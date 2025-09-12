// src/systems/ProgramBuilder.ts
import type { Plugin } from "../core/types";
import ShaderAssembler from "./ShaderAssembler";
import ProgramCache from "../rendering/ProgramCache";
import ShaderProgram from "../rendering/ShaderProgram";
import UniformManager from "./UniformManager";
import type { CompiledPipeline, NsToUniforms } from "../tracer/types";

/**
 * ProgramBuilder
 * - Given a list of plugins, assembles the fragment shader, compiles/links a program,
 *   and materializes per-namespace UniformManager views.
 * - Stateless w.r.t. pipeline config; holds assembler/cache and vertexSrc.
 */
export default class ProgramBuilder {
    private gl: WebGL2RenderingContext;
    private assembler: ShaderAssembler;
    private cache: ProgramCache;
    private vertexSrc: string;

    constructor(gl: WebGL2RenderingContext, vertexSrc: string) {
        this.gl = gl;
        this.vertexSrc = vertexSrc;
        this.assembler = new ShaderAssembler();
        this.cache = new ProgramCache(gl);
    }

    /** Assemble + compile for the given plugins; returns compiled pipeline artifacts. */
    build(plugins: Plugin[]): CompiledPipeline {
        if (!plugins.length) throw new Error("ProgramBuilder.build(): empty plugin set");

        const { fragment, uniforms } = this.assembler.buildFragment(plugins);

        const shaderHash = this.hash(fragment);
        const key = "engine:" + plugins.map(p => p.namespace).join("+") + `#${shaderHash}`;

        const program: ShaderProgram = this.cache.get(this.vertexSrc, fragment, key);

        const nsViews: NsToUniforms = new Map();
        for (const [ns, info] of Object.entries(uniforms)) {
            nsViews.set(ns, new UniformManager(this.gl, program, info.prefix));
        }

        return { plugins, program, nsViews, key, hash: shaderHash };
    }

    /** Dispose all cached GL programs. */
    dispose(): void {
        this.cache.disposeAll();
    }

    // --- internals ---

    /** Simple string hash (djb2) for stable shader cache keys */
    private hash(src: string): string {
        let h = 5381;
        for (let i = 0; i < src.length; i++) {
            h = ((h << 5) + h) ^ src.charCodeAt(i);
        }
        return (h >>> 0).toString(36);
    }
}
