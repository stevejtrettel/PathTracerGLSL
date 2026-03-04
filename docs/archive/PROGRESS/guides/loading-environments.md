# Loading HDR Environments

Guide to using HDR environment maps for realistic lighting.

## Overview

**HDR environment maps** provide realistic lighting from real-world or synthetic environments. PathTracerGLSL supports:
- **Radiance HDR (.hdr)** format
- **Equirectangular projection** (2:1 aspect ratio)
- **Importance sampling** for efficient rendering
- **Runtime loading** with validation

---

## Quick Start

### 1. Prepare HDR File

Place your `.hdr` file in a public directory:

```
public/
  hdri/
    studio.hdr
    outdoor.hdr
    sunset.hdr
```

### 2. Use HDRI Environment Module

```typescript
import { hdriEnvironmentImportance } from './world/environment/hdri-environment-importance';

const recipe: Recipe = {
    id: 'hdri-scene',
    name: 'HDRI Scene',

    world: {
        ambient: euclideanAmbient,
        environment: hdriEnvironmentImportance,  // Use HDRI
        scene: raymarchScene,
        lighting: noLight  // Environment provides lighting
    },

    optics: {
        camera: pinholeCamera,
        interaction: lambertInteraction,
        transport: pathTracerDirect,
        accumulator: averageAccumulator,
        developer: gammaDeveloper
    },

    parameters: {
        'hdri.path': './hdri/studio.hdr',  // Path to HDR file
        'hdri.intensity': 1.0,              // Brightness multiplier
        'hdri.rotation': 0                  // Rotation in degrees
    }
};
```

### 3. Load at Runtime

```typescript
const app = new App(canvas);
await app.initialize([recipe]);

// Environment loads automatically from parameters
app.start();
```

---

## Loading HDR Files

### Via Parameters

Set the path in recipe parameters:

```typescript
parameters: {
    'hdri.path': './hdri/studio.hdr'
}
```

### Via API

Load environments dynamically:

```typescript
// Load HDR environment
await app.loadEnvironmentHDR('./hdri/outdoor.hdr');

// Change environment at runtime
await app.loadEnvironmentHDR('./hdri/sunset.hdr');
```

### From URL

Load from external sources:

```typescript
await app.loadEnvironmentHDR('https://example.com/hdri/studio.hdr');
```

---

## HDR File Format

### Radiance HDR (.hdr)

PathTracerGLSL uses the **Radiance RGBE** format:

**Characteristics**:
- **Format**: RGBE (Red, Green, Blue, Exponent)
- **Range**: High dynamic range (0 to infinity)
- **Compression**: RLE-encoded scanlines
- **Projection**: Equirectangular (latitude-longitude)
- **Aspect Ratio**: Typically 2:1 (360° × 180°)

**Common Resolutions**:
- `2048 × 1024` - Good quality, moderate size
- `4096 × 2048` - High quality
- `8192 × 4096` - Very high quality (large file)
- `1024 × 512` - Low quality, fast loading

---

## Validation Pipeline

HDR files are validated through multiple stages:

### Stage 1: HTTP Response

```typescript
const response = await fetch(path);
// Validates:
// - 200 OK status
// - File exists (not 404)
// - Permissions (not 403)
```

**Errors**:
```
❌ HDR loading failed:
  • HDR file not found: /hdri/missing.hdr

❌ HDR loading failed:
  • Permission denied loading HDR file: /hdri/private.hdr
```

### Stage 2: Buffer Validation

```typescript
const buffer = await response.arrayBuffer();
// Validates:
// - Buffer not empty
// - Size within limits (default: 100MB)
// - Radiance header present
```

**Errors**:
```
❌ Invalid HDR file:
  • HDR file is empty: /hdri/empty.hdr

❌ Invalid HDR file:
  • HDR file too large: 150.3MB exceeds limit of 100MB
```

**Warnings**:
```
⚠️  HDR file warnings:
  • HDR file '/hdri/custom.hdr' does not have standard Radiance header.
    This may cause parsing errors.
```

### Stage 3: Data Validation

```typescript
const hdr = HDRLoader.parse(buffer);
// Validates:
// - Valid dimensions (16-8192 default range)
// - Data length matches dimensions
// - Aspect ratio reasonable
```

**Errors**:
```
❌ Invalid HDR data:
  • HDR dimensions too small: 8x8 (minimum: 16x16)

❌ Invalid HDR data:
  • HDR data size mismatch: expected 12288000 floats, got 12000000
```

**Warnings**:
```
⚠️  HDR data warnings:
  • HDR dimensions 1024x512 are not power-of-two.
    This may cause performance issues on some GPUs.

⚠️  HDR data warnings:
  • Unusual HDR aspect ratio: 3.5:1.
    Environment maps are typically 2:1 (equirectangular).
```

### Stage 4: Texture Creation

```typescript
const texture = textureFactory.createRGB32F(hdr.data, hdr.width, hdr.height);
// Validates:
// - Texture created successfully
// - No WebGL errors
// - Within GPU texture size limits
```

**Errors**:
```
❌ Texture creation failed:
  • Failed to create WebGL texture

❌ Texture creation failed:
  • Texture size 16384x16384 exceeds GPU limit 8192x8192
```

---

## Environment Parameters

### Intensity

Control environment brightness:

```typescript
parameters: {
    'hdri.intensity': {
        type: 'float',
        default: 1.0,
        min: 0.0,
        max: 10.0,
        step: 0.1,
        label: 'Environment Intensity'
    }
}
```

**Usage**:
```typescript
// Subtle environment
app.setParameter('hdri.intensity', 0.5);

// Bright environment
app.setParameter('hdri.intensity', 2.0);
```

### Rotation

Rotate environment map:

```typescript
parameters: {
    'hdri.rotation': {
        type: 'float',
        default: 0,
        min: 0,
        max: 360,
        step: 1,
        label: 'Environment Rotation'
    }
}
```

**Usage**:
```typescript
// Rotate 90 degrees
app.setParameter('hdri.rotation', 90);
```

### Color Tint

Tint environment color:

```typescript
parameters: {
    'hdri.tint': {
        type: 'color',
        default: [1, 1, 1],  // White (no tint)
        label: 'Environment Tint'
    }
}
```

**Usage**:
```typescript
// Warm tint
app.setParameter('hdri.tint', [1.0, 0.95, 0.9]);

// Cool tint
app.setParameter('hdri.tint', [0.9, 0.95, 1.0]);
```

---

## Importance Sampling

Importance sampling improves rendering efficiency by sampling brighter areas more frequently.

### How It Works

```
HDR Texture
  ↓
Compute Luminance
  ↓
Build CDF (Cumulative Distribution Function)
  ↓
Sample according to brightness
```

**Benefits**:
- Faster convergence
- Less noise in final render
- Better use of samples

### Implementation

The `hdri-environment-importance` module:

1. **Builds marginal CDF** - Per-row brightness distribution
2. **Builds conditional CDF** - Per-pixel within each row
3. **Samples proportional to luminance** - Bright areas sampled more

**Textures Created**:
- `env_map` - Original HDR texture (RGB32F)
- `env_cdf_marginal` - Marginal CDF (R32F, height × 1)
- `env_cdf_conditional` - Conditional CDF (R32F, width × height)

---

## Performance Considerations

### File Size

HDR files can be large:

| Resolution    | Typical Size | Load Time |
|---------------|--------------|-----------|
| 1024 × 512    | 2-5 MB       | ~100ms    |
| 2048 × 1024   | 8-15 MB      | ~200ms    |
| 4096 × 2048   | 30-50 MB     | ~500ms    |
| 8192 × 4096   | 100-200 MB   | ~2s       |

**Recommendations**:
- Use 2048×1024 for most scenes
- Use 4096×2048 for production
- Avoid >8192 unless necessary

### GPU Memory

HDR textures use significant GPU memory:

| Resolution    | GPU Memory (RGB32F) |
|---------------|---------------------|
| 1024 × 512    | 6 MB                |
| 2048 × 1024   | 24 MB               |
| 4096 × 2048   | 96 MB               |
| 8192 × 4096   | 384 MB              |

**Plus CDFs** (for importance sampling):
- Marginal CDF: `height × 4 bytes`
- Conditional CDF: `width × height × 4 bytes`

### Validation Config

Customize validation limits:

```typescript
// In Engine initialization
const config: HDRValidationConfig = {
    minWidth: 32,
    minHeight: 32,
    maxWidth: 4096,      // Limit to 4K
    maxHeight: 4096,
    maxFileSizeMB: 50    // 50MB limit
};
```

---

## Common Issues

### 404 Not Found

**Cause**: Incorrect file path

**Fix**:
```typescript
// ❌ Wrong: Absolute path
'hdri.path': '/hdri/studio.hdr'

// ✅ Correct: Relative path
'hdri.path': './hdri/studio.hdr'
```

### Black Rendering

**Cause**: Environment intensity too low or file failed to load

**Fix**:
```typescript
// Check console for load errors
// Increase intensity
app.setParameter('hdri.intensity', 2.0);
```

### Out of Memory

**Cause**: HDR file too large for GPU

**Fix**:
- Use smaller resolution HDR
- Check GPU limits: `gl.getParameter(gl.MAX_TEXTURE_SIZE)`
- Reduce to 2048×1024 or lower

### Slow Loading

**Cause**: Large file size

**Fix**:
- Use smaller HDR files
- Show loading indicator
- Preload environments

### Non-Power-of-Two Warning

**Cause**: Dimensions not powers of 2

**Impact**: May affect performance on older GPUs

**Fix** (optional):
- Resize to POT (e.g., 2048×1024)
- Or ignore (fine on modern GPUs)

---

## Advanced Usage

### Preloading Environments

Load multiple environments upfront:

```typescript
const environments = [
    './hdri/studio.hdr',
    './hdri/outdoor.hdr',
    './hdri/sunset.hdr'
];

// Preload all
for (const path of environments) {
    await app.loadEnvironmentHDR(path);
}

// Switch instantly (already loaded)
app.setParameter('hdri.path', './hdri/outdoor.hdr');
```

### Loading Progress

Show progress during load:

```typescript
app.on('hdri:load-start', ({ path }) => {
    showLoadingIndicator(`Loading ${path}...`);
});

app.on('hdri:load-progress', ({ loaded, total }) => {
    updateProgress(loaded / total);
});

app.on('hdri:load-complete', ({ path }) => {
    hideLoadingIndicator();
    console.log(`Loaded ${path}`);
});
```

### Fallback Environments

Handle load failures gracefully:

```typescript
async function loadWithFallback(primary: string, fallback: string) {
    try {
        await app.loadEnvironmentHDR(primary);
    } catch (error) {
        console.warn(`Failed to load ${primary}, using fallback`);
        await app.loadEnvironmentHDR(fallback);
    }
}

await loadWithFallback(
    './hdri/high-quality.hdr',
    './hdri/simple.hdr'
);
```

### Dynamic Environment Switching

Switch environments based on scene:

```typescript
const environmentMap = {
    'studio': './hdri/studio.hdr',
    'outdoor': './hdri/outdoor.hdr',
    'night': './hdri/night.hdr'
};

async function setSceneEnvironment(scene: string) {
    const path = environmentMap[scene];
    if (path) {
        await app.loadEnvironmentHDR(path);
        app.setParameter('hdri.intensity', scene === 'night' ? 0.5 : 1.0);
    }
}

await setSceneEnvironment('studio');
```

---

## HDR Sources

### Free HDR Resources

- **Poly Haven** - https://polyhaven.com/hdris (CC0 license)
- **HDRI Haven** - https://hdrihaven.com/ (CC0 license)
- **sIBL Archive** - http://www.hdrlabs.com/sibl/archive.html

### Creating Custom HDRs

Tools for creating HDR environment maps:
- **Blender** - 360° camera rendering
- **Photoshop** - Merge to HDR (from bracketed photos)
- **Hugin** - Panorama stitching with HDR
- **PTGui** - Professional panorama stitching

### Converting to Radiance HDR

```bash
# Using ImageMagick
convert input.exr -format hdr output.hdr

# Using Blender Python
import bpy
img = bpy.data.images.load("input.exr")
img.save_render("output.hdr")
```

---

## Best Practices

1. **Use 2:1 aspect ratio** - Standard equirectangular
2. **Start with 2048×1024** - Good quality/performance balance
3. **Validate before deploy** - Test HDR files load correctly
4. **Provide fallbacks** - Handle load failures gracefully
5. **Show loading indicators** - For large files
6. **Cache loaded environments** - Avoid redundant loads
7. **Match scene to environment** - Indoor HDRs for indoor scenes
8. **Adjust intensity** - Match desired lighting mood
9. **Consider file size** - Optimize for web delivery
10. **Test on target devices** - Verify GPU compatibility

---

## Troubleshooting Checklist

- [ ] File exists at specified path
- [ ] Path is relative (starts with `./` or `../`)
- [ ] File is valid Radiance HDR format
- [ ] File size < 100MB (or custom limit)
- [ ] Dimensions within range (16-8192)
- [ ] Aspect ratio approximately 2:1
- [ ] HDR intensity > 0
- [ ] No console errors during load
- [ ] GPU max texture size sufficient
- [ ] WebGL context not lost

---

## Example: Complete HDR Setup

```typescript
import { hdriEnvironmentImportance } from './world/environment/hdri-environment-importance';

const hdriScene: Recipe = {
    id: 'hdri-demo',
    name: 'HDRI Demonstration',

    world: {
        ambient: euclideanAmbient,
        environment: hdriEnvironmentImportance,
        scene: raymarchScene,
        lighting: noLight  // Environment provides all lighting
    },

    optics: {
        camera: pinholeCamera,
        interaction: lambertInteraction,
        transport: pathTracerDirect,
        accumulator: averageAccumulator,
        developer: gammaDeveloper
    },

    parameters: {
        // Environment settings
        'hdri.path': './hdri/studio.hdr',
        'hdri.intensity': 1.0,
        'hdri.rotation': 0,

        // Camera settings
        'camera.position': [0, 1, 3],
        'camera.target': [0, 0, 0],
        'camera.fov': 60,

        // Tone mapping
        'developer.exposureEV': 0,
        'developer.gamma': 2.2
    },

    config: {
        targetSamples: 100
    }
};

// Initialize
const app = new App(canvas);
await app.initialize([hdriScene]);

// Add loading feedback
app.on('hdri:load-start', () => {
    console.log('Loading HDR environment...');
});

app.on('hdri:load-complete', () => {
    console.log('HDR environment loaded successfully!');
});

// Start rendering
app.start();

// Runtime environment switching
document.getElementById('env-selector').addEventListener('change', async (e) => {
    const path = e.target.value;
    await app.loadEnvironmentHDR(path);
});
```

---

## Next Steps

- [Resource Validation](../errors/resource-errors.md) - HDR validation details
- [Writing Modules](writing-modules.md) - Create custom environment modules
- [Creating Recipes](creating-recipes.md) - Compose with environments
- [Engine Documentation](../engine/README.md) - Resource management internals
