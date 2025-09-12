import ShaderProgram from "./ShaderProgram";

/**
 * ProgramCache
 * - Caches ShaderProgram instances by a stable key.
 * - Key format: "<extraKey>|<vertexHash>:<fragmentHash>"
 *   - If no extraKey is provided, the key is just "<vertexHash>:<fragmentHash>".
 */
export default class ProgramCache {
    private gl: WebGL2RenderingContext;
    private cache = new Map<string, ShaderProgram>();

    constructor(gl: WebGL2RenderingContext) {
        this.gl = gl;
    }

    /** Get or create a program. `extraKey` (e.g., "PluginName:prefix") is optional. */
     get(vertSrc: string, fragSrc: string, extraKey?: string): ShaderProgram {
        const key = this.makeKey(vertSrc, fragSrc, extraKey);
        const hit = this.cache.get(key);
        if (hit) return hit;

        const prog = new ShaderProgram(this.gl, vertSrc, fragSrc);
        this.cache.set(key, prog);
        return prog;
    }

    disposeAll(): void {
        for (const prog of this.cache.values()) prog.delete();
        this.cache.clear();
    }

    // --- internals ---

    private makeKey(vertSrc: string, fragSrc: string, extraKey?: string): string {
        const pair = `${this.djb2(vertSrc)}:${this.djb2(fragSrc)}`;
        return extraKey ? `${extraKey}|${pair}` : pair;
    }

    private djb2(s: string): number {
        let h = 5381;
        for (let i = 0; i < s.length; i++) h = ((h << 5) + h) ^ s.charCodeAt(i);
        return h >>> 0;
    }
}
