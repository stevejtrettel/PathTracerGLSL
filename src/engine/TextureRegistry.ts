// engine/TextureRegistry.ts
export class TextureRegistry {
    private gl: WebGL2RenderingContext;
    private textures = new Map<string, WebGLTexture>();
    private units = new Map<string, number>();
    private nextUnit = 0;

    constructor(gl: WebGL2RenderingContext, reservedUnits: number = 1) {
        this.gl = gl;
        this.nextUnit = reservedUnits; // Skip reserved units (0 for accumulator)
    }

    register(name: string, texture: WebGLTexture, requestedUnit?: number): void {
        // Clean up old texture if replacing
        const oldTexture = this.textures.get(name);
        if (oldTexture) {
            this.gl.deleteTexture(oldTexture);
        }

        // Store texture
        this.textures.set(name, texture);

        // Assign unit (use requested or next available)
        const unit = requestedUnit ?? this.nextUnit++;
        this.units.set(name, unit);
    }

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

    bindAll(program: WebGLProgram): void {
        // Try to bind all registered textures to matching uniforms
        for (const [name, texture] of this.textures) {
            // Convert name to uniform name (environment → u_environment)
            const uniformName = `u_${name}`;
            const location = this.gl.getUniformLocation(program, uniformName);

            if (location) {
                this.bind(name, location);
            }
        }
    }

    has(name: string): boolean {
        return this.textures.has(name);
    }

    debug(): void {
        console.log('=== Texture Registry ===');
        for (const [name, unit] of this.units) {
            const texture = this.textures.get(name);
            console.log(`  ${name} → unit ${unit}`, texture);
        }
        console.log(`Next available unit: ${this.nextUnit}`);
    }

    dispose(): void {
        for (const texture of this.textures.values()) {
            this.gl.deleteTexture(texture);
        }
        this.textures.clear();
        this.units.clear();
    }
}
