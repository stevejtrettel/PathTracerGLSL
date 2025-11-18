# Object Type Library and Scene Compilation – Problem Description

## 1. Goal and Scope

We need to design a **library of geometric object types** (primarily SDFs, but also algebraic varieties, analytic primitives, etc.) that can be:

1. **Easily instantiated** in scene descriptions with clean, parameter-focused syntax
2. **Efficiently compiled** to GLSL functions that implement the Scene module contract
3. **Extended** with new types without modifying compilation infrastructure

This document describes the problem space and desired API, without prescribing a particular solution architecture.

---

## 2. Scene Description Requirements

### 2.1. Desired Scene Description Style

Scene authors should be able to write clean, declarative descriptions like:

```typescript
const scene = {
  objects: [
    {
      id: 'globe',
      geometry: {
        type: 'snow_globe',
        center: [0, 1, 0],
        outer_radius: 1.2,
        glass_thickness: 0.08,
        water_level: 0.75,
        base_height: 0.15
      },
      materials: {
        exterior_material: 'air',
        glass_material: 'glass',
        water_material: 'snow_water',
        air_material: 'air',
        base_material: 'wood'
      }
    },
    {
      id: 'simple_sphere',
      geometry: {
        type: 'sphere',
        center: [3, 0, 0],
        radius: 0.5
      },
      material: 'gold'  // single-material objects use 'material'
    }
  ]
};
```

**Key properties:**
- `type` references a known object type from the library
- Parameters are expressed as simple values (arrays, numbers)
- No GLSL code at the scene level (except for 'custom' type)
- Single-material objects use `material`, multi-region objects use `materials` map
- Material names reference a separate material registry

### 2.2. Parameter System Integration

The scene description must integrate with the existing parameter system, which supports:
- **Constants**: Direct values inlined into GLSL
- **Uniforms**: Values that can change without recompilation
- **Procedural**: GLSL expressions evaluated at runtime

**Open question:** How should parameter references be expressed in scene descriptions?

Option A: Explicit parameter objects
```typescript
geometry: {
  type: 'sphere',
  center: { param: 'globe_center' },  // references a uniform
  radius: 1.5  // constant
}
```

Option B: Parameter path syntax
```typescript
geometry: {
  type: 'sphere',
  center: params.globe_center,  // references a uniform
  radius: 1.5  // constant
}
```

Option C: String-based references
```typescript
geometry: {
  type: 'sphere',
  center: 'params.globe_center',
  radius: 1.5
}
```

**Requirements:**
- Scene author should be able to choose whether a value is constant or uniform
- Parameter expressions (e.g., `base_radius * 1.5`) should be supported
- The choice should integrate naturally with TypeScript scene description syntax

### 2.3. Material Assignment

Single-material objects:
```typescript
{
  geometry: { type: 'sphere', ... },
  material: 'gold'
}
```

Multi-region objects:
```typescript
{
  geometry: { type: 'snow_globe', ... },
  materials: {
    exterior_material: 'air',
    glass_material: 'glass',
    water_material: 'snow_water',
    air_material: 'air',
    base_material: 'wood'
  }
}
```

The material slot names (`exterior_material`, `glass_material`, etc.) are defined by the object type definition.

Materials can be defined inline or referenced from a global registry:
```typescript
material: 'gold'  // reference to registry

material: {  // inline definition
  type: 'metal',
  albedo: [1.0, 0.84, 0.0],
  roughness: 0.2
}
```

---

## 3. Object Type Library Structure

### 3.1. Type Definitions

Each object type in the library must specify:

1. **Name**: Unique identifier (e.g., `'sphere'`, `'snow_globe'`)

2. **Parameter schema**: What parameters does this type need?
    - Name, type (float, vec3, etc.), default values
    - Whether parameters are required or optional

3. **Material slots**:
    - Simple types: single `'material'` slot
    - Multi-region types: named slots for each region (e.g., `'glass_material'`, `'water_material'`)

4. **Region definitions** (for multi-region types):
    - Region IDs and names
    - Which material slot each region uses

5. **GLSL code generation**:
    - How to generate the distance function
    - How to generate the region classifier (for multi-region types)

### 3.2. Example Type: Simple Sphere

```typescript
{
  name: 'sphere',
  parameters: [
    { name: 'center', type: 'vec3', default: [0, 0, 0] },
    { name: 'radius', type: 'float', default: 1.0 }
  ],
  materialSlots: ['material'],
  glsl: {
    distance: (params) => `
      return length(p - ${params.center}) - ${params.radius};
    `
  }
}
```

### 3.3. Example Type: Multi-Region Snow Globe

```typescript
{
  name: 'snow_globe',
  parameters: [
    { name: 'center', type: 'vec3', default: [0, 0, 0] },
    { name: 'outer_radius', type: 'float', default: 1.0 },
    { name: 'glass_thickness', type: 'float', default: 0.05 },
    { name: 'water_level', type: 'float', default: 0.8 },
    { name: 'base_height', type: 'float', default: 0.2 }
  ],
  regions: [
    { id: 0, name: 'exterior', materialSlot: 'exterior_material' },
    { id: 1, name: 'glass', materialSlot: 'glass_material' },
    { id: 2, name: 'water', materialSlot: 'water_material' },
    { id: 3, name: 'air_bubble', materialSlot: 'air_material' },
    { id: 4, name: 'base', materialSlot: 'base_material' }
  ],
  glsl: {
    distance: (params) => `
      vec3 centered = p - ${params.center};
      return length(centered) - ${params.outer_radius};
    `,
    regionClassifier: (params) => `
      vec3 centered = p - ${params.center};
      float r = length(centered);
      float outer_r = ${params.outer_radius};
      float inner_r = outer_r - ${params.glass_thickness};
      
      if (r > outer_r) return 0;
      if (r > inner_r) return 1;
      
      float water_cutoff = ${params.center}.y + ${params.water_level} * inner_r;
      if (centered.y < water_cutoff - ${params.base_height}) {
        return 2;
      }
      if (centered.y < water_cutoff) {
        return 4;
      }
      return 3;
    `
  }
}
```

### 3.4. Special Case: Custom Type

For one-off custom SDFs, we need a 'custom' type that accepts raw GLSL:

```typescript
{
  id: 'weird_blob',
  geometry: {
    type: 'custom',
    parameters: {
      center: [0, 0, 0],
      scale: 1.0
    },
    glsl_distance: `
      vec3 q = p - center;
      float d1 = length(q) - scale;
      float d2 = length(q - vec3(0.3, 0, 0)) - 0.5 * scale;
      return smooth_union(d1, d2, 0.2);
    `
  },
  material: 'ceramic'
}
```

For custom multi-region SDFs:
```typescript
{
  geometry: {
    type: 'custom',
    parameters: { ... },
    glsl_distance: `...`,
    regions: [
      { id: 0, materialSlot: 'exterior_material' },
      { id: 1, materialSlot: 'interior_material' }
    ],
    glsl_region_classifier: `...`
  },
  materials: { ... }
}
```

---

## 4. Compilation Requirements

### 4.1. Generated GLSL Structure

For each object, the compiler must generate:

**1. Distance function**
```glsl
float sdf_{object_id}_distance(vec3 p) {
  // generated from type definition + parameters
}
```

**2. Region classifier** (for multi-region objects)
```glsl
int sdf_{object_id}_region_at(vec3 p) {
  // generated from type definition + parameters
}
```

**3. Parameter uniforms** (for non-constant parameters)
```glsl
uniform vec3 sdf_{object_id}_center;
uniform float sdf_{object_id}_radius;
```

**4. Material mapping data**

For single-material objects:
```glsl
const int sdf_{object_id}_material = 2;  // material ID
```

For multi-region objects:
```glsl
const int sdf_{object_id}_region_materials[N] = int[N](...);
```

### 4.2. Integration into Scene Module

These per-object functions must be integrated into:

1. **Marching kernel** that evaluates all SDF distances and picks minimum
2. **Interface resolution** that uses region classifiers to determine material_from/material_to
3. **scene_material_at** that queries which material exists at a point

### 4.3. Efficiency Requirements

- **Avoid redundant computation**: Multi-region objects should evaluate expensive SDF expressions once per query when possible
- **Minimize branching overhead**: Generated code should be branchless where possible
- **Parameter substitution**: Constants should be inlined; uniforms should use proper GPU uniform mechanism
- **Code size**: For scenes with many objects, avoid generating massive shaders (consider loops vs unrolling)

---

## 5. Type Library Organization

The type library should be organized to support:

1. **Easy addition of new types**: Adding a snow globe type shouldn't require modifying compilation code
2. **Discoverability**: Scene authors should be able to see what types are available
3. **Documentation**: Each type should document its parameters and behavior
4. **Categories**: Group related types (primitives, composite objects, etc.)

Possible organization:
```
/sdf-types/
  /primitives/
    sphere.ts
    box.ts
    cylinder.ts
    torus.ts
  /composite/
    snow-globe.ts
    cocktail-glass.ts
    wine-bottle.ts
  /special/
    custom.ts
  registry.ts  // central registry
  types.ts     // TypeScript type definitions
```

---

## 6. Open Design Questions

### 6.1. Parameter System Integration

How should scene descriptions reference uniforms vs constants?
- Explicit syntax `{ param: 'name' }` vs implicit via parameter system
- How to express parameter expressions (e.g., `base_radius * 1.5`)
- Type safety in TypeScript scene descriptions

### 6.2. GLSL Helper Functions

Many object types will need common SDF helpers (`sphere_sdf`, `smooth_union`, etc.):
- Should these be part of a standard preamble?
- Should type definitions declare dependencies?
- How do we avoid namespace collisions?

### 6.3. Code Generation Strategy

For scenes with many objects:
- When to unroll vs loop?
- How to balance code size vs performance?
- Should we generate specialized `scene_intersect` per scene, or use data-driven approach?

### 6.4. Multi-Region Optimization

For complex multi-region SDFs that compute expensive base fields:
- Can we generate code that evaluates base fields once and derives regions from cached results?
- Should type definitions provide hints about common subexpressions?
- Or accept some redundant computation as acceptable cost?

### 6.5. Type Composition

Should we support:
- CSG operations between object types (union, subtraction, intersection)?
- Transformations (scaling, rotation) at the type level?
- Instancing of complex types?

### 6.6. Validation and Error Handling

What validation should happen at scene description time vs compile time?
- Type checking parameters
- Verifying material slots are filled
- Checking for parameter name collisions
- Validating GLSL syntax in custom types

---

## 7. Success Criteria

A successful design will:

1. **Allow clean scene descriptions**: Scene author writes minimal, declarative code without GLSL
2. **Generate efficient GLSL**: Compiled code is tight, avoids redundancy, uses GPU efficiently
3. **Support extensibility**: Adding new object types is straightforward, doesn't break existing types
4. **Integrate with parameter system**: Uniforms, constants, and expressions work naturally
5. **Handle complexity**: Multi-region objects, custom SDFs, and various parameter patterns all work
6. **Maintain type safety**: TypeScript catches errors at scene description time where possible
7. **Scale to many objects**: System handles scenes with dozens or hundreds of objects without exploding shader size

---

## 8. Related Problems

This design interacts with:

- **Material compilation**: How material IDs are assigned and how material properties are queried
- **Scene module integration**: How generated SDF functions integrate with marching kernel and interface resolution
- **Parameter system**: How uniforms are bound and updated
- **World compilation**: Overall orchestration of scene, material, and lighting compilation

This document focuses specifically on the **object type library and instantiation** problem, leaving broader scene compilation architecture for separate consideration.
