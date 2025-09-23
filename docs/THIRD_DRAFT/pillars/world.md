# World Pillar: Complete System Overview

## Executive Summary

The World pillar defines mathematical and physical reality independent of observation. It provides three modules to the rendering engine:

1. **Geometry Module** (hand-written): Mathematical structure of space
2. **Scene Module** (compiled): Objects, material properties, intersection
3. **Lighting Module** (compiled): Light sampling strategies

The key innovation is that Scene and Lighting modules are compiled from high-level descriptions, with a cross-referencing step that ensures emissive objects become lights and visible lights become geometry.

## System Architecture

```
Scene Description + Light Description
              ↓
         WorldCompiler
              ↓
    ┌─────────┬─────────┐
    │         │         │
Geometry   Scene    Lighting
Module    Module    Module
```

The WorldCompiler orchestrates the entire pipeline, transforming user-friendly descriptions into optimized GLSL modules.

## The Three Modules

### 1. Geometry Module

Hand-written mathematical foundations that define the structure of space itself:

```glsl
// Differential geometry operations
Point geometry_geodesic(Point origin, Direction dir, float t)
float geometry_distance(Point a, Point b)
Frame geometry_frame(Point p, Normal n)
float geometry_dot(Direction u, Direction v, Point p)
```

These represent mathematical invariants - they don't change with scene content. We maintain a library: `euclidean.glsl`, `hyperbolic.glsl`, `spherical.glsl`.

### 2. Scene Module

Compiled from object and material descriptions, provides:

```glsl
// Intersection queries
bool scene_intersect(Ray ray, out Hit hit)
bool scene_intersect_any(Ray ray, float max_t)

// Material data (properties only, no BSDFs!)
MaterialProperties scene_material_properties(int mat_id, Point p)
int scene_material_at(Point p)

// Scene information
float scene_bounding_radius()
```

The Scene module knows about geometry and material properties, but not how light behaves - that's Photography's domain.

### 3. Lighting Module

Compiled from light descriptions and emissive objects, provides:

```glsl
// Sampling
LightSample lighting_sample(Point p, vec2 xi)
float lighting_pdf(Point p, Direction wi)

// Light information
int lighting_count()
bool lighting_has_environment()
Spectrum lighting_environment(Direction dir)
```

## Material System

Materials are **purely data containers** with no behavior:

```glsl
struct MaterialProperties {
  vec3 albedo;
  float roughness;
  float metallic;
  float ior;
  vec3 emission;        // Can be non-zero for emissive objects
  float emission_strength;
  int flags;            // DIELECTRIC | PARTICIPATING | etc.
}
```

Key principle: Materials provide properties, Photography implements physics. The Scene module never evaluates BRDFs, never samples directions, never computes Fresnel. It only returns data.

## The Compilation Pipeline

### Phase 1: Input Parsing

Users write two descriptions:

```typescript
// Scene: objects and their materials
const sceneDescription = {
  objects: [
    { geometry: 'sphere', material: 'glass', transform: {...} }
  ],
  materials: new Map([
    ['glass', { albedo: [0.95, 0.95, 0.95], ior: 1.5, emission: [0,0,0] }]
  ])
};

// Lights: illumination sources
const lightDescription = {
  lights: [
    { type: 'point', position: [0,5,0], intensity: [100,100,100], visible: false }
  ],
  environment: { type: 'hdri', path: 'sky.exr' }
};
```

### Phase 2: Cross-Referencing

The WorldCompiler performs critical cross-referencing:

1. **Emissive objects → Lighting module**: Any object with non-zero emission becomes a light source
2. **Visible lights → Scene module**: Lights marked `visible: true` become geometric objects
3. **Material ID assignment**: Sequential IDs starting from 1 (0 reserved for air)

This happens internally in the WorldCompiler:

```typescript
private augment(scene: SceneDescription, lights: LightDescription) {
  // Find emissive objects
  const emissiveLights = scene.objects
    .filter(o => o.material.emission > 0)
    .map(o => this.objectToLight(o));
  
  // Find visible lights
  const lightObjects = lights.lights
    .filter(l => l.visible)
    .map(l => this.lightToObject(l));
  
  return {
    sceneInput: {
      objects: [...scene.objects, ...lightObjects],
      materials: [...scene.materials, ...lightMaterials]
    },
    lightingInput: {
      lights: [...lights.lights, ...emissiveLights],
      environment: lights.environment
    }
  };
}
```

### Phase 3: Module Compilation

Two specialized compilers generate optimized GLSL:

#### SceneCompiler

Takes objects and materials, generates:
- Object SDF functions
- Dispatch mechanisms
- Ray marching loops
- Material property lookups

Optimizations:
- Unroll loops for <5 objects
- Fold constants when properties uniform
- Eliminate unused material properties
- Skip transforms for objects at origin

#### LightingCompiler

Takes lights (including emissive objects), generates:
- Specific samplers per light type
- Importance sampling strategies
- PDF evaluation functions
- Environment map sampling

Optimizations:
- Direct sampling for single light
- Power-based selection for multiple lights
- Analytic samplers for simple shapes
- Bbox fallback for complex emitters

### Phase 4: Module Assembly

The WorldCompiler returns three modules:

```typescript
interface CompiledWorld {
  geometry: ModuleDescriptor;   // Hand-written
  scene: ModuleDescriptor;      // From SceneCompiler
  lighting: ModuleDescriptor;   // From LightingCompiler
  metadata: {
    materialCount: number;
    lightCount: number;
    hasEmissive: boolean;
  };
}
```

## Example Flow

### Simple Scene
```typescript
// User: sphere with point light
scene.objects = [{ geometry: 'sphere', material: 'red' }];
lights.lights = [{ type: 'point', position: [0,5,0] }];
```

### After Cross-Reference
```typescript
// SceneCompiler receives:
objects: [sphere]  // Just the sphere
materials: [red]   // Non-emissive

// LightingCompiler receives:
lights: [point]    // Just the point light
```

### Complex Scene
```typescript
// User: glowing sphere + visible area light
scene.objects = [{ 
  geometry: 'sphere', 
  material: 'hot_metal',  // emission: [10, 5, 2]
}];
lights.lights = [{ 
  type: 'quad',
  vertices: [...],
  visible: true  // Will appear in scene
}];
```

### After Cross-Reference
```typescript
// SceneCompiler receives:
objects: [sphere, quad]     // Quad added as geometry
materials: [hot_metal, light_material]  // Light gets material

// LightingCompiler receives:
lights: [quad, sphere_emitter]  // Sphere added as light
```

## Key Design Decisions

### Why Separate Scene and Lighting?

1. **Different concerns**: Geometry vs. sampling strategies
2. **Flexibility**: Swap lighting without recompiling geometry
3. **Optimization**: Each compiler optimizes for its domain
4. **Clarity**: Clean separation of responsibilities

### Why Compile Instead of Hand-Write?

1. **Optimization**: Scene-specific code with no waste
2. **Correctness**: No manual synchronization errors
3. **Productivity**: High-level descriptions vs. GLSL
4. **Consistency**: Material IDs managed automatically

### Why Materials Don't Include BSDFs?

1. **Separation**: Data (World) vs. behavior (Photography)
2. **Research flexibility**: Same properties, different BRDFs
3. **Clean dependencies**: World never depends on Photography
4. **Performance**: Compile-time optimization of property access

## Integration with Engine

The Engine concatenates modules in order:

```glsl
[Common Types]
[Geometry Module]      // Mathematical foundation
[Scene Module]         // Objects and materials
[Lighting Module]      // Sampling strategies
[Camera Module]        // From Photography
[Transport Module]     // From Photography
[Interaction Module]   // BRDFs (uses material properties)
[Film Module]          // From Photography
[Developer Module]     // From Photography
[Main Function]
```

Transport queries Scene for intersections and materials, queries Lighting for samples, and Interaction queries Scene for material properties to evaluate BRDFs.

## Benefits

1. **Automatic cross-referencing**: Emissive objects become lights automatically
2. **Optimization**: Each scene gets specifically optimized code
3. **Consistency**: Material IDs managed by compiler
4. **Modularity**: Clean interfaces between components
5. **Debugging**: Generated code is readable and inspectable

## Summary

The World pillar combines hand-written mathematical truth (Geometry) with compiled physical reality (Scene and Lighting). The WorldCompiler orchestrates the transformation from user-friendly descriptions to optimized GLSL, handling all cross-referencing between emissive objects and lights. Materials are pure data containers, with all light physics delegated to Photography's Interaction module. This architecture enables aggressive optimization while maintaining clean separation between what exists (World) and how we observe it (Photography).
