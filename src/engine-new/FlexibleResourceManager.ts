// engine-new/FlexibleResourceManager.ts

import type { RenderPipeline, FramebufferConfig, SwapInstruction } from '../compiler/types.js';

/**
 * Framebuffer resource (can be single or pair for ping-pong)
 */
interface FramebufferResource {
    config: FramebufferConfig;
    framebuffers: WebGLFramebuffer[];  // 1 for texture/screen, 2 for double_buffer
    textures: WebGLTexture[];           // 1 for texture, 2 for double_buffer
    currentIndex: number;               // 0 or 1 (for double_buffer)
}

/**
 * FlexibleResourceManager
 *
 * Dynamically creates and manages GPU resources from RenderPipeline specifications.
 * Handles different framebuffer types:
 * - 'screen': Default framebuffer (canvas)
 * - 'texture': Single framebuffer with texture
 * - 'double_buffer': Ping-pong pair for accumulation
 *
 * Key responsibilities:
 * - Parse pipeline and create framebuffers/textures
 * - Provide getters that resolve current/previous state
 * - Execute swap instructions (flip ping-pong)
 * - Handle resize (recreate textures)
 * - Clean up resources
 */
export class FlexibleResourceManager {
    private gl: WebGL2RenderingContext;
    private width: number;
    private height: number;

    // Resource storage per renderer
    private renderers: Map<string, Map<string, FramebufferResource>>;
    private activeRenderer: string | null = null;

    constructor(gl: WebGL2RenderingContext, width: number, height: number) {
        this.gl = gl;
        this.width = width;
        this.height = height;
        this.renderers = new Map();
    }

    /**
     * Load a renderer's pipeline and create its GPU resources
     */
    loadRenderer(rendererId: string, pipeline: RenderPipeline): void {
        // Create resource map for this renderer
        const resources = new Map<string, FramebufferResource>();

        // Create framebuffers from pipeline spec
        for (const fbConfig of pipeline.framebuffers) {
            const resource = this._createFramebufferResource(fbConfig);
            resources.set(fbConfig.id, resource);
        }

        // Store resources
        this.renderers.set(rendererId, resources);
    }

    /**
     * Select active renderer
     */
    selectRenderer(rendererId: string): void {
        if (!this.renderers.has(rendererId)) {
            throw new Error(`Renderer not loaded: ${rendererId}`);
        }
        this.activeRenderer = rendererId;
    }

    /**
     * Get framebuffer by id (resolves current/previous for double_buffer)
     *
     * Examples:
     * - getFramebuffer('screen') → null (default framebuffer)
     * - getFramebuffer('accumulation_current') → current ping-pong buffer
     * - getFramebuffer('accumulation_previous') → previous ping-pong buffer
     * - getFramebuffer('myTexture') → single framebuffer
     */
    getFramebuffer(id: string): WebGLFramebuffer | null {
        const { baseId, qualifier } = this._parseId(id);
        const resource = this._getActiveResource(baseId);

        if (resource.config.type === 'screen') {
            return null;  // Default framebuffer
        }

        if (resource.config.type === 'double_buffer') {
            // Resolve current/previous
            const index = this._resolveIndex(resource, qualifier);
            return resource.framebuffers[index];
        }

        // Single texture
        return resource.framebuffers[0];
    }

    /**
     * Get texture by id (resolves current/previous for double_buffer)
     */
    getTexture(id: string): WebGLTexture {
        const { baseId, qualifier } = this._parseId(id);
        const resource = this._getActiveResource(baseId);

        if (resource.config.type === 'screen') {
            throw new Error('Cannot get texture for screen framebuffer');
        }

        if (resource.config.type === 'double_buffer') {
            // Resolve current/previous
            const index = this._resolveIndex(resource, qualifier);
            return resource.textures[index];
        }

        // Single texture
        return resource.textures[0];
    }

    /**
     * Execute a swap instruction
     */
    executeSwap(instruction: SwapInstruction): void {
        if (instruction.type === 'swap') {
            // Flip ping-pong buffers
            for (const bufferId of instruction.buffers) {
                const resource = this._getActiveResource(bufferId);
                if (resource.config.type === 'double_buffer') {
                    resource.currentIndex = 1 - resource.currentIndex;
                }
            }
        } else if (instruction.type === 'rotate') {
            // TODO: Implement rotation for temporal history queues
            throw new Error('Rotate swap not yet implemented');
        }
    }

    /**
     * Resize all textures to new dimensions
     */
    resize(width: number, height: number): void {
        this.width = width;
        this.height = height;

        // Recreate all textures at new size
        for (const resources of this.renderers.values()) {
            for (const resource of resources.values()) {
                if (resource.config.type !== 'screen') {
                    this._resizeTextures(resource);
                }
            }
        }
    }

    /**
     * Clean up all GPU resources
     */
    cleanup(): void {
        const gl = this.gl;

        for (const resources of this.renderers.values()) {
            for (const resource of resources.values()) {
                // Delete framebuffers
                for (const fb of resource.framebuffers) {
                    if (fb) gl.deleteFramebuffer(fb);
                }

                // Delete textures
                for (const tex of resource.textures) {
                    if (tex) gl.deleteTexture(tex);
                }
            }
        }

        this.renderers.clear();
        this.activeRenderer = null;
    }

    // ============ PRIVATE METHODS ============

    /**
     * Create framebuffer resource from config
     */
    private _createFramebufferResource(config: FramebufferConfig): FramebufferResource {
        const gl = this.gl;

        if (config.type === 'screen') {
            // Screen has no framebuffer/texture
            return {
                config,
                framebuffers: [],
                textures: [],
                currentIndex: 0
            };
        }

        if (config.type === 'texture') {
            // Single framebuffer + texture
            const texture = this._createTexture(config.format || 'rgba8');
            const framebuffer = this._createFramebuffer(texture);

            return {
                config,
                framebuffers: [framebuffer],
                textures: [texture],
                currentIndex: 0
            };
        }

        if (config.type === 'double_buffer') {
            // Ping-pong pair
            const texture0 = this._createTexture(config.format || 'rgba32f');
            const texture1 = this._createTexture(config.format || 'rgba32f');
            const framebuffer0 = this._createFramebuffer(texture0);
            const framebuffer1 = this._createFramebuffer(texture1);

            return {
                config,
                framebuffers: [framebuffer0, framebuffer1],
                textures: [texture0, texture1],
                currentIndex: 0
            };
        }

        throw new Error(`Unknown framebuffer type: ${config.type}`);
    }

    /**
     * Create a texture with specified format
     */
    private _createTexture(format: string): WebGLTexture {
        const gl = this.gl;
        const texture = gl.createTexture();
        if (!texture) throw new Error('Failed to create texture');

        gl.bindTexture(gl.TEXTURE_2D, texture);

        // Set texture parameters
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

        // Allocate storage based on format
        this._allocateTextureStorage(texture, format);

        gl.bindTexture(gl.TEXTURE_2D, null);

        return texture;
    }

    /**
     * Allocate texture storage based on format
     */
    private _allocateTextureStorage(texture: WebGLTexture, format: string): void {
        const gl = this.gl;

        gl.bindTexture(gl.TEXTURE_2D, texture);

        switch (format) {
            case 'rgba32f':
                gl.texImage2D(
                    gl.TEXTURE_2D,
                    0,
                    gl.RGBA32F,
                    this.width,
                    this.height,
                    0,
                    gl.RGBA,
                    gl.FLOAT,
                    null
                );
                break;

            case 'rgba16f':
                gl.texImage2D(
                    gl.TEXTURE_2D,
                    0,
                    gl.RGBA16F,
                    this.width,
                    this.height,
                    0,
                    gl.RGBA,
                    gl.HALF_FLOAT,
                    null
                );
                break;

            case 'rgba8':
                gl.texImage2D(
                    gl.TEXTURE_2D,
                    0,
                    gl.RGBA8,
                    this.width,
                    this.height,
                    0,
                    gl.RGBA,
                    gl.UNSIGNED_BYTE,
                    null
                );
                break;

            case 'r32f':
                gl.texImage2D(
                    gl.TEXTURE_2D,
                    0,
                    gl.R32F,
                    this.width,
                    this.height,
                    0,
                    gl.RED,
                    gl.FLOAT,
                    null
                );
                break;

            default:
                throw new Error(`Unsupported texture format: ${format}`);
        }
    }

    /**
     * Create framebuffer and attach texture
     */
    private _createFramebuffer(texture: WebGLTexture): WebGLFramebuffer {
        const gl = this.gl;
        const framebuffer = gl.createFramebuffer();
        if (!framebuffer) throw new Error('Failed to create framebuffer');

        gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
        gl.framebufferTexture2D(
            gl.FRAMEBUFFER,
            gl.COLOR_ATTACHMENT0,
            gl.TEXTURE_2D,
            texture,
            0
        );

        // Check framebuffer status
        const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
        if (status !== gl.FRAMEBUFFER_COMPLETE) {
            throw new Error(`Framebuffer incomplete: ${status}`);
        }

        gl.bindFramebuffer(gl.FRAMEBUFFER, null);

        return framebuffer;
    }

    /**
     * Resize textures in a resource
     */
    private _resizeTextures(resource: FramebufferResource): void {
        const format = resource.config.format || 'rgba8';

        for (const texture of resource.textures) {
            this._allocateTextureStorage(texture, format);
        }
    }

    /**
     * Get active renderer's resource
     */
    private _getActiveResource(id: string): FramebufferResource {
        if (!this.activeRenderer) {
            throw new Error('No active renderer');
        }

        const resources = this.renderers.get(this.activeRenderer);
        if (!resources) {
            throw new Error(`Renderer not found: ${this.activeRenderer}`);
        }

        const resource = resources.get(id);
        if (!resource) {
            throw new Error(`Resource not found: ${id}`);
        }

        return resource;
    }

    /**
     * Parse id into base and qualifier
     *
     * Examples:
     * - 'accumulation' → { baseId: 'accumulation', qualifier: null }
     * - 'accumulation_current' → { baseId: 'accumulation', qualifier: 'current' }
     * - 'accumulation_previous' → { baseId: 'accumulation', qualifier: 'previous' }
     */
    private _parseId(id: string): { baseId: string; qualifier: string | null } {
        const parts = id.split('_');

        if (parts.length === 1) {
            return { baseId: id, qualifier: null };
        }

        const lastPart = parts[parts.length - 1];
        if (lastPart === 'current' || lastPart === 'previous') {
            const baseId = parts.slice(0, -1).join('_');
            return { baseId, qualifier: lastPart };
        }

        // Not a qualifier, treat as base id
        return { baseId: id, qualifier: null };
    }

    /**
     * Resolve index based on qualifier and current state
     */
    private _resolveIndex(resource: FramebufferResource, qualifier: string | null): number {
        if (qualifier === 'current') {
            return resource.currentIndex;
        }

        if (qualifier === 'previous') {
            return 1 - resource.currentIndex;
        }

        // No qualifier, default to current
        return resource.currentIndex;
    }
}
