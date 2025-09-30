// engine/RenderExecutor.ts
import { ResourceManager } from "./ResourceManager";

export class RenderExecutor {
    private gl: WebGL2RenderingContext;
    private mainProgram: WebGLProgram | null = null;
    private displayProgram: WebGLProgram | null = null;

    constructor(gl: WebGL2RenderingContext, resources: ResourceManager) {
        this.gl = gl;
    }

    /**
     * Set both programs (called by Engine)
     */
    setPrograms(main: WebGLProgram, display: WebGLProgram): void {
        this.mainProgram = main;
        this.displayProgram = display;
    }

    /**
     * Execute main accumulation pass
     */
    executeMainPass(): void {
        if (!this.mainProgram) {
            throw new Error('No main program set - call setPrograms first');
        }

        this.gl.useProgram(this.mainProgram);
        this.gl.drawArrays(this.gl.TRIANGLES, 0, 3);
    }

    /**
     * Execute display/tone mapping pass
     */
    executeDisplayPass(radianceTexture: WebGLTexture): void {
        if (!this.displayProgram) {
            throw new Error('No display program set - call setPrograms first');
        }

        // Render to screen
        this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
        this.gl.viewport(0, 0, this.gl.canvas.width, this.gl.canvas.height);

        // Use display program
        this.gl.useProgram(this.displayProgram);

        // Bind radiance texture
        this.gl.activeTexture(this.gl.TEXTURE0);
        this.gl.bindTexture(this.gl.TEXTURE_2D, radianceTexture);

        const loc = this.gl.getUniformLocation(this.displayProgram, 'u_radiance_texture');
        if (loc) {
            this.gl.uniform1i(loc, 0);
        }

        // Draw fullscreen triangle
        this.gl.drawArrays(this.gl.TRIANGLES, 0, 3);
    }

    /**
     * Clean up (programs owned by ShaderCompiler, so we don't delete)
     */
    dispose(): void {
        this.mainProgram = null;
        this.displayProgram = null;
    }
}
