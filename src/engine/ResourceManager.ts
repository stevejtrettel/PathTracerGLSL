// engine/ResourceManager.ts

/**
 * Per-recipe accumulation resources
 * Each recipe maintains independent film buffers and accumulation state
 */
interface AccumulatorResources {
    textures: {
        current: WebGLTexture;
        previous: WebGLTexture;
    };
    framebuffers: {
        current: WebGLFramebuffer;
        previous: WebGLFramebuffer;
    };
    accumulator: {
        sampleCount: number;
        startTime: number;
        lastResetTime: number;
    };
}

/**
 * ResourceManager - Manages per-recipe GPU resources
 *
 * Responsibilities:
 * - Create and manage RGBA32F framebuffers for each recipe
 * - Track accumulation state per recipe
 * - Handle buffer swapping (ping-pong)
 * - Handle resize (recreates all buffers)
 */
export class ResourceManager {
    private gl: WebGL2RenderingContext;
    private accumulatorResourcesMap = new Map<string, AccumulatorResources>();
    private activeRecipeId: string | null = null;
    private width: number;
    private height: number;

    constructor(gl: WebGL2RenderingContext) {
        this.gl = gl;
        this.width = gl.canvas.width;
        this.height = gl.canvas.height;

        const ext = this.gl.getExtension('EXT_color_buffer_float');
        if (!ext) {
            throw new Error('EXT_color_buffer_float required for HDR rendering');
        }
    }

    /**
     * Create accumulation buffers for a recipe
     */
    setupAccumulationBuffers(recipeId: string): AccumulatorResources {
        if (this.accumulatorResourcesMap.has(recipeId)) {
            console.log(`Reusing buffers for recipe '${recipeId}'`);
            return this.accumulatorResourcesMap.get(recipeId)!;
        }

        console.log(`Creating buffers for recipe '${recipeId}'`);

        const textures = {
            current: this.createFilmTexture(),
            previous: this.createFilmTexture()
        };

        const framebuffers = {
            current: this.createFramebuffer(textures.current),
            previous: this.createFramebuffer(textures.previous)
        };

        const resources: AccumulatorResources = {
            textures,
            framebuffers,
            accumulator: {
                sampleCount: 0,
                startTime: Date.now(),
                lastResetTime: Date.now()
            }
        };

        this.accumulatorResourcesMap.set(recipeId, resources);
        this.clearAccumulationBuffers(recipeId);

        return resources;
    }

    /**
     * Set active recipe
     */
    setActiveRecipe(recipeId: string): void {
        if (!this.accumulatorResourcesMap.has(recipeId)) {
            throw new Error(`No resources for recipe: ${recipeId}`);
        }
        this.activeRecipeId = recipeId;
        console.log(`Switched to recipe '${recipeId}'`);
    }

    /**
     * Get active recipe ID
     */
    getActiveRecipeId(): string | null {
        return this.activeRecipeId;
    }

    /**
     * Get sample count for active recipe
     */
    getSampleCount(): number {
        return this.getResources().accumulator.sampleCount;
    }

    /**
     * Increment sample count
     */
    incrementSampleCount(): void {
        this.getResources().accumulator.sampleCount++;
    }

    /**
     * Reset sample count
     */
    resetSampleCount(recipeId?: string): void {
        const resources = this.getResources(recipeId);
        resources.accumulator.sampleCount = 0;
        resources.accumulator.lastResetTime = Date.now();
    }

    /**
     * Get current radiance texture
     */
    getCurrentTexture(): WebGLTexture {
        return this.getResources().textures.current;
    }

    /**
     * Get current framebuffer
     */
    getCurrentFramebuffer(): WebGLFramebuffer {
        return this.getResources().framebuffers.current;
    }

    /**
     * Prepare for rendering frame
     */
    prepareFrame(): void {
        const resources = this.getResources();

        // Bind previous frame to texture unit 0
        this.gl.activeTexture(this.gl.TEXTURE0);
        this.gl.bindTexture(this.gl.TEXTURE_2D, resources.textures.previous);

        // Set current framebuffer as render target
        this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, resources.framebuffers.current);
        this.gl.viewport(0, 0, this.width, this.height);
    }

    /**
     * Finalize frame (swap buffers)
     */
    finalizeFrame(): void {
        this.swapBuffers(this.getResources());
    }

    /**
     * Clear accumulation buffers
     */
    clearAccumulationBuffers(recipeId?: string): void {
        const resources = this.getResources(recipeId);

        [resources.framebuffers.current, resources.framebuffers.previous].forEach(fb => {
            this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, fb);
            this.gl.clearColor(0, 0, 0, 0);
            this.gl.clear(this.gl.COLOR_BUFFER_BIT);
        });

        this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
    }

    /**
     * Handle canvas resize - recreates all recipe buffers
     * WARNING: All accumulation will be lost
     */
    resize(width: number, height: number): void {
        if (width === this.width && height === this.height) {
            console.log('Resize called but dimensions unchanged, skipping');
            return;
        }

        console.log(`Resizing buffers: ${this.width}×${this.height} → ${width}×${height}`);

        this.width = width;
        this.height = height;

        // Save state
        const recipeIds = Array.from(this.accumulatorResourcesMap.keys());
        const wasActive = this.activeRecipeId;

        // Dispose and recreate all buffers
        for (const recipeId of recipeIds) {
            const resources = this.accumulatorResourcesMap.get(recipeId)!;
            this.disposeResources(resources);
        }
        this.accumulatorResourcesMap.clear();
        this.activeRecipeId = null;

        for (const recipeId of recipeIds) {
            this.setupAccumulationBuffers(recipeId);
        }

        // Restore active recipe
        if (wasActive && this.accumulatorResourcesMap.has(wasActive)) {
            this.setActiveRecipe(wasActive);
        }

        console.log(`Resized ${recipeIds.length} recipe(s) - accumulation reset for all`);
    }

    /**
     * Handle WebGL context loss
     */
    handleContextLoss(): void {
        console.warn('WebGL context lost - all GPU resources invalidated');
        this.accumulatorResourcesMap.clear();
        this.activeRecipeId = null;
    }

    /**
     * Dispose resources
     */
    dispose(recipeId?: string): void {
        if (recipeId) {
            const resources = this.accumulatorResourcesMap.get(recipeId);
            if (resources) {
                this.disposeResources(resources);
                this.accumulatorResourcesMap.delete(recipeId);
                if (this.activeRecipeId === recipeId) {
                    this.activeRecipeId = null;
                }
            }
        } else {
            for (const resources of this.accumulatorResourcesMap.values()) {
                this.disposeResources(resources);
            }
            this.accumulatorResourcesMap.clear();
            this.activeRecipeId = null;
        }
    }

    // ============================================================================
    // Private Helpers
    // ============================================================================

    private getResources(recipeId?: string): AccumulatorResources {
        const targetId = recipeId ?? this.activeRecipeId;
        if (!targetId) {
            throw new Error('No active recipe');
        }

        const resources = this.accumulatorResourcesMap.get(targetId);
        if (!resources) {
            throw new Error(`No resources for recipe: ${targetId}`);
        }

        return resources;
    }

    private swapBuffers(resources: AccumulatorResources): void {
        [resources.textures.current, resources.textures.previous] =
            [resources.textures.previous, resources.textures.current];

        [resources.framebuffers.current, resources.framebuffers.previous] =
            [resources.framebuffers.previous, resources.framebuffers.current];
    }

    private disposeResources(resources: AccumulatorResources): void {
        this.gl.deleteTexture(resources.textures.current);
        this.gl.deleteTexture(resources.textures.previous);
        this.gl.deleteFramebuffer(resources.framebuffers.current);
        this.gl.deleteFramebuffer(resources.framebuffers.previous);
    }

    private createFilmTexture(): WebGLTexture {
        const texture = this.gl.createTexture();
        if (!texture) throw new Error('Failed to create texture');

        this.gl.bindTexture(this.gl.TEXTURE_2D, texture);

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
}
