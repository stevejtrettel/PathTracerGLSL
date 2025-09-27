/**
 * RenderExecutor - compiles shaders and executes full-screen rendering
 */
class RenderExecutor {
    private gl: WebGL2RenderingContext;
    private program: WebGLProgram | null = null;

    constructor(gl: WebGL2RenderingContext) {
        this.gl = gl;
    }

    /**
     * Compile and link shaders into program
     */
    loadShader(fragmentSource: string): void {
        // Simple vertex shader - generates full-screen triangle from gl_VertexID
        const vertexSource = `#version 300 es
                    void main() {
                        // Generate positions for full-screen triangle directly
                        float x = float((gl_VertexID & 1) << 2) - 1.0;
                        float y = float((gl_VertexID & 2) << 1) - 1.0;
                        gl_Position = vec4(x, y, 0.0, 1.0);
                    }`;

        const vertexShader = this.compileShader(vertexSource, this.gl.VERTEX_SHADER);
        const fragmentShader = this.compileShader(fragmentSource, this.gl.FRAGMENT_SHADER);

        this.program = this.gl.createProgram();
        if (!this.program) {
            throw new Error('Failed to create program');
        }

        this.gl.attachShader(this.program, vertexShader);
        this.gl.attachShader(this.program, fragmentShader);
        this.gl.linkProgram(this.program);

        if (!this.gl.getProgramParameter(this.program, this.gl.LINK_STATUS)) {
            const log = this.gl.getProgramInfoLog(this.program);
            throw new Error(`Program link failed: ${log}`);
        }

        // Clean up shaders
        this.gl.deleteShader(vertexShader);
        this.gl.deleteShader(fragmentShader);
    }

    /**
     * Execute full-screen render
     */
    execute(): void {
        if (!this.program) {
            throw new Error('No program loaded');
        }

        this.gl.useProgram(this.program);
        this.gl.drawArrays(this.gl.TRIANGLES, 0, 3);
    }

    /**
     * Get compiled program for uniform management
     */
    getProgram(): WebGLProgram | null {
        return this.program;
    }

    /**
     * Clean up resources
     */
    dispose(): void {
        if (this.program) {
            this.gl.deleteProgram(this.program);
            this.program = null;
        }
    }

    /**
     * Compile individual shader
     */
    private compileShader(source: string, type: number): WebGLShader {
        const shader = this.gl.createShader(type);
        if (!shader) {
            throw new Error('Failed to create shader');
        }

        this.gl.shaderSource(shader, source);
        this.gl.compileShader(shader);

        if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) {
            const log = this.gl.getShaderInfoLog(shader);
            this.gl.deleteShader(shader);
            throw new Error(`Shader compile failed: ${log}`);
        }

        return shader;
    }
}

export { RenderExecutor };
