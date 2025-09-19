// src/tracer/Tracer.ts
import Engine from "../core/Engine";
import type { Plugin, PipelineContext } from "../core/types";
import ParameterManager from "../systems/ParameterManager";
import ShaderProgram from "../rendering/ShaderProgram";

import ProgramBuilder from "../systems/ProgramBuilder";
import VariantManager from "./VariantManager";
import type { CompiledPipeline } from "./types";
import { FrameRenderer } from "./FrameRenderer";

/* ---------- Capability Guards ---------- */
function isUpdatable(p: any): p is { update(ctx: PipelineContext, dt: number): void } {
    return p && typeof p.update === "function";
}
function isAttachable(p: any): p is { attach(el: HTMLElement): void; detach(): void } {
    return p && typeof p.attach === "function" && typeof p.detach === "function";
}
function isShaderParticipant(p: Plugin): boolean {
    const chunks = p.chunks?.() ?? [];
    const uniforms = p.uniforms?.() ?? [];
    return (chunks.length > 0) || (uniforms.length > 0);
}
/* -------------------------------------- */

export default class Tracer {
    private gl: WebGL2RenderingContext;
    private canvas: HTMLCanvasElement;
    private vertexSrc: string;

    // Plugin management
    private engine = new Engine();
    private updatables: Set<Plugin> = new Set();
    private attached: Set<Plugin> = new Set();

    // Systems
    private builder: ProgramBuilder;
    private renderer: FrameRenderer;
    private paramManager = new ParameterManager();
    private variants = new VariantManager();

    // Compiled pipelines
    private baseCompiled?: CompiledPipeline;

    // Context & timing
    private ctx: PipelineContext = {};
    private lastFrameTime = 0;

    constructor(opts: { canvas: HTMLCanvasElement; vertexSrc: string }) {
        this.canvas = opts.canvas;
        const gl = this.canvas.getContext("webgl2");
        if (!gl) throw new Error("WebGL2 not supported");
        this.gl = gl;

        this.vertexSrc = opts.vertexSrc;
        this.builder = new ProgramBuilder(this.gl, opts.vertexSrc);
        this.renderer = new FrameRenderer(this.gl, opts.vertexSrc);
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
                try {
                    plugin.attach(this.canvas);
                    this.attached.add(plugin);
                } catch {}
            }
        }

        this.registerParamsFor(plugin);
        return this;
    }

    /** Remove a shader-role plugin (by role). */
    clear(role: string): void {
        this.engine.clear(role as any);
    }

    /** Define a named variant by specifying role overrides. */
    addVariant(name: string, overrides: { [R in string]?: Plugin }): this {
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

        // Ensure any attachables are attached
        this.syncAttachments();

        // Prepare progressive resources if needed
        this.prepareRendererForActive();

        console.log("[Tracer] Built base program.");
    }

    /** Build the base program and all variants. */
    buildAll(): void {
        const basePlugins = this.engine.list().filter(isShaderParticipant);
        if (basePlugins.length === 0) {
            throw new Error("Tracer.buildAll(): no base plugins registered");
        }
        this.baseCompiled = this.buildForPlugins(basePlugins);

        this.variants.buildAllVariants(
            basePlugins,
            this.buildForPlugins.bind(this),
            isShaderParticipant
        );

        // Default active = base
        this.variants.useVariant(null);

        // Attach any attachables
        this.syncAttachments();

        // Prepare progressive resources if needed
        this.prepareRendererForActive();

        console.log("[Tracer] buildAll(): base +", this.variants.listVariantNames().length, "variant(s) compiled.");
    }

    /** Use a compiled variant by name; pass null to revert to base. */
    useVariant(name: string | null): void {
        this.variants.useVariant(name);
        this.prepareRendererForActive();
        this.renderer.resetAccumulation();
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

    /** Set viewport size in device pixels. */
    setSize(width: number, height: number): void {
        this.renderer.resize(width, height);
    }

    /** Draw one frame. */
    frame(): void {
        const compiled = this.variants.getActiveCompiled(this.baseCompiled);
        if (!compiled) {
            console.warn("[Tracer] Not built yet - call build() or buildAll() first");
            return;
        }

        // Update timing
        const now = performance.now() / 1000;
        const dt = this.lastFrameTime > 0 ? now - this.lastFrameTime : 0.016;
        this.lastFrameTime = now;

        // CPU UPDATE PHASE: updatables
        for (const p of this.updatables) {
            if (p.applyParameters) {
                const view = this.paramManager.getView(p.namespace);
                p.applyParameters(view, this.ctx);
            }
            if (isUpdatable(p)) {
                p.update(this.ctx, dt);
            }
        }

        // PARAMETER APPLICATION: shader participants
        for (const plugin of compiled.plugins) {
            if (plugin.applyParameters) {
                const view = this.paramManager.getView(plugin.namespace);
                plugin.applyParameters(view, this.ctx);
            }
        }

        // RENDER
        this.renderer.render(compiled, this.ctx, this.canvas);
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
        this.builder.dispose();
        this.renderer.dispose();

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

    // --- Private helpers ---

    private buildForPlugins(plugins: Plugin[]): CompiledPipeline {
        const shaderPlugins = plugins.filter(isShaderParticipant);
        return this.builder.build(shaderPlugins);
    }

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

    private syncAttachments(): void {
        for (const p of this.updatables) {
            if (isAttachable(p) && !this.attached.has(p)) {
                try {
                    p.attach(this.canvas);
                    this.attached.add(p);
                } catch {}
            }
        }
    }

    private prepareRendererForActive(): void {
        const compiled = this.variants.getActiveCompiled(this.baseCompiled);
        if (compiled) {
            this.renderer.ensureProgressiveResources(compiled, this.canvas);
        }
    }
}
