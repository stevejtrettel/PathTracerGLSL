// // src/rendering/ShaderProgram.ts
//
// export class ShaderProgram {
//     private program: WebGLProgram;
//
//     constructor(private gl: WebGL2RenderingContext, vertexSource: string, fragmentSource: string) {
//         this.program = this.createProgram(vertexSource, fragmentSource);
//     }
//
//     private createShader(type: number, source: string): WebGLShader {
//         const shader = this.gl.createShader(type);
//         if (!shader) {
//             throw new Error('Failed to create shader');
//         }
//
//         this.gl.shaderSource(shader, source);
//         this.gl.compileShader(shader);
//
//         if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) {
//             const log = this.gl.getShaderInfoLog(shader);
//             this.gl.deleteShader(shader);
//             throw new Error(`Shader compilation failed: ${log}`);
//         }
//
//         return shader;
//     }
//
//     private createProgram(vertSource: string, fragSource: string): WebGLProgram {
//         const vertShader = this.createShader(this.gl.VERTEX_SHADER, vertSource);
//         const fragShader = this.createShader(this.gl.FRAGMENT_SHADER, fragSource);
//
//         const program = this.gl.createProgram();
//         if (!program) {
//             throw new Error('Failed to create program');
//         }
//
//         this.gl.attachShader(program, vertShader);
//         this.gl.attachShader(program, fragShader);
//         this.gl.linkProgram(program);
//
//         if (!this.gl.getProgramParameter(program, this.gl.LINK_STATUS)) {
//             const log = this.gl.getProgramInfoLog(program);
//             this.gl.deleteProgram(program);
//             throw new Error(`Program linking failed: ${log}`);
//         }
//
//         // Clean up glsl
//         this.gl.deleteShader(vertShader);
//         this.gl.deleteShader(fragShader);
//
//         return program;
//     }
//
//     use(): void {
//         this.gl.useProgram(this.program);
//     }
//
//     // Helper to get uniform locations (we'll need this soon)
//     getUniformLocation(name: string): WebGLUniformLocation | null {
//         return this.gl.getUniformLocation(this.program, name);
//     }
//
//     destroy(): void {
//         this.gl.deleteProgram(this.program);
//     }
// }






//
// // src/rendering/ShaderProgram.ts
//
// export class ShaderProgram {
//     private program: WebGLProgram;
//
//     constructor(private gl: WebGL2RenderingContext, vertexSource: string, fragmentSource: string) {
//         this.program = this.createProgram(vertexSource, fragmentSource);
//     }
//
//     private createShader(type: number, source: string): WebGLShader {
//         const shader = this.gl.createShader(type);
//         if (!shader) {
//             throw new Error('Failed to create shader');
//         }
//
//         this.gl.shaderSource(shader, source);
//         this.gl.compileShader(shader);
//
//         if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) {
//             const log = this.gl.getShaderInfoLog(shader);
//             this.gl.deleteShader(shader);
//             throw new Error(`Shader compilation failed: ${log}`);
//         }
//
//         return shader;
//     }
//
//     private createProgram(vertSource: string, fragSource: string): WebGLProgram {
//         const vertShader = this.createShader(this.gl.VERTEX_SHADER, vertSource);
//         const fragShader = this.createShader(this.gl.FRAGMENT_SHADER, fragSource);
//
//         const program = this.gl.createProgram();
//         if (!program) {
//             throw new Error('Failed to create program');
//         }
//
//         this.gl.attachShader(program, vertShader);
//         this.gl.attachShader(program, fragShader);
//         this.gl.linkProgram(program);
//
//         if (!this.gl.getProgramParameter(program, this.gl.LINK_STATUS)) {
//             const log = this.gl.getProgramInfoLog(program);
//             this.gl.deleteProgram(program);
//             throw new Error(`Program linking failed: ${log}`);
//         }
//
//         // Clean up glsl
//         this.gl.deleteShader(vertShader);
//         this.gl.deleteShader(fragShader);
//
//         return program;
//     }
//
//     use(): void {
//         this.gl.useProgram(this.program);
//     }
//
//     // Uniform binding methods
//     getUniformLocation(name: string): WebGLUniformLocation | null {
//         return this.gl.getUniformLocation(this.program, name);
//     }
//
//     setFloat(name: string, value: number): void {
//         const location = this.getUniformLocation(name);
//         if (location !== null) {
//             this.gl.uniform1f(location, value);
//         }
//     }
//
//     setVec2(name: string, x: number, y: number): void {
//         const location = this.getUniformLocation(name);
//         if (location !== null) {
//             this.gl.uniform2f(location, x, y);
//         }
//     }
//
//     setVec3(name: string, x: number, y: number, z: number): void {
//         const location = this.getUniformLocation(name);
//         if (location !== null) {
//             this.gl.uniform3f(location, x, y, z);
//         }
//     }
//
//     destroy(): void {
//         this.gl.deleteProgram(this.program);
//     }
// }
//
//
//
//

// Minimal OOP wrapper for a WebGL2 program: compile, link, use, and query locations.
// Kept tiny on purpose; we can grow helpers (setUniform*, etc.) later.

export default class ShaderProgram {
    private gl: WebGL2RenderingContext;
    private program: WebGLProgram;

    constructor(gl: WebGL2RenderingContext, vertSource: string, fragSource: string) {
        this.gl = gl;

        const vs = this.compile(gl.VERTEX_SHADER, vertSource);
        const fs = this.compile(gl.FRAGMENT_SHADER, fragSource);

        const prog = gl.createProgram();
        if (!prog) throw new Error("Failed to create WebGL program");
        gl.attachShader(prog, vs);
        gl.attachShader(prog, fs);
        gl.linkProgram(prog);

        // Clean up glsl after linking (they’re attached to the program now).
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

// After (tolerant):
    getUniformLocation(name: string): WebGLUniformLocation | null {
        return this.gl.getUniformLocation(this.program, name); // may be null if optimized out
    }


    delete(): void {
        this.gl.deleteProgram(this.program);
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
