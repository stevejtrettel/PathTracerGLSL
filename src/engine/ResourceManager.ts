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

export class ResourceManager {
    private gl: WebGL2RenderingContext;

    // Per-recipe resources - enables instant recipe switching with preserved accumulation
    private accumulatorResourcesMap = new Map<string, AccumulatorResources>();
    private activeRecipeId: string | null = null;

    // Track dimensions for all recipes
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
    }

    /**
     * Setup film buffers for a specific recipe
     * Creates new buffers or reuses existing ones
     */
    setupAccumulationBuffers(recipeId: string): AccumulatorResources {
        // TODO: Consider validating recipe ID format (non-empty, valid chars, etc)

        // Check if already exists
        if (this.accumulatorResourcesMap.has(recipeId)) {
            console.log(`Reusing film buffers for recipe '${recipeId}'`);
            return this.accumulatorResourcesMap.get(recipeId)!;
        }

        console.log(`Creating film buffers for recipe '${recipeId}'`);

        // Create new textures
        const textures = {
            current: this.createFilmTexture(),
            previous: this.createFilmTexture()
        };

        // Create framebuffers
        const framebuffers = {
            current: this.createFramebuffer(textures.current),
            previous: this.createFramebuffer(textures.previous)
        };

        // Create resource bundle with fresh accumulation state
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
     * Set which recipe is active for rendering
     */
    setActiveRecipe(recipeId: string): void {
        if (!this.accumulatorResourcesMap.has(recipeId)) {
            throw new Error(`No film resources for recipe: ${recipeId}`);
        }
        this.activeRecipeId = recipeId;
        console.log(`Switched to recipe '${recipeId}'`);
    }

    /**
     * Get the currently active recipe ID
     */
    getActiveRecipeId(): string | null {
        return this.activeRecipeId;
    }

    /**
     * Get sample count for active recipe
     */
    getSampleCount(): number {
        const resources = this.getResources();
        return resources.accumulator.sampleCount;
    }

    /**
     * Increment sample count for active recipe
     */
    incrementSampleCount(): void {
        const resources = this.getResources();
        resources.accumulator.sampleCount++;
    }

    /**
     * Reset sample count for active recipe (or specific recipe)
     */
    resetSampleCount(recipeId?: string): void {
        const resources = this.getResources(recipeId);
        resources.accumulator.sampleCount = 0;
        resources.accumulator.lastResetTime = Date.now();
    }

    /**
     * Get current radiance texture for display pass
     */
    getCurrentTexture(): WebGLTexture {
        const resources = this.getResources();
        return resources.textures.current;
    }

    /**
     * Get current accumulator framebuffer for reading radiance data
     */
    getCurrentFramebuffer(): WebGLFramebuffer {
        const resources = this.getResources();
        return resources.framebuffers.current;
    }

    /**
     * Prepare for rendering - bind previous frame and set render target
     */
    prepareFrame(): void {
        const resources = this.getResources();

        // Bind previous frame texture to unit 0 for accumulation shader
        this.gl.activeTexture(this.gl.TEXTURE0);
        this.gl.bindTexture(this.gl.TEXTURE_2D, resources.textures.previous);

        // Render to current framebuffer
        this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, resources.framebuffers.current);
        this.gl.viewport(0, 0, this.width, this.height);
    }

    /**
     * Finalize frame - swap buffers for active recipe
     */
    finalizeFrame(): void {
        const resources = this.getResources();
        this.swapBuffers(resources);
    }

    /**
     * Clear accumulation buffers (for specific recipe or active recipe)
     */
    clearAccumulationBuffers(recipeId?: string): void {
        const resources = this.getResources(recipeId);

        // Clear both buffers to black
        [resources.framebuffers.current, resources.framebuffers.previous].forEach(fb => {
            this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, fb);
            this.gl.clearColor(0, 0, 0, 0);
            this.gl.clear(this.gl.COLOR_BUFFER_BIT);
        });

        this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
    }

    /**
     * Handle canvas resize - resizes ALL recipe buffers
     */
    resize(width: number, height: number): void {
        if (width === this.width && height === this.height) return;

        this.width = width;
        this.height = height;

        console.log(`Resizing all recipe buffers to ${width}x${height}`);

        // Save which recipes existed
        const recipeIds = Array.from(this.accumulatorResourcesMap.keys());
        const wasActive = this.activeRecipeId;

        // Dispose all old buffers
        this.dispose();

        // Recreate buffers for all recipes at new size
        for (const recipeId of recipeIds) {
            this.setupAccumulationBuffers(recipeId);
        }

        // Restore active recipe if there was one
        if (wasActive && this.accumulatorResourcesMap.has(wasActive)) {
            this.setActiveRecipe(wasActive);
        }
    }

    /**
     * Clean up GPU resources for specific recipe or all recipes
     */
    dispose(recipeId?: string): void {
        if (recipeId) {
            // Dispose specific recipe
            const resources = this.accumulatorResourcesMap.get(recipeId);
            if (resources) {
                this.disposeResources(resources);
                this.accumulatorResourcesMap.delete(recipeId);
                if (this.activeRecipeId === recipeId) {
                    this.activeRecipeId = null;
                }
            }
        } else {
            // Dispose all recipes
            for (const resources of this.accumulatorResourcesMap.values()) {
                this.disposeResources(resources);
            }
            this.accumulatorResourcesMap.clear();
            this.activeRecipeId = null;
        }
    }


    /**
     * Handle WebGL context loss - called by Engine
     */
    handleContextLoss(): void {
        console.warn('WebGL context lost - all GPU resources invalidated');
        console.warn('IMPORTANT: All accumulated samples for all recipes will be lost');

        // Clear references but DON'T try to delete - resources are already gone
        this.accumulatorResourcesMap.clear();
        this.activeRecipeId = null;

        // Note: If context is restored, Engine will need to reinitialize
    }



    /**
     * Handle canvas resize - resizes ALL recipe buffers
     * WARNING: All accumulation will be lost (unavoidable - buffer dimensions changed)
     */
    resize(width: number, height: number): void {
        if (width === this.width && height === this.height) {
            console.log('Resize called but dimensions unchanged, skipping');
            return;
        }

        console.log(`Resizing all accumulator buffers: ${this.width}x${this.height} → ${width}x${height}`);

        // Update dimensions
        this.width = width;
        this.height = height;

        // Save which recipes existed and which was active
        const recipeIds = Array.from(this.accumulatorResourcesMap.keys());
        const wasActive = this.activeRecipeId;

        // Dispose all old buffers (they're wrong size now)
        for (const recipeId of recipeIds) {
            const resources = this.accumulatorResourcesMap.get(recipeId)!;
            this.disposeResources(resources);
        }
        this.accumulatorResourcesMap.clear();
        this.activeRecipeId = null;

        // Recreate buffers at new size for all recipes
        for (const recipeId of recipeIds) {
            this.setupAccumulationBuffers(recipeId);
        }

        // Restore active recipe if there was one
        if (wasActive && this.accumulatorResourcesMap.has(wasActive)) {
            this.setActiveRecipe(wasActive);
        }

        console.log(`Resized ${recipeIds.length} recipe(s) - accumulation reset for all`);
    }

    // ============================================================================
    // Private Helpers
    // ============================================================================

    /**
     * Get resources for specific recipe or active recipe
     * Centralizes error handling for missing recipes
     */
    private getResources(recipeId?: string): AccumulatorResources {
        const targetId = recipeId ?? this.activeRecipeId;
        if (!targetId) {
            throw new Error('No active recipe and no recipe ID provided');
        }

        const resources = this.accumulatorResourcesMap.get(targetId);
        if (!resources) {
            throw new Error(`No resources found for recipe: ${targetId}`);
        }

        return resources;
    }

    private swapBuffers(resources: AccumulatorResources): void {
        // Swap texture references
        [resources.textures.current, resources.textures.previous] =
            [resources.textures.previous, resources.textures.current];

        // Swap framebuffer references
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



}
