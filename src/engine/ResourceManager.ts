// engine/ResourceManager.ts

import type { RenderPipeline, FramebufferConfig, SwapInstruction } from '../compiler/types.js';

/**
 * Framebuffer resource (can be single or pair for ping-pong)
 */
interface FramebufferResource {
    config: FramebufferConfig;
    formats: string[];                  // Normalized format array (always array, even for single)
    framebuffers: WebGLFramebuffer[];   // 1 for texture/screen, 2 for double_buffer

    /**
     * Textures organized as 2D array: [attachmentIndex][bufferIndex]
     *
     * Single attachment:
     * - texture: textures[0][0]
     * - double_buffer: textures[0][0], textures[0][1]
     *
     * MRT (3 attachments):
     * - texture: textures[0][0], textures[1][0], textures[2][0]
     * - double_buffer: textures[0][0..1], textures[1][0..1], textures[2][0..1]
     */
    textures: WebGLTexture[][];

    currentIndex: number;               // 0 or 1 (for double_buffer)
}

/**
 * ResourceManager
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
export class ResourceManager {
    private gl: WebGL2RenderingContext;
    private width: number;
    private height: number;

    // Resource storage per renderer
    private renderers: Map<string, Map<string, FramebufferResource>>;
    private activeRenderer: string | null = null;

    constructor(gl: WebGL2RenderingContext) {
        this.gl = gl;

        // Get dimensions from canvas (matches original ResourceManager pattern)
        this.width = gl.canvas.width;
        this.height = gl.canvas.height;

        this.renderers = new Map();

        this.enableRequiredExtensions();
    }

    /**
     * Enable the extensions required for float-buffer HDR rendering. Must be
     * (re-)called after a context restore — extension state resets on loss, and
     * without EXT_color_buffer_float the RGBA32F/16F framebuffers come back
     * INCOMPLETE_ATTACHMENT.
     */
    enableRequiredExtensions(): void {
        const ext = this.gl.getExtension('EXT_color_buffer_float');
        if (!ext) {
            throw new Error('EXT_color_buffer_float extension required for HDR rendering');
        }
    }

    /**
     * Load a renderer's pipeline and create its GPU resources
     */
    loadRenderer(rendererId: string, pipeline: RenderPipeline): void {
        if (this.renderers.has(rendererId)) {
            console.log(`Reusing resources for renderer '${rendererId}'`);
            return;
        }

        console.log(`Creating resources for renderer '${rendererId}'`);

        // Create resource map for this renderer
        const resources = new Map<string, FramebufferResource>();

        // Create framebuffers from pipeline spec
        for (const fbConfig of pipeline.framebuffers) {
            const resource = this._createFramebufferResource(fbConfig);
            resources.set(fbConfig.id, resource);

            // Clear buffers for double_buffer types
            if (fbConfig.type === 'double_buffer') {
                this._clearFramebuffers(resource);
            }
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
        console.log(`Switched to renderer '${rendererId}'`);
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
     * Get texture by id (resolves current/previous for double_buffer, :N for MRT)
     *
     * Examples:
     * - 'accumulation_current' → attachment 0, current buffer
     * - 'accumulation_previous:1' → attachment 1, previous buffer
     * - 'myTexture:2' → attachment 2
     */
    getTexture(id: string): WebGLTexture {
        const { baseId, qualifier, attachment } = this._parseId(id);
        const resource = this._getActiveResource(baseId);

        if (resource.config.type === 'screen') {
            throw new Error('Cannot get texture for screen framebuffer');
        }

        // Validate attachment index
        if (attachment >= resource.textures.length) {
            throw new Error(
                `Attachment ${attachment} out of range for '${baseId}' ` +
                `(has ${resource.textures.length} attachment(s))`
            );
        }

        // Get buffer index (for double_buffer)
        const bufferIndex = resource.config.type === 'double_buffer'
            ? this._resolveIndex(resource, qualifier)
            : 0;

        return resource.textures[attachment][bufferIndex];
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
     * WARNING: All accumulation will be lost
     */
    resize(width: number, height: number): void {
        if (width === this.width && height === this.height) {
            console.log('Resize called but dimensions unchanged, skipping');
            return;
        }

        console.log(`Resizing buffers: ${this.width}×${this.height} → ${width}×${height}`);

        const rendererCount = this.renderers.size;
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

        console.log(`Resized ${rendererCount} renderer(s) - accumulation reset for all`);
    }

    /**
     * Handle WebGL context loss
     */
    handleContextLoss(): void {
        console.warn('WebGL context lost - all GPU resources invalidated');
        this.renderers.clear();
        this.activeRenderer = null;
    }

    /**
     * Unload a single renderer's GPU resources (framebuffers + textures)
     *
     * No-op if the renderer isn't loaded. Clears the active pointer if it
     * referred to this renderer.
     */
    unloadRenderer(rendererId: string): void {
        const resources = this.renderers.get(rendererId);
        if (!resources) return;

        const gl = this.gl;
        for (const resource of resources.values()) {
            // Delete framebuffers
            for (const fb of resource.framebuffers) {
                if (fb) gl.deleteFramebuffer(fb);
            }

            // Delete textures — textures is WebGLTexture[][] ([attachment][bufferIndex]),
            // so this must be a nested loop (passing the inner array to deleteTexture throws)
            for (const attachmentTextures of resource.textures) {
                for (const tex of attachmentTextures) {
                    if (tex) gl.deleteTexture(tex);
                }
            }
        }

        this.renderers.delete(rendererId);
        if (this.activeRenderer === rendererId) {
            this.activeRenderer = null;
        }
    }

    /**
     * Clean up all GPU resources
     */
    cleanup(): void {
        for (const rendererId of [...this.renderers.keys()]) {
            this.unloadRenderer(rendererId);
        }
    }

    /**
     * Clear a specific buffer (set to black/transparent)
     *
     * For double_buffer types, clears both current and previous buffers.
     * This is used to reset accumulation.
     *
     * @param bufferId - The buffer id (e.g., 'accumulation')
     */
    clearBuffer(bufferId: string): void {
        const { baseId } = this._parseId(bufferId);
        const resource = this._getActiveResource(baseId);

        if (resource.config.type === 'screen') {
            // Clear screen framebuffer
            const gl = this.gl;
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
            gl.clearColor(0, 0, 0, 0);
            gl.clear(gl.COLOR_BUFFER_BIT);
            return;
        }

        // Clear all framebuffers for this resource
        this._clearFramebuffers(resource);
    }

    /**
     * Clear all buffers for the active renderer
     *
     * Clears all framebuffers including accumulation buffers.
     * Used when switching renderers or resetting state.
     */
    clearAllBuffers(): void {
        if (!this.activeRenderer) return;

        const resources = this.renderers.get(this.activeRenderer);
        if (!resources) return;

        for (const resource of resources.values()) {
            if (resource.config.type !== 'screen') {
                this._clearFramebuffers(resource);
            }
        }
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
                formats: [],
                framebuffers: [],
                textures: [],
                currentIndex: 0
            };
        }

        // Normalize format to array (single format → [format])
        const formats = Array.isArray(config.format)
            ? config.format
            : [config.format || 'rgba8'];

        const isMRT = formats.length > 1;
        const numBuffers = config.type === 'double_buffer' ? 2 : 1;

        // Validate MRT doesn't exceed WebGL limits
        if (isMRT) {
            const maxDrawBuffers = gl.getParameter(gl.MAX_DRAW_BUFFERS);
            if (formats.length > maxDrawBuffers) {
                throw new Error(
                    `MRT attachment count (${formats.length}) exceeds MAX_DRAW_BUFFERS (${maxDrawBuffers})`
                );
            }
        }

        // Create textures: 2D array [attachmentIndex][bufferIndex]
        const textures: WebGLTexture[][] = [];
        for (let a = 0; a < formats.length; a++) {
            const attachmentTextures: WebGLTexture[] = [];
            for (let b = 0; b < numBuffers; b++) {
                attachmentTextures.push(this._createTexture(formats[a]));
            }
            textures.push(attachmentTextures);
        }

        // Create framebuffers and attach all textures
        const framebuffers: WebGLFramebuffer[] = [];
        for (let b = 0; b < numBuffers; b++) {
            // Collect textures for this buffer (one from each attachment)
            const bufferTextures = textures.map(attachmentTextures => attachmentTextures[b]);
            framebuffers.push(this._createFramebuffer(bufferTextures, isMRT));
        }

        return {
            config,
            formats,
            framebuffers,
            textures,
            currentIndex: 0
        };
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
        // FUTURE: Add WebGL error checking after GL calls (checkGLError utility)

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
     * Create framebuffer and attach texture(s)
     *
     * @param textures - Array of textures to attach (one per attachment location)
     * @param isMRT - Whether this is an MRT framebuffer (sets up drawBuffers)
     */
    private _createFramebuffer(textures: WebGLTexture[], isMRT: boolean): WebGLFramebuffer {
        const gl = this.gl;
        const framebuffer = gl.createFramebuffer();
        if (!framebuffer) throw new Error('Failed to create framebuffer');

        gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);

        // Attach all textures
        for (let i = 0; i < textures.length; i++) {
            gl.framebufferTexture2D(
                gl.FRAMEBUFFER,
                gl.COLOR_ATTACHMENT0 + i,
                gl.TEXTURE_2D,
                textures[i],
                0
            );
        }

        // Set draw buffers if MRT
        if (isMRT) {
            const drawBuffers = textures.map((_, i) => gl.COLOR_ATTACHMENT0 + i);
            gl.drawBuffers(drawBuffers);
        }

        // Check framebuffer status
        const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
        if (status !== gl.FRAMEBUFFER_COMPLETE) {
            throw new Error(`Framebuffer incomplete: ${this._getFramebufferStatus(status)}`);
        }

        gl.bindFramebuffer(gl.FRAMEBUFFER, null);

        return framebuffer;
    }

    /**
     * Clear framebuffers (set to black/transparent)
     */
    private _clearFramebuffers(resource: FramebufferResource): void {
        const gl = this.gl;

        for (const framebuffer of resource.framebuffers) {
            gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
            gl.clearColor(0, 0, 0, 0);
            gl.clear(gl.COLOR_BUFFER_BIT);
        }

        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    /**
     * Get human-readable framebuffer status
     */
    private _getFramebufferStatus(status: number): string {
        const gl = this.gl;

        switch (status) {
            case gl.FRAMEBUFFER_INCOMPLETE_ATTACHMENT:
                return 'INCOMPLETE_ATTACHMENT';
            case gl.FRAMEBUFFER_INCOMPLETE_MISSING_ATTACHMENT:
                return 'MISSING_ATTACHMENT';
            case gl.FRAMEBUFFER_INCOMPLETE_DIMENSIONS:
                return 'INCOMPLETE_DIMENSIONS';
            case gl.FRAMEBUFFER_UNSUPPORTED:
                return 'UNSUPPORTED';
            default:
                return `Unknown (${status})`;
        }
    }

    /**
     * Resize textures in a resource
     */
    private _resizeTextures(resource: FramebufferResource): void {
        const gl = this.gl;

        // Resize all textures in 2D array
        for (let a = 0; a < resource.textures.length; a++) {
            for (let b = 0; b < resource.textures[a].length; b++) {
                this._allocateTextureStorage(resource.textures[a][b], resource.formats[a]);
            }
        }

        // Verify framebuffer completeness after resize
        // (Textures have new storage, need to ensure attachments are still valid)
        for (const framebuffer of resource.framebuffers) {
            gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
            const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
            if (status !== gl.FRAMEBUFFER_COMPLETE) {
                throw new Error(`Framebuffer incomplete after resize: ${this._getFramebufferStatus(status)}`);
            }
        }
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
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
     * Parse id into base, qualifier, and attachment
     *
     * Examples:
     * - 'accumulation' → { baseId: 'accumulation', qualifier: null, attachment: 0 }
     * - 'accumulation_current' → { baseId: 'accumulation', qualifier: 'current', attachment: 0 }
     * - 'accumulation_previous' → { baseId: 'accumulation', qualifier: 'previous', attachment: 0 }
     * - 'accumulation_current:1' → { baseId: 'accumulation', qualifier: 'current', attachment: 1 }
     * - 'myBuffer:2' → { baseId: 'myBuffer', qualifier: null, attachment: 2 }
     */
    private _parseId(id: string): {
        baseId: string;
        qualifier: string | null;
        attachment: number;
    } {
        return parseResourceId(id);
    }

    /**
     * Resolve index based on qualifier and current state
     */
    private _resolveIndex(resource: FramebufferResource, qualifier: string | null): number {
        return resolveBufferIndex(resource.currentIndex, qualifier);
    }
}

// ============================================================================
// Pure ID helpers (exported for unit testing; the class methods above delegate here)
// ============================================================================

/**
 * Parse a framebuffer/texture id into base id, ping-pong qualifier, and MRT attachment.
 * A non-numeric ':suffix' is left attached to the base id (attachment stays 0).
 */
export function parseResourceId(id: string): { baseId: string; qualifier: string | null; attachment: number } {
    let rest = id;
    let attachment = 0;

    const colonIndex = id.lastIndexOf(':');
    if (colonIndex !== -1) {
        const attachmentNum = parseInt(id.substring(colonIndex + 1), 10);
        if (!isNaN(attachmentNum)) {
            attachment = attachmentNum;
            rest = id.substring(0, colonIndex);
        }
    }

    const parts = rest.split('_');
    const lastPart = parts[parts.length - 1];

    if (lastPart === 'current' || lastPart === 'previous') {
        return { baseId: parts.slice(0, -1).join('_'), qualifier: lastPart, attachment };
    }

    return { baseId: rest, qualifier: null, attachment };
}

/**
 * Resolve the physical buffer index for a ping-pong qualifier.
 * 'previous' → the other of the two; 'current' or none → currentIndex.
 */
export function resolveBufferIndex(currentIndex: number, qualifier: string | null): number {
    if (qualifier === 'previous') return 1 - currentIndex;
    return currentIndex;
}
