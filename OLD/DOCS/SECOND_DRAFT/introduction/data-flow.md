# Data Flow & Dependencies

A precise trace of how data flows through the path tracer from pixel to final color.

## Execution Timeline

### Phase 1: Initialization (Once at startup)

```
1. App creates recipes with module selections
2. Engine compiles each recipe:
   - Loads module descriptors
   - Applies prefixing transformation
   - Injects defines and constants
   - Links modules in dependency order
   - Compiles GLSL program
3. Engine allocates resources:
   - Film buffers (radiance, variance)
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
   - Previous frame's film buffer → u_film_radiance
   - Environment map → u_environment_map
   - Set active framebuffer for output
```

### Phase 3: Pixel Rendering (Per pixel)

```
main() {
    vec2 pixel = gl_FragCoord.xy;
    
    // 1. Camera: pixel → ray
    vec2 xi = next_2d();  // Dims 0-1
    Ray ray = c_generate_ray(pixel, xi);
    
    // 2. Estimator: ray → spectrum
    Spectrum radiance = e_estimate(ray);
        └─> For each bounce:
            a. sc_intersect(ray, hit)
                └─> g_geodesic() for marching
                └─> g_frame() for hit frame
                └─> Material resolution
            b. l_sample_light() for NEE
            c. m_sample() for next direction
            d. m_evaluate() for BSDF
    
    // 3. Film: spectrum → accumulated radiance
    Radiance accumulated = f_accumulate(radiance, pixel);
        └─> texture(u_film_radiance, uv) for history
        └─> Incremental averaging or variance tracking
    
    // 4. Developer: radiance → RGB
    RGB color = d_develop(accumulated);
        └─> Tone mapping
        └─> Gamma correction
    
    gl_FragColor = vec4(color, 1.0);
}
```

### Phase 4: Frame Completion

```
1. Engine swaps film buffers (ping-pong)
2. App increments u_sample_count
3. App checks convergence criteria
4. Display or save output
```

## Module Dependencies

### Compile-Time Dependencies

```
Math (no dependencies)
 │
 ├─> Geometry
 │    │
 │    ├─> Objects
 │    │    │
 │    │    └─> Scene
 │    │         │
 │    └─────────┴─> Materials
 │                   │
 └─> Lights ─────────┘
      │
      └─> Estimator
           │
           └─> Film
                │
                └─> Developer
```

### Runtime Call Graph

```
main()
├── c_generate_ray(pixel, xi)
│   └── uses: u_camera_frame, u_camera_position
│
├── e_estimate(ray)
│   ├── sc_intersect(ray, hit) [multiple times]
│   │   ├── g_geodesic(origin, dir, t)
│   │   ├── eval_object_sdf(obj_id, p)
│   │   │   └── sphere_sdf(p), box_sdf(p), etc.
│   │   ├── get_object_material(obj_id, p)
│   │   │   └── classify_sphere(p), etc.
│   │   └── g_frame(p, normal)
│   │
│   ├── l_sample_light(p, xi)
│   │   └── uses: u_light_position, u_environment_map
│   │
│   ├── m_sample(wi, hit, xi, pdf)
│   │   └── uses: material_params[hit.material_to]
│   │
│   └── m_evaluate(wi, wo, hit)
│       └── uses: material_params[hit.material_to]
│
├── f_accumulate(radiance, pixel)
│   └── texture(u_film_radiance, uv)
│
└── d_develop(accumulated)
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

Each module declares its uniforms with automatic prefixing:

```glsl
// User writes in camera module:
uniform vec3 target;
uniform float aperture;

// Engine generates:
uniform vec3 u_camera_[name]_target;
uniform float u_camera_[name]_aperture;

// Pattern: u_[module_kind]_[module_name]_[param_name]
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
  engine.setUniform('u_film_reset', true);
  engine.setUniform('u_sample_count', 0);
}

// 4. Engine computes derived values
const tan_fov = Math.tan(fov * 0.5 * Math.PI / 180);
engine.setUniform('u_camera_tan_fov', tan_fov);

// 5. Next frame uses updated values
```

## Memory Layout & Access Patterns

### Texture Memory

```glsl
// Film buffers (2D textures, float32)
sampler2D u_film_radiance;    // RGB accumulation
sampler2D u_film_variance;    // RGB M2 for variance
isampler2D u_film_samples;    // Sample count per pixel

// Environment maps
sampler2D u_environment_map;   // HDR radiance
sampler2D u_environment_cdf;   // Importance sampling CDF
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

## Function Prefixing Mechanism

### Transformation Rules

The engine automatically prefixes functions to avoid naming collisions:

```glsl
// Input (user writes):
Spectrum evaluate(Direction wi, Direction wo, Hit hit) {
  return albedo / PI;
}

// Output (engine generates):
Spectrum m_evaluate(Direction wi, Direction wo, Hit hit) {
  return albedo / PI;
}
```

### Prefix Mapping

| Module Kind | Prefix | Example Transform |
|------------|---------|-------------------|
| geometry | `g_` | `geodesic` → `g_geodesic` |
| object | none | `sphere_sdf` → `sphere_sdf` |
| scene | `sc_` | `intersect` → `sc_intersect` |
| material | `m_` | `evaluate` → `m_evaluate` |
| lights | `l_` | `sample_light` → `l_sample_light` |
| camera | `c_` | `generate_ray` → `c_generate_ray` |
| estimator | `e_` | `estimate` → `e_estimate` |
| film | `f_` | `accumulate` → `f_accumulate` |
| developer | `d_` | `develop` → `d_develop` |

### Cross-Module Calls

Modules call prefixed functions from their dependencies:

```glsl
// In estimator module:
Spectrum estimate(Ray ray) {
  Hit hit;
  if (!sc_intersect(ray, hit)) {  // Calls scene's function
    return l_eval_light(ray.origin, ray.direction);  // Calls lights
  }
  
  Direction wo = m_sample(-ray.direction, hit, xi, pdf);  // Calls material
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
// In main(), before generate_ray
g_pixel_id = int(pixel.x) + int(pixel.y) * int(u_resolution.x);
g_sample_id = u_sample_count;
g_dimension_counter = 0;  // Reset for new pixel
```

## Resource Lifetime

### Persistent Resources (Frame to Frame)

- Film accumulation buffers
- Environment map textures
- Material parameter arrays
- Compiled shader programs

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

## Compilation Pipeline

### Module Assembly

```typescript
// 1. Gather modules
const modules = [
  geometryModule,
  ...objectModules,
  sceneModule,
  materialModule,
  lightsModule,
  cameraModule,
  estimatorModule,
  filmModule,
  developerModule
];

// 2. Apply transformations
modules.forEach(module => {
  module.glsl = applyPrefixing(module);
  module.glsl = injectDefines(module);
  module.glsl = resolveRequires(module);
});

// 3. Generate main function
const main = generateMainFunction(modules);

// 4. Concatenate in dependency order
const finalShader = [
  commonDefines,
  ...modules.map(m => m.glsl),
  main
].join('\n');

// 5. Compile
const program = gl.createProgram();
gl.shaderSource(vertexShader, FULLSCREEN_TRIANGLE_VS);
gl.shaderSource(fragmentShader, finalShader);
gl.linkProgram(program);
```

### Shader Cache

```typescript
// Recipes are compiled once at startup
const shaderCache = new Map<RecipeHash, WebGLProgram>();

function getOrCompileShader(recipe: Recipe): WebGLProgram {
  const hash = computeRecipeHash(recipe);
  
  if (!shaderCache.has(hash)) {
    const shader = compileRecipe(recipe);
    shaderCache.set(hash, shader);
  }
  
  return shaderCache.get(hash);
}

// Switching is instant
function switchRecipe(recipeName: string) {
  const program = shaderCache.get(recipes[recipeName]);
  gl.useProgram(program);
}
```

## Performance Critical Paths

### Hot Path 1: Ray Marching

```glsl
// Called 100-300 times per ray
Point p = g_geodesic(ray.origin, ray.direction, t);
float d = eval_object_sdf(0, p);
t += d * 0.9;
```

Optimization: Precomputed ray.direction, conservative factor

### Hot Path 2: BSDF Evaluation

```glsl
// Called 2-10 times per pixel
Spectrum f = m_evaluate(wi, wo, hit);
float cos_theta = g_dot(wo, hit.n, hit.p);
contribution = f * cos_theta / pdf;
```

Optimization: Three-way interface, precomputed hit.frame

### Hot Path 3: Film Accumulation

```glsl
// Called once per pixel
vec2 uv = pixel / u_resolution;
Radiance history = texture(u_film_radiance, uv).rgb;
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
Frame 100, Pixel (400, 300):

1. main() entry
   - gl_FragCoord = (400.5, 300.5)
   - g_dimension_counter = 0

2. c_generate_ray(pixel=(400.5, 300.5), xi=(0.234, 0.567))
   - Uses u_camera_frame, u_camera_position
   - Returns Ray(origin=(0,0,-5), direction=(0.1, -0.05, 0.994))
   - g_dimension_counter = 2

3. e_estimate(ray)
   - sc_intersect(ray) → hit at t=4.95
     - Marched 47 steps
     - Hit object_id=0 (sphere)
     - material_from=MATERIAL_AIR, material_to=0
   
   - l_sample_light(hit.p, xi=(0.123, 0.456))
     - Samples sky at direction=(0.3, 0.8, 0.52)
     - g_dimension_counter = 4
   
   - Shadow ray: blocked
   
   - m_sample(wi, hit, xi=(0.789, 0.012))
     - Samples direction=(0.2, 0.3, 0.93)
     - pdf = 0.296
     - g_dimension_counter = 6
   
   - Continue to bounce 2...
   
   Final: radiance = (0.234, 0.189, 0.156)

4. f_accumulate(radiance, pixel)
   - Previous = (0.232, 0.191, 0.154)
   - n = 100
   - Result = (0.23202, 0.19098, 0.15402)

5. d_develop(accumulated)
   - Reinhard tone map
   - Gamma correction
   - Result = (0.496, 0.456, 0.437)

6. gl_FragColor = (0.496, 0.456, 0.437, 1.0)
```
