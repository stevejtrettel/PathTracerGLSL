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





# HDRI Importance Sampling — Architecture & Integration

This document explains the system we built to **importance sample** an equirectangular HDR environment map, how it’s wired into the engine, the shader-side API, and the math behind it. It’s designed to be simple, robust, and easy to maintain.

---

## High-level flow

1. **Engine loads HDR** → uploads a single `RGB32F` texture: **`env_map`**.
2. **CPU precompute** builds **binary-search CDFs** from the HDR pixels:

    * **Conditional CDF** per row (size `W×H`, `R32F`)
    * **Marginal CDF** over rows (size `1×H`, `R32F`)
    * **Total weight** scalar and **env size** `(W, H)`
3. Engine registers the two CDF textures, sets the small metadata uniforms.
4. A dedicated **environment module** (GLSL) exposes:

    * `environment_radiance(dir)`
    * `environment_sample(p)` → `LightSample`
    * `environment_pdf(dir)`
5. The **transport** module uses **NEE** (next-event estimation) to sample the sky, and **MIS** (power heuristic) with BSDF sampling when rays escape.

---

## Engine wiring

### 1) Loading & registering textures

* **HDR**: use `TextureFactory.createRGB32F(hdr.data, W, H)` and register as **`env_map`**.
* **CDFs**: call the CPU builder:

```ts
import { buildEnvironmentSampler } from './build-environment-sampler';

const built = buildEnvironmentSampler(
  gl,
  textureRegistry,
  hdr.data, W, H,
  { map: 'env_map', cond: 'env_cdf_cond', marg: 'env_cdf_marg' }
);
```

This:

* uploads **`env_cdf_cond`** (`R32F`, `W×H`, NEAREST)
* uploads **`env_cdf_marg`** (`R32F`, `1×H`, NEAREST)
* returns `totalWeight` and `[W, H]`

### 2) Setting uniforms (two ways)

Pick **one**:

* **Option A (direct set in loader)**
  After linking the program:

  ```ts
  gl.uniform2f(locSize, W, H);                 // u_env_size (vec2)
  gl.uniform1f(locTot, built.totalWeight);     // u_env_totalWeight (float)
  ```

  *Important*: `u_env_size` is **vec2**, so use `uniform2f` (not `uniform2i`).

* **Option B (parameter system)**
  Set params once and let your uniform bindings handle it:

  ```ts
  parameterStore.batch({
    'environment.size':        [W, H],
    'environment.totalWeight': built.totalWeight,
    'environment.cdf.conditional': /* handle for env_cdf_cond */,
    'environment.cdf.marginal':    /* handle for env_cdf_marg */,
  });
  ```

`u_env_map` is already bound by the loader (as before).

---

## CPU precompute (math & data)

For each texel at column `i ∈ [0..W-1]`, row `j ∈ [0..H-1]`:

* Convert HDR RGB to **luminance**:
  [
  Y_{ij} = 0.2126,R + 0.7152,G + 0.0722,B
  ]
* Compute the row’s **polar angle** (center-of-texel):
  [
  \theta_j = \pi \frac{j + 0.5}{H}
  ]
* Form the discrete **importance weight** (radiance × solid-angle density):
  [
  w_{ij} = Y_{ij},\sin\theta_j
  ]
* Per row, build a **conditional CDF** (prefix sums over `i`, normalized to 1).
* Across rows, build a **marginal CDF** over `j` from row sums, normalized to 1.
* Keep the **total weight**:
  [
  W_{\text{tot}} = \sum_{j=0}^{H-1}\sum_{i=0}^{W-1} w_{ij}
  ]

> Note: The CDFs are built from **raw HDR pixels** (no exposure multiplier). The display exposure `u_env_intensity` is applied only when evaluating radiance, not when computing PDFs.

---

## Environment module (GLSL)

### Uniforms (consumed by the module)

* `u_env_map` — `sampler2D` (RGB32F HDR; filtered for evaluation)
* **CDF tables** (NEAREST / `texelFetch`):

    * `u_env_cdf_conditional` — `sampler2D` (R32F, `W×H`)
    * `u_env_cdf_marginal` — `sampler2D` (R32F, `1×H`)
* Metadata:

    * `u_env_size` — `vec2(W, H)` (floats)
    * `u_env_totalWeight` — `float`
* Controls:

    * `u_env_intensity` — `float` (exposure)
    * `u_env_rotation` — `float` (yaw, radians)

### Exports

* `vec3 environment_radiance(vec3 dir)`
  Equirect map with rotation, filtered texture sample, scaled by `u_env_intensity`.

* `LightSample environment_sample(Point p)`

    1. Draw two uniforms `xi = random2()`.
    2. Binary search `xi.x` in **marginal CDF** → row `j`.
    3. Binary search `xi.y` in **conditional CDF** of row `j` → col `i`.
    4. Jitter inside texel → `(u, v)`.
    5. Map to direction `wi`.
    6. Fill:

        * `ls.wi = wi`
        * `ls.position = p + wi * 1e6` (for struct parity)
        * `ls.distance = 1e6`
        * `ls.radiance = texture(u_env_map, uv).rgb * u_env_intensity`
        * `ls.pdf = env_pdf_texel(i, j)`

* `float environment_pdf(vec3 dir)`
  Map `dir → (u, v) → (i, j)` and reuse `env_pdf_texel(i, j)`.

### PDF over solid angle

Each texel approximately covers:
[
\Delta\omega_{ij} \approx \frac{2\pi}{W}\cdot\frac{\pi}{H}\cdot \sin\theta_j
]

The discrete probability of picking texel `(i,j)` is:
[
\Pr[i,j] = \frac{w_{ij}}{W_{\text{tot}}}
]

Thus the **solid-angle PDF**:
[
p_{\text{env}}(\omega \in \text{texel } ij) \approx
\frac{\Pr[i,j]}{\Delta\omega_{ij}} =
\frac{w_{ij}/W_{\text{tot}}}{\Delta\omega_{ij}} =
\frac{Y_{ij},\sin\theta_j}{W_{\text{tot}}}\cdot \frac{1}{\Delta\omega_{ij}}
]

> Implementation detail: In `env_pdf_texel(i,j)` we fetch the **raw HDR** texel (no intensity), compute `Y_ij`, apply the equations above, and guard polar regions with `max(1e-6, sinθ)`.

---

## Transport integration (NEE + MIS)

At each (non-specular) surface hit:

1. **Environment NEE**:

    * Sample sky: `LightSample ls = environment_sample(hit.p);`
    * Shadow test to the env (use `ls.distance`).
    * BSDF eval `f = interaction_surface_shade(ls.wi, -wo, hit)`
      (in our setup **`f` includes `cosθ`**).
    * **MIS** (power heuristic, β=2):

      ```glsl
      float pF = interaction_surface_pdf(-wo, ls.wi, hit);
      float w  = (ls.pdf*ls.pdf) / max(1e-8, (ls.pdf*ls.pdf + pF*pF));
      radiance += throughput * ls.radiance * f * (w / ls.pdf);
      ```

2. **BSDF continuation**:

    * Sample BSDF: `wi, pdf = interaction_surface_scatter(-wo, hit, pdf)`.
    * Update throughput: `throughput *= f / pdf;` (here `f` includes cosine).
    * Trace; if **escape to env**:

      ```glsl
      vec3 Le = environment_radiance(ray.direction);
      float pL = environment_pdf(ray.direction);
      float w  = (pdf*pdf) / max(1e-8, (pdf*pdf + pL*pL));
      radiance += throughput * Le * w;
      break;
      ```

> With MIS off, include **only one** of the two strategies per bounce to avoid double counting. With MIS on, include both with weights as above.

---

## Controls & rebuild policy

* **Exposure** (`u_env_intensity`) and **rotation** (`u_env_rotation`):
  No CDF rebuild needed. The sampler, pdf, and eval all remain consistent.
* **New HDR pixels** (different file or non-uniform edits):
  Rebuild CDFs (call `buildEnvironmentSampler` again).
* **Resolution changes**: handled automatically by the builder; remember to update `u_env_size`.

---

## Performance notes

* **Binary search**: ~`log2(W) + log2(H)` comparisons per sample (e.g., ~20 for 2k×1k). Typically negligible versus tracing/BSDF work.
* **Memory**: 2 float textures (R32F: `W×H` and `1×H`). Small and cache-friendly.
* **Filtering**: CDFs use **NEAREST** with `texelFetch`; env map uses linear filtering for smooth evaluation.

---

## Common pitfalls (and fixes)

* **Uniform type mismatch**: `u_env_size` is **vec2** → set with `uniform2f`, not `uniform2i`. If `(W,H)` end up as `(0,0)`, the sampler degenerates.
* **Double-counting energy**: If MIS is off, don’t add both NEE and BSDF-escape env in the same bounce. With MIS on, add both with weights.
* **Cosine factor**: Our `interaction_surface_shade` **includes `cosθ`**. Do **not** multiply by `cosθ` again in the NEE term.
* **Intensity in PDF**: Compute `pdf` from **raw HDR** luminance (no intensity). Apply `u_env_intensity` only to `environment_radiance`/`ls.radiance`.
* **Poles**: Guard `sinθ` with `max(1e-6, sinθ)`.

---

## Quick verification checklist

* Loader prints: `HDR loaded: W×H (CDFs built)` and `totalWeight > 0`.
* Rendering with a sun HDRI: highlights converge much faster with env NEE enabled.
* Switching tonemapper (gamma → Reinhard) affects *look*, not energy. Reinhard/ACES are recommended with HDR skies.

---

That’s the complete architecture: small, modular, and easy to reason about. It keeps the engine clean (all textures in the registry, CPU-side precompute), gives the shader a tidy API, and integrates with transport through NEE + MIS for stable, fast convergence.
