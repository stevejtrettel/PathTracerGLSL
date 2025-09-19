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
**Components**:
- Module Registry: Available modules database
- Shader Compiler: Module → GLSL transformation with auto-prefixing
- Resource Manager: GPU buffer/texture management
- Uniform Binder: Parameter → GPU mapping
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
- Each module provides specific functions (e.g., `intersect`, `evaluate`)
- Engine auto-prefixes functions (`intersect` → `sc_intersect`)
- Hot-swapping enables rapid experimentation

### Material Architecture
**Single Material Module Per Scene**: Choose Disney OR Lambert, not both
- MaterialIDs index into parameter tables for that one BRDF
- Materials provide three functions:
    - `evaluate(wi, wo, hit)`: BSDF value
    - `sample(wi, hit, xi, out pdf)`: Importance sampling
    - `pdf(wi, wo, hit)`: Probability density
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

### Eager Compilation
- All shader variants compiled at startup
- 2-3 recipes × ~8 modules = instant switching
- Accepts startup cost for runtime performance
- No compilation stutter during interaction

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
3. Engine compiles Recipe → GLSL program
   ↓
4. Parameters flow through Store → Binder → GPU
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
3. UniformBinder queues GPU update
   ↓
4. RenderCoordinator checks if reset needed
   ↓
5. Next frame: updates flushed to GPU
```

## Module Function Flow

Users write unprefixed functions, engine adds prefixes:

```glsl
// User writes in geometry module:
Point geodesic(Point origin, Direction dir, float t) { ... }

// Engine produces:
Point g_geodesic(Point origin, Direction dir, float t) { ... }

// Other modules call with prefix:
Point p = g_geodesic(ray.origin, ray.direction, t);
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

## Module Examples

### Swappable Geometry
- **Euclidean**: Standard flat space (most common)
- **Spherical**: Positive curvature for panoramas
- **Hyperbolic**: Negative curvature for Escher-like visualizations

### Swappable Estimators
- **PathTracer**: Standard unidirectional path tracing
- **VolumetricPT**: Optimized for participating media (delta tracking)
- **Debug**: Visualization modes (normals, materials, transport)

### Swappable Materials (One Per Scene)
- **Lambert**: Simple diffuse only
- **Disney**: Full principled BRDF with all features
- **Glass**: Specialized dielectric with dispersion support

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

### GPU Efficiency
- Single full-screen triangle (3 vertices, not quad)
- Minimal state changes
- Texture atlasing for multiple assets
- Float buffers for HDR throughout

## File Organization

```
src/
├── math/              # Always available utilities
├── engine/            # Boring infrastructure
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

## Next Steps

1. Read [Core Principles & Shared Concepts](core-principles.md) for detailed architectural rules
2. Review pillar overviews for philosophy and design rationale
3. Check contracts for precise function specifications
4. Implement modules following the unprefixed convention
