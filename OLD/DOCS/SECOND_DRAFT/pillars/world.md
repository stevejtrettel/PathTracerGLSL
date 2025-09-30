# World Pillar Overview

## Purpose

The World pillar defines the **mathematical and physical reality** that exists independent of observation. It encompasses geometry, objects, their arrangement, material properties, and light sources - everything that exists before we choose how to look at it.

## Core Philosophy

World modules describe **what exists**, not how we see it. This separation is fundamental: a glass sphere in hyperbolic space exists as a mathematical entity with specific properties. How light travels through it, whether we use delta tracking or ray marching, whether we visualize it as a normal map or a rendered image - these are Photography's concerns, not World's.

## The Five Components

### 1. Geometry: The Mathematical Foundation

Geometry defines the differential geometric structure of space itself. This is pure mathematics:

- **Geodesics**: How light travels in straight lines (which may be curved!)
- **Metric tensor**: How to measure angles and distances
- **Parallel transport**: How vectors change when moved through curved space
- **Frame construction**: Local coordinate systems

Geometry is **always hand-written** because it represents fundamental mathematical truths that don't change with scene content. A hyperbolic space is hyperbolic regardless of what objects inhabit it.

### 2. Objects: Shapes and Material Assignment

Objects define individual geometric entities and their material composition. Critically, objects own:

- **Shape** (SDF, isosurface, mesh)
- **Material assignment** (which MaterialID at each point)

But NOT:
- **Material properties** (what that material looks like)
- **Shading behavior** (how light interacts with it)

This separation enables powerful capabilities:
```glsl
// One object definition
float glass_sphere_sdf(vec3 p) { return length(p) - 1.0; }
int classify_glass_sphere(vec3 p) { 
  return glass_sphere_sdf(p) < 0 ? MATERIAL_GLASS : MATERIAL_AIR;
}

// Can be instantiated with different material parameters
// without changing the object definition
```

Objects can be:
- **Simple**: Single material throughout
- **Multi-region**: Different materials in different regions (shell, core)
- **Procedural**: Material assignment based on position, noise, etc.

### 3. Scene: Spatial Organization and Material Interfaces

The Scene module arranges objects in space and **resolves material interfaces**. This is where the critical architectural innovation of **nearby object tracking** happens.

#### The Nearby Object System

Instead of checking all objects to resolve material boundaries, Scene tracks only the 3 nearest objects:

```glsl
struct NearbyObjects {
  float dists[3];  // Distances to 3 closest
  int ids[3];      // Their IDs
  int count;       // How many within threshold
};
```

This elegantly solves the material interface problem:
- **90%+ of rays**: Only one object nearby, trivial material resolution
- **Boundaries**: 2-3 objects nearby, quick resolution
- **Never**: Need to check all objects in scene

Scene generates **dispatch functions** that route to object-specific code:
```glsl
float eval_object_sdf(int obj_id, vec3 p) {
  switch(obj_id) {
    case 0: return sphere_0_sdf(p);
    case 1: return box_1_sdf(p);
    // Generated for all world
  }
}
```

### 4. Materials: Physical Properties

Materials map MaterialIDs to physical properties and scattering behavior. The architecture enforces **one material module per scene** - you choose Disney BRDF or Lambert or your custom model, not a mix.

#### MaterialIDs as Indices

MaterialIDs are just integers that index into parameter tables:
```glsl
// All materials use same BRDF, different parameters
MaterialParams params[NUM_MATERIALS] = {
  {albedo: vec3(0.8,0.2,0.2), roughness: 0.3},  // ID 0
  {albedo: vec3(0.9,0.9,0.9), roughness: 0.1},  // ID 1
};
```

#### The Three-Way Interface

Materials provide three functions that define local scattering:
- **evaluate**: Given incident and outgoing directions, what's the BSDF value?
- **sample**: Given incident direction, sample an outgoing direction
- **pdf**: What's the probability of that sample?

Materials do NOT:
- Decide how to integrate through volumes
- Implement transport algorithms
- Handle material boundaries

For volumes, materials only provide **properties**:
- Scattering coefficients
- Absorption coefficients
- Phase functions

The **integration strategy** (delta tracking, ray marching, etc.) belongs to the Estimator in Photography.

### 5. Lights: Illumination Sources

Lights define where photons originate. They provide:
- **Sampling strategies** for importance sampling
- **Evaluation** of radiance from directions
- **PDFs** for multiple importance sampling

Complex lights (environment maps) benefit from build-time optimization - precomputing CDFs for importance sampling.

## Build-Time Optimization Strategy

World modules are **generated and optimized at scene load time**, not runtime:

### 1. Analysis Phase
```typescript
// What's actually used in this scene?
const analysis = {
  usedMaterialIds: [0, 1, 2],
  hasRoughness: true,
  hasVolumes: false,
  hasClearcoat: false
};
```

### 2. Generation Phase
Based on analysis, generate optimized GLSL:
- **Dead code elimination**: No clearcoat code if no clearcoat materials
- **Constant folding**: If all roughness = 0.5, compile as constant
- **Unrolled loops**: For small object counts
- **Specialized dispatch**: Direct switch statements

### 3. Result
Shaders contain **only what's needed**:
- 30-70% fewer instructions
- Better GPU occupancy
- No runtime branching for unused features

## Material Interface Resolution

The complete flow for determining material at boundaries:

1. **Objects** define shape and assign MaterialIDs
2. **Scene** tracks nearby objects during marching
3. **At intersection**, Scene resolves material interface:
    - Samples points on both sides of surface
    - Queries only 2-3 nearby objects
    - Determines material_from and material_to
4. **Materials** provide properties for those MaterialIDs

This is efficient because:
- Each component has one job
- Nearby tracking avoids scene-wide queries
- MaterialIDs are just integers
- Resolution happens once per intersection

## Key Design Principles

### 1. Separation of Concerns

- **Objects own shapes**, not shading
- **Scene owns arrangement**, not properties
- **Materials own properties**, not transport
- **Geometry owns space**, not content

### 2. Compile-Time Over Runtime

Everything that can be decided at build time is:
- Feature selection
- Constant values
- Loop unrolling
- Dead code elimination

### 3. Universal Interface Tracking

Every ray-surface interaction is a transition between materials:
```glsl
struct Hit {
  int material_from;  // What ray exits
  int material_to;    // What ray enters
  float ior_ratio;    // Precomputed
};
```

This uniformly handles:
- Entering objects
- Exiting objects
- Internal boundaries
- Nested dielectrics

### 4. Hybrid Implementation

- **Hand-written**: Geometry (pure math), simple lights
- **Generated**: Scene (from object arrangement), Materials (from analysis)
- **Both**: Objects can be either

## Why This Architecture?

### Research Flexibility

- Test new materials without changing objects
- Compare transport algorithms without changing materials
- Add new geometries without touching existing code

### Performance

- Specialized shaders for each scene
- No unused code
- Efficient boundary resolution
- Compile-time optimization

### Clarity

- Each module has one clear purpose
- Dependencies flow in one direction
- No hidden coupling between components

### Extensibility

- Easy to add new object types
- New materials just need three functions
- Scene generation handles arbitrary complexity

## Implementation Flow

1. **Define geometry space** (hand-written)
2. **Create objects** (hand-written or procedural)
3. **Arrange in scene** (build-time generation)
4. **Analyze material usage** (automatic)
5. **Generate optimized materials** (build-time)
6. **Setup lights** (hand-written or generated)

## Summary

The World pillar defines mathematical and physical reality through five components with clear responsibilities. The architecture's key insights are:

1. **Materials don't own transport** - they provide properties, estimators decide integration
2. **Nearby object tracking** - efficiently resolve boundaries with 2-3 objects, not entire scene
3. **Build-time optimization** - generate specialized code for actual usage
4. **MaterialIDs as indices** - one BRDF type per scene, parameters vary by ID

This separation creates a system where mathematical reality exists independent of how it's observed, enabling both research flexibility and production performance.
