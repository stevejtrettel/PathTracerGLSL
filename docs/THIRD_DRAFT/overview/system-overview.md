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
**What it provides**: Data only - shapes, material IDs, properties  
**What it doesn't do**: Physics, light behavior, BRDFs

**Modules** (4 modules + building blocks):
- **Geometry**: Differential geometric structure (`geometry_*`)
- **Scene**: Object arrangement and material ID resolution (`scene_*`)
- **Materials**: Physical properties ONLY via `material_get_properties()` (`material_*`)
- **Lights**: Emission sources (`light_*`)

**Building Blocks** (compiled into Scene):
- **Objects**: Shape definitions with type-based naming (`sphere_*`, `box_*`)

**Key Insight**: Materials is now a pure property database - no evaluation/sampling/pdf functions, just data.

### 3. Photography (Observation)
**Purpose**: Define how light is observed and measured  
**What it provides**: All physics and integration algorithms

**5-Module Pipeline**:
1. **Camera**: Ray generation (`camera_*`)
2. **Transport**: Integration algorithms - HOW to integrate (`transport_*`)
3. **Interaction**: Light-matter physics - WHAT happens (`interaction_*`)
4. **Film**: Temporal accumulation (`film_*`)
5. **Developer**: Tone mapping (`developer_*`)

**Revolutionary Split**: Transport owns integration strategy (path tracing, delta tracking), Interaction owns physics (BRDF evaluation, phase functions). Materials just provides the raw data.

### 4. Engine (Infrastructure)
**Purpose**: Compile shaders, manage GPU, execute renders  
**Principle**: Boring, deterministic, invisible  
**Components** (4 subsystems):
- Module Registry: Validates modules with manual prefixing
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

## Key Architectural Separation

### Data vs Behavior
**World (Data)**:
- What exists: shapes, material IDs, properties
- `material_get_properties()` returns albedo, roughness, IOR, etc.
- No knowledge of BRDFs, Fresnel, or light physics

**Photography (Behavior)**:
- How light behaves with that data
- `interaction_surface_shade()` implements Disney/Lambert/etc using properties
- `transport_trace()` implements path tracing strategies

This is a hard boundary - no physics in World, no data ownership in Photography.

## Manual Function Prefixing

All modules use explicit prefixes - no transformation by Engine:

```glsl
// Geometry module
vec3 geometry_geodesic(vec3 origin, vec3 dir, float t)
Frame geometry_frame(vec3 p, vec3 n)

// Scene module  
bool scene_intersect(Ray ray, out Hit hit)
int scene_get_material(vec3 p)

// Materials module (data only!)
MaterialProperties material_get_properties(int mat_id, vec3 p)
float material_get_ior(int mat_id)

// Photography modules
Ray camera_generateRay(vec2 pixel)
Spectrum transport_trace(Ray ray)
Spectrum interaction_surface_shade(vec3 wi, vec3 wo, Hit hit)
Radiance film_accumulate(Spectrum s, vec2 pixel)
RGB developer_develop(Radiance r)

// Objects (type-based, not module prefixes)
float sphere_glass_sphere_distance(vec3 p)
int box_metal_box_material(vec3 p)
```

## The Transport-Interaction Separation

This architecture makes a critical distinction in Photography:

### Transport (Algorithms)
Owns HOW to integrate light:
- Path construction strategies
- Russian roulette decisions
- Next event estimation
- Delta tracking vs ray marching for volumes

### Interaction (Physics)
Owns WHAT happens when light meets matter:
- BRDF/BSDF evaluation using material properties
- Importance sampling of scattering directions
- Fresnel equations and energy conservation
- Phase functions for volumes

### Materials (Data)
Just provides properties:
```glsl
struct MaterialProperties {
  vec3 albedo;
  float roughness;
  float metallic;
  float ior;
  vec3 sigma_scatter;
  vec3 sigma_absorb;
  float phase_g;
  // ... just data, no functions
}
```

## Data Flow Example

```
1. Camera generates ray
   camera_generateRay() → Ray

2. Transport drives integration
   transport_trace(ray) coordinates the algorithm

3. Scene finds intersection
   scene_intersect(ray, hit) → geometric data + material IDs

4. Materials provides properties
   material_get_properties(hit.material_to, hit.p) → MaterialProperties

5. Interaction computes physics
   interaction_surface_shade(wi, wo, hit, props) → Spectrum
   interaction_surface_scatter(wi, hit, props) → Direction

6. Film accumulates
   film_accumulate(spectrum, pixel) → updated buffer

7. Developer maps to display
   developer_develop(radiance) → RGB
```

## Module Composition Example

A typical production recipe:

| Module | Implementation | Purpose |
|--------|----------------|---------|
| Geometry | euclidean | Standard 3D space |
| Scene | generated | Compiled from object definitions |
| Materials | optimized | Property arrays with compile-time optimization |
| Lights | area_lights | Emissive geometry |
| Camera | thin_lens | DOF effects |
| Transport | pathtracer | Unidirectional path tracing |
| Interaction | disney | Disney principled BRDF |
| Film | variance | Accumulation with variance tracking |
| Developer | aces | Film-like tone mapping |

## Build-Time Optimization

The system analyzes the scene and generates optimized code:

```typescript
// Analysis determines what varies
propertyAnalysis = {
  constant: { roughness: 0.5 },     // Same for all materials
  varying: ['albedo', 'ior'],       // Differ between materials  
  spatial: ['albedo'],              // Textures/procedural
  unused: ['subsurface']            // Never referenced
}

// Generated code eliminates dead paths
MaterialProperties material_get_properties(int id, vec3 p) {
  props.roughness = 0.5;  // Constant folded
  props.albedo = texture_lookup(id, p);  // Spatial variation
  props.ior = ior_array[id];  // Per-material
  // subsurface eliminated entirely
}
```

## Performance Architecture

### Nearby Object Tracking
Scene tracks only 3 closest objects:
- 90% of rays: Single object
- 10% boundaries: 2-3 objects
- Never: Full traversal

### Compile-Time Specialization
- No runtime material type branching
- Unused properties eliminated
- Constants folded
- Fixed concatenation order

### Per-Recipe Resources
Each recipe maintains separate buffers:
- Switch recipes without losing samples
- No reallocation thrashing
- Instant comparison

## Research Workflows

### Interactive Exploration
- Real-time preview
- Debug visualizations (normals, materials, properties)
- **Hot-swap Interaction models**: Compare Disney vs Lambert instantly

### Progressive Refinement
- Continuous accumulation
- **Recipe switching preserves samples**
- Variance-based convergence

### Algorithm Research
- **Swap Transport strategies**: Path tracing vs bidirectional
- **Swap Interaction physics**: Different BRDF models, same properties
- **A/B testing**: Side-by-side with preserved accumulation

## File Organization

```
src/
├── math/              # Utilities
├── engine/            # Infrastructure
├── app/              # Orchestration
├── world/            
│   ├── geometry/     # Modules
│   ├── scene/        # Modules  
│   ├── materials/    # Modules (properties only!)
│   ├── lights/       # Modules
│   └── objects/      # Building blocks (not modules)
└── photography/      
    ├── cameras/      # Modules
    ├── transport/    # Modules (algorithms)
    ├── interaction/  # Modules (physics)
    ├── films/        # Modules
    └── developers/   # Modules
```

## Key Benefits of New Architecture

1. **Clear Separation**: Data (World) vs Behavior (Photography)
2. **Research Flexibility**: Swap algorithms without changing data
3. **Optimization**: Aggressive compile-time specialization
4. **Debugging**: Manual prefixes make code self-documenting
5. **Performance**: Property batching, no virtual dispatch
6. **Experimentation**: Mix and match Transport/Interaction independently
