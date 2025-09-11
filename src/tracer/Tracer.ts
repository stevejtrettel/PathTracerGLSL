/**
 * Tracer with clean uniform system
 */
import Engine from "../core/Engine";
import type { Plugin, Role, PipelineContext, UniformSpec } from "../core/types";
import ShaderAssembler from "../systems/ShaderAssembler";
import ProgramCache from "../rendering/ProgramCache";
import ShaderProgram from "../rendering/ShaderProgram";
import FullscreenQuad from "../rendering/FullscreenQuad";
import UniformManager from "../systems/UniformManager";

export default class Tracer {
    private gl: WebGL2RenderingContext;
    private canvas: HTMLCanvasElement;
    private vertexSrc: string;

    private engine = new Engine();
    private assembler = new ShaderAssembler();
    private cache: ProgramCache;
    private quad: FullscreenQuad;

    private program!: ShaderProgram;
    private nsViews: Map<string, UniformManager> = new Map();
    private ctx: PipelineContext = {};

    constructor(opts: { canvas: HTMLCanvasElement; vertexSrc: string }) {
        this.canvas = opts.canvas;
        const gl = this.canvas.getContext("webgl2");
        if (!gl) throw new Error("WebGL2 not supported");
        this.gl = gl;

        this.cache = new ProgramCache(this.gl);
        this.quad = new FullscreenQuad(this.gl);
        this.vertexSrc = opts.vertexSrc;
    }

    /** Register/replace the active provider for its role. */
    use(plugin: Plugin): this {
        this.engine.use(plugin);
        return this;
    }

    /** Remove the active provider for a role. */
    clear(role: Role): void {
        this.engine.clear(role);
    }

    /** Set pipeline context */
    setContext(ctx: PipelineContext): void {
        this.ctx = ctx;
    }

    /** Assemble + compile program for the current engine configuration. */
    build(): void {
        const plugins = this.engine.list();
        const { fragment, uniforms } = this.assembler.buildFragment(plugins);

        // Stable cache key
        const shaderHash = this.hash(fragment);
        const key = "engine:" + plugins.map(p => p.namespace).join("+") + `#${shaderHash}`;
        this.program = this.cache.get(this.vertexSrc, fragment, key);

        // Build prefixed views per namespace
        this.nsViews.clear();
        for (const [ns, info] of Object.entries(uniforms)) {
            this.nsViews.set(ns, new UniformManager(this.gl, this.program, info.prefix));
        }
    }

    /** Set viewport size in device pixels */
    setSize(width: number, height: number): void {
        this.gl.viewport(0, 0, width, height);
    }

    /** Draw one frame */
    frame(): void {
        const gl = this.gl;
        this.program.use();

        // Engine global
        const noPrefix = new UniformManager(gl, this.program, "");
        noPrefix.set2f("u_resolution", this.canvas.width, this.canvas.height);

        // Per-plugin uniforms
        for (const p of this.engine.list()) {
            const view = this.nsViews.get(p.namespace);
            if (!view) continue;

            if (p.getUniforms) {
                const specs = p.getUniforms();
                this.applyUniformSpecs(view, specs);
            }
        }

        this.quad.draw();
    }

    /** Apply uniform specifications to a manager */
    private applyUniformSpecs(manager: UniformManager, specs: Record<string, UniformSpec>): void {
        for (const [name, spec] of Object.entries(specs)) {
            const value = spec.value;

            if (typeof value === 'number') {
                // Use type hint to distinguish int vs float
                if (spec.type === 'int') {
                    manager.set1i(name, value);
                } else {
                    manager.set1f(name, value);
                }
            } else if (Array.isArray(value)) {
                const isInt = spec.type.startsWith('ivec');
                switch (value.length) {
                    case 2:
                        if (isInt) manager.set2i(name, value[0], value[1]);
                        else manager.set2f(name, value[0], value[1]);
                        break;
                    case 3:
                        if (isInt) manager.set3i(name, value[0], value[1], value[2]);
                        else manager.set3f(name, value[0], value[1], value[2]);
                        break;
                    case 4:
                        if (isInt) manager.set4i(name, value[0], value[1], value[2], value[3]);
                        else manager.set4f(name, value[0], value[1], value[2], value[3]);
                        break;
                }
            } else if (value instanceof Float32Array) {
                if (value.length === 9) {
                    manager.setMatrix3fv(name, value);
                } else if (value.length === 16) {
                    manager.setMatrix4fv(name, value);
                }
            }
        }
    }

    /** Optional accessors */
    getEngine(): Engine { return this.engine; }
    getProgram(): ShaderProgram { return this.program; }

    private hash(src: string): string {
        let h = 5381;
        for (let i = 0; i < src.length; i++) {
            h = ((h << 5) + h) ^ src.charCodeAt(i);
        }
        return (h >>> 0).toString(36);
    }
}
