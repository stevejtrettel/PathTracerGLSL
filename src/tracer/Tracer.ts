// src/tracer/Tracer.ts
import Engine from "../core/Engine";
import type { Plugin, PipelineContext } from "../core/types";
import UniformManager from "../systems/UniformManager";
import ParameterManager from "../systems/ParameterManager";
import ShaderProgram from "../rendering/ShaderProgram";
import FullscreenQuad from "../rendering/FullscreenQuad";

import ProgramBuilder from "../systems/ProgramBuilder";
import VariantManager from "./VariantManager";
import type { CompiledPipeline } from "./types";

/* ---------- Capability Guards ---------- */
function isUpdatable(p: any): p is { update(ctx: PipelineContext, dt: number): void } {
    return p && typeof p.update === "function";
}
function isAttachable(p: any): p is { attach(el: HTMLElement): void; detach(): void } {
    return p && typeof p.attach === "function" && typeof p.detach === "function";
}
function isShaderParticipant(p: Plugin): boolean {
    // Participates in GPU pipeline if it provides any GLSL chunks or uniforms
    const chunks = p.chunks?.() ?? [];
    const uniforms = p.uniforms?.() ?? [];
    return (chunks.length > 0) || (uniforms.length > 0);
}
/* -------------------------------------- */

export default class Tracer {
    private gl: WebGL2RenderingContext;
    private canvas: HTMLCanvasElement;

    // Shader participants managed by Engine (camera, integrator, postprocess, scene, libs, geometry shader half)
    private engine = new Engine();

    // CPU-only / pre-phase modules (e.g., keyboard controls). Multiple allowed.
    private updatables: Set<Plugin> = new Set();

    // Systems
    private builder: ProgramBuilder;
    private quad: FullscreenQuad;
    private paramManager = new ParameterManager();
    private variants = new VariantManager();

    // Compiled pipelines
    private baseCompiled?: CompiledPipeline;

    // Context & timing
    private ctx: PipelineContext = {};
    private lastFrameTime = 0;

    // Track attached attachables to manage DOM listeners
    private attached: Set<Plugin> = new Set();

    constructor(opts: { canvas: HTMLCanvasElement; vertexSrc: string }) {
        this.canvas = opts.canvas;
        const gl = this.canvas.getContext("webgl2");
        if (!gl) throw new Error("WebGL2 not supported");
        this.gl = gl;

        this.builder = new ProgramBuilder(this.gl, opts.vertexSrc);
        this.quad = new FullscreenQuad(this.gl);
    }

    // --- Public API ----------------------------------------------------------

    /** Register a plugin. Shader-participants go to Engine; updatables run in pre-phase. */
    use(plugin: Plugin): this {
        const shaderish = isShaderParticipant(plugin);
        const updatable = isUpdatable(plugin);

        if (shaderish) {
            this.engine.use(plugin);
        }
        if (updatable) {
            this.updatables.add(plugin);
            // Auto-attach if capable
            if (isAttachable(plugin)) {
                try { plugin.attach(this.canvas); this.attached.add(plugin); } catch {}
            }
        }

        this.registerParamsFor(plugin);
        return this;
    }

    /** Remove a shader-role plugin (by role). Updatables are not keyed by role; remove manually if needed. */
    clear(role: string): void {
        // Shader participants are role-keyed
        this.engine.clear(role as any);

        // If an updatable happened to share that role name, we do nothing here.
        // (If you need removal: add a remove(plugin) API or track by namespace.)
    }

    /** Define a named variant by specifying role overrides (shader participants only). */
    addVariant(name: string, overrides: { [R in string]?: Plugin }): this {
        // Pre-register parameters so UI is ready pre-build
        for (const role of Object.keys(overrides)) {
            const p = overrides[role]!;
            this.registerParamsFor(p);
        }
        this.variants.addVariant(name, overrides as any);
        return this;
    }

    /** Build the base program only. */
    build(): void {
        const shaderPlugins = this.engine.list().filter(isShaderParticipant);
        this.baseCompiled = this.buildForPlugins(shaderPlugins);

        // Default active = base
        this.variants.useVariant(null);

        // Ensure any attachables among updatables are attached (if not already)
        this.syncAttachments();

        console.log("[Tracer] Built base program.");
    }

    /** Build the base program and all variants (precompile for hot-switching). */
    buildAll(): void {
        const basePlugins = this.engine.list().filter(isShaderParticipant);
        if (basePlugins.length === 0) {
            throw new Error("Tracer.buildAll(): no base plugins registered");
        }
        this.baseCompiled = this.buildForPlugins(basePlugins);

        // Compile all variants against current base; filter to shader participants
        this.variants.buildAllVariants(
            basePlugins,
            this.buildForPlugins.bind(this),
            isShaderParticipant
        );

        // Default active = base
        this.variants.useVariant(null);

        // Attach any attachables among updatables
        this.syncAttachments();

        console.log("[Tracer] buildAll(): base +", this.variants.listVariantNames().length, "variant(s) compiled.");
    }

    /** Use a compiled variant by name; pass null to revert to base. */
    useVariant(name: string | null): void {
        this.variants.useVariant(name);
    }

    /** List available variant names. */
    listVariants(): string[] {
        return this.variants.listVariantNames();
    }

    /** Set pipeline context (e.g., geometry frame). */
    setContext(ctx: Partial<PipelineContext>): this {
        Object.assign(this.ctx, ctx);
        return this;
    }

    /** Set a parameter value programmatically. */
    setParameter(namespace: string, name: string, value: any): this {
        this.paramManager.set(namespace, name, value);
        return this;
    }

    /** Get parameter manager for UI generation. */
    getParameterManager(): ParameterManager {
        return this.paramManager;
    }

    /** Set viewport size in device pixels (call after you size the canvas). */
    setSize(width: number, height: number): void {
        this.gl.viewport(0, 0, width, height);
    }

    /** Draw one frame: PRE (updatables) → SHADER (uniforms & draw). */
    frame(): void {
        const compiled = this.variants.getActiveCompiled(this.baseCompiled);
        if (!compiled) {
            console.warn("[Tracer] Not built yet - call build() or buildAll() first");
            return;
        }

        const gl = this.gl;

        // Time
        const now = performance.now() / 1000;
        const dt = this.lastFrameTime > 0 ? now - this.lastFrameTime : 0.016;
        this.lastFrameTime = now;

        // -------- PRE PHASE: CPU updatables --------
        for (const p of this.updatables) {
            if (p.applyParameters) {
                const view = this.paramManager.getView(p.namespace);
                p.applyParameters(view, this.ctx);
            }
            if (isUpdatable(p)) {
                p.update(this.ctx, dt);
            }
        }

        // -------- SHADER PHASE --------
        const pluginSet = compiled.plugins; // shader participants only

        // Apply parameters for shader-participating plugins
        for (const plugin of pluginSet) {
            if (plugin.applyParameters) {
                const view = this.paramManager.getView(plugin.namespace);
                plugin.applyParameters(view, this.ctx);
            }
        }

        // Use program
        compiled.program.use();

        // Global uniforms (no prefix)
        const noPrefix = new UniformManager(gl, compiled.program, "");
        noPrefix.set2f("u_resolution", this.canvas.width, this.canvas.height);

        // Prefixed plugin uniforms
        for (const p of pluginSet) {
            const view = compiled.nsViews.get(p.namespace);
            if (view && p.applyUniforms) {
                p.applyUniforms(view, this.ctx);
            }
        }

        // Draw
        this.quad.draw();
    }

    /** Save current parameter state. */
    saveParameters(): Record<string, Record<string, any>> {
        return this.paramManager.serialize();
    }

    /** Restore parameter state. */
    loadParameters(data: Record<string, Record<string, any>>): this {
        this.paramManager.deserialize(data);
        return this;
    }

    /** Clean up resources. */
    dispose(): void {
        if (this.baseCompiled) {
            this.baseCompiled.program.delete();
            this.baseCompiled = undefined;
        }
        this.variants.disposeAllPrograms();
        this.quad.dispose();
        this.builder.dispose();

        // Detach attachables
        for (const p of this.attached) {
            if (isAttachable(p)) {
                try { p.detach(); } catch {}
            }
        }
        this.attached.clear();
    }

    /** Optional accessor */
    getProgram(): ShaderProgram | undefined {
        return this.variants.getActiveCompiled(this.baseCompiled)?.program;
    }

    // --- Internals -----------------------------------------------------------

    /** Build a compiled pipeline for a given plugin list. */
    private buildForPlugins(plugins: Plugin[]): CompiledPipeline {
        // Ensure we only pass shader participants into the GPU builder
        const shaderPlugins = plugins.filter(isShaderParticipant);
        return this.builder.build(shaderPlugins);
    }

    /** Register parameter descriptors (and apply initial values) for a plugin if provided. */
    private registerParamsFor(plugin: Plugin): void {
        if (plugin.parameters) {
            const descriptors = plugin.parameters();
            if (descriptors.length > 0) {
                this.paramManager.registerParameters(plugin.namespace, descriptors);
                if (plugin.applyParameters) {
                    const view = this.paramManager.getView(plugin.namespace);
                    plugin.applyParameters(view, this.ctx);
                }
            }
        }
    }

    /** Ensure attachables among updatables are attached to the canvas. */
    private syncAttachments(): void {
        for (const p of this.updatables) {
            if (isAttachable(p) && !this.attached.has(p)) {
                try { p.attach(this.canvas); this.attached.add(p); } catch {}
            }
        }
    }
}
