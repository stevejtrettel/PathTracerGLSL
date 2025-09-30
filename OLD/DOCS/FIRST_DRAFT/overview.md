# Research Path Tracer: Complete System Architecture

## Vision

A research-grade GPU path tracer where **mathematics drives implementation**. The code you write mirrors the equations in your papers. All shader compilation, resource management, and GL plumbing is hidden behind clean abstractions.

**Core Principle**: Write differential geometry and rendering algorithms, not WebGL boilerplate.

## System Architecture

```
src/
├── math/              # Mathematical infrastructure (always available)
│   ├── core.glsl     # Pure math: sin, cos, mix, clamp
│   ├── sampling.glsl # Random numbers with automatic dimension tracking
│   ├── geometric.glsl# Universal operations: reflect, refract
│   └── types.glsl    # Interface types: Ray, Hit, Frame
│
├── engine/            # Boring deterministic infrastructure
│   ├── compiler/     # Module → GLSL transformation
│   ├── resources/    # GPU buffer/texture management
│   └── pipeline/     # Render execution
│
├── app/              # Research orchestration
│   ├── core/        # Basic app lifecycle
│   ├── workflows/   # Parameter sweeps, A/B testing
│   └── extensions/  # UI, controls, analysis
│
├── world/            # Mathematical scene content
│   ├── geometries/  # Spaces: Euclidean, hyperbolic, etc.
│   ├── objects/     # Shapes and material assignments (new separation)
│   ├── scenes/      # Object arrangement and interface resolution
│   ├── materials/   # BSDFs and volume properties (by material ID)
│   └── lights/      # Emitters
│
└── photography/      # Observation algorithms
    ├── cameras/     # Ray generation (with precomputed matrices)
    ├── estimators/  # Light transport (owns integration strategy)
    ├── films/       # Accumulation
    └── developers/  # Output processing
```

## The Five Pillars

### 1. Math (Infrastructure)
**Purpose**: Universal mathematical operations  
**Available**: Everywhere, always  
**Special feature**: Automatic random dimension tracking via `next_2d()`, `next_3d()`  
**No contracts**: These are utilities, not modules

### 2. Engine (Plumbing)
**Purpose**: Compile shaders, manage GPU, execute renders  
**Principle**: Boring, deterministic, invisible  
**Optimizations**: Precomputes camera matrices, manages dimension counters  
**You never modify this once it works**

### 3. App (Orchestration)
**Purpose**: Research workflows and experiment management  
**What it does**: Combines World + Photography, manages parameters, runs experiments  
**This is your control center**

### 4. World (Content)
**Purpose**: Define the mathematical space and its contents  
**Now provides five module types**:
- **Geometry**: Differential geometric structure of space
- **Objects**: Shape definitions and material ID assignments
- **Scene**: Object arrangement and material interface resolution
- **Materials**: Properties and scattering functions (work with material IDs)
- **Lights**: Emission sources

**Key architectural change**: Clear separation of concerns
- Objects own geometry + material IDs (not properties)
- Materials map IDs to properties and local behavior
- Scene arranges objects and resolves interfaces with nearby tracking
- Build-time optimization generates specialized GLSL

### 5. Photography (Algorithms)
**Purpose**: Define how light is measured and integrated  
**Provides**: Camera, estimation, accumulation, output  
**Key architectural change**: Estimator owns transport strategy
- Materials provide properties (sigma values, phase functions)
- Estimator decides integration method (delta tracking, ray marching, etc.)
- Transport strategies are compile-time selectable for research

## Data Flow

```
1. App selects World + Photography
   ↓
2. App analyzes scene and generates optimized modules
   ↓
3. App builds Recipe from optimized modules
   ↓
4. Engine compiles Recipe → GLSL program
   ↓
5. Engine executes render loop with precomputed uniforms
   ↓
6. Pixels to screen/file
```

## Module System

### Module Descriptor
Every module (from World or Photography) conforms to:

```typescript
interface ModuleDescriptor {
  id: {
    kind: string;     // "Geometry", "Objects", "Scene", "Material", etc.
    name: string;     // "Euclidean", "Pinhole", etc.
    version: string;  // "1.0.0"
  };
  
  fragment: {
    uniforms?: string;    // Declarations (auto-prefixed)
    functions: string;    // GLSL implementation (often generated)
    provides?: string[];  // Functions this module exports
    requires?: string[];  // Functions this module needs
    entrypoints?: {       // For main shader entry
      fragmentMain?: string;
    };
  };
  
  parameters?: Array<{
    name: string;         // Clean name (auto-prefixed)
    kind: ParameterKind;
    default: any;
    min?: number;
    max?: number;
    resetPolicy?: "none" | "accumulation" | "program";
  }>;
}
```

### Auto-Prefixing Convention

The engine automatically prefixes everything:

```glsl
// You write:
uniform vec3 position;
vec3 generate_ray(vec2 pixel) { ... }

// Engine produces:
uniform vec3 u_camera_pinhole_position;
vec3 c_generate_ray(vec2 pixel) { ... }
```

Prefix mapping:
- Uniforms: `u_${kind}_${name}_${param}`
- Geometry: `g_`
- Objects: no prefix (instance-specific names)
- Scene: `sc_`
- Material: `m_`
- Light: `l_`
- Camera: `c_`
- Estimator: `e_`
- Film: `f_`
- Developer: `d_`

## Math Infrastructure

### Always Available with Automatic Dimension Tracking
```glsl
// math/core.glsl - Pure mathematics
float saturate(float x);
vec3 mix(vec3 a, vec3 b, float t);

// math/sampling.glsl - Random numbers with automatic dimension tracking
// Old manual way (deprecated):
float sample_1d(ivec2 pixel, int sample, int dim);
vec2 sample_2d(ivec2 pixel, int sample, int dim);

// New automatic way (recommended):
float next_1d();  // Automatically increments dimension
vec2 next_2d();   // Automatically increments dimension
vec3 next_3d();   // Takes 2 dimensions

// math/geometric.glsl - Geometry-dependent operations
Direction reflect(Direction i, Direction n, Point at);  // Uses g_dot
Direction refract(Direction i, Direction n, float eta, Point at);
```

### Interface Types (Optimized)
```glsl
// math/types.glsl
// Note: Point and Direction are defined by Geometry module

struct Ray {
  Point o;
  Direction d;
};

struct Hit {
  // Geometric information
  Point p;
  Direction n;
  Direction incident;
  float t;
  vec2 uv;
  
  // Precomputed helpers
  Frame frame;         // Orthonormal frame (computed once by scene)
  
  // Object information
  int object_id;
  int part_id;
  
  // Material interface (resolved by Scene using nearby tracking)
  int material_from;   // Material ID we're traveling through
  int material_to;     // Material ID we would enter
  float ior_ratio;     // ior_from / ior_to (precomputed)
};

struct Frame {
  Point base;
  Direction t;
  Direction b;  
  Direction n;
};

// Nearby object tracking for efficient boundaries
struct NearbyObjects {
  float dists[3];      // Distances to closest 3 world
  int ids[3];          // Object IDs
  int count;           // How many within threshold
};
```

## Module Communication

### World Module Interactions

**Objects → Scene:**
- Objects provide: `classify_[name](p) → MaterialID`
- Objects provide: `[name]_sdf(p)` or `[name]_f(p)`
- Scene uses these to resolve material interfaces

**Scene → Materials:**
- Scene determines: `material_from`, `material_to`
- Scene provides: `NearbyObjects` for efficient boundary resolution
- Materials work with material IDs, not object IDs

**Materials → Estimator:**
- Surface: `m_interact(wi, hit, xi, wo, pdf)` - batched BSDF
- Volume properties: `m_sigma_s(p, mat_id)`, `m_sigma_a(p, mat_id)`
- Phase functions: `m_sample_phase(wi, p, mat_id, xi, pdf)`
- Type flags: `material_types[mat_id]` for dispatch

### Photography Module Interactions

**Estimator Transport Architecture:**
```glsl
// Estimator owns transport strategy
TransportResult dispatch_transport(Ray ray, Hit hit, TransportState state) {
    int type_to = material_types[hit.material_to];
    
    if (type_to & MAT_TYPE_PARTICIPATING) {
        // Estimator chooses HOW to integrate
        #if VOLUME_STRATEGY == DELTA_TRACKING
            return delta_track_volume(ray, hit, state);
        #elif VOLUME_STRATEGY == RAY_MARCHING
            return raymarch_volume(ray, hit, state);
        #endif
    }
    
    return transport_surface(ray, hit, state);
}
```

The key change: Materials provide properties, Estimator implements integration.

### Optimized Operations
- **Scene** precomputes `hit.frame` once per intersection
- **Scene** tracks only 3 nearby objects for boundary resolution
- **Materials** indexed by material ID for fast lookup
- **Materials** use batched `m_interact()` for sampling + evaluation
- **Camera** uses precomputed `u_camera_frame` matrix

## Compilation Process

1. **Scene Analysis**: Determine which objects and materials are used
2. **Object Compilation**: Generate classifiers and distance functions
3. **Material Analysis**: Determine which features are actually used
4. **Module Generation**: Build optimized GLSL for materials/scenes
5. **Module Collection**: Gather all modules from World + Photography
6. **Dependency Resolution**: Order modules, verify all `requires` satisfied
7. **Auto-Prefixing**: Transform uniforms and functions
8. **Dead Code Elimination**: Remove unused features
9. **Constant Folding**: Compile-time evaluation of fixed values
10. **Orchestration Generation**: Create main() that calls modules in order
11. **Type Injection**: Add Point/Direction from Geometry
12. **Final Assembly**: Complete optimized GLSL program

## Build-Time Optimization

### Object Optimization
Objects are compiled with:
- **Efficient classifiers**: Return material IDs directly
- **Analytic normals**: When available for primitives
- **CSG operations**: Inlined at compile time

### Scene Optimization
Scenes are generated with:
- **Nearby object tracking**: Only check 2-3 objects at boundaries
- **Dispatch functions**: Direct routing to object-specific code
- **Efficient interface resolution**: Using nearby objects, not entire scene

### Material Optimization
Materials are analyzed and optimized at build time:
- **Dead code elimination**: Unused features (metallic, clearcoat) removed
- **Property indexing**: By material ID, not object ID
- **Constant folding**: Fixed parameters compiled as constants
- **Type flags**: Packed into integers for fast dispatch

### Estimator Optimization
Estimators compile with:
- **Transport strategies**: Selected at compile time (no runtime branching)
- **Efficient dispatch**: Using material type bit flags
- **Pluggable strategies**: Different methods for volumes, SSS

### Camera Optimization
Cameras receive:
- **Precomputed matrices**: `u_camera_frame`, `u_camera_tan_fov`
- **No per-ray rebuilding**: Coordinate frames computed once

## Example Workflow

```typescript
// Research session
const app = new ResearchApp(gl);

// Build world with clear separation
const world = new WorldBuilder()
  .setGeometry(new EuclideanGeometry())
  .addObject({
    shape: sphereSDF([0,0,0], 1),
    material: MATERIAL_GLASS  // Just ID assignment
  })
  .compile();  // Generates optimized GLSL

// Configure estimator with transport strategy
const estimator = new PathTracer({
  volumeStrategy: 'delta_tracking',  // Compile-time selection
  sssModel: 'diffusion'
});

// Set observation algorithm  
app.setPhotographer(estimator);

// Materials work with IDs, not world
app.parameters.set("material[GLASS].ior", 1.5);

// Run experiment comparing transport strategies
const results = await app.compareStrategies([
  { volumeStrategy: 'delta_tracking' },
  { volumeStrategy: 'ray_marching' },
  { volumeStrategy: 'analytical' }
]);
```

## Performance Optimizations Summary

1. **Nearby Object Tracking**: Only check 2-3 objects at material boundaries
2. **Material ID Dispatch**: Properties indexed by material ID, not object ID
3. **Compile-Time Transport**: Volume strategies selected at compilation
4. **Precomputed Frame**: Hit structure includes frame, computed once
5. **IOR Ratio Only**: Store only `ior_ratio`, not individual IORs
6. **Automatic Dimensions**: `next_2d()` instead of manual tracking
7. **Batched Properties**: Single `MaterialProperties` fetch
8. **Analytic Normals**: Computed directly for known primitives
9. **Camera Matrices**: Precomputed per frame, not per ray
10. **Batched BSDF**: `m_interact()` returns direction + PDF + contribution
11. **Dead Code Elimination**: Unused material features removed
12. **Constant Folding**: Fixed values compiled as constants
13. **Reset Detection**: `u_film_reset` flag for parameter changes

## Key Architectural Decisions

The system now features clear separation of concerns:
- **Objects**: Own geometry and material ID assignment
- **Materials**: Map material IDs to properties and local behavior
- **Scene**: Arranges objects and efficiently resolves interfaces
- **Estimator**: Owns transport strategy and integration methods

This separation enables:
- Easy material swapping without changing geometry
- Multiple transport strategies for research comparison
- Efficient boundary resolution with nearby tracking
- Clear ownership of integration algorithms
