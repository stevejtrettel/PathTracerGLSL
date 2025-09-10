import ShaderProgram from "../rendering/ShaderProgram";

/**
 * Uniforms: tiny helper that lets plugins set uniforms by *local* names.
 * - Optionally takes a `prefix` for future namespacing (engine-provided).
 * - Caches locations so lookups are done once.
 * - Minimal setters for now; we’ll add more as needed.
 */
export default class Uniforms {
    private gl: WebGL2RenderingContext;
    private program: ShaderProgram;
    private prefix: string;
    private cache = new Map<string, WebGLUniformLocation>();

    constructor(
        gl: WebGL2RenderingContext,
        program: ShaderProgram,
        prefix: string = "" // e.g., "u_solid_color_" later; empty for now
    ) {
        this.gl = gl;
        this.program = program;
        this.prefix = prefix;
    }

    /** Resolve and cache the (prefixed) uniform location. Throws if not found. */
    private loc(localName: string): WebGLUniformLocation {
        const gpuName = this.prefix ? `${this.prefix}${localName}` : localName;
        let loc = this.cache.get(gpuName);
        if (!loc) {
            loc = this.program.getUniformLocation(gpuName);
            this.cache.set(gpuName, loc);
        }
        return loc;
    }

    // --- Minimal setters; expand as needed ---

    set1f(name: string, x: number): void {
        this.gl.uniform1f(this.loc(name), x);
    }

    set2f(name: string, x: number, y: number): void {
        this.gl.uniform2f(this.loc(name), x, y);
    }

    set3f(name: string, x: number, y: number, z: number): void {
        this.gl.uniform3f(this.loc(name), x, y, z);
    }

    set2fv(name: string, v: Float32List): void {
        this.gl.uniform2fv(this.loc(name), v);
    }

    set3fv(name: string, v: Float32List): void {
        this.gl.uniform3fv(this.loc(name), v);
    }
}
