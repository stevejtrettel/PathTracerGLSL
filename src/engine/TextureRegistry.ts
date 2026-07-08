// engine/TextureRegistry.ts

/**
 * TextureRegistry - Manages texture units and bindings
 *
 * Responsibilities:
 * - Register textures and assign texture units
 * - Bind textures to shader uniforms
 * - Handle texture cleanup
 *
 * Note: Unit 0 is typically reserved for accumulator texture
 */
export class TextureRegistry {
    private gl: WebGL2RenderingContext;
    private textures = new Map<string, WebGLTexture>();
    private units = new Map<string, number>();
    private nextUnit: number;
    private readonly reservedUnits: number;

    constructor(gl: WebGL2RenderingContext, reservedUnits: number = 1) {
        this.gl = gl;
        this.reservedUnits = reservedUnits;
        this.nextUnit = reservedUnits;
    }

    /**
     * Drop all registrations after a context loss. The WebGLTexture handles are
     * dead and their source data isn't retained here, so callers must re-load
     * (e.g. re-load the HDR environment) to repopulate the registry.
     */
    handleContextLoss(): void {
        this.textures.clear();
        this.units.clear();
        this.nextUnit = this.reservedUnits;
    }

    /**
     * Register a texture with optional unit assignment
     */
    register(name: string, texture: WebGLTexture, requestedUnit?: number): void {
        // Clean up existing texture if replacing
        const oldTexture = this.textures.get(name);
        if (oldTexture) {
            this.gl.deleteTexture(oldTexture);
        }

        this.textures.set(name, texture);

        // Reuse the unit already assigned to this name when re-registering (e.g.
        // reloading an HDR). Only a genuinely new name consumes a fresh unit —
        // otherwise every re-registration leaks one of the ~32 available units.
        let unit = requestedUnit ?? this.units.get(name);
        if (unit === undefined) {
            unit = this.nextUnit++;
        }
        this.units.set(name, unit);
    }

    /**
     * Bind texture to uniform location
     */
    bind(name: string, location: WebGLUniformLocation): void {
        const texture = this.textures.get(name);
        const unit = this.units.get(name);

        if (!texture || unit === undefined) {
            return; // Silently skip - texture might be optional
        }

        this.gl.activeTexture(this.gl.TEXTURE0 + unit);
        this.gl.bindTexture(this.gl.TEXTURE_2D, texture);
        this.gl.uniform1i(location, unit);
    }

    /**
     * Check if texture is registered
     */
    has(name: string): boolean {
        return this.textures.has(name);
    }

    /**
     * Print debug information
     */
    debug(): void {
        console.log('=== Texture Registry ===');
        for (const [name, unit] of this.units) {
            const texture = this.textures.get(name);
            console.log(`  ${name} → unit ${unit}`, texture);
        }
        console.log(`Next available unit: ${this.nextUnit}`);
    }

    /**
     * Clean up all textures
     */
    dispose(): void {
        for (const texture of this.textures.values()) {
            this.gl.deleteTexture(texture);
        }
        this.textures.clear();
        this.units.clear();
    }
}
