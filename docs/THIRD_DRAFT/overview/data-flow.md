# Data Flow & Dependencies

A precise trace of how data flows through the path tracer from pixel to final color.

## Execution Timeline

### Phase 1: Initialization (Once at startup)

```
1. App creates recipes with module selections
2. Engine compiles each recipe:
   - Loads module descriptors (with manually prefixed functions)
   - Validates manual prefixing
   - Concatenates modules in fixed order
   - Compiles GLSL program
3. Engine allocates per-recipe resources:
   - Film buffers (radiance, variance) for each recipe
   - Light textures (environment maps, CDFs)
   - Uniform buffer objects
4. App binds initial parameters to uniforms
```

### Phase 2: Frame Setup (Once per frame)

```
1. App checks for parameter changes
   - If critical params changed: set u_film_reset = true
   - Update changed uniforms via Engine
   
2. Engine computes frame data:
   - u_camera_frame = build_frame(position, target, up)
   - u_camera_tan_fov = tan(fov * 0.5 * PI/180)
   - u_frame_index++
   - u_time = current_time()
   
3. Engine binds resources:
   - Previous frame's film buffer → u_film_radiance_previous
   - Environment map → u_environment_map
   - Set active framebuffer for output
```

### Phase 3: Pixel Rendering (Per pixel)

```
main() {
    vec2 pixel = gl_FragCoord.xy;
    
    // 1. Camera: pixel → ray (actual module names)
    vec2 xi = next_2d();  // Dims 0-1
    Ray ray = pinhole_generateRay(pixel, xi);  // Module named "pinhole"
    
    // 2. Estimator: ray → spectrum
    Spectrum radiance = pathtracer_estimate(ray);  // Module named "pathtracer"
        └─> For each bounce:
            a. sdf_intersect(ray, hit)  // Module named "sdf"
                └─> euclidean_geodesic() for marching
                └─> euclidean_frame() for hit frame
                └─> Material resolution
            b. hdri_sample_light() for NEE  // Module named "hdri"
            c. disney_sample() for next direction  // Module named "disney"
            d. disney_evaluate() for BSDF
    
    // 3. Film: spectrum → accumulated radiance
    Radiance accumulated = variance_accumulate(radiance, pixel);  // Module named "variance"
        └─> texture(u_film_radiance_previous, uv) for history
        └─> Incremental averaging or variance tracking
    
    // 4. Developer: radiance → RGB
    RGB color = aces_develop(accumulated);  // Module named "aces"
        └─> Tone mapping
        └─> Gamma correction
    
    gl_FragColor = vec4(color, 1.0);
}
```

### Phase 4: Frame Completion

```
1. Engine swaps film buffers (ping-pong) for current recipe
2. App increments u_sample_count
3. App checks convergence criteria
4. Display or save output
```

## Module Dependencies

### Compile-Time Dependencies (Fixed Order)

```
Modules are concatenated in this fixed order:
1. Geometry
2. Material
3. Lights
4. Scene
5. Camera
6. Estimator
7. Film
8. Developer

No dependency resolution needed - order is constant.
```

### Runtime Call Graph (With Manual Prefixes)

```
main()
├── pinhole_generateRay(pixel, xi)
│   └── uses: u_camera_frame, u_camera_position
│
├── pathtracer_estimate(ray)
│   ├── sdf_intersect(ray, hit) [multiple times]
│   │   ├── euclidean_geodesic(origin, dir, t)
│   │   ├── eval_object_sdf(obj_id, p)
│   │   │   └── sphere_sdf(p), box_sdf(p), etc.
│   │   ├── get_object_material(obj_id, p)
│   │   │   └── classify_sphere(p), etc.
│   │   └── euclidean_frame(p, normal)
│   │
│   ├── hdri_sample_light(p, xi)
│   │   └── uses: u_light_position, u_environment_map
│   │
│   ├── disney_sample(wi, hit, xi, pdf)
│   │   └── uses: material_params[hit.material_to]
│   │
│   └── disney_evaluate(wi, wo, hit)
│       └── uses: material_params[hit.material_to]
│
├── variance_accumulate(radiance, pixel)
│   └── texture(u_film_radiance_previous, uv)
│
└── aces_develop(accumulated)
    └── uses: u_developer_exposure, etc.
```

## Uniform Data Flow

### Engine-Provided Uniforms

These are computed and set by the engine before each frame:

```glsl
// Global uniforms (available to all modules)
uniform vec2 u_resolution;          // Screen dimensions
uniform int u_frame_index;          // Frame counter
uniform float u_time;               // Wall clock time
uniform int u_sample_count;         // Samples accumulated
uniform bool u_film_reset;          // Clear accumulation

// Camera uniforms (computed from parameters)
uniform mat3 u_camera_frame;        // [right, up, forward]
uniform vec3 u_camera_position;     // World position
uniform float u_camera_tan_fov;     // tan(fov/2)
```

### Module-Specific Uniforms

Each module declares its uniforms:

```glsl
// Module parameters map directly to uniforms:
// Pattern: u_[module_kind]_[param_name]

uniform vec3 u_camera_target;
uniform float u_camera_aperture;
uniform vec3 u_material_albedo;
uniform float u_material_roughness;
```

### Parameter Update Flow

```typescript
// 1. User changes parameter
app.setParameter('camera.fov', 60);

// 2. ParameterStore validates and notifies
paramStore.set('camera.fov', 60);
  └─> Emits change event

// 3. RenderCoordinator checks impact
if (triggers_reset.includes('camera.fov')) {
  engine.clearAccumulation();  // Clears current recipe's buffers
}

// 4. Engine computes derived values
const tan_fov = Math.tan(fov * 0.5 * Math.PI / 180);
engine.updateUniforms({ 'u_camera_tan_fov': tan_fov });

// 5. Next frame uses updated values
```

## Memory Layout & Access Patterns

### Per-Recipe Film Buffers

```typescript
// Each recipe maintains separate accumulation buffers
ResourceManager {
  filmResourcesMap: Map<recipeId, FilmResources>
    │
    ├─ 'pathtracer' → {
    │     textures: [radiance_current, radiance_previous, variance],
    │     framebuffers: { current, previous }
    │   }
    │
    └─ 'debug' → {
          textures: [color],
          framebuffers: { current }
        }
}
```

### Texture Memory

```glsl
// Film buffers (2D textures, float32) - per recipe
sampler2D u_film_radiance_previous;  // RGB accumulation
sampler2D u_film_variance_previous;  // RGB M2 for variance
isampler2D u_film_samples_previous;  // Sample count per pixel

// Environment maps
sampler2D u_environment_map;         // HDR radiance
sampler2D u_environment_cdf;         // Importance sampling CDF
```

### Uniform Buffer Layout

```glsl
// Materials use array uniforms
struct MaterialParams {
  vec4 albedo_metallic;      // RGB + metallic packed
  vec4 roughness_ior_flags;  // Properties packed
};
uniform MaterialParams u_material_params[NUM_MATERIALS];

// Access pattern (memory coherent)
MaterialParams mp = u_material_params[hit.material_to];
```

### Constants (Compile-Time)

```glsl
// Generated at build time, baked into shader
const int NUM_MATERIALS = 5;
const int NUM_OBJECTS = 3;
const float material_iors[NUM_MATERIALS] = float[](
  1.0,   // Air
  1.5,   // Glass
  1.33,  // Water
  // ...
);
```

## Manual Prefixing Convention

### No Transformation - Direct Usage

Module authors write manually prefixed functions that are used directly:

```glsl
// Module author writes (in material module named "disney"):
Spectrum disney_evaluate(Direction wi, Direction wo, Hit hit) {
  return albedo / PI;
}

// Used directly in other modules - no transformation:
Spectrum f = disney_evaluate(wi, wo, hit);
```

### Prefix Mapping (Manual Convention)

| Module Kind | Example Name | Functions Written By Author |
|------------|--------------|------------------------------|
| geometry | euclidean | `euclidean_geodesic`, `euclidean_dot`, `euclidean_frame` |
| material | disney | `disney_evaluate`, `disney_sample`, `disney_pdf` |
| scene | sdf | `sdf_intersect`, `sdf_classify_point` |
| lights | hdri | `hdri_sample_light`, `hdri_eval_light` |
| camera | pinhole | `pinhole_generateRay` |
| estimator | pathtracer | `pathtracer_estimate` |
| film | variance | `variance_accumulate` |
| developer | aces | `aces_develop` |

### Cross-Module Calls

Modules call manually prefixed functions from other modules:

```glsl
// In pathtracer estimator module:
Spectrum pathtracer_estimate(Ray ray) {
  Hit hit;
  if (!sdf_intersect(ray, hit)) {  // Calls scene module named "sdf"
    return hdri_eval_light(ray.origin, ray.direction);  // Calls lights module named "hdri"
  }
  
  Direction wo = disney_sample(-ray.direction, hit, xi, pdf);  // Calls material module named "disney"
  // ...
}
```

## Random Dimension Management

### Automatic Tracking

```glsl
// Global state (hidden from user)
int g_dimension_counter = 0;
int g_pixel_id;
int g_sample_id;

// User-visible functions
float next_1d() {
  float value = sample_1d(g_pixel_id, g_sample_id, g_dimension_counter);
  g_dimension_counter += 1;
  return value;
}

vec2 next_2d() {
  vec2 value = sample_2d(g_pixel_id, g_sample_id, g_dimension_counter);
  g_dimension_counter += 2;
  return value;
}
```

### Dimension Allocation

| Module | Purpose | Dimensions Used |
|--------|---------|----------------|
| Camera | Antialiasing | 0-1 |
| Camera | Depth of field | 2-3 |
| Estimator | Light selection | 4-5 |
| Estimator | Light sampling | 6-7 |
| Estimator | BSDF sampling (bounce 0) | 8-9 |
| Estimator | Russian roulette (bounce 0) | 10 |
| Estimator | BSDF sampling (bounce 1) | 11-12 |
| ... | ... | ... |

### Reset Between Pixels

```glsl
// In main(), before generateRay
g_pixel_id = int(pixel.x) + int(pixel.y) * int(u_resolution.x);
g_sample_id = u_sample_count;
g_dimension_counter = 0;  // Reset for new pixel
```

## Resource Lifetime

### Persistent Resources (Recipe to Recipe)

- Compiled shader programs for each recipe
- Per-recipe film accumulation buffers
- Environment map textures
- Material parameter arrays

### Per-Frame Resources

- Camera matrices (recomputed if camera moves)
- Random seeds (different per frame)
- Time uniforms

### Per-Pixel State

- Ray origin and direction
- Random dimension counter
- Local RNG state

### Per-Sample Temporaries

- Hit structures
- BSDF samples
- Light samples
- Transport state

## Simplified Compilation Pipeline

### Direct Module Assembly

```typescript
// 1. Gather modules
const modules = {
  geometry: registry.get('geometry', 'euclidean'),
  material: registry.get('material', 'disney'),
  lights: registry.get('lights', 'hdri'),
  scene: registry.get('scene', 'sdf'),
  camera: registry.get('camera', 'pinhole'),
  estimator: registry.get('estimator', 'pathtracer'),
  film: registry.get('film', 'variance'),
  developer: registry.get('developer', 'aces')
};

// 2. Validate manual prefixing
modules.forEach(module => {
  validatePrefixing(module);  // Ensures functions are properly prefixed
});

// 3. Generate main function using actual module names
const main = generateMainFunction(modules);

// 4. Concatenate in fixed order - NO TRANSFORMATION
const finalShader = [
  commonDefines,
  modules.geometry.fragment.functions,
  modules.material.fragment.functions,
  modules.lights.fragment.functions,
  modules.scene.fragment.functions,
  modules.camera.fragment.functions,
  modules.estimator.fragment.functions,
  modules.film.fragment.functions,
  modules.developer.fragment.functions,
  main
].join('\n');

// 5. Compile
const program = gl.createProgram();
gl.shaderSource(vertexShader, FULLSCREEN_TRIANGLE_VS);
gl.shaderSource(fragmentShader, finalShader);
gl.linkProgram(program);
```

### Recipe Switching with Preserved Accumulation

```typescript
// Recipes are compiled once at startup
const programCache = new Map<recipeId, WebGLProgram>();

// Each recipe has its own film buffers
const filmBuffers = new Map<recipeId, FilmResources>();

// Switching preserves accumulation
function switchRecipe(recipeId: string) {
  const program = programCache.get(recipeId);
  gl.useProgram(program);
  
  // Activate this recipe's film buffers (accumulation intact!)
  resourceManager.setActiveRecipe(recipeId);
}
```

## Performance Critical Paths

### Hot Path 1: Ray Marching

```glsl
// Called 100-300 times per ray
Point p = euclidean_geodesic(ray.origin, ray.direction, t);
float d = eval_object_sdf(0, p);
t += d * 0.9;
```

Optimization: Precomputed ray.direction, conservative factor

### Hot Path 2: BSDF Evaluation

```glsl
// Called 2-10 times per pixel (using manual prefixes)
Spectrum f = disney_evaluate(wi, wo, hit);
float cos_theta = euclidean_dot(wo, hit.n, hit.p);
contribution = f * cos_theta / pdf;
```

Optimization: Three-way interface, precomputed hit.frame

### Hot Path 3: Film Accumulation

```glsl
// Called once per pixel
vec2 uv = pixel / u_resolution;
Radiance history = texture(u_film_radiance_previous, uv).rgb;
return mix(history, new_sample, 1.0 / n);
```

Optimization: Incremental mean, single texture fetch

## Debug Data Flow

### Debug Overrides

```glsl
#ifdef DEBUG_NORMALS
  // In estimator, after intersection
  return Spectrum(hit.n * 0.5 + 0.5);
#endif

#ifdef DEBUG_MATERIALS
  return hash_color(hit.material_to);
#endif
```

### Performance Counters

```glsl
// Instrumentation points
uniform int u_debug_ray_count;
uniform int u_debug_bounce_count;
uniform int u_debug_shadow_rays;

// In estimator
atomicAdd(u_debug_ray_count, 1);
```

## Complete Frame Trace Example

```
Frame 100, Pixel (400, 300), Recipe: 'pathtracer'

1. main() entry
   - gl_FragCoord = (400.5, 300.5)
   - g_dimension_counter = 0

2. pinhole_generateRay(pixel=(400.5, 300.5), xi=(0.234, 0.567))
   - Uses u_camera_frame, u_camera_position
   - Returns Ray(origin=(0,0,-5), direction=(0.1, -0.05, 0.994))
   - g_dimension_counter = 2

3. pathtracer_estimate(ray)
   - sdf_intersect(ray) → hit at t=4.95
     - Marched 47 steps using euclidean_geodesic
     - Hit object_id=0 (sphere)
     - material_from=MATERIAL_AIR, material_to=0
   
   - hdri_sample_light(hit.p, xi=(0.123, 0.456))
     - Samples sky at direction=(0.3, 0.8, 0.52)
     - g_dimension_counter = 4
   
   - Shadow ray: blocked
   
   - disney_sample(wi, hit, xi=(0.789, 0.012))
     - Samples direction=(0.2, 0.3, 0.93)
     - pdf = 0.296
     - g_dimension_counter = 6
   
   - Continue to bounce 2...
   
   Final: radiance = (0.234, 0.189, 0.156)

4. variance_accumulate(radiance, pixel)
   - Previous = (0.232, 0.191, 0.154) from recipe's film buffer
   - n = 100
   - Result = (0.23202, 0.19098, 0.15402)

5. aces_develop(accumulated)
   - Reinhard tone map
   - Gamma correction
   - Result = (0.496, 0.456, 0.437)

6. gl_FragColor = (0.496, 0.456, 0.437, 1.0)

Note: If we switch to 'debug' recipe, pathtracer's 100 samples remain preserved
```

## Context Loss Handling

```
WebGL Context Lost:
1. All GPU resources invalidated
2. Per-recipe accumulation buffers lost (cannot be recovered)
3. Engine attempts recovery:
   - Recompiles shaders from cached recipes
   - Recreates film buffers (empty)
   - Resumes from frame 0
```

## Key Simplifications

| Aspect | Old System | New Simplified System |
|--------|------------|------------------------|
| **Function Prefixing** | Automatic transformation | Manual by authors |
| **Compilation** | Complex 8-stage pipeline | Direct concatenation |
| **Module Order** | Dependency resolution | Fixed order |
| **Recipe Keys** | Complex hashing | Simple recipe.id |
| **Film Buffers** | Single global | Per-recipe (preserved) |
| **Function Calls** | Generated prefixes | Actual module names |
