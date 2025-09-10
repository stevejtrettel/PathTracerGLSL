import ShaderProgram from "./ShaderProgram";

/**
 * ProgramCache
 * - Caches ShaderProgram instances by a stable key.
 * - If you don't pass a key, it hashes the shader sources (djb2).
 * - Keeps your hot-swaps fast: compile once, reuse many times.
 */
export default class ProgramCache {
    private gl: WebGL2RenderingContext;
    private cache = new Map<string, ShaderProgram>();

    constructor(gl: WebGL2RenderingContext) {
        this.gl = gl;
    }

    /** Get or create a program. If key is omitted, we hash vert+frag. */
    get(vertSrc: string, fragSrc: string, key?: string): ShaderProgram {
        const k = key ?? this.hashPair(vertSrc, fragSrc);
        const hit = this.cache.get(k);
        if (hit) return hit;

        const prog = new ShaderProgram(this.gl, vertSrc, fragSrc);
        this.cache.set(k, prog);
        return prog;
    }

    /** Optional: free everything (e.g., on teardown). */
    disposeAll(): void {
        for (const prog of this.cache.values()) prog.delete();
        this.cache.clear();
    }

    private hashPair(a: string, b: string): string {
        return `${this.djb2(a)}:${this.djb2(b)}`;
    }

    private djb2(s: string): number {
        let h = 5381;
        for (let i = 0; i < s.length; i++) h = ((h << 5) + h) ^ s.charCodeAt(i);
        return h >>> 0;
    }
}
