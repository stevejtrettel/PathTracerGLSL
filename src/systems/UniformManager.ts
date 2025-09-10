import ShaderProgram from "../rendering/ShaderProgram";

/**
 * UniformManager
 * - Set uniforms by *local* names; a prefix is applied internally for GPU names.
 * - Caches locations; exposes convenience setters and withPrefix().
 */
export default class UniformManager {
    private gl: WebGL2RenderingContext;
    private program: ShaderProgram;
    private prefix: string;
    private cache = new Map<string, WebGLUniformLocation>();

    constructor(gl: WebGL2RenderingContext, program: ShaderProgram, prefix: string = "") {
        this.gl = gl;
        this.program = program;
        this.prefix = prefix;
    }

    /** Return a new manager sharing gl/program but using a different prefix. */
    withPrefix(prefix: string): UniformManager {
        return new UniformManager(this.gl, this.program, prefix);
    }

    // ---- lookups ----
    private loc(localName: string): WebGLUniformLocation {
        const gpuName = this.prefix ? `${this.prefix}${localName}` : localName;
        let loc = this.cache.get(gpuName);
        if (!loc) {
            loc = this.program.getUniformLocation(gpuName);
            this.cache.set(gpuName, loc);
        }
        return loc;
    }

    // ---- floats ----
    set1f(name: string, x: number): void { this.gl.uniform1f(this.loc(name), x); }
    set2f(name: string, x: number, y: number): void { this.gl.uniform2f(this.loc(name), x, y); }
    set3f(name: string, x: number, y: number, z: number): void { this.gl.uniform3f(this.loc(name), x, y, z); }
    set2fv(name: string, v: Float32List): void { this.gl.uniform2fv(this.loc(name), v); }
    set3fv(name: string, v: Float32List): void { this.gl.uniform3fv(this.loc(name), v); }

    // ---- integers/samplers ----
    set1i(name: string, x: number): void { this.gl.uniform1i(this.loc(name), x | 0); }

    // ---- matrices ----
    /** Set a 4x4 matrix. WebGL requires transpose=false. */
    setMatrix4fv(name: string, m: Float32Array | number[]): void {
        this.gl.uniformMatrix4fv(this.loc(name), false, m as Float32List);
    }
}
