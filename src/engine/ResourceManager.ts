// engine/ResourceManager.ts

/**
 * Per-recipe accumulation resources
 * Each recipe maintains independent film buffers and accumulation state
 */
interface FilmResources {
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
    private filmResourcesMap = new Map<string, FilmResources>();
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
    setupFilmBuffers(recipeId: string): FilmResources {
        // TODO: Consider validating recipe ID format (non-empty, valid chars, etc)

        // Check if already exists
        if (this.filmResourcesMap.has(recipeId)) {
            console.log(`Reusing film buffers for recipe '${recipeId}'`);
            return this.filmResourcesMap.get(recipeId)!;
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
        const resources: FilmResources = {
            textures,
            framebuffers,
            accumulator: {
                sampleCount: 0,
                startTime: Date.now(),
                lastResetTime: Date.now()
            }
        };

        this.filmResourcesMap.set(recipeId, resources);
        this.clearFilmBuffers(recipeId);

        return resources;
    }

    /**
     * Set which recipe is active for rendering
     */
    setActiveRecipe(recipeId: string): void {
        if (!this.filmResourcesMap.has(recipeId)) {
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
    clearFilmBuffers(recipeId?: string): void {
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
        const recipeIds = Array.from(this.filmResourcesMap.keys());
        const wasActive = this.activeRecipeId;

        // Dispose all old buffers
        this.dispose();

        // Recreate buffers for all recipes at new size
        for (const recipeId of recipeIds) {
            this.setupFilmBuffers(recipeId);
        }

        // Restore active recipe if there was one
        if (wasActive && this.filmResourcesMap.has(wasActive)) {
            this.setActiveRecipe(wasActive);
        }
    }

    /**
     * Clean up GPU resources for specific recipe or all recipes
     */
    dispose(recipeId?: string): void {
        if (recipeId) {
            // Dispose specific recipe
            const resources = this.filmResourcesMap.get(recipeId);
            if (resources) {
                this.disposeResources(resources);
                this.filmResourcesMap.delete(recipeId);
                if (this.activeRecipeId === recipeId) {
                    this.activeRecipeId = null;
                }
            }
        } else {
            // Dispose all recipes
            for (const resources of this.filmResourcesMap.values()) {
                this.disposeResources(resources);
            }
            this.filmResourcesMap.clear();
            this.activeRecipeId = null;
        }
    }

    // ============================================================================
    // Private Helpers
    // ============================================================================

    /**
     * Get resources for specific recipe or active recipe
     * Centralizes error handling for missing recipes
     */
    private getResources(recipeId?: string): FilmResources {
        const targetId = recipeId ?? this.activeRecipeId;
        if (!targetId) {
            throw new Error('No active recipe and no recipe ID provided');
        }

        const resources = this.filmResourcesMap.get(targetId);
        if (!resources) {
            throw new Error(`No resources found for recipe: ${targetId}`);
        }

        return resources;
    }

    private swapBuffers(resources: FilmResources): void {
        // Swap texture references
        [resources.textures.current, resources.textures.previous] =
            [resources.textures.previous, resources.textures.current];

        // Swap framebuffer references
        [resources.framebuffers.current, resources.framebuffers.previous] =
            [resources.framebuffers.previous, resources.framebuffers.current];
    }

    private disposeResources(resources: FilmResources): void {
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
