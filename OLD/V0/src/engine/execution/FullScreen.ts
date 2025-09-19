/**
 * Purpose: Minimal helper that draws a fullscreen cover primitive using a gl_VertexID-based triangle.
 * Public contract: class Fullscreen { bind(gl); draw(gl); dispose(gl); }
 * Inputs: WebGL2RenderingContext (from your Context).
 * Outputs: A bound VAO and one gl.drawArrays(GL_TRIANGLES, 0, 3) when requested.
 * Lifecycle: Create once per GL context; reuse across all passes; dispose on teardown.
 * Invariants:
 *  - This is NOT a “fullscreen mode” toggle. It’s a tiny draw helper.
 *  - Uses a SINGLE TRIANGLE synthesized in the vertex shader (no VBO/attributes).
 *  - Does not compile shaders or bind textures; strictly VAO management + draw call.
 *  - Safe to call bind() multiple times; draw() assumes a program is already active.
 * Rationale:
 *  - We prefer a triangle over a quad to avoid diagonal interpolation artifacts and extra vertices.
 *  - If you ever need a quad (e.g., for specific UV addressing), add a separate FullscreenQuad helper.
 */


export class Fullscreen {
    private vao: WebGLVertexArrayObject | null;
    private disposed = false;

    private constructor(vao: WebGLVertexArrayObject) {
        this.vao = vao;
    }

    /** Create and initialize the VAO. Must be called once per GL context. */
    static create(gl: WebGL2RenderingContext): Fullscreen {
        const vao = gl.createVertexArray();
        if (!vao) throw new Error('Fullscreen: failed to create VAO');
        // No attributes/VBOs: shaders will use gl_VertexID to synthesize positions.
        return new Fullscreen(vao);
    }

    /** Bind the VAO so subsequent gl_VertexID-based draws are valid. */
    bind(gl: WebGL2RenderingContext): void {
        if (this.disposed) throw new Error('Fullscreen: bind() after dispose()');
        if (!this.vao) throw new Error('Fullscreen: VAO missing');
        gl.bindVertexArray(this.vao);
    }

    /**
     * Issue the fullscreen draw. Assumes:
     *  - A program using a gl_VertexID fullscreen vertex shader is already active.
     *  - The correct framebuffer/viewport/state has been set by the caller.
     */
    draw(gl: WebGL2RenderingContext): void {
        if (this.disposed) throw new Error('Fullscreen: draw() after dispose()');
        gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    /** Destroy GL resources. Do not use this instance after calling dispose(). */
    dispose(gl: WebGL2RenderingContext): void {
        if (this.vao) {
            gl.deleteVertexArray(this.vao);
            this.vao = null;
        }
        this.disposed = true;
    }
}
