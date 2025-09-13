// src/rendering/ShaderProgram.ts
// Minimal OOP wrapper for a WebGL2 program: compile, link, use, and query locations.
// Kept tiny on purpose; we can grow helpers (setUniform*, etc.) later.

export default class ShaderProgram {
    private gl: WebGL2RenderingContext;
    private program: WebGLProgram;

    // cache uniform locations to avoid repeated GL queries
    private uniformLocCache = new Map<string, WebGLUniformLocation | null>();

    constructor(gl: WebGL2RenderingContext, vertSource: string, fragSource: string) {
        this.gl = gl;

        const vs = this.compile(gl.VERTEX_SHADER, vertSource);
        const fs = this.compile(gl.FRAGMENT_SHADER, fragSource);

        const prog = gl.createProgram();
        if (!prog) throw new Error("Failed to create WebGL program");
        gl.attachShader(prog, vs);
        gl.attachShader(prog, fs);
        gl.linkProgram(prog);

        // Clean up shader objects after linking.
        gl.deleteShader(vs);
        gl.deleteShader(fs);

        if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
            const log = gl.getProgramInfoLog(prog) || "Unknown link error";
            gl.deleteProgram(prog);
            throw new Error(`Program link failed:\n${log}`);
        }

        this.program = prog;
    }

    use(): void {
        this.gl.useProgram(this.program);
    }

    getAttribLocation(name: string): number {
        const loc = this.gl.getAttribLocation(this.program, name);
        if (loc === -1) {
            // Not throwing by default—attributes can be optimized out.
            console.warn(`Attribute not found (or optimized out): ${name}`);
        }
        return loc;
    }

    // Public, direct lookup (no cache) — fine to keep exposed
    getUniformLocation(name: string): WebGLUniformLocation | null {
        return this.gl.getUniformLocation(this.program, name); // may be null if optimized out
    }

    // Preferred internal lookup with cache
    private loc(name: string): WebGLUniformLocation | null {
        if (this.uniformLocCache.has(name)) {
            return this.uniformLocCache.get(name)!; // may be null if optimized out
        }
        const L = this.gl.getUniformLocation(this.program, name);
        this.uniformLocCache.set(name, L);
        return L;
    }

    // --- small uniform helpers (add more as needed) ---

    set1f(name: string, x: number): void {
        const L = this.loc(name);
        if (L) this.gl.uniform1f(L, x);
    }

    set2f(name: string, x: number, y: number): void {
        const L = this.loc(name);
        if (L) this.gl.uniform2f(L, x, y);
    }

    set1i(name: string, x: number): void {
        const L = this.loc(name);
        if (L) this.gl.uniform1i(L, x | 0); // coerce to int
    }

    delete(): void {
        this.gl.deleteProgram(this.program);
        this.uniformLocCache.clear();
    }

    // Alias for convenience if callers expect dispose()
    dispose(): void {
        this.delete();
    }

    // --- internals ---

    private compile(type: number, source: string): WebGLShader {
        const shader = this.gl.createShader(type);
        if (!shader) throw new Error("Failed to create shader");

        this.gl.shaderSource(shader, source);
        this.gl.compileShader(shader);

        if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) {
            const log = this.gl.getShaderInfoLog(shader) || "Unknown compile error";
            const kind = type === this.gl.VERTEX_SHADER ? "VERTEX" : "FRAGMENT";
            this.gl.deleteShader(shader);
            throw new Error(`${kind} shader compile failed:\n${log}\n--- Source ---\n${indentLines(source)}`);
        }
        return shader;
    }
}

// Small helper to make error logs readable.
function indentLines(s: string): string {
    return s.split("\n").map((l, i) => `${String(i + 1).padStart(3, " ")}| ${l}`).join("\n");
}
