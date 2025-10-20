// engine/RenderExecutor.ts
import { ResourceManager } from './ResourceManager';

interface Viewport {
    x: number;
    y: number;
    width: number;
    height: number;
}

interface Rectangle {
    x: number;
    y: number;
    width: number;
    height: number;
}

/**
 * RenderExecutor - Manages WebGL rendering execution
 *
 * Responsibilities:
 * - Execute main and display passes
 * - Manage viewport state
 * - Provide pixel readback (HDR radiance, LDR display)
 */
export class RenderExecutor {
    private gl: WebGL2RenderingContext;
    private resources: ResourceManager;
    private mainProgram: WebGLProgram | null = null;
    private displayProgram: WebGLProgram | null = null;

    // Current viewport
    private viewport: Viewport;

    constructor(gl: WebGL2RenderingContext, resources: ResourceManager) {
        this.gl = gl;
        this.resources = resources;

        const canvas = gl.canvas as HTMLCanvasElement;
        this.viewport = {
            x: 0,
            y: 0,
            width: canvas.width,
            height: canvas.height
        };
    }

    /**
     * Set active programs
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
            throw new Error('No main program set');
        }

        this.gl.useProgram(this.mainProgram);
        this.gl.drawArrays(this.gl.TRIANGLES, 0, 3);
    }

    /**
     * Execute display/tone mapping pass
     */
    executeDisplayPass(radianceTexture: WebGLTexture): void {
        if (!this.displayProgram) {
            throw new Error('No display program set');
        }

        this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
        this.gl.viewport(
            this.viewport.x,
            this.viewport.y,
            this.viewport.width,
            this.viewport.height
        );

        this.gl.useProgram(this.displayProgram);

        // Bind radiance texture
        this.gl.activeTexture(this.gl.TEXTURE0);
        this.gl.bindTexture(this.gl.TEXTURE_2D, radianceTexture);

        const loc = this.gl.getUniformLocation(this.displayProgram, 'u_radiance_texture');
        if (loc) {
            this.gl.uniform1i(loc, 0);
        }

        this.gl.drawArrays(this.gl.TRIANGLES, 0, 3);
    }

    /**
     * Update viewport on canvas resize
     */
    resize(width: number, height: number): void {
        if (width <= 0 || height <= 0) {
            throw new Error(`Invalid resize dimensions: ${width}×${height}`);
        }

        this.viewport = { x: 0, y: 0, width, height };
        this.gl.viewport(0, 0, width, height);
    }

    // ============================================================================
    // Pixel Readback
    // ============================================================================

    /**
     * Read HDR radiance from accumulator
     *
     * Returns Float32Array with RGBA values (unbounded range)
     * Use for: HDR export, scientific analysis, compositing
     *
     * @param rect - Optional region to read (defaults to full viewport)
     */
    readRadiance(rect?: Rectangle): Float32Array {
        const r = rect || this.getFullViewportRect();
        this.validateRect(r);

        const fb = this.resources.getCurrentFramebuffer();
        this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, fb);

        const pixels = new Float32Array(r.width * r.height * 4);
        this.gl.readPixels(
            r.x, r.y,
            r.width, r.height,
            this.gl.RGBA,
            this.gl.FLOAT,
            pixels
        );

        return pixels;
    }

    /**
     * Read tone-mapped display from screen
     *
     * Returns Uint8Array with RGBA values (0-255 range)
     * Use for: PNG/JPEG export, screenshots
     *
     * @param rect - Optional region to read (defaults to full viewport)
     */
    readDisplay(rect?: Rectangle): Uint8Array {
        const r = rect || this.getFullViewportRect();
        this.validateRect(r);

        this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);

        const pixels = new Uint8Array(r.width * r.height * 4);
        this.gl.readPixels(
            r.x, r.y,
            r.width, r.height,
            this.gl.RGBA,
            this.gl.UNSIGNED_BYTE,
            pixels
        );

        return pixels;
    }

    /**
     * Clean up resources
     */
    dispose(): void {
        this.mainProgram = null;
        this.displayProgram = null;
    }

    // ============================================================================
    // Private Helpers
    // ============================================================================

    private getFullViewportRect(): Rectangle {
        return {
            x: this.viewport.x,
            y: this.viewport.y,
            width: this.viewport.width,
            height: this.viewport.height
        };
    }

    private validateRect(rect: Rectangle): void {
        if (rect.x < 0 || rect.y < 0 || rect.width <= 0 || rect.height <= 0) {
            throw new Error(`Invalid rectangle: ${JSON.stringify(rect)}`);
        }
    }
}

export type { Viewport, Rectangle };
