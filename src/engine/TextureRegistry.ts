// engine/TextureRegistry.ts

/**
 * TextureRegistry — a dumb name → WebGLTexture store (contracts §2.10).
 *
 * The registry holds externally-loaded textures (e.g. an environment map + its CDFs)
 * under stable names. It does NOT own texture units or bind anything: the RenderExecutor
 * is the sole texture-unit authority — per pass, it binds framebuffer refs and
 * `extern:<name>` refs alike to sequential units in declaration order. (The old
 * fixed-unit reservation + bind-at-load scheme was the blind-executor violation and
 * collided with pass-input units — audit F1/F10; deleted in env-as-light T1.)
 */
export class TextureRegistry {
    private gl: WebGL2RenderingContext;
    private textures = new Map<string, WebGLTexture>();

    constructor(gl: WebGL2RenderingContext) {
        this.gl = gl;
    }

    /**
     * Drop all registrations after a context loss. The WebGLTexture handles are
     * dead and their source data isn't retained here, so callers must re-load
     * (e.g. re-load the HDR environment) to repopulate the registry.
     */
    handleContextLoss(): void {
        this.textures.clear();
    }

    /** Register a texture under a stable name, deleting any texture it replaces. */
    register(name: string, texture: WebGLTexture): void {
        const oldTexture = this.textures.get(name);
        if (oldTexture) {
            this.gl.deleteTexture(oldTexture);
        }
        this.textures.set(name, texture);
    }

    /** Look up a texture by name (undefined if not registered). */
    get(name: string): WebGLTexture | undefined {
        return this.textures.get(name);
    }

    /** Check if a texture is registered. */
    has(name: string): boolean {
        return this.textures.has(name);
    }

    /** Registered names (for error messages). */
    names(): string[] {
        return [...this.textures.keys()];
    }

    /** Clean up all textures. */
    dispose(): void {
        for (const texture of this.textures.values()) {
            this.gl.deleteTexture(texture);
        }
        this.textures.clear();
    }
}
