# Core Principles & Shared Concepts

## Architectural Principles

### 1. Separation of Concerns
Each pillar has exclusive responsibilities:
- **World**: Defines *what exists* - data only (no physics, no behavior)
- **Photography**: Defines *how we observe* - all physics and algorithms
- **Engine**: Provides *infrastructure* (no research logic)
- **App**: Orchestrates *experiments* (no GPU calls)
- **Math**: Provides *utilities* (no state or contracts)

### 2. Compilation vs Hand-Writing
Modules fall into two categories:
- **Compiled**: Scene, Lighting (from descriptions, optimized at build-time)
- **Hand-written**: Geometry, Camera, Transport, Interaction, Film, Developer

Compilation enables aggressive optimization and automatic cross-referencing.

### 3. Determinism & Reproducibility
Given fixed inputs (recipe, seed, environment), output is identical:
- Random sampling explicitly seeded and dimensioned
- All floating point operations IEEE-compliant
- Parameter changes tracked and logged
- No undefined behavior or race conditions

### 4. Ownership Rules
Clear ownership prevents architectural confusion:
- **WorldCompiler owns cross-referencing**: Emissive objects → lights, visible lights → geometry
- **SceneCompiler owns geometry**: Object SDFs, intersection, material properties
- **LightingCompiler owns sampling**: Light sampling strategies, PDFs
- **Transport owns integration**: Path tracing, delta tracking strategies
- **Interaction owns physics**: BRDF evaluation, phase functions, Fresnel
- **Engine owns GPU state**: All WebGL operations
- **App owns orchestration**: Recipe and parameter management

### 5. The Critical Separation
**Data vs Behavior** is the core architectural principle:
- **World = Data**: Shapes, material properties, light parameters
- **Photography = Behavior**: How light interacts with that data
- Scene NEVER implements physics (no BRDFs)
- Lighting NEVER implements materials (only sampling)
- Interaction NEVER stores properties (queries Scene)

### 6. Error & Fallback Policy
- **Fatal errors**: Shader compilation, out-of-memory → stop
- **Recoverable errors**: Missing parameters → use defaults with warning
- **Research errors**: NaN/Inf samples → clamp to black, count, continue
- **Capability fallbacks**: Missing HDR → suggest LDR alternatives
- **Context loss**: Warn about accumulation loss, attempt recovery

### 7. Performance Philosophy
Optimize at compile-time, not runtime:
- Scene-specific code generation
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
    kind: string;     // "geometry", "scene", "lighting", etc.
    name: string;     // "euclidean", "compiled_12345", etc.
    version: string;  // "1.0.0"
  };
  
  fragment: {
    uniforms?: string;    // Parameter declarations
    functions: string;    // GLSL implementation
    constants?: string;   // #define statements
  };
  
  metadata?: {
    materialCount?: number;
    lightCount?: number;
    hasEmissive?: boolean;
  };
}
```

### Function Prefixing Convention

All modules use explicit prefixes based on their **kind**:

| Module Kind | Prefix | Example Functions |
|------------|---------|-------------------|
| Geometry | `geometry_` | `geometry_geodesic()`, `geometry_frame()` |
| Scene | `scene_` | `scene_intersect()`, `scene_material_properties()` |
| Lighting | `lighting_` | `lighting_sample()`, `lighting_pdf()` |
| Camera | `camera_` | `camera_generateRay()` |
| Transport | `transport_` | `transport_trace()` |
| Interaction | `interaction_` | `interaction_surface_shade()` |
| Film | `film_` | `film_accumulate()` |
| Developer | `developer_` | `developer_develop()` |

### Cross-Module Communication
Modules call each other using prefixes:

```glsl
// Transport orchestrates the pipeline
Spectrum transport_trace(Ray ray) {
  Hit hit;
  
  // Call Scene for intersection
  if (scene_intersect(ray, hit)) {
    // Get material properties from Scene
    MaterialProperties props = scene_material_properties(hit.material_to, hit.p);
    
    // Call Lighting for direct illumination
    LightSample ls = lighting_sample(hit.p, xi);
    
    // Call Interaction for physics
    Spectrum f = interaction_surface_shade(-ray.direction, ls.wi, hit);
  }
}
```

## Material Architecture

### Pure Data Model

Materials in the Scene module are **pure property containers**:

```glsl
struct MaterialProperties {
  // Surface properties
  vec3 albedo;
  float roughness;
  float metallic;
  float ior;
  
  // Emission (can be non-zero)
  vec3 emission;
  float emission_intensity;
  
  // Volume properties
  vec3 sigma_scatter;
  vec3 sigma_absorb;
  float phase_g;
  
  // Type flags
  int flags;  // DIELECTRIC | PARTICIPATING | EMISSIVE
}

// Scene provides properties only
MaterialProperties scene_material_properties(int mat_id, Point p);
```

### Physics in Interaction

All light-matter physics lives in Photography's Interaction module:

```glsl
// Interaction implements physics using Scene's data
Spectrum interaction_surface_shade(Direction wi, Direction wo, Hit hit) {
  // Query properties from Scene
  MaterialProperties props = scene_material_properties(hit.material_to, hit.p);
  
  // Implement BRDF using properties
  float alpha = props.roughness * props.roughness;
  // ... Disney/Lambert/etc calculation
}
```

## Compilation Architecture

### WorldCompiler Pipeline

```
Scene Description + Light Description
              ↓
    WorldCompiler.augment()
              ↓
  Cross-referenced inputs
              ↓
    SceneCompiler + LightingCompiler
              ↓
    Three modules: Geometry, Scene, Lighting
```

### Cross-Referencing Rules

The WorldCompiler automatically:
1. **Emissive → Lights**: Objects with `emission > 0` become light sources
2. **Visible Lights → Geometry**: Lights with `visible: true` become objects
3. **Material IDs**: Sequential assignment starting from 1 (0 = air)

### Compilation Optimizations

SceneCompiler optimizations:
- Unroll loops for <5 objects
- Fold constants for uniform properties
- Eliminate unused material fields
- Inline simple SDFs

LightingCompiler optimizations:
- Direct call for single light
- Power-based importance sampling
- Analytic samplers for simple shapes
- Bbox fallback for complex emitters

## Shared Types

### Core Types
```glsl
typedef vec3 Spectrum;   // Wavelength-dependent radiance
typedef vec3 Radiance;   // What films accumulate  
typedef vec3 RGB;        // Display output
typedef vec3 Point;      // Position in space
typedef vec3 Direction;  // Unit vector
typedef vec3 Normal;     // Surface normal
```

### Hit Structure
```glsl
struct Hit {
  // Geometry
  Point p;              // Hit point
  Normal n;             // Normal
  float t;              // Ray parameter
  vec2 uv;              // Texture coordinates
  
  // Frame
  Frame frame;          // Orthonormal basis
  
  // Material interface
  int material_from;    // Material we're leaving
  int material_to;      // Material we're entering
  
  // Object identity
  int object_id;
}
```

### LightSample Structure
```glsl
struct LightSample {
  Point point;          // Point on light
  Direction wi;         // Direction to light
  Spectrum radiance;    // Emitted radiance
  float pdf;           // Sampling PDF
  float distance;      // Distance to light
  int light_id;        // Which light
}
```

## Technical Patterns

### Property Access Pattern
Always batch property queries:
```glsl
// Good - single query
MaterialProperties props = scene_material_properties(mat_id, p);

// Bad - would require multiple functions (don't do)
vec3 albedo = scene_get_albedo(mat_id, p);  // NO!
```

### Compile-Time Specialization
Generated code adapts to scene:
```glsl
// If all materials have roughness = 0.5
#define CONST_ROUGHNESS 0.5

// If scene has no volumes
// All volume code eliminated
```

### Multiple Importance Sampling
Transport combines sampling strategies:
```glsl
// Sample lights (Lighting module)
LightSample ls = lighting_sample(p, xi);

// Sample BRDF (Interaction module)
Direction wo = interaction_surface_scatter(wi, hit, xi, pdf);

// Combine with MIS weights
weight = balance_heuristic(light_pdf, brdf_pdf);
```

## Performance Characteristics

### Compile-Time Costs
- Scene analysis: O(objects + materials)
- Code generation: O(objects)
- Optimization passes: O(code size)
- Total: <100ms for typical scenes

### Runtime Benefits
- No dynamic dispatch
- Minimal branching
- Optimized memory layout
- Cache-friendly access patterns
- Zero overhead abstractions

## Debug Support

### Debug Visualization Modes
- `DEBUG_NORMALS`: Surface normals
- `DEBUG_MATERIALS`: Material IDs as colors
- `DEBUG_PROPERTIES`: Specific properties (roughness, metallic)
- `DEBUG_LIGHTS`: Light sampling density
- `DEBUG_INTERSECTION`: Ray march step count

## Key Architecture Benefits

1. **Automatic Cross-referencing**: Emissive objects and visible lights handled automatically
2. **Compile-Time Optimization**: Scene-specific code generation
3. **Clear Separation**: Data (World) vs Physics (Photography)
4. **Research Flexibility**: Swap algorithms independently
5. **Zero Boilerplate**: Descriptions compile to optimized GLSL
6. **Type Safety**: MaterialIDs managed by compiler
7. **Performance**: No runtime overhead from abstraction

This architecture enables:
- Writing scene descriptions instead of GLSL
- Automatic optimization based on actual scene content
- Clean separation between what exists and how light behaves
- Research into new algorithms without touching scene representation
