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
- **Context loss**: Warn about accumulation loss, attempt recovery

### 5. Performance Philosophy
Optimize at compile-time, not runtime:
- Dead code elimination for unused features
- Constant specialization for fixed values
- Strategy selection at compilation (#if VOLUME_STRATEGY)
- Precomputation of matrices and frames
- Three-way BSDF interface for efficient MIS
- Per-recipe accumulation buffers (no reallocation on switch)

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
    functions: string;    // GLSL implementation with manual prefixes
    constants?: string;   // #define statements
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

### Manual Prefixing Convention
Module authors manually prefix all public functions with their module name:

| Module Kind | Module Name | Author Writes | Called As | Uniform Example |
|------------|-------------|---------------|-----------|-----------------|
| Geometry | euclidean | `euclidean_geodesic()` | `euclidean_geodesic()` | `u_geometry_euclidean_*` |
| Material | disney | `disney_evaluate()` | `disney_evaluate()` | `u_material_disney_*` |
| Scene | sdf | `sdf_intersect()` | `sdf_intersect()` | `u_scene_sdf_*` |
| Lights | hdri | `hdri_sample_light()` | `hdri_sample_light()` | `u_lights_hdri_*` |
| Camera | pinhole | `pinhole_generateRay()` | `pinhole_generateRay()` | `u_camera_pinhole_*` |
| Estimator | pathtracer | `pathtracer_estimate()` | `pathtracer_estimate()` | `u_estimator_pathtracer_*` |
| Film | variance | `variance_accumulate()` | `variance_accumulate()` | `u_film_variance_*` |
| Developer | aces | `aces_develop()` | `aces_develop()` | `u_developer_aces_*` |

**Key Rule**: The prefix is the module NAME, not the kind. A camera module named "thin_lens" uses `thin_lens_generateRay()`, not `camera_generateRay()`.

### Cross-Module Communication
Modules call each other using manually prefixed functions:

```glsl
// In pathtracer estimator calling other modules:
Spectrum pathtracer_estimate(Ray ray) {
  Hit hit;
  
  // Call scene module (named "sdf")
  if (sdf_intersect(ray, hit)) {
    // Call material module (named "disney")
    float pdf;
    vec3 wo = disney_sample(-ray.direction, hit, xi, pdf);
    vec3 f = disney_evaluate(-ray.direction, wo, hit);
    
    // Call lights module (named "hdri")
    LightSample ls = hdri_sample_light(hit.p, xi);
    // ...
  }
}
```

### Validation Requirements
Every module must:
1. Provide all required functions for its kind with proper manual prefixes
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
    - `moduleName_evaluate(wi, wo, hit)`: BSDF value
    - `moduleName_sample(wi, hit, xi, out pdf)`: Importance sampling
    - `moduleName_pdf(wi, wo, hit)`: Probability density
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

// Resolution uses only nearby objects, not entire scene
int resolve_material(vec3 p, NearbyObjects nearby) {
    // Fast path: one object (90% of cases)
    if (nearby.count <= 1) {
        // Check single object
    }
    // Slow path: check 2-3 objects at boundaries
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
  int part_id;          // For multi-part objects
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
Separate evaluation, sampling, and PDF for flexibility (with manual prefixes):
```glsl
// Sampling (assuming material module named "disney")
Direction wo = disney_sample(wi, hit, xi, pdf);

// Evaluation (for MIS)
Spectrum f = disney_evaluate(wi, wo, hit);

// PDF query (for MIS)
float pdf = disney_pdf(wi, wo, hit);

// Complete contribution (assuming geometry module named "euclidean")
Spectrum contrib = f * abs(euclidean_dot(wo, hit.n, hit.p)) / pdf;
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

// Compile all at startup (validates manual prefixing):
engine.initialize(Object.values(recipes));

// Switch instantly (preserves per-recipe accumulation):
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
- Per-recipe film buffers (preserve accumulation)
- Robust manifest comparison (property-by-property)
- Texture atlasing for multiple assets
- Pool allocations where possible
- Clear rather than reallocate

### GPU Efficiency
- Full-screen triangle (3 vertices, not quad)
- Minimal state changes
- Batched uniform updates (once per frame)
- Float buffers throughout (no conversion)
- Direct shader concatenation (no transformation)

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

### Manual Prefixing Convention
Module authors write functions with explicit prefixes:
```glsl
// In material module named "disney", author writes:
Spectrum disney_evaluate(Direction wi, Direction wo, Hit hit) {
  // Implementation
}

Spectrum disney_sample(Direction wi, Hit hit, vec2 xi, out float pdf) {
  // Implementation
}

float disney_pdf(Direction wi, Direction wo, Hit hit) {
  // Implementation
}

// Used directly in compiled shader - no transformation
```

### Material-Estimator Separation
Materials provide properties, Estimator owns algorithms:
```glsl
// Material provides (for volumes) - with manual prefix:
Spectrum volumetric_sigma_s(Point p, int mat_id);  // Scattering coefficient
Spectrum volumetric_sigma_a(Point p, int mat_id);  // Absorption coefficient

// Estimator implements:
TransportResult delta_track_volume(...) {
  // Uses volumetric_sigma_s and volumetric_sigma_a
  // But implements the integration algorithm
}
```

### Main Function Generation
The main() orchestrator uses actual module names from the recipe:
```glsl
void main() {
  vec2 pixel = gl_FragCoord.xy;
  
  // Calls use module names as prefixes (not kind names)
  Ray ray = pinhole_generateRay(pixel);         // Camera module named "pinhole"
  Spectrum radiance = pathtracer_estimate(ray); // Estimator module named "pathtracer"
  Radiance accumulated = variance_accumulate(radiance, pixel); // Film module named "variance"
  RGB color = aces_develop(accumulated);        // Developer module named "aces"
  
  fragColor = vec4(color, 1.0);
}
```

## Simplified Engine Integration

The Engine now uses:
- **4 subsystems** instead of 5 (UniformBinder integrated into SimpleCompiler)
- **Direct concatenation** instead of 8-stage transformation pipeline
- **Manual prefixing** instead of automatic transformation
- **Fixed module order** instead of dependency sorting
- **Per-recipe resources** preserving accumulation when switching
- **Robust manifest comparison** (property-by-property, not JSON)

This simplification makes the system more transparent and debuggable while maintaining all essential functionality.
