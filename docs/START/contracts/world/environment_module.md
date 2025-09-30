# Environment Module Documentation

## Purpose

The Environment module defines the **infinite boundary conditions** of the world - what exists at infinity when rays escape the scene, and potentially the medium through which light travels. It provides the mathematical and visual closure to the rendered world, serving as both a light source and a background.

## Core Philosophy

The environment represents **spatial boundary conditions** rather than objects. While the Scene module defines finite geometries with definite positions and boundaries, the Environment defines what happens at the limits - infinitely far away or permeating all space. This includes:

- **Distant illumination**: Skyboxes, HDRI environment maps, procedural skies
- **Participating media**: Atmospheric scattering, fog, volumetric effects (future)
- **Directional evaluation**: What radiance arrives from any direction at infinity

## Module Interface

### Current Minimal Interface

```glsl
// Core function - evaluates radiance from a direction
vec3 environment_radiance(vec3 direction);
```

### Future Complete Interface

```glsl
// Radiance evaluation
vec3 environment_radiance(vec3 direction);

// Importance sampling (future)
vec3 environment_sample(vec2 xi, out vec3 direction, out float pdf);
float environment_pdf(vec3 direction);

// Participating media (future)
vec3 environment_transmittance(vec3 origin, vec3 direction, float distance);
vec3 environment_inscatter(vec3 origin, vec3 direction, float distance);
```

## Integration Points

### 1. Transport Module
When rays miss all geometry, they sample the environment:
```glsl
if (!scene_intersect(ray, hit)) {
    vec3 env_radiance = environment_radiance(ray.direction);
    radiance += throughput * env_radiance;
    break;
}
```

### 2. Lighting Module
The environment acts as an area light at infinity:
```glsl
// Current: uniform sampling
vec3 dir = sample_uniform_sphere(xi);
vec3 env_radiance = environment_radiance(dir);
ls.wi = dir;
ls.radiance = env_radiance;
ls.pdf = 1.0 / (4.0 * PI);
```

### 3. Future: Participating Media
Rays accumulate extinction and in-scattering:
```glsl
// Future: atmosphere effects
vec3 transmittance = environment_transmittance(ray.origin, ray.direction, hit.t);
throughput *= transmittance;
radiance += environment_inscatter(ray.origin, ray.direction, hit.t);
```

## Implementation Variants

### 1. Constant Environment
Simplest case - uniform color in all directions:
- Single color parameter
- No textures required
- Useful for debugging and indoor scenes

### 2. HDRI Environment
Photographic environment maps:
- Equirectangular projection
- HDR radiance values for realistic lighting
- Rotation parameter for orientation
- Intensity multiplier for exposure control

### 3. Procedural Sky
Analytical models for atmospheric scattering:
- Sun position and intensity
- Atmospheric parameters
- Can provide sharp sun shadows naturally
- Cheaper than texture lookups

### 4. Analytical Lights
Mathematical distant light sources:
- Directional lights (sun)
- Can be sampled exactly
- Perfect for architectural visualization

## Sampling Strategies

### Phase 1: Uniform Sampling (Current)
- Sample sphere uniformly
- Simple but noisy
- Works with any environment type

### Phase 2: Importance Sampling (Next)
Environment module provides its own sampling:
- HDRI: Pre-computed CDFs from luminance
- Procedural: Analytical sampling of sun + sky
- Each environment type optimizes its own sampling

### Phase 3: Multiple Importance Sampling
Combine environment and BRDF sampling:
- Balance between bright light sources and surface orientation
- Reduces noise in all conditions
- Requires PDF evaluation for arbitrary directions

## Technical Architecture

### Module Order
Environment comes after Scene but before Lighting, allowing:
- Lighting to sample the environment
- Scene to remain independent
- Future atmosphere effects to know scene bounds

### Texture Management
For HDRI environments:
- Textures loaded via ResourceManager
- Automatic texture unit assignment
- Shared between all uses (miss rays, light sampling)

### Coordinate Systems
- Direction vectors in world space
- Equirectangular mapping: (θ, φ) → (u, v)
- Consistent orientation (Y-up)

## Future Extensions

### Participating Media
The environment module could handle atmospheric effects:
```glsl
struct MediumProperties {
    vec3 sigma_s;  // Scattering coefficient
    vec3 sigma_a;  // Absorption coefficient  
    float g;       // Phase function asymmetry
};

MediumProperties environment_medium(vec3 position);
```

### Time-of-Day Systems
For animated environments:
- Sun position from time
- Sky color from atmospheric model
- Coordinated with lighting changes

### Portals and Windows
For interior scenes with exterior views:
- Importance sampling through portals
- Efficient sky visibility computation

## Design Rationale

### Why Separate from Lighting?
While environments provide illumination, they're fundamentally different from local light sources:
- Exist at infinity vs finite position
- No shadow rays (infinite distance)
- Different sampling strategies
- Can include participating media

### Why Part of World/Objects?
The environment is "what exists" rather than "how we observe":
- Defines actual radiance at infinity
- Independent of camera or transport
- Like Scene, but unbounded
- Natural home for atmospheric media

### Sampling Ownership
Each environment type should own its sampling strategy because:
- HDRI needs texture-based CDFs
- Procedural can sample sun analytically
- Constant needs no importance sampling
- Keeps complexity contained within each implementation

## Performance Considerations

### Current (Simple)
- Single texture lookup per miss ray
- Uniform sampling has poor convergence
- No preprocessing required

### Future (Optimized)
- Importance mapping: 2-4x convergence improvement
- MIP-mapped sampling: Better for glossy reflections
- Analytical sun sampling: Crisp shadows
- Atmospheric LUTs: Real-time media evaluation

## Summary

The Environment module provides the spatial boundary conditions for the world - what exists at infinity and in the space between objects. Starting with simple radiance evaluation for miss rays and uniform sampling for lighting, it will grow to support importance sampling, participating media, and analytical sky models. By separating environment from both Scene (finite objects) and Lighting (local sources), the architecture maintains clean boundaries while enabling sophisticated global illumination effects.





# HDR Environment Module Documentation

## Overview

The HDR environment module provides image-based lighting (IBL) for the path tracer using high dynamic range environment maps in Radiance (.hdr) format. It replaces constant background colors with photographic or rendered 360° environments that provide realistic lighting and reflections.

## Architecture

### Module Structure

```
world/
├── environment/
│   ├── const-environment.ts     # Constant color fallback
│   └── hdri-environment.ts      # HDR texture-based environment
engine/
├── loaders/
│   └── hdr-loader.ts            # Radiance HDR parser
└── ResourceManager.ts           # GPU texture management
```

### Data Flow

1. **HDR Loading**: `Engine.loadEnvironmentHDR()` → `ResourceManager.loadHDRTexture()` → `HDRLoader.parse()`
2. **GPU Upload**: Parsed float data → RGB32F texture → Bound to texture unit 1
3. **Shader Access**: `environment_radiance()` samples texture via `u_env_map` uniform
4. **Usage**: Transport modules call `environment_radiance()` for miss rays

## Implementation Details

### HDR Loader (`engine/loaders/hdr-loader.ts`)

Parses Radiance HDR format:
- **Header parsing**: Extracts image dimensions from `-Y height +X width` line
- **RLE decompression**: Handles run-length encoded scanlines with separate RGBE channels
- **RGBE to float**: Converts 4-byte RGBE pixels to RGB floats via `rgb * 2^(e-128) / 255`

### Environment Module (`world/environment/hdri-environment.ts`)

GLSL implementation for equirectangular mapping:
```glsl
vec2 direction_to_equirect(vec3 dir) {
    vec3 n = normalize(dir);
    float phi = atan(n.z, n.x) + u_env_rotation;
    float theta = acos(clamp(n.y, -1.0, 1.0));
    return vec2(phi / TWO_PI + 0.5, theta / PI);
}
```

### Resource Management

The `ResourceManager` handles:
- Single environment texture (replaces on reload)
- Fixed texture unit assignment (unit 1, with unit 0 reserved for accumulator)
- Automatic filter mode selection (LINEAR if supported, NEAREST fallback)

## Key Lessons Learned

### 1. Float Texture Linear Filtering

**Issue**: Black environment despite correct data upload.

**Discovery**: WebGL doesn't guarantee linear filtering for float textures without the `OES_texture_float_linear` extension.

**Solution**: Check for extension and fall back to nearest filtering:
```typescript
const linearExt = this.gl.getExtension('OES_texture_float_linear');
const filterMode = linearExt ? this.gl.LINEAR : this.gl.NEAREST;
```

### 2. Texture Binding Persistence

**Issue**: Initial assumption that texture bindings need refresh every frame.

**Discovery**: WebGL texture unit bindings persist until explicitly changed. Nothing else uses unit 1.

**Solution**: Bind once during HDR load, not every frame. Simplified `RenderExecutor`.

### 3. Asset Loading Strategies

**Issue**: Vite's complex asset handling for binary files.

**Discovery**: Multiple approaches exist (imports, public directory, plugins) with different tradeoffs.

**Solution**: Use public directory for simplicity - no build configuration needed, direct URL access.

### 4. Shader Optimization

**Issue**: Unused uniforms get optimized away by GLSL compiler.

**Discovery**: When debugging with hardcoded values instead of texture sampling, `u_env_map` disappears.

**Solution**: Always use the texture in shader code, even for debugging (sample then modify result).

## Configuration

### File Structure
```
public/
└── hdri/
    └── autumn_field_1k.hdr    # 1k or 2k recommended for web
```

### Parameters
- `environment.intensity`: Multiplier for environment contribution (default: 1.0)
- `environment.rotation`: Y-axis rotation in degrees (default: 0.0)

### Usage
```typescript
// In app initialization
await this.engine.loadEnvironmentHDR('/hdri/autumn_field_1k.hdr');

// Adjust brightness/rotation dynamically
this.parameterStore.batch({
    'environment.intensity': 2.0,
    'environment.rotation': 45
});
```

## Best Practices

1. **Resolution**: Use 1k or 2k HDR files for web. 4k+ adds loading time without visible benefit in most cases.

2. **Fallback**: Always provide constant environment module as fallback for failed HDR loads.

3. **Caching**: HDR textures persist on GPU until explicitly replaced - no need to reload for parameter changes.

4. **Sampling**: Currently uses miss rays only. Future: Add importance sampling for next event estimation.

## Future Enhancements

- **Importance sampling**: Pre-compute CDF for sampling bright regions
- **Prefiltered mipmaps**: For different roughness levels in glossy reflections
- **Procedural skies**: Analytical models (Preetham, Hosek-Wilkie) as alternatives
- **Texture compression**: BC6H format support for smaller files

## Technical Constraints

- Requires `EXT_color_buffer_float` for HDR rendering pipeline
- Optional `OES_texture_float_linear` for smooth interpolation
- Maximum texture size limited by `gl.MAX_TEXTURE_SIZE` (typically 4096-16384)
- No built-in tone mapping in module - handled by developer stage
