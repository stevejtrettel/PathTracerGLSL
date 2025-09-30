// engine/ResourceManager.ts
import { HDRLoader } from './loaders/hdr-loader';

export class ResourceManager {
    private gl: WebGL2RenderingContext;

    // Ping-pong textures and framebuffers
    private textures: {
        current: WebGLTexture;
        previous: WebGLTexture;
    };
    private framebuffers: {
        current: WebGLFramebuffer;
        previous: WebGLFramebuffer;
    };

    // Environment texture management
    private environmentTexture: WebGLTexture | null = null;
    private environmentTextureUnit = 1;  // Unit 0 reserved for accumulator

    // Track dimensions
    private width: number;
    private height: number;

    constructor(gl: WebGL2RenderingContext) {
        this.gl = gl;
        this.width = gl.canvas.width;
        this.height = gl.canvas.height;

        // Ensure float rendering is supported
        const ext = this.gl.getExtension('EXT_color_buffer_float');
        if (!ext) {
            throw new Error('EXT_color_buffer_float required for HDR rendering');
        }

        this.setupFilmBuffers();
    }

    private setupFilmBuffers(): void {
        // Create two RGBA32F textures for ping-pong
        this.textures = {
            current: this.createFilmTexture(),
            previous: this.createFilmTexture()
        };

        // Create framebuffers and attach textures
        this.framebuffers = {
            current: this.createFramebuffer(this.textures.current),
            previous: this.createFramebuffer(this.textures.previous)
        };

        // Clear both buffers to start
        this.clearFilmBuffers();
    }

    private createFilmTexture(): WebGLTexture {
        const texture = this.gl.createTexture();
        if (!texture) throw new Error('Failed to create texture');

        this.gl.bindTexture(this.gl.TEXTURE_2D, texture);

        // RGBA32F for full HDR precision
        this.gl.texImage2D(
            this.gl.TEXTURE_2D,
            0,
            this.gl.RGBA32F,
            this.width,
            this.height,
            0,
            this.gl.RGBA,
            this.gl.FLOAT,
            null
        );

        // Use NEAREST to avoid filtering artifacts during accumulation
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.NEAREST);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.NEAREST);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE);

        this.gl.bindTexture(this.gl.TEXTURE_2D, null);
        return texture;
    }

    private createFramebuffer(texture: WebGLTexture): WebGLFramebuffer {
        const framebuffer = this.gl.createFramebuffer();
        if (!framebuffer) throw new Error('Failed to create framebuffer');

        this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, framebuffer);
        this.gl.framebufferTexture2D(
            this.gl.FRAMEBUFFER,
            this.gl.COLOR_ATTACHMENT0,
            this.gl.TEXTURE_2D,
            texture,
            0
        );

        // Verify framebuffer is complete
        const status = this.gl.checkFramebufferStatus(this.gl.FRAMEBUFFER);
        if (status !== this.gl.FRAMEBUFFER_COMPLETE) {
            throw new Error(`Framebuffer incomplete: ${this.getFramebufferStatus(status)}`);
        }

        this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
        return framebuffer;
    }

    private getFramebufferStatus(status: number): string {
        switch(status) {
            case this.gl.FRAMEBUFFER_INCOMPLETE_ATTACHMENT: return 'INCOMPLETE_ATTACHMENT';
            case this.gl.FRAMEBUFFER_INCOMPLETE_MISSING_ATTACHMENT: return 'MISSING_ATTACHMENT';
            case this.gl.FRAMEBUFFER_INCOMPLETE_DIMENSIONS: return 'INCOMPLETE_DIMENSIONS';
            case this.gl.FRAMEBUFFER_UNSUPPORTED: return 'UNSUPPORTED';
            default: return `Unknown (${status})`;
        }
    }

    /**
     * Load an HDR environment texture, replacing any existing one
     */
    async loadHDRTexture(url: string): Promise<void> {
        try {
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const buffer = await response.arrayBuffer();
            const hdr = HDRLoader.parse(buffer);

            // Clean up old texture if it exists
            if (this.environmentTexture) {
                this.gl.deleteTexture(this.environmentTexture);
                this.environmentTexture = null;
            }

            // Create new environment texture
            this.environmentTexture = this.createEnvironmentTexture(
                hdr.width,
                hdr.height,
                hdr.data
            );

            console.log(`Loaded HDR environment: ${hdr.width}x${hdr.height}`);
        } catch (error: any) {
            throw new Error(`Failed to load HDR from ${url}: ${error.message}`);
        }
    }

    private createEnvironmentTexture(
        width: number,
        height: number,
        data: Float32Array
    ): WebGLTexture {
        const texture = this.gl.createTexture();
        if (!texture) throw new Error('Failed to create environment texture');

        this.gl.bindTexture(this.gl.TEXTURE_2D, texture);

        // Upload texture as RGB32F
        this.gl.texImage2D(
            this.gl.TEXTURE_2D,
            0,
            this.gl.RGB32F,
            width,
            height,
            0,
            this.gl.RGB,
            this.gl.FLOAT,
            data
        );

        // Check for linear filtering support and use appropriate filter
        const linearExt = this.gl.getExtension('OES_texture_float_linear');
        const filterMode = linearExt ? this.gl.LINEAR : this.gl.NEAREST;

        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, filterMode);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, filterMode);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.REPEAT);
        this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE);

        this.gl.bindTexture(this.gl.TEXTURE_2D, null);
        return texture;
    }

    /**
     * Bind environment texture to a shader uniform location
     */
    bindEnvironmentTexture(location: WebGLUniformLocation): void {
        if (!this.environmentTexture) {
            console.warn('No environment texture loaded');
            return;
        }

        this.gl.activeTexture(this.gl.TEXTURE1);
        this.gl.bindTexture(this.gl.TEXTURE_2D, this.environmentTexture);
        this.gl.uniform1i(location, 1);
    }

    /**
     * Get current radiance texture for display pass
     */
    getCurrentTexture(): WebGLTexture {
        return this.textures.current;
    }

    /**
     * Prepare for rendering - bind previous frame and set render target
     */
    prepareFrame(): void {
        // Bind previous frame texture to unit 0 for accumulation shader
        this.gl.activeTexture(this.gl.TEXTURE0);
        this.gl.bindTexture(this.gl.TEXTURE_2D, this.textures.previous);

        // Render to current framebuffer
        this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, this.framebuffers.current);
        this.gl.viewport(0, 0, this.width, this.height);
    }

    /**
     * Finalize frame - just swap buffers
     */
    finalizeFrame(): void {
        // Just swap buffers for next frame
        this.swapBuffers();
    }

    private swapBuffers(): void {
        // Swap texture references
        [this.textures.current, this.textures.previous] =
            [this.textures.previous, this.textures.current];

        // Swap framebuffer references
        [this.framebuffers.current, this.framebuffers.previous] =
            [this.framebuffers.previous, this.framebuffers.current];
    }

    /**
     * Clear accumulation buffers (for reset)
     */
    clearFilmBuffers(): void {
        // Clear both buffers
        [this.framebuffers.current, this.framebuffers.previous].forEach(fb => {
            this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, fb);
            this.gl.clearColor(0, 0, 0, 0);
            this.gl.clear(this.gl.COLOR_BUFFER_BIT);
        });

        this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
    }

    /**
     * Handle canvas resize
     */
    resize(width: number, height: number): void {
        if (width === this.width && height === this.height) return;

        this.width = width;
        this.height = height;

        // Recreate buffers at new size
        this.dispose();
        this.setupFilmBuffers();
    }

    /**
     * Clean up GPU resources
     */
    dispose(): void {
        // Clean up environment texture
        if (this.environmentTexture) {
            this.gl.deleteTexture(this.environmentTexture);
            this.environmentTexture = null;
        }

        // Clean up film buffers
        if (this.textures) {
            this.gl.deleteTexture(this.textures.current);
            this.gl.deleteTexture(this.textures.previous);
        }

        if (this.framebuffers) {
            this.gl.deleteFramebuffer(this.framebuffers.current);
            this.gl.deleteFramebuffer(this.framebuffers.previous);
        }
    }
}
