# Objects Pillar: Complete System Overview

## Purpose

The Objects pillar defines the **mathematical and physical reality** that exists independent of observation. It encompasses the ambient space, geometries, their arrangement, material properties, and light sources - everything that exists before we choose how to look at it.

## Core Philosophy

Objects modules describe **what exists**, not how we see it. This separation is fundamental: a glass sphere in hyperbolic space exists as a mathematical entity with specific properties. How light travels through it, whether we use delta tracking or ray marching, whether we visualize it as a normal map or a rendered image - these are Optics' concerns, not Objects'.

## System Architecture

```
Scene Description + Light Description
              ↓
         WorldCompiler
              ↓
    ┌─────────┬─────────┐
    │         │         │
AmbientSpace  Scene    Lighting
   Module    Module    Module
```

The WorldCompiler orchestrates the transformation from user-friendly descriptions to optimized GLSL, automatically handling the relationship between emissive materials and lights.

## The Three Core Modules

### 1. AmbientSpace Module: The Mathematical Foundation

AmbientSpace defines the differential geometric structure of space itself. This is pure mathematics:

```glsl
// Geodesics: How light travels in straight lines (which may be curved!)
Point ambient_geodesic(Point origin, Direction dir, float t)

// Metric tensor: How to measure angles and distances
float ambient_distance(Point a, Point b)
float ambient_dot(Direction u, Direction v, Point p)

// Parallel transport: How vectors change when moved through curved space
Direction ambient_parallel_transport(Direction v, Point from, Point to)

// Frame construction: Local coordinate systems
Frame ambient_frame(Point p, Normal n)
```

AmbientSpace is **always hand-written** because it represents fundamental mathematical truths that don't change with scene content. A hyperbolic space is hyperbolic regardless of what geometries inhabit it.

#### Example: Euclidean Ambient Space
```glsl
Point ambient_geodesic(Point origin, Direction dir, float t) {
  return origin + dir * t;  // Simple linear interpolation
}

float ambient_distance(Point a, Point b) {
  return length(a - b);  // Standard Euclidean distance
}
```

#### Example: Hyperbolic Ambient Space
```glsl
Point ambient_geodesic(Point origin, Direction dir, float t) {
  // Geodesics in Poincaré ball model
  float r = length(origin);
  float k = (1.0 - r*r) / 2.0;
  return (origin + k*t*dir) / (1.0 + k*t*dot(dir, origin));
}
```

We maintain a library: `euclidean.glsl`, `hyperbolic.glsl`, `spherical.glsl`.

### 2. Scene Module: Geometries and Materials

The Scene module provides geometric queries and material properties for all geometries in the scene. It tracks materials and their associated lights through a direct ID system.

#### Core Responsibilities

1. **Geometry Arrangement**: Spatial organization via SDFs
2. **Material Interface Resolution**: Determining material boundaries
3. **Light Association**: Materials know their light IDs directly

#### The Hit Structure (Simplified)

```glsl
struct Hit {
  // Geometric data
  Point p;
  Normal n;
  vec2 uv;
  float t;
  
  // Material interface (no geometry_id needed!)
  int material_from;    // Material we're leaving
  int material_to;      // Material we're entering
  
  // Frame
  Frame frame;
}
```

Note the absence of `geometry_id` - we don't need it because materials directly reference their lights.

#### Material Properties with Light References

```glsl
struct MaterialProperties {
  vec3 albedo;
  float roughness;
  float metallic;
  float ior;
  vec3 emission;
  float emission_strength;
  int light_id;  // KEY: Direct reference to light array (-1 if non-emissive)
  int flags;
}
```

#### Efficient Material Interface Resolution

The Scene module uses **nearby geometry tracking** to efficiently resolve material boundaries:

```glsl
struct NearbyGeometries {
  float dists[3];      // Distances to 3 closest
  int material_ids[3];  // Their material IDs
  int count;           // How many within threshold
};

// During ray marching
void march_ray(Ray ray, out Hit hit) {
  NearbyGeometries nearby;
  
  for (int step = 0; step < MAX_STEPS; step++) {
    Point p = ambient_geodesic(ray.origin, ray.direction, t);
    
    // Track only nearby geometries
    update_nearby_geometries(p, nearby);
    
    if (nearby.dists[0] < EPSILON) {
      // Resolve material interface using only 2-3 geometries
      resolve_materials(p, nearby, hit);
      return;
    }
  }
}
```

This elegantly solves the material interface problem:
- **90%+ of rays**: Only one geometry nearby, trivial resolution
- **Boundaries**: 2-3 geometries nearby, quick resolution
- **Never**: Need to check all geometries in scene

### 3. Lighting Module: Unified Light Management

The Lighting module manages all light sources uniformly, whether they originated as explicit lights or emissive materials.

#### Light Data Structure

```glsl
struct LightData {
  vec3 radiance;
  int sampling_type;  // SAMPLING_NONE, SAMPLING_POINT, SAMPLING_SPHERE, etc.
  vec4 param0;  // Position or other primary parameters
  vec4 param1;  // Additional parameters
}

// All lights in one array
uniform LightData u_lights[NUM_LIGHTS];
```

#### Sampling Capability

Lights fall into two categories:

1. **Samplable** (`sampling_type != SAMPLING_NONE`)
   - Can be explicitly sampled for next event estimation
   - Need MIS when hit via path tracing

2. **Path-only** (`sampling_type == SAMPLING_NONE`)
   - Too complex to sample (fractals, complex SDFs)
   - Only found by path tracing
   - No MIS needed (single strategy)

#### Direct Access Functions

```glsl
// Get light information by ID
LightData lighting_get_light(int light_id) {
  return u_lights[light_id];
}

// Check if light can be sampled
bool lighting_can_sample(int light_id) {
  return u_lights[light_id].sampling_type != SAMPLING_NONE;
}
```

## The Compilation Pipeline

### Phase 1: Light Collection and Unification

```typescript
private collectLights(scene: SceneDescription, lights: LightDescription): CompilerLight[] {
  const allLights: CompilerLight[] = [];
  
  // Explicit lights
  lights.lights.forEach(light => {
    allLights.push({
      id: light.id,
      radiance: light.intensity,
      sampling: determineSamplingStrategy(light),
      source: 'explicit_light'
    });
  });
  
  // Emissive materials become lights
  scene.materials.forEach((mat, name) => {
    if (isEmissive(mat)) {
      allLights.push({
        id: `emissive_${name}`,
        radiance: mat.emission,
        sampling: null,  // Usually path-only
        source: 'emissive_material'
      });
    }
  });
  
  return allLights;
}
```

### Phase 2: Material-Light Assignment

```typescript
private assignLightIds(materials: Map<string, MaterialDescription>, lights: CompilerLight[]): CompilerMaterial[] {
  return materials.map((mat, name) => {
    let light_id = -1;
    
    if (isEmissive(mat)) {
      const lightIndex = lights.findIndex(l => l.id === `emissive_${name}`);
      light_id = lightIndex;
    }
    
    return {
      ...mat,
      light_id  // Materials now know their light
    };
  });
}
```

### Phase 3: Module Generation with Optimization

#### Build-Time Analysis
```typescript
const analysis = {
  usedMaterialIds: [0, 1, 2],
  hasRoughMaterials: true,
  hasVolumes: false,
  lightCount: allLights.length,
  samplableLightCount: allLights.filter(l => l.sampling !== null).length
};
```

#### Optimization Strategies

**Dead Code Elimination**
```glsl
// If no volumes in scene
#if !HAS_VOLUMES
  // Volume code completely removed
#endif
```

**Constant Folding**
```glsl
// If all materials have same roughness
#define CONST_ROUGHNESS 0.5
```

**Loop Unrolling**
```glsl
// For < 5 geometries
float dispatch_sdf(Point p) {
  float d0 = geometry_0_sdf(p);
  float d1 = geometry_1_sdf(p);
  float d2 = geometry_2_sdf(p);
  return min(min(d0, d1), d2);
}
```

**Direct Light Access**
```glsl
// Single light optimization
#if NUM_SAMPLABLE == 1
  LightSample lighting_sample(Point p, vec2 xi) {
    return sample_light_0(p, xi);  // Skip selection
  }
#endif
```

## MIS Integration Flow

The key to correct MIS is the direct material→light reference:

```glsl
// In Transport module
Hit hit;
if (scene_intersect(ray, hit)) {
  // Get material properties including light_id
  MaterialProperties props = scene_material_properties(hit.material_to, hit.p);
  
  if (props.light_id >= 0) {
    // This material emits light!
    LightData light = lighting_get_light(props.light_id);
    
    if (lighting_can_sample(props.light_id)) {
      // Can be sampled - need MIS
      float bsdf_pdf = last_bounce_pdf;
      float light_pdf = lighting_pdf(previous_point, ray.direction);
      float mis_weight = power_heuristic(bsdf_pdf, light_pdf);
      radiance += throughput * light.radiance * mis_weight;
    } else {
      // Path-only light - no MIS
      radiance += throughput * light.radiance;
    }
  }
}
```

## Complete Example: Scene with Mixed Lights

### User Input
```typescript
// Scene
geometries = [
  { shape: 'sphere', material: 'emissive_orb' },
  { shape: 'plane', material: 'concrete' }
];

materials = {
  emissive_orb: { 
    emission: [50, 20, 5],
    albedo: [0.8, 0.4, 0.1],
    roughness: 0.2
  },
  concrete: {
    emission: [0, 0, 0],
    albedo: [0.5, 0.5, 0.5],
    roughness: 0.8
  }
};

// Lights
lights = [
  { type: 'point', position: [5, 5, 5], intensity: [100, 100, 100] }
];
```

### After Compilation

```glsl
// Materials with light IDs
MaterialProperties[2] = {
  { // emissive_orb
    albedo: vec3(0.8, 0.4, 0.1),
    roughness: 0.2,
    light_id: 1  // Points to sphere light
  },
  { // concrete
    albedo: vec3(0.5, 0.5, 0.5),
    roughness: 0.8,
    light_id: -1  // Non-emissive
  }
};

// Unified light array
LightData[2] = {
  { // Point light
    radiance: vec3(100, 100, 100),
    sampling_type: SAMPLING_POINT,
    param0: vec4(5, 5, 5, 0)
  },
  { // Sphere emitter
    radiance: vec3(50, 20, 5),
    sampling_type: SAMPLING_SPHERE,
    param0: vec4(0, 0, 0, 1)  // center + radius
  }
};
```

## Key Design Principles

### 1. Direct References
- Materials reference lights directly via `light_id`
- No complex geometry→light mappings
- Single source of truth

### 2. Compile-Time Optimization
- Feature detection and dead code elimination
- Constant folding for shared properties
- Specialized dispatch for small scenes

### 3. Efficient Boundary Resolution
- Nearby geometry tracking avoids full scene queries
- Material interfaces resolved with 2-3 geometries
- O(1) light lookups via direct IDs

### 4. Separation of Concerns
- **AmbientSpace**: Mathematical space structure
- **Scene**: Geometry arrangement and materials
- **Lighting**: Sampling strategies and radiance
- **Materials**: Properties including light references

## Performance Benefits

1. **Smaller Hit Structure**: No geometry_id saves registers
2. **Direct Lookups**: Material→Light is single array access
3. **Optimized Shaders**: Only code for used features
4. **Efficient Marching**: Nearby tracking reduces computations
5. **Simple MIS**: Direct light_id eliminates indirection

## Summary

The Objects pillar provides a clean, efficient system for managing the ambient space, materials, and lights. The key architectural insight is that **materials directly reference their associated lights**, eliminating complex cross-referencing while maintaining correct MIS. Combined with build-time optimization and efficient boundary resolution, this creates a system that is both powerful for research and performant for production.
