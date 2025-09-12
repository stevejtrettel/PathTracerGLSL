// src/tracer/Tracer.ts

import Engine from "../core/Engine";
import type { Plugin, Role, PipelineContext } from "../core/types";
import UniformManager from "../systems/UniformManager";
import ParameterManager from "../systems/ParameterManager";
import ShaderProgram from "../rendering/ShaderProgram";
import FullscreenQuad from "../rendering/FullscreenQuad";

import ProgramBuilder from "../systems/ProgramBuilder";
import VariantManager from "./VariantManager";
import type { CompiledPipeline } from "./types";

export default class Tracer {
    private gl: WebGL2RenderingContext;
    private canvas: HTMLCanvasElement;

    // Base (default) configuration
    private engine = new Engine();                 // non-controls plugins
    private baseControls?: Plugin;                 // controls plugin (not in Engine)

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

    constructor(opts: { canvas: HTMLCanvasElement; vertexSrc: string }) {
        this.canvas = opts.canvas;
        const gl = this.canvas.getContext("webgl2");
        if (!gl) throw new Error("WebGL2 not supported");
        this.gl = gl;

        this.builder = new ProgramBuilder(this.gl, opts.vertexSrc);
        this.quad = new FullscreenQuad(this.gl);
    }

    // --- Public API ----------------------------------------------------------

    /** Register/replace the active provider for its role in the *base* configuration. */
    use(plugin: Plugin): this {
        if (plugin.role === "controls") {
            this.baseControls = plugin;
            this.registerParamsFor(plugin);
        } else {
            this.engine.use(plugin);
            this.registerParamsFor(plugin);
        }
        return this;
    }

    /** Remove the active provider for a role from the *base* configuration. */
    clear(role: Role): void {
        if (role === "controls") {
            this.baseControls = undefined;
        } else {
            this.engine.clear(role);
        }
    }

    /** Define a named variant by specifying role overrides (any subset of roles). */
    addVariant(name: string, overrides: { [R in Role]?: Plugin }): this {
        // Register parameters for override plugins now so UI is ready pre-build
        for (const role of Object.keys(overrides) as Role[]) {
            const p = overrides[role]!;
            this.registerParamsFor(p);
        }
        this.variants.addVariant(name, overrides);
        return this;
    }

    /** Build the base program only (compatibility). Prefer buildAll() for variants. */
    build(): void {
        this.baseCompiled = this.buildForPlugins(this.engine.list());
        // Default active = base
        this.variants.useVariant(null);
        console.log("[Tracer] Built base program.");
    }

    /** Build the base program and all variants (precompile for hot-switching). */
    buildAll(): void {
        const basePlugins = this.engine.list();
        if (basePlugins.length === 0) {
            throw new Error("Tracer.buildAll(): no base plugins registered");
        }
        this.baseCompiled = this.buildForPlugins(basePlugins);

        // Ask VariantManager to compile all variants against the current base
        this.variants.buildAllVariants(basePlugins, this.buildForPlugins.bind(this));

        // Default active = base
        this.variants.useVariant(null);
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

    /** Draw one frame: update controls, apply parameters, set uniforms, draw quad. */
    frame(): void {
        const compiled = this.variants.getActiveCompiled(this.baseCompiled);
        if (!compiled) {
            console.warn("[Tracer] Not built yet - call build() or buildAll() first");
            return;
        }

        const gl = this.gl;

        // Calculate delta time for controls
        const now = performance.now() / 1000;
        const dt = this.lastFrameTime > 0 ? now - this.lastFrameTime : 0.016;
        this.lastFrameTime = now;

        // Resolve active controls (variant override takes precedence over base)
        const activeControls = this.variants.getActiveControls(this.baseControls);

        // Step 1: Update controls (may mutate ctx)
        if (activeControls && "update" in activeControls) {
            (activeControls as any).update(this.ctx, dt);
        }

        // Compute the active plugin set that participates in the shader (no controls)
        const pluginSet = compiled.plugins;

        // Step 2: Apply parameters to plugin state (plus controls if present)
        const toApplyParams: Plugin[] = activeControls ? [...pluginSet, activeControls] : pluginSet;
        for (const plugin of toApplyParams) {
            if (plugin.applyParameters) {
                const view = this.paramManager.getView(plugin.namespace);
                plugin.applyParameters(view, this.ctx);
            }
        }

        // Step 3: Use shader program
        compiled.program.use();

        // Step 4: Set engine global uniforms (no prefix)
        const noPrefix = new UniformManager(gl, compiled.program, "");
        noPrefix.set2f("u_resolution", this.canvas.width, this.canvas.height);

        // Step 5: Apply plugin uniforms (prefixed views)
        for (const p of pluginSet) {
            const view = compiled.nsViews.get(p.namespace);
            if (view && p.applyUniforms) {
                p.applyUniforms(view, this.ctx);
            }
        }

        // Step 6: Draw fullscreen quad
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
    }

    /** Optional accessor */
    getProgram(): ShaderProgram | undefined {
        return this.variants.getActiveCompiled(this.baseCompiled)?.program;
    }

    // --- Internals -----------------------------------------------------------

    /** Build a compiled pipeline for a given plugin list. */
    private buildForPlugins(plugins: Plugin[]): CompiledPipeline {
        return this.builder.build(plugins);
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
}
