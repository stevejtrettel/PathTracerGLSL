# Resource Management

How the engine manages GPU resources: buffers, textures, and uniforms.

## ResourceManager

The `ResourceManager` handles per-recipe accumulation buffers and shared resources.

### Per-Recipe Resources

Each recipe has isolated resources:

```typescript
recipeResources = {
    'pathtracer': {
        pingFB: WebGLFramebuffer,
        pongFB: WebGLFramebuffer,
        pingTex: WebGLTexture,
        pongTex: WebGLTexture,
        sampleCount: 0
    },
    'albedo': {
        pingFB: WebGLFramebuffer,
        pongFB: WebGLFramebuffer,
        pingTex: WebGLTexture,
        pongTex: WebGLTexture,
        sampleCount: 0
    }
};
```

This enables instant recipe switching without losing accumulated samples.

### Shared Resources

- **RGB framebuffer** - Shared across all recipes (tone-mapped output)
- **Composite program** - Shared across all recipes

---

## Accumulation Buffers

### Format

```typescript
Format: gl.RGBA32F
Internal Format: gl.RGBA
Type: gl.FLOAT
```

**Why RGBA32F?**
- 32-bit floating point per channel
- Unbounded dynamic range (HDR)
- Precise accumulation (no precision loss)
- Supports negative values (importance sampling weights)

### Size

Matches canvas dimensions:
```typescript
width = gl.canvas.width;
height = gl.canvas.height;
```

### Creation

```typescript
createAccumulationBuffer(width: number, height: number) {
    // Create texture
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA32F,        // Internal format
        width,
        height,
        0,
        gl.RGBA,           // Format
        gl.FLOAT,          // Type
        null               // Data (allocated but not initialized)
    );

    // Filtering
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    // Create framebuffer
    const framebuffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(
        gl.FRAMEBUFFER,
        gl.COLOR_ATTACHMENT0,
        gl.TEXTURE_2D,
        texture,
        0
    );

    // Validate
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
        throw new Error('Framebuffer incomplete');
    }

    return { framebuffer, texture };
}
```

### Double Buffering

```typescript
class ResourceManager {
    private currentBuffer: 'ping' | 'pong' = 'ping';

    prepareFrame() {
        // Swap buffers
        this.currentBuffer = this.currentBuffer === 'ping' ? 'pong' : 'ping';
    }

    getCurrentFramebuffer(): WebGLFramebuffer {
        const resources = this.recipeResources.get(this.activeRecipeId);
        return this.currentBuffer === 'ping'
            ? resources.pingFB
            : resources.pongFB;
    }

    getPreviousTexture(): WebGLTexture {
        const resources = this.recipeResources.get(this.activeRecipeId);
        // Previous is opposite of current
        return this.currentBuffer === 'ping'
            ? resources.pongTex  // Read from pong
            : resources.pingTex; // Read from ping
    }
}
```

### Clearing

```typescript
clearAccumulationBuffers() {
    const resources = this.recipeResources.get(this.activeRecipeId);

    // Clear ping
    gl.bindFramebuffer(gl.FRAMEBUFFER, resources.pingFB);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    // Clear pong
    gl.bindFramebuffer(gl.FRAMEBUFFER, resources.pongFB);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
}
```

Called when:
- Initializing recipe
- Parameter with `triggersReset` changes
- User manually resets

---

## RGB Framebuffer

### Format

```typescript
Format: gl.RGBA8
Internal Format: gl.RGBA
Type: gl.UNSIGNED_BYTE
```

**Why RGBA8?**
- 8-bit per channel (0-255)
- Matches screen format
- Efficient memory usage
- Standard for LDR images

### Purpose

Holds tone-mapped LDR image from display pass before compositing to screen.

### Shared Resource

Only one RGB framebuffer exists, shared across all recipes:

```typescript
class ResourceManager {
    private rgbFramebuffer: WebGLFramebuffer;
    private rgbTexture: WebGLTexture;

    setupRGBFramebuffer(width: number, height: number) {
        // Create once, reuse for all recipes
        this.rgbFramebuffer = this.createRGBBuffer(width, height);
    }
}
```

---

## Texture Registry

Manages global textures (environment maps, CDFs).

### Structure

```typescript
class TextureRegistry {
    private textures: Map<string, WebGLTexture>;
    private textureUnit: number;

    register(name: string, texture: WebGLTexture) {
        this.textures.set(name, texture);
    }

    bind(name: string, location: WebGLUniformLocation) {
        const texture = this.textures.get(name);
        gl.activeTexture(gl.TEXTURE0 + this.textureUnit);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.uniform1i(location, this.textureUnit);
        this.textureUnit++;
    }
}
```

### Registered Textures

**Environment maps**:
- `env_map` - HDR environment texture (RGB32F)
- `env_cdf_conditional` - Conditional CDF for importance sampling (R32F)
- `env_cdf_marginal` - Marginal CDF for importance sampling (R32F)

These are loaded once and shared across all recipes.

---

## Texture Factory

Creates floating-point data textures.

### R32F Textures

Single-channel float textures for CDFs:

```typescript
createR32F(data: Float32Array, width: number, height: number): WebGLTexture {
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.R32F,           // Single channel, 32-bit float
        width,
        height,
        0,
        gl.RED,            // Format
        gl.FLOAT,          // Type
        data
    );

    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    return texture;
}
```

### RGB32F Textures

Three-channel float textures for HDR images:

```typescript
createRGB32F(data: Float32Array, width: number, height: number): WebGLTexture {
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGB32F,         // Three channels, 32-bit float each
        width,
        height,
        0,
        gl.RGB,            // Format
        gl.FLOAT,          // Type
        data
    );

    // Linear filtering (requires OES_texture_float_linear extension)
    const linearExt = gl.getExtension('OES_texture_float_linear');
    const filter = linearExt ? gl.LINEAR : gl.NEAREST;

    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    return texture;
}
```

---

## Parameter Manager

Manages shader uniform updates.

### Uniform Location Cache

```typescript
class ParameterManager {
    private uniformCache: Map<string, {
        location: WebGLUniformLocation;
        value: any;
    }>;

    cacheUniformLocation(name: string, location: WebGLUniformLocation) {
        this.uniformCache.set(name, { location, value: undefined });
    }
}
```

Locations are cached after program compilation, avoiding repeated `getUniformLocation` calls.

### Uniform Update

```typescript
updateUniforms(changes: ParameterChanges) {
    for (const [path, change] of Object.entries(changes)) {
        // Find bindings that depend on this parameter
        const bindings = this.getBindingsForParameter(path);

        for (const binding of bindings) {
            // Compute new value
            const value = binding.compute(this.parameters);

            // Get cached location
            const cached = this.uniformCache.get(binding.uniform);
            if (!cached) continue;

            // Skip if value unchanged
            if (this.valuesEqual(cached.value, value)) {
                this.stats.skipped++;
                continue;
            }

            // Update uniform
            this.setUniform(cached.location, binding.type, value);
            cached.value = value;
            this.stats.total++;
        }
    }
}
```

### Uniform Types

```typescript
private setUniform(location: WebGLUniformLocation, type: UniformType, value: any) {
    switch (type) {
        case 'float':
            gl.uniform1f(location, value);
            break;
        case 'int':
        case 'bool':
            gl.uniform1i(location, value);
            break;
        case 'vec2':
            gl.uniform2fv(location, value);
            break;
        case 'vec3':
            gl.uniform3fv(location, value);
            break;
        case 'vec4':
            gl.uniform4fv(location, value);
            break;
        case 'mat3':
            gl.uniformMatrix3fv(location, false, value);
            break;
        case 'mat4':
            gl.uniformMatrix4fv(location, false, value);
            break;
        case 'sampler2D':
        case 'samplerCube':
            gl.uniform1i(location, value);  // Texture unit
            break;
    }
}
```

---

## Memory Management

### Resize Handling

When canvas resizes:

```typescript
resize(width: number, height: number) {
    // Resize accumulation buffers (per recipe)
    for (const [recipeId, resources] of this.recipeResources) {
        this.resizeBuffer(resources.pingFB, resources.pingTex, width, height);
        this.resizeBuffer(resources.pongFB, resources.pongTex, width, height);
        resources.sampleCount = 0;  // Reset accumulation
    }

    // Resize RGB buffer (shared)
    this.resizeBuffer(this.rgbFramebuffer, this.rgbTexture, width, height);

    // Update executor viewport
    this.executor.resize(width, height);
}
```

### Disposal

Clean up resources when switching scenes:

```typescript
dispose() {
    // Delete per-recipe resources
    for (const [recipeId, resources] of this.recipeResources) {
        gl.deleteFramebuffer(resources.pingFB);
        gl.deleteFramebuffer(resources.pongFB);
        gl.deleteTexture(resources.pingTex);
        gl.deleteTexture(resources.pongTex);
    }

    // Delete shared resources
    gl.deleteFramebuffer(this.rgbFramebuffer);
    gl.deleteTexture(this.rgbTexture);

    // Clear texture registry
    this.textureRegistry.dispose();

    // Delete programs
    for (const program of this.programs.values()) {
        gl.deleteProgram(program.main);
        gl.deleteProgram(program.display);
    }
    gl.deleteProgram(this.compositeProgram);
}
```

---

## Sample Count Tracking

Each recipe maintains its own sample count:

```typescript
class ResourceManager {
    private recipeResources: Map<string, {
        // ... framebuffers and textures
        sampleCount: number;
    }>;

    getSampleCount(): number {
        return this.recipeResources.get(this.activeRecipeId).sampleCount;
    }

    incrementSampleCount() {
        const resources = this.recipeResources.get(this.activeRecipeId);
        resources.sampleCount++;
    }

    resetSampleCount() {
        const resources = this.recipeResources.get(this.activeRecipeId);
        resources.sampleCount = 0;
    }
}
```

---

## HDR Environment Loading

### Process

```typescript
async loadEnvironmentHDR(path: string) {
    // 1. Fetch
    const response = await fetch(path);
    validateHDRResponse(response, path);

    // 2. Parse
    const buffer = await response.arrayBuffer();
    validateHDRBuffer(buffer, path);
    const hdr = HDRLoader.parse(buffer);

    // 3. Validate
    validateHDRData(hdr.width, hdr.height, hdr.data.length, path);

    // 4. Create texture
    const texture = textureFactory.createRGB32F(hdr.data, hdr.width, hdr.height);
    validateTextureCreation(texture, hdr.width, hdr.height, gl);

    // 5. Register
    this.textureRegistry.register('env_map', texture);

    // 6. Build CDFs
    const cdfs = buildEnvironmentSampler(gl, hdr.data, hdr.width, hdr.height);
    this.textureRegistry.register('env_cdf_cond', cdfs.conditional);
    this.textureRegistry.register('env_cdf_marg', cdfs.marginal);

    // 7. Bind to all recipes
    for (const program of this.programs.values()) {
        this.bindEnvironmentTextures(program.main);
    }
}
```

### CDF Construction

For importance sampling of environment maps:

**Marginal CDF** (per-row probabilities):
- Width: 1
- Height: envHeight
- Format: R32F
- Contains cumulative probabilities for each row

**Conditional CDF** (per-pixel probabilities):
- Width: envWidth
- Height: envHeight
- Format: R32F
- Contains cumulative probabilities within each row

---

## WebGL Extensions

Required extensions:

```typescript
constructor(gl: WebGL2RenderingContext) {
    // Float textures (RGBA32F, RGB32F, R32F)
    if (!gl.getExtension('EXT_color_buffer_float')) {
        throw new Error('Float textures required but not supported');
    }

    // Linear filtering on float textures (optional but recommended)
    gl.getExtension('OES_texture_float_linear');
}
```

---

## Performance Considerations

### Texture Binding

- Cache texture units
- Minimize texture switches
- Reuse textures across frames

### Buffer Allocation

- Allocate once, reuse
- Only recreate on resize
- Use double buffering to avoid stalls

### Uniform Updates

- Cache uniform locations
- Skip unchanged uniforms
- Batch uniform updates

### Framebuffer Operations

- Minimize framebuffer switches
- Clear only when necessary
- Validate completeness once (at creation)

---

## Debugging

### Stats

```typescript
getCacheStats() {
    return {
        total: this.stats.total,
        skipped: this.stats.skipped,
        skipRate: this.stats.skipped / this.stats.total
    };
}
```

### Diagnostics

- Check framebuffer status
- Validate texture parameters
- Monitor WebGL errors
- Track memory usage

---

## Next Steps

- [Rendering Pipeline](rendering-pipeline.md) - How resources are used
- [API Reference](api-reference.md) - Method signatures
- [Core Concepts](core-concepts.md) - Modules and recipes
