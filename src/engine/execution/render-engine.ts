// src/engine/execution/render-engine.test.ts
/**
 * render-engine.test.ts — v1
 * ------------------------------------------------------------
 * PURPOSE
 *   Orchestrate one-pass rendering with a GPU Film:
 *     - Build/link/compile a shader from an AssemblyRecipe.
 *     - Compute a deterministic ProgramKey from the link result.
 *     - Cache/reuse the compiled program; hot-swap when the key changes.
 *     - Maintain and apply accumulation counters (frameIndex/sampleCount).
 *     - Delegate drawing to RenderPipeline (which owns VAO + ping-pong use).
 *
 * DESIGN
 *   - Zero feature branching: recipe selection determines shader shape.
 *   - Reset accumulation whenever the ProgramKey changes (code shape change).
 *   - Manual reset available via `resetAccumulation()`.
 *   - Film-specific uniforms are bound by the pipeline only if present in
 *     the manifest (e.g., historyColor, sampleCount), so Films that don't
 *     accumulate remain simple.
 *
 * DEPENDENCIES
 *   - compileRecipe: builds final GLSL + manifest.
 *   - linkRecipe + computeProgramKey: derive ProgramKey from resolved order.
 *   - ProgramCache-like provider to build/reuse GPU programs.
 *   - RenderPipeline-like class for drawing.
 *   - FramebufferPool for GPU film ping-pong.
 *
 * TESTABILITY
 *   - All collaborators are injected via small interfaces (see below).
 *   - No direct DOM or canvas access; width/height provided by caller.
 */

import type { AssemblyRecipe } from "../shaders/assembly-recipe";
import { linkRecipe } from "../shaders/dependency-linker";
import { compileRecipe, type UniformManifest } from "../shaders/shader-compiler";
import { computeProgramKey } from "../shaders/program-key";

// --- minimal interfaces to stay decoupled from concrete wrappers ---

export interface ProgramLike {
    use(): void;
    getUniformLocation(name: string): WebGLUniformLocation | null;
}

export interface ProgramCacheLike {
    /** Return a compiled program for the (key, sources), reusing any cached one. */
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
    render(width: number, height: number): void;
    dispose(): void;
}

export type RenderPipelineFactory = (
    gl: WebGL2RenderingContext,
    program: ProgramLike,
    pool: FramebufferPoolLike,
    manifest: UniformManifest
) => RenderPipelineLike;

export interface RenderEngineOptions {
    /** Vertex template version tag for ProgramKey derivation (default "v1"). */
    vertexTemplateVersion?: string;
}

/** Outcome metadata per render call. */
export interface RenderOutcome {
    key: string;
    recompiled: boolean;
    frameIndex: number;
    sampleCount: number;
    diagnostics: {
        moduleOrder: string[];
        warnings: string[];
    };
}

export default class RenderEngine {
    private gl: WebGL2RenderingContext;
    private cache: ProgramCacheLike;
    private pool: FramebufferPoolLike;
    private makePipeline: RenderPipelineFactory;

    private pipeline: RenderPipelineLike | null = null;
    private currentKey: string | null = null;

    private frameIndex = 0;
    private sampleCount = 0;

    private vertexTemplateVersion: string;

    constructor(
        gl: WebGL2RenderingContext,
        cache: ProgramCacheLike,
        pool: FramebufferPoolLike,
        makePipeline: RenderPipelineFactory,
        opts: RenderEngineOptions = {}
    ) {
        this.gl = gl;
        this.cache = cache;
        this.pool = pool;
        this.makePipeline = makePipeline;
        this.vertexTemplateVersion = opts.vertexTemplateVersion ?? "v1";
    }

    /** Force an accumulation reset (clears film + zeros counters). */
    resetAccumulation(): void {
        this.pool.clear();
        this.frameIndex = 0;
        this.sampleCount = 0;
    }

    /** Dispose the current pipeline/program resources owned by the engine. */
    dispose(): void {
        this.pipeline?.dispose();
        this.pipeline = null;
        this.currentKey = null;
    }

    /**
     * Render one frame for the provided recipe at (width,height).
     * - Recompiles/hot-swaps if ProgramKey changes.
     * - Increments accumulation counters post-draw (next frame sees +1).
     */
    render(width: number, height: number, recipe: AssemblyRecipe): RenderOutcome {
        // 1) Link + compute key from resolved order
        const link = linkRecipe(recipe);
        const progKey = computeProgramKey(recipe, link, this.vertexTemplateVersion);

        // 2) Compile GLSL (deterministic) + get manifest
        const compiled = compileRecipe(recipe);

        // 3) (Re)build pipeline if the key changed
        let recompiled = false;
        if (this.currentKey !== progKey.key) {
            const program = this.cache.getOrCreate(progKey.key, compiled.vertexSrc, compiled.fragmentSrc);
            this.pipeline?.dispose();
            this.pipeline = this.makePipeline(this.gl, program, this.pool, compiled.manifest);

            // new code shape → reset accumulation
            this.resetAccumulation();
            this.currentKey = progKey.key;
            recompiled = true;
        }

        // 4) Apply engine counters for this draw
        // (Films that don't consume these simply ignore)
        this.pipeline!.setFrameIndex(this.frameIndex);
        this.pipeline!.setSampleCount(this.sampleCount);

        // 5) Draw
        this.pipeline!.render(width, height);

        // 6) Advance counters for next frame
        this.frameIndex++;
        this.sampleCount++;

        return {
            key: progKey.key,
            recompiled,
            frameIndex: this.frameIndex,
            sampleCount: this.sampleCount,
            diagnostics: {
                moduleOrder: compiled.diagnostics.moduleOrder,
                warnings: compiled.diagnostics.warnings,
            },
        };
    }
}
