// engine/RenderExecutor.ts
import { ResourceManager } from "./ResourceManager";

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

export class RenderExecutor {
    private gl: WebGL2RenderingContext;
    private resources: ResourceManager;
    private mainProgram: WebGLProgram | null = null;
    private displayProgram: WebGLProgram | null = null;

    // Viewport management
    private viewport: Viewport;
    private viewportStack: Viewport[] = [];

    constructor(gl: WebGL2RenderingContext, resources: ResourceManager) {
        this.gl = gl;
        this.resources = resources;

        // Initialize viewport from canvas
        const canvas = gl.canvas as HTMLCanvasElement;
        this.viewport = {
            x: 0,
            y: 0,
            width: canvas.width,
            height: canvas.height
        };
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

        // Use current viewport (might be full screen or a tile)
        this.gl.viewport(
            this.viewport.x,
            this.viewport.y,
            this.viewport.width,
            this.viewport.height
        );

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

    // ============================================================================
    // Viewport Control
    // ============================================================================

    /**
     * Set viewport for rendering
     * Used for tiled rendering - render to specific region of framebuffer
     */
    setViewport(x: number, y: number, width: number, height: number): void {
        if (width <= 0 || height <= 0) {
            throw new Error(`Invalid viewport dimensions: ${width}x${height}`);
        }

        this.viewport = { x, y, width, height };
        this.gl.viewport(x, y, width, height);
    }

    /**
     * Get current viewport
     */
    getViewport(): Viewport {
        return { ...this.viewport }; // Return copy
    }

    /**
     * Push current viewport and set new one
     * Useful for temporarily changing viewport
     */
    pushViewport(viewport: Viewport): void {
        // Save current viewport
        this.viewportStack.push({ ...this.viewport });

        // Set new viewport
        this.setViewport(viewport.x, viewport.y, viewport.width, viewport.height);
    }

    /**
     * Restore previous viewport
     */
    popViewport(): void {
        const prev = this.viewportStack.pop();

        if (!prev) {
            console.warn('No viewport to pop - stack empty');
            return;
        }

        this.setViewport(prev.x, prev.y, prev.width, prev.height);
    }

    // ============================================================================
    // Resize Handling
    // ============================================================================

    /**
     * Update viewport when canvas resizes
     * Called by Engine when canvas dimensions change
     */
    resize(width: number, height: number): void {
        if (width <= 0 || height <= 0) {
            throw new Error(`Invalid resize dimensions: ${width}x${height}`);
        }

        this.viewport = {
            x: 0,
            y: 0,
            width,
            height
        };

        // Update WebGL viewport immediately
        this.gl.viewport(0, 0, width, height);
    }

    // ============================================================================
    // Pixel Readback
    // ============================================================================

    /**
     * Read HDR radiance from accumulator buffer
     *
     * Use for: EXR export, scientific analysis, any HDR workflow
     * Data format: RGBA32F (4 floats per pixel, unbounded values)
     *
     * @param rect - Optional rectangle to read (defaults to full viewport)
     * @returns Float32Array with RGBA data (length = width * height * 4)
     */
    readRadiance(rect?: Rectangle): Float32Array {
        const r = rect || this.getFullViewportRect();

        // Validate rectangle
        if (r.x < 0 || r.y < 0 || r.width <= 0 || r.height <= 0) {
            throw new Error(`Invalid readback rectangle: ${JSON.stringify(r)}`);
        }

        // Bind accumulator framebuffer (RGBA32F)
        const fb = this.resources.getCurrentFramebuffer();
        this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, fb);

        // Allocate and read (RGBA = 4 floats per pixel)
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
     * Use for: PNG/JPEG export, screenshots, social media
     * Data format: RGBA8 (4 bytes per pixel, range 0-255)
     *
     * @param rect - Optional rectangle to read (defaults to full viewport)
     * @returns Uint8Array with RGBA data (length = width * height * 4)
     */
    readDisplay(rect?: Rectangle): Uint8Array {
        const r = rect || this.getFullViewportRect();

        // Validate rectangle
        if (r.x < 0 || r.y < 0 || r.width <= 0 || r.height <= 0) {
            throw new Error(`Invalid readback rectangle: ${JSON.stringify(r)}`);
        }

        // Bind default framebuffer (screen, RGBA8)
        this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);

        // Allocate and read (RGBA = 4 bytes per pixel)
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
     * Helper: Get rectangle for full viewport
     */
    private getFullViewportRect(): Rectangle {
        return {
            x: this.viewport.x,
            y: this.viewport.y,
            width: this.viewport.width,
            height: this.viewport.height
        };
    }

    // ============================================================================
    // Cleanup
    // ============================================================================

    /**
     * Clean up (programs owned by ShaderCompiler, so we don't delete)
     */
    dispose(): void {
        this.mainProgram = null;
        this.displayProgram = null;
        this.viewportStack = [];
    }
}

export type { Viewport, Rectangle };
