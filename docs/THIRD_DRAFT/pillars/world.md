# World Pillar Overview

## Purpose

The World pillar defines the **mathematical and physical reality** that exists independent of observation. It encompasses geometry, objects, their arrangement, material properties, and light sources - everything that exists before we choose how to look at it.

## Core Philosophy

World modules describe **what exists**, not how we see it or how light behaves. This separation is fundamental: a glass sphere in hyperbolic space exists as a mathematical entity with specific properties (refractive index, surface roughness). How light refracts through it, whether we use Fresnel equations or approximations, how we importance sample the BRDF - these are Photography's concerns, not World's.

## The Five Components

### 1. Geometry: The Mathematical Foundation

Geometry defines the differential geometric structure of space itself. This is pure mathematics:

- **Geodesics**: Straight lines in the space (which may be curved!)
- **Metric tensor**: How to measure angles and distances
- **Parallel transport**: How vectors change when moved through curved space
- **Frame construction**: Local coordinate systems

Geometry is **always hand-written** because it represents fundamental mathematical truths that don't change with scene content.

### 2. Objects: Building Blocks for Scene

Objects are **not modules** but building blocks that get compiled into the Scene module. 
They define shapes and material ID assignment using type-based naming conventions:
```glsl
// Objects use type-based naming, not module prefixes
float sphere_glass_sphere_distance(vec3 p)
int sphere_glass_sphere_material(vec3 p)
vec3 sphere_glass_sphere_normal(vec3 p)
```


### 3. Scene: Spatial Organization and Interface Resolution

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

Scene generates **dispatch functions** that route to object-specific code:
```glsl
float eval_object_sdf(int obj_id, vec3 p) {
  switch(obj_id) {
    case 0: return sphere_0_sdf(p);
    case 1: return box_1_sdf(p);
  }
}
```

### 4. Materials: Physical Properties Only

Materials is now **purely a data provider** with zero knowledge of light physics:

**Materials DOES provide:**
- Property queries via `material_get_properties()`
- Fast accessors like `material_get_ior()`
- Type flags (DIELECTRIC, PARTICIPATING, EMISSIVE)

**Materials NEVER provides:**
- BRDF evaluation functions ❌
- Sampling strategies ❌
- PDF calculations ❌
- Fresnel equations ❌
- Phase functions ❌
- ANY light interaction logic ❌

This is a hard boundary - all physics lives in Photography's Interaction module.


#### Properties as Data

Materials provide a query interface for properties:

```glsl
// The key function that Photography calls
MaterialProperties material_get_properties(int mat_id, vec3 p) {
  MaterialProperties props;
  
  // Surface properties (may be constant or varying)
  props.albedo = get_albedo(mat_id, p);
  props.roughness = get_roughness(mat_id, p);
  props.metallic = get_metallic(mat_id, p);
  props.ior = material_iors[mat_id];  // Often constant
  
  // Emission
  props.emission = get_emission(mat_id, p);
  props.emission_intensity = get_emission_intensity(mat_id, p);
  
  // Volume properties (if applicable)
  props.sigma_scatter = get_sigma_scatter(mat_id, p);
  props.sigma_absorb = get_sigma_absorb(mat_id, p);
  props.phase_g = phase_asymmetry[mat_id];
  
  return props;
}
```

#### Constant vs Spatially-Varying

Properties can be:
- **Constants**: Simple values in arrays
- **Textures**: UV-mapped from surface coordinates
- **Procedural**: Functions of position (noise, patterns)

```glsl
// Compile-time selection based on scene analysis
vec3 get_albedo(int mat_id, vec3 p) {
  #if ALBEDO_VARYING
    // Procedural or texture lookup
    return texture_lookup(mat_id, p);
  #else
    // Simple array lookup
    return material_albedo[mat_id];
  #endif
}
```

Materials do NOT provide:
- BRDF evaluation functions
- Sampling strategies
- Phase functions
- Any light interaction logic

All interaction physics moved to Photography's Interaction module.

### 5. Lights: Illumination Sources

Lights define where photons originate. They provide:
- **Sampling strategies** for importance sampling
- **Evaluation** of radiance from directions
- **PDFs** for multiple importance sampling

## Build-Time Optimization Strategy

World modules are **generated and optimized at scene load time**:

### 1. Analysis Phase
```typescript
const analysis = {
  materialProperties: {
    hasVaryingAlbedo: true,
    hasVaryingRoughness: false,
    hasVolumes: false,
    hasEmission: true
  },
  propertyRanges: {
    roughness: [0.1, 0.1],  // All same - make constant
    ior: [1.0, 1.5, 1.33]   // Varying - need array
  }
};
```

### 2. Generation Phase
Generate optimized property accessors:
- **Constant folding**: If all materials have roughness = 0.5, compile as constant
- **Dead code elimination**: No volume queries if no volumes
- **Texture atlasing**: Pack all textures efficiently
- **Procedural inlining**: Inline simple noise functions

## The Property Query Architecture

The `material_get_properties()` function is the key interface between World and Photography:

### Compile-Time Optimization
Based on scene analysis, the compiler generates specialized versions:

```glsl
// Scene with only constant properties (fast path)
MaterialProperties material_get_properties(int mat_id, vec3 p) {
  return constant_properties[mat_id];
}

// Scene with some varying properties
MaterialProperties material_get_properties(int mat_id, vec3 p) {
  MaterialProperties props = constant_properties[mat_id];
  #if HAS_VARYING_ALBEDO
    props.albedo = sample_albedo_texture(mat_id, p);
  #endif
  return props;
}
```

### Batched Access
Photography gets all properties in one call, avoiding multiple queries:
- More efficient memory access
- Better GPU utilization
- Clearer interface

## Material Interface Resolution

The complete flow for determining material at boundaries:

1. **Objects** define shape and assign MaterialIDs
2. **Scene** tracks nearby objects during marching
3. **At intersection**, Scene resolves interface:
    - Determines material_from and material_to
4. **Materials** provide properties for those IDs via `material_get_properties()`
5. **Photography** uses properties to compute light interaction

## Key Design Principles

### 1. Separation of Data and Behavior

- **World owns data**: Properties, positions, shapes
- **Photography owns behavior**: How light interacts with that data

### 2. Single Query Interface

Materials expose one key function that returns all properties:
- Simple, clear contract
- Efficient batching
- Easy to optimize

### 3. Build-Time Specialization

Property accessors are specialized based on actual usage:
- Constant properties become literals
- Unused properties are eliminated
- Texture accesses are optimized


## Function Naming Conventions

World uses **manual function prefixing** for clarity and to avoid naming conflicts:

- **Geometry**: `geometry_*` (geometry_geodesic, geometry_frame)
- **Scene**: `scene_*` (scene_intersect, scene_get_material)
- **Materials**: `material_*` (material_get_properties, material_get_ior)
- **Lights**: `light_*` (light_sample, light_evaluate)
- **Objects**: Type-based naming (sphere_*, box_*, torus_*)

This explicit prefixing makes the code self-documenting and enables fixed concatenation order without complex dependency resolution.

## Why This Architecture?

### Clarity

- Materials are just data providers
- No confusion about where physics lives
- Clear one-way dependency

### Performance

- Batched property access
- Compile-time optimization
- No virtual dispatch for properties

### Flexibility

- Easy to add new properties
- Photography modules can interpret properties differently
- Same material data works with different interaction models

## Implementation Flow

1. **Define geometry space** (hand-written)
2. **Create objects** with material IDs (hand-written or procedural)
3. **Arrange in scene** (build-time generation)
4. **Analyze material properties** (automatic)
5. **Generate property accessors** (build-time)
6. **Setup lights** (hand-written or generated)

## Summary

The World pillar defines reality through five components, with Materials now simplified to pure property providers. The key architectural change is that **Materials no longer implement light interaction** - they only provide the data (albedo, roughness, scattering coefficients) that Photography's Interaction module will use to compute how light behaves.

The `material_get_properties()` function serves as the clean interface between World's data and Photography's algorithms, returning all material properties in a single, efficient query that can be optimized at compile time based on scene analysis.

---

Regarding your question about where `material_get_properties()` lives: it should be **part of the Materials module**. The Materials module is generated at build time and includes:
1. The property data (arrays, texture references)
2. The accessor functions (get_albedo, get_roughness, etc.)
3. The main `material_get_properties()` function that packages everything

This keeps all material data access in one place and allows for compile-time optimization based on what properties are actually varying in the scene.
