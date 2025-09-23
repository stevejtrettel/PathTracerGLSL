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
**What it provides**: Data only - shapes, material properties, light sources  
**What it doesn't do**: Physics, light behavior, BRDFs

**Three Modules**:
- **Geometry** (hand-written): Differential geometric structure (`geometry_*`)
- **Scene** (compiled): Objects, materials, intersection (`scene_*`)
- **Lighting** (compiled): Light sampling strategies (`lighting_*`)

**Key Innovation**: Scene and Lighting modules are compiled from high-level descriptions with automatic cross-referencing:
- Emissive objects → become lights in Lighting module
- Visible lights → become geometry in Scene module
- Material IDs managed automatically

**Critical Insight**: Materials are pure property data within Scene - no BRDFs, no sampling, just data accessed via `scene_material_properties()`.

### 3. Photography (Observation)
**Purpose**: Define how light is observed and measured  
**What it provides**: All physics and integration algorithms

**5-Module Pipeline**:
1. **Camera**: Ray generation (`camera_*`)
2. **Transport**: Integration algorithms - HOW to integrate (`transport_*`)
3. **Interaction**: Light-matter physics - WHAT happens (`interaction_*`)
4. **Film**: Temporal accumulation (`film_*`)
5. **Developer**: Tone mapping (`developer_*`)

**Revolutionary Split**: Transport owns integration strategy (path tracing, delta tracking), Interaction owns physics (BRDF evaluation, phase functions). Scene just provides the raw material data.

### 4. Engine (Infrastructure)
**Purpose**: Compile shaders, manage GPU, execute renders  
**Principle**: Boring, deterministic, invisible  
**Components** (4 subsystems):
- Module Registry: Validates and loads modules
- Simple Compiler: Direct concatenation → GLSL
- Resource Manager: Per-recipe GPU buffers
- Render Executor: WebGL draw calls

### 5. App (Orchestration)
**Purpose**: Research workflows and experiment management  
**Components**:
- Recipe System: Named configurations
- Parameter Store: Central state management
- Render Coordinator: Execution modes
- Extension System: Services without core modification

## World Compilation Pipeline

The World system features a sophisticated compilation pipeline:

```
Scene Description + Light Description
              ↓
         WorldCompiler
              ↓
    ┌─────────┬─────────┐
    │         │         │
Geometry   Scene    Lighting
(hand)   (compiled) (compiled)
```

**Cross-referencing**: The compiler automatically:
- Adds emissive objects as light sources
- Adds visible lights as geometric objects
- Assigns material IDs consistently

## Key Architectural Separation

### Data vs Behavior
**World (Data)**:
- What exists: shapes, material properties, light positions
- `scene_material_properties()` returns albedo, roughness, IOR, etc.
- `lighting_sample()` returns light samples
- No knowledge of BRDFs, Fresnel, or light physics

**Photography (Behavior)**:
- How light behaves with that data
- `interaction_surface_shade()` implements Disney/Lambert/etc using properties
- `transport_trace()` implements path tracing strategies

This is a hard boundary - no physics in World, no data ownership in Photography.

## Module Function Prefixing

All modules use explicit prefixes:

```glsl
// Geometry module (hand-written)
Point geometry_geodesic(Point origin, Direction dir, float t)
Frame geometry_frame(Point p, Normal n)

// Scene module (compiled)
bool scene_intersect(Ray ray, out Hit hit)
MaterialProperties scene_material_properties(int mat_id, Point p)
int scene_material_at(Point p)

// Lighting module (compiled)
LightSample lighting_sample(Point p, vec2 xi)
float lighting_pdf(Point p, Direction wi)

// Photography modules (hand-written)
Ray camera_generateRay(vec2 pixel)
Spectrum transport_trace(Ray ray)
Spectrum interaction_surface_shade(Direction wi, Direction wo, Hit hit)
Radiance film_accumulate(Spectrum s, vec2 pixel)
RGB developer_develop(Radiance r)
```

## Data Flow Example

```
1. Camera generates ray
   camera_generateRay() → Ray

2. Transport drives integration
   transport_trace(ray) coordinates the algorithm

3. Scene finds intersection
   scene_intersect(ray, hit) → geometric data + material IDs

4. Scene provides material properties
   scene_material_properties(hit.material_to, hit.p) → MaterialProperties

5. Lighting provides light samples
   lighting_sample(hit.p, xi) → LightSample

6. Interaction computes physics
   interaction_surface_shade(wi, wo, hit) → Spectrum
   (queries scene_material_properties internally)

7. Film accumulates
   film_accumulate(spectrum, pixel) → updated buffer

8. Developer maps to display
   developer_develop(radiance) → RGB
```

## Module Composition Example

A typical production recipe:

| Module | Type | Purpose |
|--------|------|---------|
| Geometry | euclidean (hand) | Standard 3D space |
| Scene | compiled | Objects, materials, intersection |
| Lighting | compiled | Light sampling strategies |
| Camera | thin_lens (hand) | DOF effects |
| Transport | pathtracer (hand) | Unidirectional path tracing |
| Interaction | disney (hand) | Disney principled BRDF |
| Film | variance (hand) | Accumulation with variance tracking |
| Developer | aces (hand) | Film-like tone mapping |

## Compilation and Optimization

The WorldCompiler analyzes descriptions and generates optimized code:

```typescript
// Analysis determines what varies
analysis = {
  objects: 2,
  materials: 3,
  lights: 1,
  constantProperties: { roughness: 0.5 },
  varyingProperties: ['albedo', 'ior'],
  hasEmissive: true
}

// Generated Scene module optimizations:
- Unrolled marching for 2 objects
- Constant-folded roughness
- Efficient material property packing

// Generated Lighting module optimizations:
- Direct sampling for single light
- Analytic sampler for sphere lights
- Bbox fallback for complex emitters
```

## Performance Architecture

### Compile-Time Specialization
- Scene-specific code generation
- Dead code elimination
- Constant folding
- Optimal data layout

### Runtime Efficiency
- No dynamic dispatch
- Minimal branching
- Packed material properties
- Per-recipe accumulation buffers

## Research Workflows

### Interactive Development
- Write scene/light descriptions
- Automatic compilation to GLSL
- Hot-reload on changes
- Debug visualizations

### Algorithm Comparison
- **Swap Transport strategies**: Path tracing vs bidirectional
- **Swap Interaction models**: Disney vs Lambert
- **Swap Lighting setups**: Without recompiling scene
- **A/B testing**: Side-by-side comparison

## File Organization

```
src/
├── math/              # Utilities
├── engine/            # Infrastructure
├── app/              # Orchestration
├── world/            
│   ├── geometry/     # Hand-written modules
│   ├── compiler/     # WorldCompiler system
│   │   ├── WorldCompiler.ts
│   │   ├── SceneCompiler.ts
│   │   └── LightingCompiler.ts
│   └── descriptions/ # Scene/light descriptions
└── photography/      
    ├── cameras/      # Hand-written modules
    ├── transport/    # Hand-written modules
    ├── interaction/  # Hand-written modules
    ├── films/        # Hand-written modules
    └── developers/   # Hand-written modules
```

## Key Benefits

1. **Automatic Cross-referencing**: Emissive objects become lights, visible lights become geometry
2. **Compile-Time Optimization**: Scene-specific code with zero overhead
3. **Clear Separation**: Data (World) vs Behavior (Photography)
4. **Research Flexibility**: Mix and match algorithms independently
5. **No Boilerplate**: Write descriptions, not GLSL
6. **Debugging**: Generated code is readable and inspectable
