import Engine from "../core/Engine";
import type { Plugin, Role } from "../core/types";
import ShaderAssembler from "../systems/ShaderAssembler";
import ProgramCache from "../rendering/ProgramCache";
import ShaderProgram from "../rendering/ShaderProgram";
import FullscreenQuad from "../rendering/FullscreenQuad";
import UniformManager from "../systems/UniformManager";

type NsToUniforms = Map<string, UniformManager>;

export default class Tracer {
    private gl: WebGL2RenderingContext;
    private canvas: HTMLCanvasElement;
    private vertexSrc: string;

    private engine = new Engine();
    private assembler = new ShaderAssembler();
    private cache: ProgramCache;
    private quad: FullscreenQuad;

    private program!: ShaderProgram;
    private nsViews: NsToUniforms = new Map();

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

    /** Assemble + (re)compile program for the current engine configuration. */
    build(): void {
        const plugins = this.engine.list();
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
    }

    /** Set viewport size in device pixels (call after you size the canvas). */
    setSize(width: number, height: number): void {
        this.gl.viewport(0, 0, width, height);
    }

    /** Draw one frame: set engine global(s), let plugins bind uniforms, draw quad. */
    frame(): void {
        const gl = this.gl;
        this.program.use();

        // Engine global (minimal by design): u_resolution (no prefix)
        const noPrefix = new UniformManager(gl, this.program, "");
        noPrefix.set2f("u_resolution", this.canvas.width, this.canvas.height);

        // Per-plugin uniforms (prefixed views)
        for (const p of this.engine.list()) {
            const view = this.nsViews.get(p.namespace);
            (p as any).applyUniforms?.(view);
        }

        this.quad.draw();
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
