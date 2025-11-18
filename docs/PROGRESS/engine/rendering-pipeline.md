# Rendering Pipeline

Detailed documentation of the multi-pass rendering pipeline.

## Overview

PathTracerGLSL uses a three-pass rendering architecture:

```
Pass 1: Main (Accumulation)      →  RGBA32F framebuffer
Pass 2: Display (Tone Mapping)   →  RGBA8 framebuffer
Pass 3: Composite (Screen Output) →  Canvas
```

This separation enables:
- High dynamic range accumulation (float precision)
- Modular tone mapping (swap developer modules)
- Clean final output

---

## Pass 1: Main (Accumulation)

### Purpose

Render path-traced samples and accumulate them over time.

### Framebuffer Target

**Ping accumulation buffer** (current frame)
- Format: `RGBA32F` (floating-point)
- Size: Canvas dimensions
- Channels:
  - RGB: Radiance (unbounded float values)
  - A: Weight (for importance sampling, usually 1.0)

### Inputs

**Previous accumulation buffer** (pong buffer from last frame)
- Read via `u_accumulator_radiance_previous`
- Contains accumulated radiance from all previous samples

**Engine uniforms**:
```glsl
uniform vec2 u_resolution;      // Canvas size
uniform int u_frameIndex;       // Current frame
uniform int u_sampleCount;      // Samples accumulated so far
uniform float u_time;           // Elapsed time
uniform vec2 u_pixelOffset;     // For tiled rendering
uniform vec2 u_imageSize;       // Full image size (tiling)
```

**Module uniforms**:
- All uniforms from all modules

### Fragment Shader Flow

```glsl
void main() {
    // 1. Get pixel coordinates
    vec2 uv = gl_FragCoord.xy / u_resolution;

    // 2. Generate camera ray
    Ray ray = camera_generateRay(uv);

    // 3. Trace scene and compute radiance
    vec3 radiance = transport_trace(ray);
    // transport_trace internally calls:
    //   - scene_raymarch()
    //   - interaction_surface_shade()
    //   - lighting_sample()
    //   - environment_radiance()

    // 4. Accumulate with previous samples
    vec4 previous = texture(u_accumulator_radiance_previous, uv);
    vec4 accumulated = accumulator_accumulate(radiance, previous, u_sampleCount);

    // 5. Output to accumulation buffer
    gl_FragColor = accumulated;
}
```

### Accumulation Strategy

**Average Accumulator** (most common):
```glsl
vec4 accumulator_accumulate(vec3 radiance, vec4 previous, int sampleCount) {
    // Running average: avg_n = (avg_{n-1} * (n-1) + sample_n) / n
    vec3 previousAvg = previous.rgb;
    float n = float(sampleCount + 1);
    vec3 newAvg = (previousAvg * float(sampleCount) + radiance) / n;
    return vec4(newAvg, 1.0);
}
```

**Oneshot Accumulator** (no accumulation):
```glsl
vec4 accumulator_accumulate(vec3 radiance, vec4 previous, int sampleCount) {
    return vec4(radiance, 1.0);  // Just return current sample
}
```

### Double Buffering

```
Frame N:
  Read:  pongFB (contains samples 1..N-1)
  Write: pingFB (contains samples 1..N)
  After frame: swap(ping, pong)

Frame N+1:
  Read:  pingFB (contains samples 1..N)
  Write: pongFB (contains samples 1..N+1)
  After frame: swap(ping, pong)
```

This prevents read/write conflicts and enables progressive rendering.

### Performance

- Fullscreen quad (2 triangles, 6 vertices)
- One fragment shader invocation per pixel
- Texture reads: 1 (previous accumulation)
- Texture writes: 1 (current accumulation)

---

## Pass 2: Display (Tone Mapping)

### Purpose

Convert high dynamic range (HDR) radiance to low dynamic range (LDR) RGB for display.

### Framebuffer Target

**RGB buffer** (shared across all recipes)
- Format: `RGBA8` (8-bit per channel)
- Size: Canvas dimensions
- Channels:
  - RGB: Tone-mapped color [0, 1]
  - A: 1.0 (opaque)

### Inputs

**Radiance texture** (current accumulation buffer from Pass 1)
- Read via `u_radiance_texture`
- Contains averaged HDR radiance

**Developer module uniforms**:
- Exposure, white balance, desaturation, etc.

### Fragment Shader Flow

```glsl
uniform sampler2D u_radiance_texture;

// Developer module uniforms
uniform float u_developer_exposureEV;
uniform vec3 u_developer_whiteBalance;
uniform float u_developer_desat;

void main() {
    vec2 uv = gl_FragCoord.xy / u_resolution;

    // 1. Read HDR radiance
    vec3 hdr = texture(u_radiance_texture, uv).rgb;

    // 2. Tone map to LDR
    vec3 ldr = developer_tonemap(hdr);
    // developer_tonemap applies:
    //   - Exposure adjustment
    //   - White balance
    //   - Tone curve (Reinhard, filmic, ACES, etc.)
    //   - Gamma correction
    //   - Desaturation

    // 3. Output to RGB buffer
    gl_FragColor = vec4(ldr, 1.0);
}
```

### Tone Mapping Operators

**Gamma Developer** (simple):
```glsl
vec3 developer_tonemap(vec3 hdr) {
    // Exposure
    vec3 exposed = hdr * pow(2.0, u_developer_exposureEV);

    // Desaturation
    float luma = dot(exposed, vec3(0.299, 0.587, 0.114));
    vec3 desat = mix(exposed, vec3(luma), u_developer_desat);

    // Gamma correction
    vec3 ldr = pow(desat, vec3(1.0 / 2.2));

    return clamp(ldr, 0.0, 1.0);
}
```

**Filmic Developer** (more sophisticated):
```glsl
vec3 developer_tonemap(vec3 hdr) {
    vec3 exposed = hdr * pow(2.0, u_developer_exposureEV);

    // Filmic tone curve (approximates film response)
    vec3 x = max(vec3(0.0), exposed - 0.004);
    vec3 mapped = (x * (6.2 * x + 0.5)) / (x * (6.2 * x + 1.7) + 0.06);

    // Gamma
    return pow(mapped, vec3(1.0 / 2.2));
}
```

### Performance

- Fullscreen quad
- One texture read per pixel
- Lightweight computation (tone curve, gamma)

---

## Pass 3: Composite (Screen Output)

### Purpose

Render the final LDR image to the canvas (screen).

### Framebuffer Target

**Canvas** (`null` framebuffer)
- Format: Device-dependent (usually RGBA8)
- Size: Canvas dimensions

### Inputs

**RGB texture** (from Pass 2)
- Read via `u_rgb_texture`
- Contains tone-mapped LDR image

### Fragment Shader Flow

```glsl
uniform sampler2D u_rgb_texture;

void main() {
    vec2 uv = gl_FragCoord.xy / u_resolution;
    vec3 color = texture(u_rgb_texture, uv).rgb;
    gl_FragColor = vec4(color, 1.0);
}
```

### Optional Post-Effects

This pass can apply additional effects:
- Vignette
- Film grain
- Color grading
- Sharpening
- Anti-aliasing (FXAA)

Currently just a passthrough.

### Performance

- Fullscreen quad
- One texture read per pixel
- Minimal computation

---

## Complete Frame Timeline

```
1. ResourceManager.prepareFrame()
   └─> Swap ping/pong accumulation buffers

2. ParameterManager.updateEngineUniforms()
   └─> Set u_resolution, u_time, u_sampleCount, etc.

3. RenderExecutor.executeMainPass()
   ├─> Bind ping accumulation framebuffer
   ├─> Set viewport
   ├─> Use main program
   ├─> Bind pong accumulation texture (previous)
   ├─> Draw fullscreen quad
   └─> Result: New sample accumulated

4. RenderExecutor.executeDisplayPass(radianceTexture)
   ├─> Bind RGB framebuffer
   ├─> Set viewport
   ├─> Use display program
   ├─> Bind radiance texture (current accumulation)
   ├─> Draw fullscreen quad
   └─> Result: Tone-mapped LDR image

5. RenderExecutor.executeCompositePass()
   ├─> Bind screen framebuffer (null)
   ├─> Set viewport
   ├─> Use composite program
   ├─> Bind RGB texture
   ├─> Draw fullscreen quad
   └─> Result: Image on screen

6. ResourceManager.finalizeFrame()
   └─> Increment sample count

7. RequestAnimationFrame (loop back to 1)
```

---

## Pixel Readback

### HDR Readback

Read floating-point radiance values:

```typescript
const hdrData = engine.readRadiance();
// Returns Float32Array (width * height * 4)
// RGBA channels, unbounded float values
```

**Use cases**:
- Export to EXR format
- Scientific analysis
- Compositing in external tools

### LDR Readback

Read tone-mapped RGB values:

```typescript
const ldrData = engine.readRGB();
// Returns Uint8Array (width * height * 4)
// RGBA channels, [0, 255] range
```

**Use cases**:
- Export to PNG/JPEG
- Screenshots
- Thumbnails

### Partial Readback

Read specific rectangle:

```typescript
const rect = { x: 100, y: 100, width: 200, height: 200 };
const data = engine.readRadiance(rect);
```

Useful for tiled rendering or region-of-interest analysis.

---

## Accumulation Reset

Accumulation resets when:
- Parameters marked with `triggersReset` change
- Camera moves
- User manually calls `engine.clearAccumulation()`

Reset process:
```typescript
clearAccumulation() {
    this.resources.clearAccumulationBuffers();
    this.resources.resetSampleCount();
}
```

Both ping and pong buffers are cleared to black.

---

## Tiled Rendering

For production rendering at high resolutions:

```typescript
// Full image: 4000x4000
// Tile size: 1000x1000

engine.setImageSize(4000, 4000);

for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
        engine.setPixelOffset(x * 1000, y * 1000);
        engine.resize(1000, 1000);

        // Render N samples
        for (let i = 0; i < 100; i++) {
            engine.renderFrame();
        }

        // Read tile
        const tileData = engine.readRadiance();
        saveTile(tileData, x, y);
    }
}
```

The shader uses `u_pixelOffset` and `u_imageSize` to compute correct UVs.

---

## Progressive Rendering

The accumulation system enables progressive rendering:

```
Frame 1:  1 sample  (noisy)
Frame 2:  2 samples (less noisy)
Frame 3:  3 samples (less noisy)
...
Frame 100: 100 samples (smooth)
```

Sample count increases linearly with frames.

### Convergence

Path tracers converge at rate O(1/√N):
- 4 samples: 50% noise
- 16 samples: 25% noise
- 64 samples: 12.5% noise
- 256 samples: 6.25% noise

To halve noise, need 4× samples.

---

## WebGL State Management

The RenderExecutor manages WebGL state transitions:

```typescript
executeMainPass() {
    const accumulatorFB = this.resources.getCurrentFramebuffer();

    gl.bindFramebuffer(gl.FRAMEBUFFER, accumulatorFB);
    gl.viewport(0, 0, width, height);
    gl.useProgram(this.mainProgram);

    // Bind textures
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, previousAccumulatorTexture);
    gl.uniform1i(previousTexLoc, 0);

    // Draw
    gl.drawArrays(gl.TRIANGLES, 0, 3);
}
```

Similar for display and composite passes.

---

## Error Handling

If any pass fails:
- Check framebuffer completeness
- Check shader program validity
- Check texture binding
- Log WebGL errors

All validated during engine initialization.

---

## Next Steps

- [Resource Management](resource-management.md) - Buffer and texture details
- [API Reference](api-reference.md) - Method signatures
- [Core Concepts](core-concepts.md) - Modules and recipes
