// src/tracer/Tracer.ts

import Engine from "../core/Engine";
import type { Plugin, Role, PipelineContext } from "../core/types";
import ShaderAssembler from "../systems/ShaderAssembler";
import UniformManager from "../systems/UniformManager";
import ParameterManager from "../systems/ParameterManager";
import ProgramCache from "../rendering/ProgramCache";
import ShaderProgram from "../rendering/ShaderProgram";
import FullscreenQuad from "../rendering/FullscreenQuad";

type NsToUniforms = Map<string, UniformManager>;

export default class Tracer {
    private gl: WebGL2RenderingContext;
    private canvas: HTMLCanvasElement;
    private vertexSrc: string;

    private engine = new Engine();
    private assembler = new ShaderAssembler();
    private cache: ProgramCache;
    private quad: FullscreenQuad;
    private paramManager = new ParameterManager();

    private program!: ShaderProgram;
    private nsViews: NsToUniforms = new Map();
    private ctx: PipelineContext = {};

    // Track controls plugin separately (doesn't participate in shader generation)
    private controlsPlugin?: Plugin;

    // Timing for controls
    private lastFrameTime: number = 0;

    constructor(opts: { canvas: HTMLCanvasElement; vertexSrc: string }) {
        this.canvas = opts.canvas;
        const gl = this.canvas.getContext("webgl2");
        if (!gl) throw new Error("WebGL2 not supported");
        this.gl = gl;

        this.cache = new ProgramCache(this.gl);
        this.quad = new FullscreenQuad(this.gl);
        this.vertexSrc = opts.vertexSrc;

        // // Set up global parameter listener for accumulation reset
        // this.paramManager.addGlobalListener((namespace, name, value, old) => {
        //     const descriptors = this.paramManager.getNamespaceParameters(namespace);
        //     const desc = descriptors.find(d => d.name === name);
        //     if (desc?.resetAccumulation && this.ctx.accumulation) {
        //         this.ctx.accumulation.reset();
        //     }
        // });
    }

    /** Register/replace the active provider for its role. */
    use(plugin: Plugin): this {
        // Special handling for controls (doesn't go into Engine)
        if (plugin.role === "controls") {
            this.controlsPlugin = plugin;
        } else {
            this.engine.use(plugin);
        }

        // Register parameters if plugin declares them
        if (plugin.parameters) {
            const descriptors = plugin.parameters();
            if (descriptors.length > 0) {
                this.paramManager.registerParameters(plugin.namespace, descriptors);

                // Apply initial parameter values to plugin state
                if (plugin.applyParameters) {
                    const view = this.paramManager.getView(plugin.namespace);
                    plugin.applyParameters(view, this.ctx);
                }
            }
        }

        return this;
    }

    /** Remove the active provider for a role. */
    clear(role: Role): void {
        if (role === "controls") {
            this.controlsPlugin = undefined;
        } else {
            this.engine.clear(role);
        }
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

    /** Assemble + (re)compile program for the current engine configuration. */
    build(): void {
        const plugins = this.engine.list();
        if (plugins.length === 0) {
            throw new Error("Tracer.build(): no plugins registered");
        }

        const { fragment, uniforms } = this.assembler.buildFragment(plugins);

        // Stable cache key = namespaces + hash of GLSL fragment
        const shaderHash = this.hash(fragment);
        const key = "engine:" + plugins.map(p => p.namespace).join("+") + `#${shaderHash}`;
        this.program = this.cache.get(this.vertexSrc, fragment, key);

        // Build prefixed views per namespace (from assembler prefixes)
        this.nsViews.clear();
        for (const [ns, info] of Object.entries(uniforms)) {
            this.nsViews.set(ns, new UniformManager(this.gl, this.program, info.prefix));
        }

        console.log("[Tracer] Built with:", plugins.map(p => `${p.role}:${p.namespace}`).join(", "));
    }

    /** Set viewport size in device pixels (call after you size the canvas). */
    setSize(width: number, height: number): void {
        this.gl.viewport(0, 0, width, height);

        // Future: Reset accumulation buffer when size changes
    }

    /** Draw one frame: update controls, apply parameters, set uniforms, draw quad. */
    frame(): void {
        if (!this.program) {
            console.warn("[Tracer] Not built yet - call build() first");
            return;
        }

        const gl = this.gl;

        // Calculate delta time for controls
        const now = performance.now() / 1000;
        const dt = this.lastFrameTime > 0 ? now - this.lastFrameTime : 0.016;
        this.lastFrameTime = now;

        // Step 1: Update controls (modifies context)
        if (this.controlsPlugin && 'update' in this.controlsPlugin) {
            (this.controlsPlugin as any).update(this.ctx, dt);
        }

        // Step 2: Apply parameters to plugin state
        // Include both engine plugins and controls plugin
        const allPlugins = [...this.engine.list()];
        if (this.controlsPlugin) allPlugins.push(this.controlsPlugin);

        for (const plugin of allPlugins) {
            if (plugin.applyParameters) {
                const view = this.paramManager.getView(plugin.namespace);
                plugin.applyParameters(view, this.ctx);
            }
        }

        // Step 3: Use shader program
        this.program.use();

        // Step 4: Set engine global uniforms (no prefix)
        const noPrefix = new UniformManager(gl, this.program, "");
        noPrefix.set2f("u_resolution", this.canvas.width, this.canvas.height);
        // Future: u_time, u_frame, u_sampleCount, etc.

        // Step 5: Apply plugin uniforms (prefixed views)
        for (const p of this.engine.list()) {
            const view = this.nsViews.get(p.namespace);
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
        if (this.program) {
            this.program.delete();
        }
        this.quad.dispose();
        this.cache.disposeAll();
    }

    /** Optional accessors for advanced usage */
    getEngine(): Engine { return this.engine; }
    getProgram(): ShaderProgram { return this.program; }

    /** Simple string hash (djb2) for stable shader cache keys */
    private hash(src: string): string {
        let h = 5381;
        for (let i = 0; i < src.length; i++) {
            h = ((h << 5) + h) ^ src.charCodeAt(i);
        }
        // base36 keeps it short and readable
        return (h >>> 0).toString(36);
    }
}
