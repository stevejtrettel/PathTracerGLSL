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
    private cache = new Map<string, WebGLUniformLocation | null>();    // Change the cache to store nulls as well

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








    private loc(localName: string): WebGLUniformLocation | null {
        const gpuName = this.prefix ? `${this.prefix}${localName}` : localName;
        if (this.cache.has(gpuName)) return this.cache.get(gpuName)!;
        const loc = this.program.getUniformLocation(gpuName); // now returns WebGLUniformLocation | null
        this.cache.set(gpuName, loc);
        return loc;
    }

// Then guard each setter:
    set1f(name: string, x: number): void {
        const L = this.loc(name);
        if (L) this.gl.uniform1f(L, x);
    }
    set2f(name: string, x: number, y: number): void {
        const L = this.loc(name);
        if (L) this.gl.uniform2f(L, x, y);
    }
    set3f(name: string, x: number, y: number, z: number): void {
        const L = this.loc(name);
        if (L) this.gl.uniform3f(L, x, y, z);
    }
    set2fv(name: string, v: Float32List): void {
        const L = this.loc(name);
        if (L) this.gl.uniform2fv(L, v);
    }
    set3fv(name: string, v: Float32List): void {
        const L = this.loc(name);
        if (L) this.gl.uniform3fv(L, v);
    }
    set1i(name: string, x: number): void {
        const L = this.loc(name);
        if (L) this.gl.uniform1i(L, x | 0);
    }
    setMatrix4fv(name: string, m: Float32Array | number[]): void {
        const L = this.loc(name);
        if (L) this.gl.uniformMatrix4fv(L, false, m as Float32List);
    }



}
