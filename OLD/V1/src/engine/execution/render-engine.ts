// src/engine/execution/render-engine.ts
/**
 * render-engine.ts — v2.1 (compile-on-change + correct ResourceBinder wiring)
 * ------------------------------------------------------------
 * Orchestrates single-pass rendering with deterministic shader assembly.
 */

import type { AssemblyRecipe } from "../shaders/assembly-recipe";
import { linkRecipe } from "../shaders/dependency-linker";
import { compileRecipe, type UniformManifest } from "../shaders/shader-compiler";
import { computeProgramKey } from "../shaders/program-key";

import UniformBinder from "../bindings/uniform-binder";
import ResourceBinder from "../bindings/resource-binder";
import TextureUnitPool from "../bindings/texture-unit-pool";

import type ResourceDirectory from "../resources/resource-directory";

import ParameterStore, {
    type ParameterKind,
    type ParamValue as ParameterValue,
} from "../parameters/parameter-store";
import { registerModuleParams } from "../parameters/register-module-params";
import type { ModuleParamSchema } from "../../core/shader-fragment";

// ---------- Public test-facing types ----------

export interface ProgramLike {
    getUniformLocation(name: string): WebGLUniformLocation | null;
}

export interface ProgramCacheLike {
    getOrCreate(key: string, vertexSrc: string, fragmentSrc: string): ProgramLike;
}

export interface FramebufferPoolLike {
    ensureSize(w: number, h: number): void;
    pair(): { readTex: WebGLTexture | null; writeFbo: WebGLFramebuffer | null };
    swap(): void;
    clear(): void;
}

export interface RenderPipelineLike {
    setFrameIndex(i: number): void;
    setSampleCount(n: number): void;
    render(w: number, h: number): void;
    dispose(): void;
}

export type RenderPipelineFactory = (
    gl: WebGL2RenderingContext,
    program: ProgramLike,
    pool: FramebufferPoolLike,
    manifest: UniformManifest
) => RenderPipelineLike;

export interface RenderOutcome {
    key: string;
    recompiled: boolean;
    frameIndex: number;
    sampleCount: number;
    diagnostics: {
        moduleOrder: string[];
        warnings: string[];
        resources: {
            boundSamplers: number;
            skippedSamplers: string[];
            errors: string[];
        };
    };
}

// ---------- Engine implementation ----------

export default class RenderEngine {
    private gl: WebGL2RenderingContext;
    private cache: ProgramCacheLike;
    private pool: FramebufferPoolLike;
    private makePipeline: RenderPipelineFactory;

    private pipeline: RenderPipelineLike | null = null;
    private binder: UniformBinder | null = null;
    private resBinder: ResourceBinder | null = null;

    private currentKey: string | null = null;
    private vertexTemplateVersion = "v1";

    private frameIndex = 0;
    private sampleCount = 0;

    private paramStore = new ParameterStore();
    private resourceDir: ResourceDirectory | null = null;

    // Persistent sampler unit allocator (stable across frames/programs)
    private texUnits = new TextureUnitPool({ size: 8, baseUnit: 0 });

    // Cached compile products for the active ProgramKey
    private lastManifest: UniformManifest | null = null;
    private lastDiagnostics: { warnings: string[]; entrySymbol: string; moduleOrder: string[] } | null = null;

    // Optional micro-stats hook (debug)
    public onRenderStats?: (stats: {
        recompiled: boolean;
        boundUniforms: number;
        skippedUniforms: string[];
    }) => void;

    constructor(
        gl: WebGL2RenderingContext,
        cache: ProgramCacheLike,
        pool: FramebufferPoolLike,
        pipelineFactory: RenderPipelineFactory
    ) {
        this.gl = gl;
        this.cache = cache;
        this.pool = pool;
        this.makePipeline = pipelineFactory;
    }

    /** Expose parameter store for tests and tooling. */
    public getParameterStore(): ParameterStore {
        return this.paramStore;
    }

    /** Manual accumulation reset: clears film and zeros counters for next frame. */
    public resetAccumulation(): void {
        this.pool.clear();
        this.frameIndex = 0;
        this.sampleCount = 0;
    }

    /** App-side hook: provide the per-frame resource directory used for sampler binding. */
    public setResourceDirectory(dir: ResourceDirectory | null): void {
        this.resourceDir = dir;
    }

    /** Dispose current pipeline resources. */
    public dispose(): void {
        this.pipeline?.dispose();
        this.pipeline = null;
        this.binder = null;
        this.resBinder = null;
        this.currentKey = null;
        this.lastManifest = null;
        this.lastDiagnostics = null;
    }

    render(width: number, height: number, recipe: AssemblyRecipe): RenderOutcome {
        // A) Gather dirty params up front
        const dirty = this.paramStore.collectDirty();
        const wantsProgramReset = dirty.some((d) => d.resetPolicy === "program");
        const wantsAccumReset = dirty.some((d) => d.resetPolicy === "accumulation");

        // If program-level changes occurred, force a recompile regardless of key equality.
        if (wantsProgramReset && this.currentKey !== null) {
            this.pipeline?.dispose();
            this.pipeline = null;
            this.binder = null;
            this.resBinder = null;
            this.currentKey = null;
            this.lastManifest = null;
            this.lastDiagnostics = null;
        }

        // B) Link + compute key; compile if needed
        const link = linkRecipe(recipe);
        const progKey = computeProgramKey(recipe, link, this.vertexTemplateVersion);

        let recompiled = false;

        if (this.currentKey !== progKey.key) {
            // Compile this recipe shape (once per key)
            const compiled = compileRecipe(recipe);

            const program = this.cache.getOrCreate(
                progKey.key,
                compiled.vertexSrc,
                compiled.fragmentSrc
            );

            // Rebuild pipeline and binders
            this.pipeline?.dispose();
            this.pipeline = this.makePipeline(this.gl, program, this.pool, compiled.manifest);
            this.binder = new UniformBinder(this.gl, program, compiled.manifest);
            this.resBinder = new ResourceBinder(this.gl, this.texUnits, this.binder, compiled.manifest);

            // Cache manifest/diagnostics for reuse while key is stable
            this.lastManifest = compiled.manifest;
            this.lastDiagnostics = compiled.diagnostics;

            // Auto-register module parameter schemas for this program shape
            this.registerParamsForRecipe(recipe);

            // New code shape → reset accumulation
            this.resetAccumulation();
            this.currentKey = progKey.key;
            recompiled = true;
        } else if (wantsAccumReset) {
            // Only reset film if we didn't already do so due to a recompile.
            this.resetAccumulation();
        }

        // Ensure film buffers are correct size each frame
        this.pool.ensureSize(width, height);

        // C) Bind dirty uniforms via binder (if any)
        let boundCount = 0;
        let skipped: string[] = [];
        if (this.binder && dirty.length) {
            const items = dirty.map((d) => ({
                logical: d.logical,
                value: d.value as ParameterValue,
                kind: d.kind as ParameterKind,
            }));
            const res = this.binder.setMany(items);
            boundCount = res.bound;
            skipped = res.skipped;

            // Mark params clean by scope
            const perScope = new Map<string, string[]>();
            for (const d of dirty) {
                const arr = perScope.get(d.scope) ?? [];
                arr.push(d.logical);
                perScope.set(d.scope, arr);
            }
            for (const [scope, names] of perScope) {
                this.paramStore.markClean(scope, names);
            }
        }

        // D) Bind GPU resources (samplers) from the provided directory, if any
        const resDiag = { boundSamplers: 0, skippedSamplers: [] as string[], errors: [] as string[] };
        if (this.resourceDir && this.resBinder) {
            const snapshot = this.resourceDir.snapshot();
            const rb = this.resBinder.bind(snapshot);
            resDiag.boundSamplers = rb.bound ?? 0;
            resDiag.skippedSamplers = rb.skipped ?? [];
            resDiag.errors = rb.errors ?? [];
        }

        // E) Apply engine counters and draw
        this.pipeline!.setFrameIndex(this.frameIndex);
        this.pipeline!.setSampleCount(this.sampleCount);
        this.pipeline!.render(width, height);

        // F) Advance counters
        this.frameIndex++;
        this.sampleCount++;

        // Optional diagnostics hook
        if (this.onRenderStats) {
            this.onRenderStats({ recompiled, boundUniforms: boundCount, skippedUniforms: skipped });
        }

        const diag = this.lastDiagnostics ?? { warnings: [], entrySymbol: "", moduleOrder: [] };

        return {
            key: this.currentKey ?? progKey.key,
            recompiled,
            frameIndex: this.frameIndex,
            sampleCount: this.sampleCount,
            diagnostics: {
                moduleOrder: diag.moduleOrder,
                warnings: diag.warnings,
                resources: resDiag,
            },
        };
    }

    // ---------- internals ----------

    /** Register module parameter schemas (if provided) when a new program shape becomes active. */
    private registerParamsForRecipe(recipe: AssemblyRecipe): void {
        for (const m of recipe.modules) {
            const schema = (m as any).parameters as ModuleParamSchema | undefined;
            if (!schema || schema.length === 0) continue;
            registerModuleParams(this.paramStore as any, m.id, schema as any);
        }
    }
}
