# Photography Integration Contract

## Orchestration Pipeline

```
Pixel → [Camera] → Ray → [Transport] → Radiance → [Film] → Accumulated → [Developer] → Output
                            ↓
                      [Interaction] 
                            ↓
                   [Material Properties]
```

## Main Function Generation

The main orchestration function connects all five Photography modules:

```glsl
void main() {
  vec2 pixel = gl_FragCoord.xy;
  
  // Camera: generate ray with antialiasing
  vec2 xi = next_2d();
  Ray ray = camera_generateRay(pixel, xi);
  
  // Transport: compute spectral radiance (uses Interaction internally)
  Spectrum radiance = transport_trace(ray);
  
  // Film: accumulate spectrum into radiance buffer
  Radiance accumulated = film_accumulate(radiance, pixel);
  
  // Developer: convert radiance to RGB for display
  RGB color = developer_develop(accumulated);
  
  gl_FragColor = vec4(color, 1.0);
}
```

## Module Assembly

```typescript
interface PhotographyDescriptor {
  camera: ModuleDescriptor;
  transport: ModuleDescriptor;
  interaction: ModuleDescriptor;  // NEW
  film: ModuleDescriptor;
  developer: ModuleDescriptor;
  
  metadata: {
    hasVolumes: boolean;
    maxBounces: number;
    filmResources: ResourceManifest;
  }
}
```

## Manual Function Prefixing

All modules use manual prefixing by module kind:

| Module Kind | Function Examples |
|------------|------------------|
| camera | `camera_generateRay()`, `camera_getPdf()` |
| transport | `transport_trace()`, `transport_direct()` |
| interaction | `interaction_surface_shade()`, `interaction_volume_scatter()` |
| film | `film_accumulate()`, `film_getVariance()` |
| developer | `developer_develop()`, `developer_getExposure()` |

## Random Dimension Management

Automatic dimension tracking provided by math infrastructure:

```glsl
// Global state (hidden from modules)
int g_dimension_counter = 0;

float next_1d() {
  return sample_1d(pixel_id, sample_id, g_dimension_counter++);
}

vec2 next_2d() {
  vec2 result = sample_2d(pixel_id, sample_id, g_dimension_counter);
  g_dimension_counter += 2;
  return result;
}

// Reset for each pixel in main()
void reset_dimensions() {
  g_dimension_counter = 0;
}
```

Dimension allocation across modules:

| Module | Typical Dimensions Used | Purpose |
|--------|-------------------------|---------|
| Camera | 0-3 | Antialiasing, depth of field |
| Transport | 4-7 | First bounce NEE |
| Interaction | 8-9 | First bounce scattering |
| Transport | 10-13 | Second bounce NEE |
| Interaction | 14-15 | Second bounce scattering |
| ... | ... | Continues per bounce |

## Module Dependencies

```
Camera → (no dependencies)
    ↓
Transport → Scene, Lights, Interaction
    ↓
Interaction → Material, Geometry
    ↓
Film → (previous frame buffers)
    ↓
Developer → (no dependencies)
```

### Transport Dependencies

Transport calls these functions from other modules:

```glsl
// From Scene
Hit hit;
bool found = scene_intersect(ray, hit);
bool occluded = scene_intersect_any(shadow_ray);
int material = scene_classify_point(p, obj_id);

// From Interaction (surfaces)
Spectrum f = interaction_surface_shade(wi, wo, hit);
vec3 wo = interaction_surface_scatter(wi, hit, xi, pdf);
float pdf = interaction_surface_pdf(wi, wo, hit);
Spectrum Le = interaction_surface_emit(hit);

// From Interaction (volumes)
Spectrum phase = interaction_volume_shade(wi, wo, p, mat_id, distance);
vec3 wo = interaction_volume_scatter(wi, p, mat_id, xi, pdf);
Spectrum Le = interaction_volume_emit(p, mat_id);

// From Lights
LightSample ls = lights_sample_light(p, xi);
Spectrum env = lights_eval_environment(direction);
float pdf = lights_pdf_light(p, direction);
```

### Interaction Dependencies

Interaction queries material properties:

```glsl
// From Material (batched query)
MaterialProperties mp = material_get_properties(mat_id, p);
// Contains: albedo, roughness, metallic, ior, emission, 
//           sigma_scatter, sigma_absorb, phase_g, etc.

// From Geometry (for frame construction if needed)
vec3 tangent = geometry_tangent(p, normal);
float distance = geometry_distance(p1, p2);
```

## Parameter Flow

```
App.parameterStore
    ↓ (uniform updates)
Camera uniforms: u_camera_*
Transport uniforms: u_transport_*  
Film uniforms: u_film_*
Developer uniforms: u_developer_*
    ↓ (shader execution)
GPU renders frame
```

## Reset Detection

The Engine manages accumulation resets when parameters change:

```typescript
class RenderCoordinator {
  // Parameters that trigger reset
  resetTriggers = [
    'camera.*',           // Any camera change
    'transport.*',        // Algorithm changes
    'interaction.*',      // BRDF changes
    'material.*',         // Material properties
    'lights.*'            // Lighting changes
  ];
  
  // Parameters that don't reset
  noResetParams = [
    'developer.*',        // Tone mapping
    'film.alpha',         // Blend factor
    'debug.*'             // Debug settings
  ];
  
  onParameterChange(path: string) {
    if (this.shouldReset(path)) {
      engine.setUniform('u_film_reset', true);
      engine.setUniform('u_sample_count', 0);
    }
  }
}
```

## Per-Recipe Resource Management

Each recipe maintains separate resources:

```typescript
interface RecipeResources {
  program: WebGLProgram;           // Compiled shader
  filmBuffers: {
    radiance: WebGLTexture;        // Accumulated radiance
    variance?: WebGLTexture;       // Optional variance tracking
    auxiliary?: WebGLTexture;      // Optional auxiliary data
  };
  lightTextures?: {
    environment?: WebGLTexture;    // HDR environment map
    cdf?: WebGLTexture;           // Importance sampling CDF
  };
}

// Switching recipes preserves accumulation
function switchRecipe(recipeId: string) {
  const resources = recipeResourceMap.get(recipeId);
  gl.useProgram(resources.program);
  bindTextures(resources.filmBuffers);
  // Previous accumulation preserved!
}
```

## Compilation Pipeline

```typescript
// Fixed module concatenation order
const MODULE_ORDER = [
  // World modules
  'geometry',
  'material',      // Properties only
  'lights',
  'scene',
  // Photography modules
  'camera',
  'interaction',   // Light-matter physics
  'transport',     // Integration algorithms
  'film',
  'developer'
];

function compileRecipe(recipe: Recipe): WebGLProgram {
  // Gather modules
  const modules = MODULE_ORDER.map(kind => 
    registry.get(kind, recipe[kind])
  );
  
  // Generate main function
  const main = generateMainFunction(recipe);
  
  // Direct concatenation - no transformation!
  const shaderCode = [
    commonDefines,
    ...modules.map(m => m.fragment.functions),
    main
  ].join('\n');
  
  return compileShader(shaderCode);
}
```

## Transport-Interaction Coordination

The key architectural pattern - Transport delegates physics to Interaction:

```glsl
// TRANSPORT: Algorithmic decisions
Spectrum transport_trace(Ray ray) {
  Hit hit;
  if (!scene_intersect(ray, hit)) {
    return lights_eval_environment(ray.direction);
  }
  
  // INTERACTION: Physics computation
  vec3 wo = interaction_surface_scatter(-ray.direction, hit, next_2d(), pdf);
  Spectrum f = interaction_surface_shade(-ray.direction, wo, hit);
  
  // TRANSPORT: Integration logic
  throughput *= f * abs(dot(wo, hit.n)) / pdf;
  
  // TRANSPORT: Termination decision
  if (bounce > 3 && next_1d() > survival_probability) {
    break;
  }
}
```

## Debug Compilation Modes

Different module combinations for debugging:

```typescript
const debugRecipes = {
  normals: {
    camera: 'pinhole',
    transport: 'simple',
    interaction: 'debug_normal',  // Just returns normal color
    film: 'simple',
    developer: 'reinhard'
  },
  
  albedo: {
    camera: 'pinhole',
    transport: 'simple',
    interaction: 'debug_albedo',  // Just returns albedo
    film: 'simple',
    developer: 'reinhard'
  },
  
  variance: {
    camera: 'pinhole',
    transport: 'pathtracer',
    interaction: 'disney',
    film: 'variance',             // Tracks convergence
    developer: 'false_color'      // Visualizes variance
  }
};
```

## Performance Optimization Points

### Precomputation
- Camera matrices computed once per frame
- Material properties batched per query
- Light CDFs precomputed for environment sampling

### Early Termination
- Russian roulette after few bounces
- Shadow rays use `scene_intersect_any()` for early exit
- Adaptive sampling stops converged pixels

### Memory Patterns
- Single material property query per interaction
- Coherent texture access in film
- Per-recipe buffers avoid reallocation

### Compile-Time Optimization
- Transport strategies selected at compile time
- Interaction models fixed per recipe
- Dead code elimination for unused features

## Validation Requirements

### Module Interfaces
- Each module implements required functions with correct prefixes
- Functions return valid values (no NaN/Inf)
- Directions are normalized

### Energy Conservation
```glsl
// In interaction
assert(albedo <= 1.0);
assert(pdf >= 0.0);
assert(isfinite(shade_result));

// In transport
assert(luminance(throughput) <= 1.0);
```

### Numerical Stability
```glsl
// In film
assert(all(accumulated >= 0.0));
assert(isfinite(accumulated));

// In developer
assert(all(color >= 0.0 && color <= 1.0));
```

## Performance Metrics

Track per frame:
- Rays per second
- Average path length
- Samples per pixel accumulated
- Convergence rate (variance reduction)
- Module timing breakdown

## Module Composition Examples

### Simple Preview
```
pinhole + simple + lambert + simple + reinhard
= Fast diffuse preview
```

### Production Quality
```
thin_lens + pathtracer + disney + variance + aces
= Full featured rendering
```

### Volume Rendering
```
pinhole + volumetric + henyey_greenstein + simple + reinhard
= Cloud/smoke visualization
```

### Technical Drawing
```
orthographic + simple + debug_albedo + simple + gamma_only
= Flat shaded technical illustration
```

## Design Principles Summary

1. **Clear separation**: Transport (algorithms) vs Interaction (physics)
2. **Manual prefixing**: Explicit, debuggable function names
3. **Fixed order**: No dependency resolution needed
4. **Per-recipe state**: Instant switching with preserved accumulation
5. **Compile-time optimization**: No runtime strategy branches
6. **Modular composition**: Mix and match for any use case
