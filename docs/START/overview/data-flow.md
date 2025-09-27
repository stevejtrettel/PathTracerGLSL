# Data Flow & Dependencies

## Execution Timeline

### Phase 1: Scene Compilation (At scene load)

```
1. User provides scene and light descriptions
2. WorldCompiler processes descriptions:
   - Assigns material IDs sequentially
   - Cross-references:
     * Emissive geometries → added to lighting
     * Visible lights → added to scene
3. SceneCompiler generates Scene module:
   - Geometry SDFs
   - Material properties
   - Intersection functions
4. LightingCompiler generates Lighting module:
   - Light samplers
   - PDF evaluation
   - Environment maps
5. Compiled modules cached for recipe
```

### Phase 2: Recipe Initialization (Once per recipe)

```
1. App creates recipe with module selections:
   - Objects: {ambient: 'euclidean', scene: compiled, lighting: compiled}
   - Optics: {camera, transport, interaction, film, developer}
2. Engine concatenates modules in fixed order:
   - Common types
   - AmbientSpace (hand-written)
   - Scene (compiled)
   - Lighting (compiled)
   - Camera through Developer (hand-written)
3. Engine compiles GLSL program
4. Engine allocates per-recipe resources:
   - Film buffers (radiance, variance)
   - Material property uniforms
   - Light intensity uniforms
```

### Phase 3: Frame Setup (Once per frame)

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

### Phase 4: Pixel Rendering (Per pixel)

```
main() {
    vec2 pixel = gl_FragCoord.xy;
    
    // 1. Camera: pixel → ray
    vec2 xi = next_2d();
    Ray ray = camera_generateRay(pixel, xi);
    
    // 2. Transport: ray → spectrum (drives integration)
    Spectrum radiance = transport_trace(ray);
        └─> For each bounce:
            a. scene_intersect(ray, hit)
                └─> ambient_geodesic() for marching
                └─> Dispatch to geometry SDFs
                └─> Material interface resolution
            
            b. scene_material_properties(hit.material_to, hit.p)
                └─> Returns MaterialProperties (data only!)
            
            c. lighting_sample(hit.p, xi) for NEE
                └─> Importance samples lights
                └─> Returns LightSample
            
            d. interaction_surface_scatter() for next direction
                └─> Queries scene_material_properties()
                └─> Implements importance sampling
            
            e. interaction_surface_shade() for BRDF
                └─> Queries scene_material_properties()
                └─> Evaluates Disney/Lambert/etc.
    
    // 3. Film: spectrum → accumulated radiance
    Radiance accumulated = film_accumulate(radiance, pixel);
    
    // 4. Developer: radiance → RGB
    RGB color = developer_develop(accumulated);
    
    gl_FragColor = vec4(color, 1.0);
}
```

## Module Dependencies

### Concatenation Order (Fixed)

```
1. Common types and utilities
2. AmbientSpace (hand-written)
3. Scene (compiled)
4. Lighting (compiled)
5. Camera (hand-written)
6. Transport (hand-written)
7. Interaction (hand-written)
8. Film (hand-written)
9. Developer (hand-written)
10. Main function
```

### Runtime Call Graph

```
main()
├── camera_generateRay(pixel, xi)
│   └── uses: u_camera_frame, u_camera_position
│
├── transport_trace(ray)
│   ├── scene_intersect(ray, hit)
│   │   ├── ambient_geodesic(origin, dir, t)
│   │   └── Internal dispatch to geometry SDFs
│   │
│   ├── scene_material_properties(mat_id, p)
│   │   └── Returns: MaterialProperties struct
│   │
│   ├── lighting_sample(p, xi)
│   │   └── Samples from all light sources
│   │
│   ├── lighting_pdf(p, wi)
│   │   └── Evaluates PDF for MIS
│   │
│   ├── interaction_surface_scatter(wi, hit, xi, pdf)
│   │   └── Queries scene_material_properties()
│   │
│   └── interaction_surface_shade(wi, wo, hit)
│       └── Queries scene_material_properties()
│
├── film_accumulate(radiance, pixel)
│   └── texture(u_film_radiance_previous, uv)
│
└── developer_develop(accumulated)
```

## Compilation Data Flow

### Cross-Referencing During Compilation

```
Scene Description           Light Description
       ↓                           ↓
    Geometries                  Lights
    Materials                Environment
       ↓                           ↓
       └─────────┬─────────────────┘
                 ↓
           WorldCompiler
                 ↓
    ┌────────────┴────────────┐
    ↓                         ↓
Find emissive            Find visible
  geometries                lights
    ↓                         ↓
Add to lights            Add to scene
    ↓                         ↓
    └─────────┬───────────────┘
              ↓
    ┌─────────┴─────────┐
    ↓                   ↓
SceneCompiler    LightingCompiler
    ↓                   ↓
Scene Module     Lighting Module
```

## Data vs Behavior Separation

### Data Flow (Objects Modules)

```
SCENE MODULE (Compiled):
┌─────────────────────────────────┐
│ - scene_intersect()             │
│ - scene_material_properties()   │
│   Returns: MaterialProperties   │
│   {albedo, roughness, ior,      │
│    emission, ...}               │
└─────────────────────────────────┘
           ↓ Properties
           
LIGHTING MODULE (Compiled):
┌─────────────────────────────────┐
│ - lighting_sample()              │
│ - lighting_pdf()                 │
│   Returns: LightSample          │
│   {point, wi, radiance, pdf}    │
└─────────────────────────────────┘
           ↓ Samples
```

### Behavior Flow (Optics Modules)

```
TRANSPORT (Algorithm):
┌─────────────────────────────────┐
│ - transport_trace()              │
│ - Owns integration strategy      │
│ - Calls Scene for intersection  │
│ - Calls Lighting for samples    │
└─────────────────────────────────┘
           ↓ Orchestrates
           
INTERACTION (Physics):
┌─────────────────────────────────┐
│ - interaction_surface_shade()    │
│ - interaction_surface_scatter()  │
│ - Implements BRDFs               │
│ - Uses Scene's properties        │
└─────────────────────────────────┘
```

## Uniform Management

### Scene Module Uniforms (Generated)

```glsl
// Material properties (packed)
uniform vec4 u_material_albedo_metallic[NUM_MATERIALS];
uniform vec4 u_material_roughness_ior[NUM_MATERIALS];
uniform vec3 u_material_emission[NUM_MATERIALS];

// Geometry transforms (if not baked)
uniform mat4 u_geometry_transforms[NUM_GEOMETRIES];
```

### Lighting Module Uniforms (Generated)

```glsl
// Light intensities (adjustable)
uniform vec3 u_light_intensities[NUM_LIGHTS];

// Environment
uniform sampler2D u_environment_map;
uniform float u_environment_intensity;
```

### Optics Uniforms (Hand-written)

```glsl
// Camera
uniform mat3 u_camera_frame;
uniform vec3 u_camera_position;
uniform float u_camera_aperture;

// Transport
uniform int u_transport_max_bounces;
uniform float u_transport_rr_threshold;

// Film
uniform sampler2D u_film_radiance_previous;
uniform int u_sample_count;
```

## Material Property Flow

```glsl
// Scene provides properties
MaterialProperties scene_material_properties(int id, Point p) {
  MaterialProperties props;
  
  // Unpack from uniforms (optimized layout)
  vec4 am = u_material_albedo_metallic[id];
  props.albedo = am.rgb;
  props.metallic = am.a;
  
  vec4 ri = u_material_roughness_ior[id];
  props.roughness = ri.x;
  props.ior = ri.y;
  
  props.emission = u_material_emission[id];
  
  return props;
}

// Interaction uses properties for physics
Spectrum interaction_surface_shade(Direction wi, Direction wo, Hit hit) {
  // Single query for all properties
  MaterialProperties props = scene_material_properties(hit.material_to, hit.p);
  
  // Implement BRDF
  float alpha = props.roughness * props.roughness;
  // ... Disney/Lambert/etc calculation
}
```

## Light Sampling Flow

```glsl
// Transport requests light sample
LightSample ls = lighting_sample(hit.p, next_2d());

// Cast shadow ray
Ray shadow = Ray(hit.p, ls.wi, EPSILON, ls.distance);
if (!scene_intersect_any(shadow, ls.distance)) {
  // Evaluate BRDF with light
  Spectrum f = interaction_surface_shade(-ray.direction, ls.wi, hit);
  
  // MIS weight
  float brdf_pdf = interaction_surface_pdf(-ray.direction, ls.wi, hit);
  float weight = balance_heuristic(ls.pdf, brdf_pdf);
  
  // Contribution
  L += ls.radiance * f * weight / ls.pdf;
}
```

## Prefixing Convention

| Module | Prefix | Example Functions |
|--------|--------|-------------------|
| **AmbientSpace** | `ambient_` | `ambient_geodesic()`, `ambient_frame()` |
| **Scene** | `scene_` | `scene_intersect()`, `scene_material_properties()` |
| **Lighting** | `lighting_` | `lighting_sample()`, `lighting_pdf()` |
| **Camera** | `camera_` | `camera_generateRay()` |
| **Transport** | `transport_` | `transport_trace()` |
| **Interaction** | `interaction_` | `interaction_surface_shade()` |
| **Film** | `film_` | `film_accumulate()` |
| **Developer** | `developer_` | `developer_develop()` |

## Performance Critical Paths

### Hot Path 1: Ray Marching
```glsl
// Inner loop of scene_intersect (compiled, optimized)
for (int i = 0; i < MAX_STEPS; i++) {
  Point p = ambient_geodesic(ray.origin, ray.direction, t);
  float d = dispatch_sdf(p);  // Unrolled for few geometries
  if (d < EPSILON) { /* hit */ }
  t += d * 0.9;
}
```

### Hot Path 2: Material Properties
```glsl
// Single batched query (cache-friendly)
MaterialProperties props = scene_material_properties(mat_id, p);
// All properties in one struct
```

### Hot Path 3: Light Sampling
```glsl
// Compiled for specific light configuration
LightSample lighting_sample(Point p, vec2 xi) {
  #if NUM_LIGHTS == 1
    return sample_light_0(p, xi);  // Direct call
  #else
    // Power-based selection
  #endif
}
```

## Complete Frame Trace

```
Frame 100, Pixel (400, 300)

1. main() entry
   - gl_FragCoord = (400.5, 300.5)

2. camera_generateRay(pixel, xi)
   - Returns primary ray

3. transport_trace(ray)
   
   a. scene_intersect(ray) → hit
      - Marches using ambient_geodesic()
      - Returns hit with material IDs
   
   b. scene_material_properties(hit.material_to, hit.p)
      - Returns: {albedo=(0.8,0.2,0.2), roughness=0.3, ...}
   
   c. lighting_sample(hit.p, xi)
      - Samples directional light
      - Returns: {wi=(0,-1,-1), radiance=(5,5,5), pdf=1}
   
   d. Shadow test: scene_intersect_any()
   
   e. interaction_surface_shade(wi, ls.wi, hit)
      - Queries material properties
      - Evaluates Lambert BRDF
   
   f. Continue path...

4. film_accumulate(radiance, pixel)
   - Updates accumulation

5. developer_develop(accumulated)
   - Tone maps to RGB

6. Output color
```

## Key Benefits of Architecture

1. **Compilation Pipeline**: Scene-specific optimization at build time
2. **Automatic Cross-referencing**: Emissive geometries and visible lights handled transparently
3. **Clean Separation**: Scene provides data, Interaction provides physics
4. **Efficient Batching**: Single property query per shading point
5. **Optimized Sampling**: Light sampling compiled for specific configuration
6. **Research Flexibility**: Swap Transport/Interaction independently

The data flow is cleaner with compiled Scene and Lighting modules providing optimized, scene-specific code while maintaining complete separation between data (Objects) and behavior (Optics).
