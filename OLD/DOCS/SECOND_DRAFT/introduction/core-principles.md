# Core Principles & Shared Concepts

## Architectural Principles

### 1. Separation of Concerns
Each pillar has exclusive responsibilities:
- **World**: Defines *what exists* (no knowledge of ray tracing)
- **Photography**: Defines *how we measure* (no scene definition)
- **Engine**: Provides *infrastructure* (no research logic)
- **App**: Orchestrates *experiments* (no GPU calls)
- **Math**: Provides *utilities* (no state or contracts)

### 2. Determinism & Reproducibility
Given fixed inputs (recipe, seed, environment), output is identical:
- Random sampling explicitly seeded and dimensioned
- All floating point operations IEEE-compliant
- Parameter changes tracked and logged
- No undefined behavior or race conditions

### 3. Ownership Rules
Clear ownership prevents architectural confusion:
- **Estimator owns transport**: Decides integration strategy
- **Objects own placement**: Geometry + material IDs only
- **Materials own appearance**: Properties via evaluate/sample/pdf
- **Scene owns interfaces**: Material boundary resolution
- **Engine owns GPU state**: All WebGL operations
- **App owns orchestration**: Recipe and parameter management

### 4. Error & Fallback Policy
- **Fatal errors**: Shader compilation, out-of-memory → stop
- **Recoverable errors**: Missing parameters → use defaults with warning
- **Research errors**: NaN/Inf samples → clamp to black, count, continue
- **Capability fallbacks**: Missing HDR → suggest LDR alternatives

### 5. Performance Philosophy
Optimize at compile-time, not runtime:
- Dead code elimination for unused features
- Constant specialization for fixed values
- Strategy selection at compilation (#if VOLUME_STRATEGY)
- Precomputation of matrices and frames
- Three-way BSDF interface for efficient MIS

## Module System

### Module Descriptor Structure
```typescript
interface ModuleDescriptor {
  id: {
    kind: string;     // "geometry", "material", etc.
    name: string;     // "euclidean", "disney", etc.
    version: string;  // "1.0.0"
  };
  
  fragment: {
    uniforms?: string;    // Parameter declarations
    functions: string;    // GLSL implementation
    provides?: string[];  // Exported functions
    requires?: string[];  // Required functions
  };
  
  parameters?: Array<{
    name: string;
    type: string;
    default: any;
    min?: number;
    max?: number;
  }>;
}
```

### Prefixing Convention
Users write unprefixed functions. Engine auto-prefixes to avoid collisions:

| Module Kind | User Writes | Engine Produces | Uniform Example |
|------------|-------------|-----------------|-----------------|
| Geometry | `geodesic()` | `g_geodesic()` | `u_geometry_euclidean_` |
| Material | `evaluate()` | `m_evaluate()` | `u_material_disney_` |
| Scene | `intersect()` | `sc_intersect()` | `u_scene_sdf_` |
| Lights | `sample_light()` | `l_sample_light()` | `u_lights_hdri_` |
| Camera | `generate_ray()` | `c_generate_ray()` | `u_camera_pinhole_` |
| Estimator | `estimate()` | `e_estimate()` | `u_estimator_pt_` |
| Film | `accumulate()` | `f_accumulate()` | `u_film_variance_` |
| Developer | `develop()` | `d_develop()` | `u_developer_aces_` |

### Cross-Module Communication
Modules communicate through required/provided functions:
```glsl
// Material requires from Scene:
"requires": ["intersect", "classify_point"]

// Scene provides:
"provides": ["intersect", "intersect_any", "classify_point"]

// After prefixing in compiled shader:
Hit hit;
if (sc_intersect(ray, hit)) {  // Calls Scene's function
  // ...
}
```

### Validation Requirements
Every module must:
1. Provide all required functions for its kind
2. Return finite, valid values (no NaN/Inf)
3. Maintain interface contracts (normalized directions, etc.)
4. Handle edge cases gracefully
5. Be deterministic given same inputs

## Material Architecture

### Single Material Module Per Scene
Each scene uses ONE material module (e.g., Disney BRDF). MaterialIDs index into parameter tables for that single BRDF implementation.

### The Separation (Single Source of Truth)

**Objects Own:**
- Geometric shape (SDF, isosurface, mesh)
- Material ID assignment (which material at each point)
- No properties or shading behavior

**Materials Own:**
- Appearance properties indexed by material ID
- Local scattering behavior via three functions:
    - `evaluate(wi, wo, hit)`: BSDF value
    - `sample(wi, hit, xi, out pdf)`: Importance sampling
    - `pdf(wi, wo, hit)`: Probability density
- For volumes: properties only (sigma_s, sigma_a, phase)
- No transport decisions or integration

**Scene Owns:**
- Object arrangement and transforms
- Material interface resolution (material_from, material_to)
- Efficient traversal with nearby tracking
- No shading or properties

**Estimator Owns:**
- Transport strategy (how to integrate)
- Volume marching method (delta tracking, ray marching)
- Sampling decisions (when to use NEE)
- Uses material properties but implements algorithms

### Nearby Object Tracking
For efficient boundary resolution, track only closest 2-3 objects:
```glsl
struct NearbyObjects {
    float dists[3];      // Distances to closest 3
    int ids[3];          // Object IDs
    int count;           // Within threshold
};

// Resolution uses only nearby world, not entire scene
int resolve_material(vec3 p, NearbyObjects nearby) {
    // Fast path: one object (90% of cases)
    if (nearby.count <= 1) {
        // Check single object
    }
    // Slow path: check 2-3 world at boundaries
}
```

## Shared Types

### Spectral Types
For future extensibility, color types are abstract:

```glsl
// Spectral representation hierarchy:
typedef vec3 Spectrum;   // Wavelength-dependent radiance
                        // RGB now, could be float (mono),
                        // vec2 (wavelength+intensity), or struct
                        
typedef vec3 Radiance;   // What films accumulate
                        // RGB now, XYZ tristimulus in spectral

typedef vec3 RGB;        // Display output (always vec3)
```

### Geometric Types
Defined by Geometry module:

```glsl
typedef vec3 Point;      // Could be vec4 for projective
typedef vec3 Direction;  // Could be vec4 for 4D
```

### Core Structures
```glsl
struct Ray {
  Point origin;
  Direction direction;
  float tmin, tmax;      // Valid t range
};

struct Hit {
  // Geometry
  Point p;               // Hit point
  Direction n;           // Normal (outward)
  Direction incident;    // Incoming direction
  float t;               // Ray parameter
  vec2 uv;              // Texture coordinates
  
  // Precomputed
  Frame frame;          // Orthonormal basis
  float ior_ratio;      // material_iors[from]/material_iors[to]
  
  // Material interface (Scene computes)
  int material_from;    // Traveling through
  int material_to;      // Would enter
  
  // Object identity
  int object_id;
  int part_id;          // For multi-part world
};

struct Frame {
  Point base;           // Valid position
  Direction t, b, n;    // Orthonormal vectors
};

struct TransportState {
  Spectrum throughput;  // Path weight
  Spectrum radiance;    // Accumulated
  int depth;           // Bounce count
  bool specular_path;  // For NEE decisions
};

struct LightSample {
  Direction wi;         // Direction toward light
  float distance;       // Distance to light
  Spectrum radiance;    // Incoming radiance
  float pdf;           // Probability density
  int light_id;        // Which light
  bool is_delta;       // Point/directional
};
```

## Technical Patterns

### Automatic Dimension Tracking
Replace manual dimension incrementing with automatic tracking:
```glsl
// OLD (error-prone):
int dim = 0;
vec2 xi1 = sample_2d(pixel, sample, dim++);
vec2 xi2 = sample_2d(pixel, sample, dim++);

// NEW (automatic):
vec2 xi1 = next_2d();  // Dimension 0-1
vec2 xi2 = next_2d();  // Dimension 2-3
float xi3 = next_1d();  // Dimension 4
```

### Precomputed Values
Compute expensive operations once:
- **Camera matrices**: Per frame, not per ray
- **Hit frames**: Once at intersection, not per BSDF call
- **IOR ratios**: At hit creation, not in material
- **Material type flags**: Bit flags for fast dispatch

### Three-Way BSDF Interface
Separate evaluation, sampling, and PDF for flexibility:
```glsl
// Sampling
Direction wo = m_sample(wi, hit, xi, pdf);

// Evaluation (for MIS)
Spectrum f = m_evaluate(wi, wo, hit);

// PDF query (for MIS)
float pdf = m_pdf(wi, wo, hit);

// Complete contribution
Spectrum contrib = f * abs(g_dot(wo, hit.n, hit.p)) / pdf;
```

### Compile-Time Strategy Selection
Choose algorithms at compilation, not runtime:
```glsl
#define VOLUME_STRATEGY DELTA_TRACKING

// In estimator:
#if VOLUME_STRATEGY == DELTA_TRACKING
    return delta_track_volume(ray, hit, state);
#elif VOLUME_STRATEGY == RAY_MARCHING
    return raymarch_volume(ray, hit, state);
#endif
```

### Recipe-Based Configuration
All configuration through recipes, not dynamic creation:
```typescript
// App defines known recipes upfront:
const recipes = {
  pathtracer: { /* modules and params */ },
  debug: { /* modules and params */ },
  production: { /* modules and params */ }
};

// Compile all at startup:
engine.initializeShaders(Object.values(recipes));

// Switch instantly:
app.switchRecipe('pathtracer');
```

## Performance Optimizations

### Material System
- Single material module per scene (no dispatch overhead)
- Properties indexed by material ID (O(1) lookup)
- Type flags for fast dispatch (bit operations)
- Dead code elimination for unused features
- Three-way interface enables efficient MIS

### Scene Traversal
- Nearby object tracking (max 3 objects)
- Conservative marching factor (0.9)
- Early termination for shadow rays
- Spatial acceleration for >20 objects

### Memory Patterns
- Film buffer reuse (check manifest equality)
- Texture atlasing for multiple assets
- Pool allocations where possible
- Clear rather than reallocate

### GPU Efficiency
- Full-screen triangle (3 vertices, not quad)
- Minimal state changes
- Batched uniform updates (once per frame)
- Float buffers throughout (no conversion)

## Debug & Analysis

### Standard Debug Modes
Available through compile-time flags:
- `DEBUG_NORMALS`: Visualize surface normals
- `DEBUG_MATERIALS`: Show material IDs as colors
- `DEBUG_TRANSPORT`: Color by transport type
- `DEBUG_NEARBY`: Show nearby object count
- `DEBUG_VARIANCE`: Highlight high-variance pixels

### Performance Profiling
- Frame timing with moving averages
- Sample throughput metrics
- GPU memory usage tracking
- Transport strategy usage counts

## Implementation Notes

### Function Writing Convention
Module authors write functions without prefixes:
```glsl
// In material module, author writes:
Spectrum evaluate(Direction wi, Direction wo, Hit hit) {
  // Implementation
}

// Engine produces in compiled shader:
Spectrum m_evaluate(Direction wi, Direction wo, Hit hit) {
  // Same implementation
}
```

### Material-Estimator Separation
Materials provide properties, Estimator owns algorithms:
```glsl
// Material provides (for volumes):
Spectrum sigma_s(Point p, int mat_id);  // Scattering coefficient
Spectrum sigma_a(Point p, int mat_id);  // Absorption coefficient

// Estimator implements:
TransportResult delta_track_volume(...) {
  // Uses sigma_s and sigma_a
  // But implements the integration algorithm
}
```
