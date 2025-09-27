# Photography Integration Contract

## Orchestration Pipeline

```
Pixel → [Camera] → Ray → [Estimator] → Radiance → [Film] → Accumulated → [Developer] → Output
```

## Main Function Generation

Engine generates orchestration:

```glsl
void main() {
  vec2 pixel = gl_FragCoord.xy;
  
  // Camera: generate ray with antialiasing
  vec2 xi = next_2d();  // Automatic dimension tracking
  Ray ray = c_generate_ray(pixel, xi);
  
  // Estimator: compute spectral radiance
  Spectrum radiance = e_estimate(ray);
  
  // Film: accumulate spectrum into radiance buffer
  Radiance accumulated = f_accumulate(radiance, pixel);
  
  // Developer: convert radiance to RGB for display
  RGB color = d_develop(accumulated);
  
  gl_FragColor = vec4(color, 1.0);
}
```

## Module Assembly

```typescript
interface PhotographyDescriptor {
  camera: ModuleDescriptor;
  estimator: ModuleDescriptor;
  film: ModuleDescriptor;
  developer: ModuleDescriptor;
  
  metadata: {
    hasVolumes: boolean;
    maxBounces: number;
    filmResources: ResourceManifest;
  }
}
```

## Function Prefixing

Engine applies prefixes automatically:

```glsl
// User writes:
Ray generate_ray(vec2 pixel, vec2 xi) { ... }

// Engine produces:
Ray c_generate_ray(vec2 pixel, vec2 xi) { ... }
```

| Module | User Function | Engine Function |
|--------|--------------|-----------------|
| Camera | `generate_ray` | `c_generate_ray` |
| Estimator | `estimate` | `e_estimate` |
| Film | `accumulate` | `f_accumulate` |
| Developer | `develop` | `d_develop` |

## Random Dimension Management

Engine provides automatic tracking:

```glsl
// Infrastructure (from math/sampling.glsl)
uniform int u_base_dimension;  // Per-pixel base
int g_dimension_counter;       // Current dimension

float next_1d() {
  return sample_1d(pixel_id, sample_id, g_dimension_counter++);
}

vec2 next_2d() {
  vec2 result = sample_2d(pixel_id, sample_id, g_dimension_counter);
  g_dimension_counter += 2;
  return result;
}

// Reset between pixels
void reset_dimensions() {
  g_dimension_counter = 0;
}
```

Dimension allocation:

| Module | Dimensions Used |
|--------|----------------|
| Camera | 0-3 (AA + DOF) |
| Estimator | 4+ (transport) |
| Film | None |
| Developer | None |

## Precomputed Values

Engine computes once per frame:

```glsl
// Camera matrices
mat3 u_camera_frame = compute_camera_frame(position, target, up);
float u_camera_tan_fov = tan(fov * 0.5 * PI / 180.0);

// Hit frames computed by Scene
Frame hit.frame = g_frame(hit.p, hit.n);

// IOR ratios computed by Scene
float hit.ior_ratio = material_iors[hit.material_from] / 
                     material_iors[hit.material_to];
```

## Batched Operations

Materials provide efficient batched interface:

```glsl
// Instead of three calls:
vec3 f = m_eval(wi, wo, hit);
float cos_theta = dot(wo, hit.n);
float pdf = m_pdf(wi, wo, hit);
vec3 contribution = f * cos_theta / pdf;

// Single batched call:
vec3 contribution = m_interact(wi, hit, xi, wo, pdf);
// Returns f * cos(θ) / pdf directly
```

## Configuration System

### Compile-Time Selection

```typescript
interface RenderConfig {
  camera: {
    type: 'pinhole' | 'thin_lens';
    fov: number;
    aperture?: number;
  };
  
  estimator: {
    type: 'pathtracer' | 'volumetric_pt';
    maxBounces: number;
    volumeStrategy: 'delta_tracking' | 'ray_marching';
    sssModel: 'diffusion' | 'photon_beam';
    neeStrategy: 'mis' | 'light_only' | 'none';
  };
  
  film: {
    type: 'simple' | 'variance' | 'adaptive';
    fireflyRejection?: boolean;
  };
  
  developer: {
    type: 'aces' | 'reinhard' | 'filmic';
    exposure?: number;
  };
}
```

Generates defines:

```glsl
#define CAMERA_TYPE THIN_LENS
#define MAX_BOUNCES 10
#define VOLUME_STRATEGY DELTA_TRACKING
#define NEE_STRATEGY MIS
#define FILM_TYPE VARIANCE
#define TONE_MAPPER ACES
```

## Parameter Flow

```
App.parameterStore
    ↓ (uniform updates)
Camera uniforms: u_camera_*
Estimator uniforms: u_estimator_*
Film uniforms: u_film_*
Developer uniforms: u_developer_*
    ↓ (shader execution)
GPU renders frame
```

## Reset Detection

Engine manages accumulation reset:

```typescript
class RenderCoordinator {
  // Parameters that trigger reset
  resetTriggers = [
    'camera.*',      // Any camera change
    'estimator.*',   // Transport changes
    'material.*',    // Material properties
    'lights.*'       // Lighting changes
  ];
  
  // Parameters that don't reset
  noResetParams = [
    'developer.*',   // Tone mapping
    'film.alpha',    // Blend factor
    'debug.*'        // Debug settings
  ];
  
  onParameterChange(path: string) {
    if (this.shouldReset(path)) {
      engine.setUniform('u_film_reset', true);
      engine.setUniform('u_sample_count', 0);
    }
  }
}
```

## Film Resource Management

```typescript
interface FilmResources {
  radiance: WebGLTexture;    // Current accumulation
  variance?: WebGLTexture;   // Optional variance
  auxiliary?: WebGLTexture;  // Optional aux data
  
  // Double buffering for accumulation
  swap(): void;
}

class ResourceManager {
  setupFilm(film: ModuleDescriptor): FilmResources {
    const manifest = film.resources;
    
    // Allocate textures based on manifest
    const resources = {
      radiance: this.createTexture(manifest.radiance),
      variance: manifest.variance ? 
                this.createTexture(manifest.variance) : null
    };
    
    return resources;
  }
}
```

## Debug Compilation

Different shaders for debug modes:

```typescript
// Normal rendering
if (config.mode === 'render') {
  return compileStandard(modules);
}

// Debug visualization
if (config.mode === 'debug') {
  switch (config.debugType) {
    case 'normals':
      estimator = loadDebugEstimator('normal_viz');
      break;
    case 'materials':
      estimator = loadDebugEstimator('material_viz');
      break;
    case 'transport':
      defines.DEBUG_TRANSPORT = 1;
      break;
  }
}
```

## Optimization Strategies

### Precomputation
- Camera matrices computed once per frame
- Hit frames computed once per intersection
- IOR ratios precomputed during hit creation

### Early Termination
- Russian roulette after few bounces
- Adaptive sampling stops converged pixels
- Shadow rays use simplified traversal

### Memory Coherence
- Batched BSDF operations
- Dimension tracking avoids array lookups
- Prefixed functions for clear dispatch

### Compile-Time Optimization
- Transport strategies selected at compile
- Unused features eliminated
- Debug code compiled out

## Module Dependencies

```
Camera → nothing
    ↓
Estimator → Scene, Materials, Lights, Geometry
    ↓
Film → previous frame buffers
    ↓
Developer → nothing
```

## Validation Requirements

### Energy Conservation
```glsl
// Estimator must maintain:
assert(luminance(throughput) <= 1.0);
assert(all(bsdf_value >= Spectrum(0.0)));
assert(pdf > 0.0 || terminated);
```

### Numerical Stability
```glsl
// Film accumulation:
assert(isfinite(accumulated));
assert(all(accumulated >= Radiance(0.0)));

// Developer output:
assert(all(color >= RGB(0.0) && color <= RGB(1.0)));
```

### Interface Compliance
- Each module implements required functions
- Ray directions normalized
- Random dimensions properly consumed
- Reset flag properly handled

## Performance Metrics

Track per-frame:
- Rays per second
- Average path length
- Transport strategy distribution
- Convergence rate (variance reduction)
- Memory bandwidth usage

## Error Handling

```typescript
interface RenderError {
  module: 'camera' | 'estimator' | 'film' | 'developer';
  type: 'compilation' | 'execution' | 'validation';
  message: string;
  shader?: string;
}

class IntegrationValidator {
  validate(modules: PhotographyDescriptor): ValidationResult {
    const errors: string[] = [];
    
    // Check interfaces
    if (!modules.camera.provides.includes('camera')) {
      errors.push('Camera missing required function');
    }
    
    // Check configuration consistency
    if (modules.estimator.config.volumeStrategy && 
        !modules.metadata.hasVolumes) {
      errors.push('Volume strategy without volume materials');
    }
    
    return { valid: errors.length === 0, errors };
  }
}
```

## Design Principles

1. **Clear orchestration**: Fixed pipeline order
2. **Automatic management**: Dimensions, prefixes, resets
3. **Compile-time configuration**: No runtime strategy branches
4. **Precomputed optimization**: Matrices, frames, ratios
5. **Module independence**: Each module self-contained
6. **Energy conservation**: Validated throughout pipeline
7. **Debug transparency**: Separate debug compilation paths
