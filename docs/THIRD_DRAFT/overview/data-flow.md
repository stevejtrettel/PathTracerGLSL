# Data Flow & Dependencies (Revised)

## Execution Timeline

### Phase 1: Initialization (Once at startup)

```
1. App creates recipes with module selections
2. Engine compiles each recipe:
   - Loads module descriptors with manual prefixing
   - Validates prefixing (geometry_*, scene_*, material_*, etc.)
   - Concatenates modules in fixed order
   - Compiles GLSL program
3. Engine allocates per-recipe resources:
   - Film buffers (radiance, variance) for each recipe
   - Light textures (environment maps, CDFs)
   - Material property arrays
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

### Phase 3: Pixel Rendering (Per pixel - Updated Flow)

```
main() {
    vec2 pixel = gl_FragCoord.xy;
    
    // 1. Camera: pixel → ray
    vec2 xi = next_2d();  // Dims 0-1
    Ray ray = camera_generateRay(pixel, xi);
    
    // 2. Transport: ray → spectrum (drives integration)
    Spectrum radiance = transport_trace(ray);
        └─> For each bounce:
            a. scene_intersect(ray, hit)
                └─> geometry_geodesic() for marching
                └─> geometry_frame() for hit frame
                └─> Material ID resolution
            
            b. material_get_properties(hit.material_to, hit.p)
                └─> Returns MaterialProperties struct
            
            c. light_sample() for NEE
            
            d. interaction_surface_scatter() for next direction
                └─> Uses material properties
                └─> Implements importance sampling
            
            e. interaction_surface_shade() for BRDF
                └─> Uses material properties
                └─> Evaluates Disney/Lambert/etc.
    
    // 3. Film: spectrum → accumulated radiance
    Radiance accumulated = film_accumulate(radiance, pixel);
        └─> texture(u_film_radiance_previous, uv) for history
        └─> Incremental averaging or variance tracking
    
    // 4. Developer: radiance → RGB
    RGB color = developer_develop(accumulated);
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

## Module Dependencies (Updated)

### Compile-Time Dependencies (Fixed Order)

```
Modules concatenated in fixed order:
1. Common types and utilities
2. Geometry (defines coordinate system)
3. Scene (includes compiled objects)
4. Materials (property provider)
5. Lights (emission sources)
6. Camera (ray generation)
7. Interaction (light-matter physics)
8. Transport (integration algorithms)
9. Film (accumulation)
10. Developer (tone mapping)

No dependency resolution - order is constant.
```

### Runtime Call Graph (With Correct Prefixes)

```
main()
├── camera_generateRay(pixel, xi)
│   └── uses: u_camera_frame, u_camera_position
│
├── transport_trace(ray)
│   ├── scene_intersect(ray, hit) [multiple times]
│   │   ├── geometry_geodesic(origin, dir, t)
│   │   ├── scene_eval_object_distance(obj_id, p)
│   │   │   └── sphere_sphere_0_distance(p), box_box_1_distance(p)
│   │   ├── scene_get_object_material(obj_id, p)
│   │   │   └── sphere_sphere_0_material(p), box_box_1_material(p)
│   │   └── geometry_frame(p, normal)
│   │
│   ├── material_get_properties(mat_id, p)
│   │   └── Returns: albedo, roughness, ior, etc. (DATA ONLY)
│   │
│   ├── light_sample(p, xi)
│   │   └── uses: u_light_positions, u_environment_map
│   │
│   ├── interaction_surface_scatter(wi, hit, xi, pdf)
│   │   └── Queries material_get_properties()
│   │   └── Implements importance sampling
│   │
│   └── interaction_surface_shade(wi, wo, hit)
│       └── Queries material_get_properties()
│       └── Implements BRDF evaluation
│
├── film_accumulate(radiance, pixel)
│   └── texture(u_film_radiance_previous, uv)
│
└── developer_develop(accumulated)
    └── uses: u_developer_exposure, etc.
```

## Data vs Behavior Flow

### The Critical Separation

```
DATA PROVIDERS (World):
┌─────────────────────────────────┐
│ Materials Module                 │
│ - material_get_properties()      │
│ - Returns: MaterialProperties    │
│   {albedo, roughness, ior, ...}  │
└─────────────────────────────────┘
           ↓ Properties
           
PHYSICS (Photography - Interaction):
┌─────────────────────────────────┐
│ Interaction Module               │
│ - interaction_surface_shade()    │
│ - interaction_surface_scatter()  │
│ - Implements Disney/Lambert/etc  │
│ - Uses properties for physics    │
└─────────────────────────────────┘
           ↓ BRDFs
           
ALGORITHMS (Photography - Transport):
┌─────────────────────────────────┐
│ Transport Module                 │
│ - transport_trace()              │
│ - Owns integration strategy      │
│ - Calls Interaction for physics  │
└─────────────────────────────────┘
```

## Uniform Data Flow (Updated)

### Module-Specific Uniforms with Correct Prefixes

```glsl
// Pattern: u_[module_kind]_[param_name]

// Camera uniforms
uniform mat3 u_camera_frame;
uniform vec3 u_camera_position;
uniform float u_camera_tan_fov;
uniform float u_camera_aperture;

// Material uniforms (property arrays, not BRDFs!)
uniform vec4 u_material_albedo_roughness[NUM_MATERIALS];
uniform vec4 u_material_metallic_ior[NUM_MATERIALS];
uniform int u_material_flags[NUM_MATERIALS];

// Scene uniforms
uniform mat4 u_scene_object_transforms[NUM_OBJECTS];

// Transport uniforms
uniform int u_transport_max_bounces;
uniform float u_transport_rr_threshold;

// Interaction uniforms (if parameterized)
uniform float u_interaction_brdf_mode;
```

### Property Query Flow (New)

```glsl
// Materials provides data
MaterialProperties material_get_properties(int mat_id, vec3 p) {
  MaterialProperties props;
  
  // Unpack from optimized arrays
  vec4 ar = u_material_albedo_roughness[mat_id];
  props.albedo = ar.rgb;
  props.roughness = ar.a;
  
  vec4 mi = u_material_metallic_ior[mat_id];
  props.metallic = mi.x;
  props.ior = mi.y;
  
  props.flags = u_material_flags[mat_id];
  
  return props;
}

// Interaction uses data for physics
Spectrum interaction_surface_shade(vec3 wi, vec3 wo, Hit hit) {
  // Get properties once
  MaterialProperties props = material_get_properties(hit.material_to, hit.p);
  
  // Implement BRDF using properties
  if (props.flags & MATERIAL_FLAG_DIELECTRIC) {
    return compute_glass_brdf(wi, wo, hit, props.ior);
  } else {
    return compute_disney_brdf(wi, wo, hit, props.albedo, 
                              props.roughness, props.metallic);
  }
}
```

## Memory Layout (Updated for Property Architecture)

### Material Property Storage

```glsl
// Packed for GPU efficiency
layout(std140) uniform MaterialData {
  vec4 albedo_roughness[NUM_MATERIALS];    // rgb + roughness
  vec4 metallic_ior_flags[NUM_MATERIALS];  // metallic + ior + 2 flags
  vec4 emission_intensity[NUM_MATERIALS];  // rgb + intensity
  vec4 scatter_absorb[NUM_MATERIALS];      // volume properties
} u_materials;

// NO BRDF function pointers or evaluation code here!
```

### Object Building Blocks in Scene

```glsl
// Objects compiled into Scene's dispatch functions
float scene_eval_object_distance(int obj_id, vec3 p) {
  switch(obj_id) {
    case 0: return sphere_glass_sphere_distance(p);
    case 1: return box_metal_box_distance(p);
    case 2: return torus_plastic_torus_distance(p);
  }
  return MAX_DIST;
}

int scene_get_object_material(int obj_id, vec3 p) {
  switch(obj_id) {
    case 0: return sphere_glass_sphere_material(p);
    case 1: return box_metal_box_material(p);
    case 2: return torus_plastic_torus_material(p);
  }
  return MATERIAL_AIR;
}
```

## The Transport-Interaction-Materials Triangle

### Complete Integration Example

```glsl
// Transport drives the algorithm
Spectrum transport_trace(Ray ray) {
  Hit hit;
  
  // 1. Find intersection (geometry + material IDs)
  if (!scene_intersect(ray, hit)) {
    return light_environment(ray.direction);
  }
  
  // 2. Get material properties (data only)
  MaterialProperties props = material_get_properties(hit.material_to, hit.p);
  
  // 3. Check emission
  Spectrum Le = props.emission * props.emission_intensity;
  
  // 4. Sample next direction (Interaction does physics)
  float pdf;
  vec3 wo = interaction_surface_scatter(-ray.direction, hit, next_2d(), pdf);
  
  // 5. Evaluate BRDF (Interaction does physics)
  Spectrum f = interaction_surface_shade(-ray.direction, wo, hit);
  
  // 6. Continue path (Transport owns recursion strategy)
  if (transport_should_continue(depth, throughput)) {
    Ray next_ray = Ray(hit.p, wo, EPSILON, MAX_DIST);
    Spectrum Li = transport_trace(next_ray);  // Recursive
    return Le + f * Li * abs(dot(wo, hit.n)) / pdf;
  }
  
  return Le;
}
```

### Volume Integration Example

```glsl
// Transport owns integration strategy
Spectrum transport_integrate_volume(Ray ray, Hit entry, int mat_id) {
  // Get volume properties from Materials
  MaterialProperties props = material_get_properties(mat_id, ray.origin);
  
  #if VOLUME_STRATEGY == DELTA_TRACKING
    // Transport: Sample free path
    float sigma_t = length(props.sigma_scatter + props.sigma_absorb);
    float t = -log(next_1d()) / sigma_t;
    
    vec3 p = geometry_geodesic(ray.origin, ray.direction, t);
    
    // Interaction: Compute scattering
    float phase_pdf;
    vec3 wo = interaction_volume_scatter(ray.direction, p, mat_id, next_2d(), phase_pdf);
    Spectrum phase = interaction_volume_shade(ray.direction, wo, p, mat_id);
    
    // Transport: Continue
    return phase * transport_trace(Ray(p, wo, 0, MAX_DIST));
    
  #elif VOLUME_STRATEGY == RAY_MARCHING
    // Different integration strategy, same property/physics separation
  #endif
}
```

## Manual Prefixing Reference

### Module Prefixes (by Kind)

| Module Kind | Prefix | Example Functions |
|-------------|--------|-------------------|
| **Geometry** | `geometry_` | `geometry_geodesic()`, `geometry_frame()` |
| **Scene** | `scene_` | `scene_intersect()`, `scene_get_material()` |
| **Materials** | `material_` | `material_get_properties()` (DATA ONLY!) |
| **Lights** | `light_` | `light_sample()`, `light_evaluate()` |
| **Camera** | `camera_` | `camera_generateRay()` |
| **Transport** | `transport_` | `transport_trace()`, `transport_integrate()` |
| **Interaction** | `interaction_` | `interaction_surface_shade()`, `interaction_surface_scatter()` |
| **Film** | `film_` | `film_accumulate()` |
| **Developer** | `developer_` | `developer_develop()` |

### Object Naming (Type-Based)

Objects use their type and instance name:
- `sphere_glass_sphere_distance()`
- `box_metal_box_material()`
- `torus_plastic_torus_normal()`

## Performance Critical Paths (Updated)

### Hot Path 1: Material Properties

```glsl
// Called 2-10 times per ray - MUST be efficient
MaterialProperties props = material_get_properties(mat_id, p);

// Single query gets everything (cache-friendly)
// Compile-time optimization for constant properties
```

### Hot Path 2: BRDF Evaluation

```glsl
// Interaction module - optimized per model
Spectrum f = interaction_surface_shade(wi, wo, hit);

// No virtual dispatch, compiled for specific BRDF
// Uses cached properties from material_get_properties()
```

### Hot Path 3: Transport Decisions

```glsl
// Transport owns strategy - compiled for specific algorithm
if (transport_should_use_nee(state)) {
  // Next event estimation path
}

// No runtime branching between algorithms
```

## Complete Frame Trace (Updated)

```
Frame 100, Pixel (400, 300), Recipe: 'production'

1. main() entry
   - gl_FragCoord = (400.5, 300.5)

2. camera_generateRay(pixel, xi)
   - Returns Ray

3. transport_trace(ray)
   
   a. scene_intersect(ray) → hit
      - Uses scene_eval_object_distance()
      - Calls sphere_glass_sphere_distance()
      - Returns material IDs: from=AIR, to=GLASS
   
   b. material_get_properties(GLASS, hit.p)
      - Returns: {albedo=(0.95,0.95,0.95), ior=1.5, ...}
   
   c. interaction_surface_scatter(wi, hit, xi)
      - Uses glass properties
      - Samples refraction direction
   
   d. interaction_surface_shade(wi, wo, hit)
      - Implements Fresnel equations
      - Returns transmission coefficient
   
   e. transport continues recursion...

4. film_accumulate(radiance, pixel)
   - Updates accumulation buffer

5. developer_develop(accumulated)
   - Tone maps to display range

6. gl_FragColor = final color
```

## Key Architectural Changes in Data Flow

| Aspect | Old Architecture | New Architecture |
|--------|------------------|------------------|
| **Material Role** | Provided evaluate/sample/pdf | Only provides properties |
| **BRDF Location** | In Materials module | In Interaction module |
| **Integration** | In Estimator | Split: Transport (algorithm) + Interaction (physics) |
| **Property Access** | Multiple queries | Single batched query |
| **Module Count** | 8 in Photography | 5 in Photography |
| **Prefixing** | By module name | By module kind |
| **Objects** | Modules | Building blocks in Scene |

## Benefits of New Data Flow

1. **Clear Separation**: Properties (Materials) vs Physics (Interaction) vs Algorithms (Transport)
2. **Research Flexibility**: Swap interaction models without changing material data
3. **Performance**: Single property query, aggressive compile-time optimization
4. **Debugging**: Can visualize properties directly without BRDF evaluation
5. **Extensibility**: Easy to add new properties or interaction models

The data now flows cleanly from geometric queries (Scene) through property lookup (Materials) to physics evaluation (Interaction), all orchestrated by algorithmic decisions (Transport).
