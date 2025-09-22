# System Overview - Research Path Tracer

## Vision & Purpose

A research-grade GPU path tracer where **mathematics drives implementation**. The code you write mirrors the equations in your papers. All shader compilation, resource management, and WebGL plumbing is hidden behind clean abstractions.

**Core Philosophy**: Write differential geometry and rendering algorithms, not WebGL boilerplate.

## Architecture: Five Pillars

### 1. Math (Infrastructure)
**Purpose**: Universal mathematical operations  
**Availability**: Everywhere, always  
**No contracts**: These are utilities, not modules

- Pure math functions: sin, cos, mix, clamp
- Sampling with automatic dimension tracking: `next_2d()`, `next_3d()`
- Geometric operations: reflect, refract
- Spectrum operations: add, scale, multiply
- Random sampling infrastructure

### 2. World (Content)
**Purpose**: Define the mathematical space and its contents  
**Modules**:
- **Geometry**: Differential geometric structure of space
- **Objects**: Shape definitions and material ID assignments
- **Scene**: Object arrangement and material interface resolution
- **Materials**: Properties and scattering functions (ONE module per scene)
- **Lights**: Emission sources

**Key Insight**: Materials provide properties via three functions (evaluate/sample/pdf), but Estimator owns transport strategy.

### 3. Photography (Algorithms)
**Purpose**: Define how light is measured and integrated  
**Modules**:
- **Camera**: Ray generation from image coordinates
- **Estimator**: Light transport strategy (OWNS integration method)
- **Film**: Sample accumulation over time
- **Developer**: HDR to display mapping

**Key Insight**: Estimator decides HOW to integrate (delta tracking vs ray marching), Materials only provide WHAT (coefficients).

### 4. Engine (Infrastructure)
**Purpose**: Compile shaders, manage GPU, execute renders  
**Principle**: Boring, deterministic, invisible  
**Components** (Simplified to 4 subsystems):
- Module Registry: Validates modules and enforces manual prefixing
- Simple Compiler: Direct concatenation → GLSL (with integrated uniform mapping)
- Resource Manager: Per-recipe GPU buffer/texture management
- Render Executor: WebGL draw calls

### 5. App (Orchestration)
**Purpose**: Research workflows and experiment management  
**Components**:
- Recipe System: Named configurations (2-3 defined upfront)
- Parameter Store: Central state management
- Render Coordinator: Execution modes (interactive/progressive/production)
- Extension System: Services without core modification

## Key Design Decisions

### Module-Based Composition
- Modules are swappable components implementing contracts
- Each module provides specific functions with manual prefixes
- Module names determine prefixes (`disney_evaluate`, `pinhole_generateRay`)
- Hot-swapping enables rapid experimentation

### Manual Prefixing Convention
**Modules handle their own namespacing**: Authors manually prefix all public functions with the module name
- Material named "disney": `disney_evaluate()`, `disney_sample()`, `disney_pdf()`
- Camera named "pinhole": `pinhole_generateRay()`
- Scene named "sdf": `sdf_intersect()`, `sdf_classify_point()`
- No transformation by Engine - what you write is what runs

### Material Architecture
**Single Material Module Per Scene**: Choose Disney OR Lambert, not both
- MaterialIDs index into parameter tables for that one BRDF
- Materials provide three functions (with manual prefixes):
    - `moduleName_evaluate(wi, wo, hit)`: BSDF value
    - `moduleName_sample(wi, hit, xi, out pdf)`: Importance sampling
    - `moduleName_pdf(wi, wo, hit)`: Probability density
- For volumes, materials provide properties only (sigma_s, sigma_a)
- Transport algorithms belong to Estimator

### Type Hierarchy for Spectral Rendering
- **Spectrum**: Wavelength-dependent radiance (vec3 now, wavelengths future)
- **Radiance**: What films accumulate (vec3 now, XYZ future)
- **RGB**: Display output (always vec3)

### Compile-Time Optimization
- All optimization happens at shader compilation
- No runtime branching for material types or transport strategies
- Dead code elimination for unused features
- Constant folding for fixed parameters
- Fixed module concatenation order (no dependency sorting)

### Eager Compilation
- All shader variants compiled at startup
- 2-3 recipes × ~8 modules = instant switching
- Accepts startup cost (~500ms) for runtime performance
- No compilation stutter during interaction

### Per-Recipe Accumulation
- Each recipe maintains separate film buffers
- Accumulation preserved when switching between recipes
- Enables quick debug checks without losing samples
- Robust manifest comparison prevents unnecessary reallocation

### Extension-Based Growth
- Core stays minimal and stable
- Features added as services, not methods on app
- Extensions access core through service registry
- Clean separation enables parallel development

## Data Flow

### Recipe to Pixels
```
1. User selects Recipe (named configuration)
   ↓
2. App resolves modules from Registry
   ↓
3. Engine validates manual prefixing and concatenates → GLSL program
   ↓
4. Parameters flow through Store → Compiler → GPU
   ↓
5. Executor renders full-screen triangle
   ↓
6. GPU runs: Camera → Estimator → World queries → Film → Developer
   ↓
7. Pixels to screen or file
```

### Parameter Updates
```
1. User changes parameter
   ↓
2. ParameterStore validates and notifies
   ↓
3. SimpleCompiler updates uniforms (integrated mapping)
   ↓
4. RenderCoordinator checks if reset needed
   ↓
5. Next frame: updates flushed to GPU
```

## Module Function Flow

Module authors write manually prefixed functions:

```glsl
// Author writes in geometry module named "euclidean":
Point euclidean_geodesic(Point origin, Direction dir, float t) { ... }

// Used directly in other modules - no transformation:
Point p = euclidean_geodesic(ray.origin, ray.direction, t);

// In material module named "disney":
vec3 disney_evaluate(vec3 wi, vec3 wo, Hit hit) { ... }

// Called from estimator:
vec3 f = disney_evaluate(wi, wo, hit);
```

The main() function uses actual module names from the recipe:

```glsl
void main() {
  vec2 pixel = gl_FragCoord.xy;
  
  // Calls use module names as prefixes
  Ray ray = pinhole_generateRay(pixel);         // Camera named "pinhole"
  Spectrum radiance = pathtracer_estimate(ray); // Estimator named "pathtracer"
  Radiance accumulated = variance_accumulate(radiance, pixel);
  RGB color = aces_develop(accumulated);
  
  fragColor = vec4(color, 1.0);
}
```

## Research Workflows

### Interactive Exploration
- Real-time preview without accumulation
- Camera movement with WASD + mouse
- Parameter tweaking with immediate feedback
- Debug visualizations (normals, material IDs)

### Progressive Refinement
- Continuous accumulation until convergence
- Variance tracking for quality metrics
- Firefly rejection for outliers
- Save/load session state
- **Switch recipes without losing accumulation**

### Production Rendering
- High resolution with tiling support
- Checkpointing for long renders
- Batch processing for parameter studies
- Export in multiple formats

### Experimental Research
- A/B comparison of algorithms
- Parameter sweeps with automatic capture
- Performance profiling and analysis
- Custom transport strategies via module swapping
- **Preserved accumulation enables rapid iteration**

## Module Examples

### Swappable Geometry
- **Euclidean**: Standard flat space (most common)
    - Functions: `euclidean_geodesic()`, `euclidean_dot()`, `euclidean_frame()`
- **Spherical**: Positive curvature for panoramas
    - Functions: `spherical_geodesic()`, `spherical_dot()`, `spherical_frame()`
- **Hyperbolic**: Negative curvature for Escher-like visualizations
    - Functions: `hyperbolic_geodesic()`, `hyperbolic_dot()`, `hyperbolic_frame()`

### Swappable Estimators
- **PathTracer**: Standard unidirectional path tracing
    - Function: `pathtracer_estimate()`
- **VolumetricPT**: Optimized for participating media (delta tracking)
    - Function: `volumetric_estimate()`
- **Debug**: Visualization modes (normals, materials, transport)
    - Function: `debug_estimate()`

### Swappable Materials (One Per Scene)
- **Lambert**: Simple diffuse only
    - Functions: `lambert_evaluate()`, `lambert_sample()`, `lambert_pdf()`
- **Disney**: Full principled BRDF with all features
    - Functions: `disney_evaluate()`, `disney_sample()`, `disney_pdf()`
- **Glass**: Specialized dielectric with dispersion support
    - Functions: `glass_evaluate()`, `glass_sample()`, `glass_pdf()`

## Performance Architecture

### Nearby Object Tracking
Scene tracks only 3 closest objects for material resolution:
- 90% of rays: Single object, trivial resolution
- 10% boundaries: 2-3 objects, quick check
- Never: Full scene traversal

### Optimization Strategy
- Precomputed camera matrices (per frame, not per ray)
- Material properties indexed by ID (O(1) lookup)
- Three-way BSDF interface enables MIS naturally
- Automatic dimension tracking prevents correlation bugs
- Per-recipe resources eliminate reallocation overhead

### GPU Efficiency
- Single full-screen triangle (3 vertices, not quad)
- Minimal state changes
- Direct shader concatenation (no transformation)
- Float buffers for HDR throughout
- Robust manifest comparison (property-by-property)

## Context Loss Handling

WebGL context can be lost at any time:
- Engine attempts recovery
- Shaders recompiled from cached recipes
- **WARNING**: All accumulated samples lost
- Recovery starts from frame 0

## File Organization

```
src/
├── math/              # Always available utilities
├── engine/            # Simplified infrastructure (4 subsystems)
├── app/              # Research orchestration
├── world/            # Content modules
│   ├── geometry/
│   ├── objects/
│   ├── scenes/
│   ├── materials/
│   └── lights/
└── photography/      # Algorithm modules
    ├── cameras/
    ├── estimators/
    ├── films/
    └── developers/
```

## Simplified Engine Benefits

The new simplified Engine provides:
- **Clearer code**: Manual prefixing makes function calls explicit
- **Easier debugging**: No hidden transformations
- **Preserved accumulation**: Per-recipe buffers maintain samples
- **Faster compilation**: Direct concatenation instead of complex pipeline
- **Less complexity**: 4 subsystems instead of 5

## Next Steps

1. Read [Core Principles & Shared Concepts](core-principles.md) for detailed architectural rules
2. Review pillar overviews for philosophy and design rationale
3. Check contracts for precise function specifications
4. Implement modules following the **manual prefixing** convention
