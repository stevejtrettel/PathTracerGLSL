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
│   ├── materials/   # BSDFs: Lambert, GGX, etc. (build-time optimized)
│   ├── scenes/      # Object compositions (build-time generated)
│   └── lights/      # Emitters
│
└── photography/      # Observation algorithms
    ├── cameras/     # Ray generation (with precomputed matrices)
    ├── estimators/  # Light transport
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
**Provides**: Geometry, materials, scene structure  
**Build-time optimization**: Generates specialized GLSL based on scene analysis  
**This is where differential geometry lives**

### 5. Photography (Algorithms)
**Purpose**: Define how light is measured and integrated  
**Provides**: Camera, estimation, accumulation, output  
**Optimization**: Uses precomputed frames, batched BSDF operations  
**This is where rendering algorithms live**

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
    kind: string;     // "Geometry", "Camera", etc.
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
- Material: `m_`
- Scene: `sc_`
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
  
  // Material interface
  int material_from;
  int material_to;
  float ior_ratio;     // Only ratio needed (not individual IORs)
};

struct Frame {
  Point base;
  Direction t;
  Direction b;  
  Direction n;
};

// Batched material properties
struct MaterialProperties {
  vec3 albedo;
  float roughness;
  float metallic;
  // Only properties used in scene
};
```

## Module Communication

Modules communicate through:
1. **Function calls** - Using clean names, auto-resolved by engine
2. **Shared types** - Ray, Hit, Frame (with precomputed data)
3. **Engine uniforms** - `u_resolution`, `u_frame_index`, precomputed matrices
4. **Batched operations** - `m_interact()` for combined BSDF operations

### Optimized Operations
- **Scene** precomputes `hit.frame` once per intersection
- **Materials** use batched `m_interact()` for sampling + evaluation
- **Camera** uses precomputed `u_camera_frame` matrix
- **Properties** fetched via batched `sc_get_material_properties()`

## Compilation Process

1. **Scene Analysis**: Determine which features are actually used
2. **Module Generation**: Build optimized GLSL for materials/scenes
3. **Module Collection**: Gather all modules from World + Photography
4. **Dependency Resolution**: Order modules, verify all `requires` satisfied
5. **Auto-Prefixing**: Transform uniforms and functions
6. **Dead Code Elimination**: Remove unused features
7. **Constant Folding**: Compile-time evaluation of fixed values
8. **Orchestration Generation**: Create main() that calls modules in order
9. **Type Injection**: Add Point/Direction from Geometry
10. **Final Assembly**: Complete optimized GLSL program

## Build-Time Optimization

### Material Optimization
Materials are analyzed and optimized at build time:
- **Dead code elimination**: Unused features (metallic, clearcoat) removed
- **Constant folding**: Fixed parameters compiled as constants
- **Batched properties**: Single struct fetch vs multiple calls

### Scene Optimization
Scenes are generated with:
- **Analytic normals**: For spheres, boxes, other primitives
- **Inlined SDFs**: Constants folded at compile time
- **Optimized property access**: Arrays for constants, switches for procedural

### Camera Optimization
Cameras receive:
- **Precomputed matrices**: `u_camera_frame`, `u_camera_tan_fov`
- **No per-ray rebuilding**: Coordinate frames computed once

## Example Workflow

```typescript
// Research session
const app = new ResearchApp(gl);

// Build optimized world (analyzed at compile time)
const world = new WorldBuilder()
  .setGeometry(new EuclideanGeometry())
  .addObject(sphere([0,0,0], 1))
  .compile();  // Generates optimized GLSL

// Set observation algorithm  
app.setPhotographer(new PathTracer());

// Adjust parameters (batched fetch in shader)
app.parameters.set("material.albedo", [0.9, 0.2, 0.2]);

// Run experiment (uses all optimizations)
const results = await app.parameterSweep({
  parameter: "roughness",
  values: [0.1, 0.2, 0.3, 0.4, 0.5]
});
```

## Performance Optimizations Summary

1. **Precomputed Frame**: Hit structure includes frame, computed once
2. **IOR Ratio Only**: Store only `ior_ratio`, not individual IORs
3. **Automatic Dimensions**: `next_2d()` instead of manual tracking
4. **Batched Properties**: Single `MaterialProperties` fetch
5. **Analytic Normals**: Computed directly for known primitives
6. **Camera Matrices**: Precomputed per frame, not per ray
7. **Batched BSDF**: `m_interact()` returns direction + PDF + contribution
8. **Dead Code Elimination**: Unused material features removed
9. **Constant Folding**: Fixed values compiled as constants
10. **Reset Detection**: `u_film_reset` flag for parameter changes
