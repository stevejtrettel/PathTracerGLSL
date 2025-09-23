# Core Principles & Shared Concepts (Revised)

## Architectural Principles

### 1. Separation of Concerns
Each pillar has exclusive responsibilities:
- **World**: Defines *what exists* - data only (no physics, no behavior)
- **Photography**: Defines *how we observe* - all physics and algorithms
- **Engine**: Provides *infrastructure* (no research logic)
- **App**: Orchestrates *experiments* (no GPU calls)
- **Math**: Provides *utilities* (no state or contracts)

### 2. Determinism & Reproducibility
Given fixed inputs (recipe, seed, environment), output is identical:
- Random sampling explicitly seeded and dimensioned
- All floating point operations IEEE-compliant
- Parameter changes tracked and logged
- No undefined behavior or race conditions

### 3. Ownership Rules (Updated)
Clear ownership prevents architectural confusion:
- **Transport owns integration**: Path tracing, delta tracking strategies
- **Interaction owns physics**: BRDF evaluation, phase functions, Fresnel
- **Materials owns properties**: Provides data via `material_get_properties()`
- **Objects own shapes**: Geometry + material ID assignment only
- **Scene owns interfaces**: Material boundary resolution, nearby tracking
- **Engine owns GPU state**: All WebGL operations
- **App owns orchestration**: Recipe and parameter management

### 4. The Critical Separation
**Data vs Behavior** is the core architectural principle:
- **World = Data**: Shapes, material IDs, properties (albedo, roughness, IOR)
- **Photography = Behavior**: How light interacts with that data
- Materials NEVER implements physics (no evaluate/sample/pdf)
- Interaction NEVER stores properties (queries Materials)

### 5. Error & Fallback Policy
- **Fatal errors**: Shader compilation, out-of-memory → stop
- **Recoverable errors**: Missing parameters → use defaults with warning
- **Research errors**: NaN/Inf samples → clamp to black, count, continue
- **Capability fallbacks**: Missing HDR → suggest LDR alternatives
- **Context loss**: Warn about accumulation loss, attempt recovery

### 6. Performance Philosophy
Optimize at compile-time, not runtime:
- Dead code elimination for unused properties
- Constant folding when all materials share a value
- Strategy selection at compilation (#if DELTA_TRACKING)
- Property batching in single query
- Per-recipe accumulation buffers (no reallocation)

## Module System

### Module Descriptor Structure
```typescript
interface ModuleDescriptor {
  id: {
    kind: string;     // "geometry", "scene", "materials", etc.
    name: string;     // "euclidean", "generated", "optimized", etc.
    version: string;  // "1.0.0"
  };
  
  fragment: {
    uniforms?: string;    // Parameter declarations
    functions: string;    // GLSL implementation with manual prefixes
    constants?: string;   // #define statements
  };
  
  metadata?: {
    // Module-specific metadata
  };
}
```

### Manual Prefixing Convention (Updated)

All modules use explicit prefixes based on their **kind**, not their name:

| Module Kind | Prefix | Example Functions |
|------------|---------|-------------------|
| Geometry | `geometry_` | `geometry_geodesic()`, `geometry_frame()` |
| Scene | `scene_` | `scene_intersect()`, `scene_get_material()` |
| Materials | `material_` | `material_get_properties()`, `material_get_ior()` |
| Lights | `light_` | `light_sample()`, `light_evaluate()` |
| Camera | `camera_` | `camera_generateRay()` |
| Transport | `transport_` | `transport_trace()`, `transport_integrate()` |
| Interaction | `interaction_` | `interaction_surface_shade()`, `interaction_surface_scatter()` |
| Film | `film_` | `film_accumulate()` |
| Developer | `developer_` | `developer_develop()` |

Objects (building blocks) use type-based naming:
- `sphere_[instance]_distance()`
- `box_[instance]_material()`
- `torus_[instance]_normal()`

### Cross-Module Communication (Updated)
Modules call each other using manual prefixes:

```glsl
// In Transport calling other modules
Spectrum transport_trace(Ray ray) {
  Hit hit;
  
  // Call Scene for intersection
  if (scene_intersect(ray, hit)) {
    // Get material properties from Materials
    MaterialProperties props = material_get_properties(hit.material_to, hit.p);
    
    // Call Interaction for physics
    vec3 wo = interaction_surface_scatter(-ray.direction, hit, xi, pdf);
    Spectrum f = interaction_surface_shade(-ray.direction, wo, hit);
    
    // Call Lights for direct illumination
    LightSample ls = light_sample(hit.p, xi);
    // ...
  }
}
```

## Material Architecture (Completely Revised)

### The Three-Layer Separation

**Materials Module (Data Layer)**
- Provides properties via `material_get_properties(int mat_id, vec3 p)`
- Returns: albedo, roughness, metallic, IOR, emission, volume coefficients
- NO evaluation, sampling, or PDF functions
- Just a property database

**Interaction Module (Physics Layer)**
- Implements light-matter physics using properties from Materials
- Surface interactions: BRDF/BSDF evaluation, importance sampling
- Volume interactions: Phase functions, scattering
- Uses but doesn't own material properties

**Transport Module (Algorithm Layer)**
- Owns integration strategies (path tracing, bidirectional, etc.)
- Decides WHEN to sample, HOW to terminate paths
- Calls Interaction for physics, never accesses Materials directly

### Property Query Architecture

```glsl
// The ONLY interface from Materials
struct MaterialProperties {
  // Surface properties
  vec3 albedo;
  float roughness;
  float metallic;
  float ior;
  
  // Emission
  vec3 emission;
  float emission_intensity;
  
  // Volume properties
  vec3 sigma_scatter;
  vec3 sigma_absorb;
  float phase_g;
  
  // Type flags
  int flags;  // DIELECTRIC | PARTICIPATING | EMISSIVE
}

MaterialProperties material_get_properties(int mat_id, vec3 p);
```

### Physics Implementation (in Interaction)

```glsl
// Surface interactions (using properties)
Spectrum interaction_surface_shade(vec3 wi, vec3 wo, Hit hit) {
  MaterialProperties props = material_get_properties(hit.material_to, hit.p);
  
  // Implement Disney BRDF using properties
  float alpha = props.roughness * props.roughness;
  vec3 h = normalize(wi + wo);
  float D = ggx_d(hit.n, h, alpha);
  // ... rest of BRDF calculation
}

vec3 interaction_surface_scatter(vec3 wi, Hit hit, vec2 xi, out float pdf) {
  MaterialProperties props = material_get_properties(hit.material_to, hit.p);
  // Importance sample based on properties
}

// Volume interactions (parallel structure)
Spectrum interaction_volume_shade(vec3 wi, vec3 wo, vec3 p, int mat_id) {
  MaterialProperties props = material_get_properties(mat_id, p);
  // Implement phase function using props.phase_g
}
```

### Nearby Object Tracking
For efficient boundary resolution, Scene tracks only closest 3 objects:
```glsl
struct NearbyObjects {
  float dists[3];      // Distances to closest 3
  int ids[3];          // Object IDs
  int count;           // Within threshold
};

// Scene uses this for material ID resolution
int scene_resolve_material(vec3 p, NearbyObjects nearby) {
  // Fast path: one object (90% of cases)
  if (nearby.count <= 1) {
    return scene_get_object_material(nearby.ids[0], p);
  }
  // Boundary: check 2-3 objects
}
```

## Shared Types

### Spectral Types
```glsl
typedef vec3 Spectrum;   // Wavelength-dependent radiance
typedef vec3 Radiance;   // What films accumulate  
typedef vec3 RGB;        // Display output
```

### Hit Structure (Updated)
```glsl
struct Hit {
  // Geometry
  vec3 p;               // Hit point
  vec3 n;               // Normal
  vec3 incident;        // Incoming direction
  float t;              // Ray parameter
  vec2 uv;              // Texture coordinates
  
  // Frame
  Frame frame;          // Orthonormal basis
  
  // Material interface (IDs only!)
  int material_from;    // Material we're leaving
  int material_to;      // Material we're entering
  
  // Object identity
  int object_id;
  
  // NO precomputed material properties!
  // NO ior_ratio - Interaction computes when needed
}
```

## Technical Patterns

### Property Batching
Get all properties in one call:
```glsl
// Good - single query
MaterialProperties props = material_get_properties(mat_id, p);
use(props.albedo);
use(props.roughness);

// Bad - multiple queries (never do this)
vec3 albedo = material_get_albedo(mat_id, p);
float roughness = material_get_roughness(mat_id, p);
```

### Compile-Time Property Optimization
```glsl
// Generated based on scene analysis
#define HAS_VARYING_ROUGHNESS 0
#define CONST_ROUGHNESS 0.5

MaterialProperties material_get_properties(int mat_id, vec3 p) {
  MaterialProperties props;
  
  #if HAS_VARYING_ROUGHNESS
    props.roughness = texture_lookup_roughness(mat_id, p);
  #else
    props.roughness = CONST_ROUGHNESS;  // Compile-time constant
  #endif
  
  // ... other properties
  return props;
}
```

### Transport-Interaction Cooperation
```glsl
// Transport decides strategy
Spectrum transport_integrate_volume(Ray ray, Hit entry) {
  #if VOLUME_STRATEGY == DELTA_TRACKING
    return transport_delta_track(ray, entry);
  #elif VOLUME_STRATEGY == RAY_MARCHING
    return transport_raymarch(ray, entry);
  #endif
}

// Inside delta tracking, Transport calls Interaction for physics
Spectrum transport_delta_track(Ray ray, Hit entry) {
  // Transport: Sample free path
  float t = -log(random()) / sigma_max;
  
  // Interaction: Compute scattering
  vec3 wo = interaction_volume_scatter(wi, p, mat_id, xi, pdf);
  Spectrum phase = interaction_volume_shade(wi, wo, p, mat_id);
  
  // Transport: Update path state
  throughput *= phase;
}
```

## Performance Optimizations

### Material System (New)
- Single property query returns everything (cache-friendly)
- Compile-time constant folding for uniform properties
- Dead code elimination for unused properties
- No virtual dispatch or function pointers
- Properties packed efficiently in memory

### Photography Pipeline
- Transport algorithms compiled for specific strategies
- Interaction physics optimized per BRDF model
- No runtime branching between material types
- Precomputed frames and geometric quantities

### Scene Traversal
- Nearby object tracking (max 3 objects)
- Conservative marching factor (0.9)
- Early termination for shadow rays
- Dispatch functions for object routing

## Debug & Analysis

### Property Visualization
New debug modes for the separated architecture:
- `DEBUG_PROPERTIES`: Visualize material properties directly
- `DEBUG_INTERACTION`: Show interaction type (diffuse/specular/volume)
- `DEBUG_TRANSPORT`: Color by transport decision
- `DEBUG_NEARBY`: Show nearby object count

## Implementation Flow Example

Complete flow showing the separation:

```glsl
// 1. Camera generates ray
Ray ray = camera_generateRay(pixel);

// 2. Transport drives the algorithm
Spectrum transport_trace(Ray ray) {
  Hit hit;
  
  // 3. Scene finds intersection (geometry + material IDs)
  if (!scene_intersect(ray, hit)) return scene_env_radiance(ray.direction);
  
  // 4. Materials provides properties
  MaterialProperties props = material_get_properties(hit.material_to, hit.p);
  
  // 5. Check for emission
  Spectrum Le = props.emission * props.emission_intensity;
  
  // 6. Interaction computes scattering
  vec3 wo;
  float pdf;
  wo = interaction_surface_scatter(-ray.direction, hit, next_2d(), pdf);
  
  // 7. Interaction evaluates BRDF
  Spectrum f = interaction_surface_shade(-ray.direction, wo, hit);
  
  // 8. Transport continues recursion
  Ray next_ray = Ray(hit.p, wo, EPSILON, MAX_DIST);
  return Le + f * transport_trace(next_ray) * abs(dot(wo, hit.n)) / pdf;
}
```

## Key Architecture Benefits

1. **Clear Separation**: Data (Materials) vs Physics (Interaction) vs Algorithms (Transport)
2. **Research Flexibility**: Swap interaction models without changing properties
3. **Optimization**: Aggressive compile-time specialization based on property usage
4. **Debugging**: Each layer can be tested independently
5. **Performance**: Property batching, no virtual dispatch
6. **Extensibility**: Easy to add new properties or interaction models

This architecture enables mixing and matching:
- Same properties, different interaction models (Disney vs Lambert)
- Same interaction physics, different transport (unidirectional vs bidirectional)
- Same transport, different property distributions
