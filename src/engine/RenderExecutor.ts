/**
 * RenderExecutor manages all WebGL interaction
 * Takes GLSL source from compiler and executes it on GPU
 */
class RenderExecutor {
    private gl: WebGL2RenderingContext;
    private program: WebGLProgram | null = null;
    private quadVAO: WebGLVertexArrayObject | null = null;

    constructor(gl: WebGL2RenderingContext) {
        this.gl = gl;
        this.setupQuad();
    }

    /**
     * Compile vertex and fragment shaders, link into program
     * Takes fragment shader source from ShaderCompiler
     */
    loadShader(fragmentSource: string): void {
        // Hardcoded vertex shader - generates full-screen quad positions
        const vertexSource = `#version 300 es
void main() {
  // Generate full-screen quad from gl_VertexID
  // No attributes needed - positions calculated directly
  vec2 positions[3] = vec2[](
    vec2(-1.0, -1.0),  // Bottom-left
    vec2( 3.0, -1.0),  // Bottom-right (extends beyond)
    vec2(-1.0,  3.0)   // Top-left (extends beyond)
  );
  gl_Position = vec4(positions[gl_VertexID], 0.0, 1.0);
}`;

        // Compile shaders
        const vertexShader = this.compileShader(vertexSource, this.gl.VERTEX_SHADER);
        const fragmentShader = this.compileShader(fragmentSource, this.gl.FRAGMENT_SHADER);

        // Link program
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
     * Execute the loaded shader program
     * Draws full-screen quad triggering fragment shader
     */
    execute(): void {
        if (!this.program || !this.quadVAO) {
            throw new Error('No program loaded or quad not set up');
        }

        // Bind program and VAO
        this.gl.useProgram(this.program);
        this.gl.bindVertexArray(this.quadVAO);

        // Draw full-screen quad (3 vertices = 1 triangle covering screen)
        this.gl.drawArrays(this.gl.TRIANGLES, 0, 3);

        // Unbind
        this.gl.bindVertexArray(null);
    }

    /**
     * Set up VAO for full-screen quad
     * No attributes needed - positions generated in vertex shader
     */
    private setupQuad(): void {
        // Create VAO
        this.quadVAO = this.gl.createVertexArray();
        if (!this.quadVAO) {
            throw new Error('Failed to create VAO');
        }

        // Bind VAO (but no vertex buffer needed)
        this.gl.bindVertexArray(this.quadVAO);

        // Unbind - VAO is ready with no attributes
        this.gl.bindVertexArray(null);
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
