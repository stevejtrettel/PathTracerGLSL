# World Pillar: Complete Specification

## Purpose

The World pillar defines the mathematical and physical reality that the renderer observes. It provides four types of modules that together describe what exists, how it's arranged, how light interacts with it, and where light originates.

## Architecture Overview

World modules use a hybrid approach:
- **Geometry modules**: Hand-written (pure mathematics)
- **Material modules**: Generated from scene analysis (optimized BRDFs)
- **Scene modules**: Generated from object descriptions (optimized SDFs)
- **Light modules**: Hand-written for simple, generated for complex

Each module type provides:
1. **Builder classes** (TypeScript) - Construct and optimize implementations
2. **Module descriptor** - GLSL + metadata passed to Engine
3. **Contract satisfaction** - Generated code always implements required functions

## Core Design Principles

1. **Build-time optimization**: Generate specialized GLSL based on actual usage
2. **Geometry-agnostic physics**: Materials and lights work in any geometry
3. **Universal interface tracking**: Every hit is a transition between materials
4. **Priority-based nesting**: Simple solution for overlapping dielectrics
5. **Compile-time property optimization**: Zero overhead for constants

## Module Types

### Geometry Module

Defines the differential geometric structure of space. Hand-written as these are mathematical fundamentals.

**Provides:**
- Type definitions for `Point` and `Direction` (may be vec3 or vec4)
- Geodesic flow for light propagation
- Metric tensor for angle and distance calculations
- Parallel transport for vector transformation
- Frame construction for local coordinate systems

**Required functions:**
```glsl
Point g_geodesic(Point origin, Direction dir, float t)
float g_dot(Direction v1, Direction v2, Point p)
Direction g_parallel_transport(Direction v, Point from, Point to)
Frame g_frame(Point p, Direction normal)
```

**Optional functions:**
```glsl
float g_distance(Point p1, Point p2)          // Geodesic distance
Point g_exp_map(Point base, Direction tangent) // Exponential map
Direction g_log_map(Point from, Point to)      // Logarithm map
mat3[3] g_christoffel(Point p)                // Christoffel symbols
float g_curvature(Point p)                    // Scalar curvature
```

**Frame structure:**
```glsl
struct Frame {
  Point base;      // Where this frame is valid
  Direction t;     // Tangent vector (orthonormal)
  Direction b;     // Bitangent vector (orthonormal)
  Direction n;     // Normal vector (orthonormal)
}
```

**Implementation notes:**
- Simple geometries (Euclidean, spherical, hyperbolic) provide closed-form functions
- Complex geometries (Schwarzschild, numerical metrics) may use numerical integration
- All functions auto-prefixed with `g_` by the engine

### Material Module

Defines surface and volumetric light interaction. Generated from high-level material descriptions.

**Core Principle:** Every hit represents an interface between two materials. The material module receives complete interface information and never needs to determine which materials are present.

**Direction Convention:**
- `wi`: Incident direction - points TOWARD the surface (incoming light)
- `wo`: Outgoing direction - points AWAY from surface (scattered light)
- At hit point: `wi = -ray.direction`

**Surface interaction - Required (choose one):**
```glsl
// Simple shading for direct illumination
vec3 m_shade(Direction wi, Hit hit)

// Full interaction for path tracing
vec3 m_interact(Direction wi, Hit hit, vec2 xi, out Direction wo, out float pdf)
```

**Surface interaction - Optional (for advanced algorithms):**
```glsl
vec3 m_eval(Direction wi, Direction wo, Hit hit)
float m_pdf(Direction wi, Direction wo, Hit hit)
Direction m_sample(Direction wi, Hit hit, vec2 xi, out float pdf)
vec3 m_emission(Hit hit)
float m_ior(Hit hit)
float m_priority(Hit hit)  // For nested dielectrics
bool m_is_delta()          // Perfect specular/transmission
```

**Volumetric properties - Optional:**
```glsl
vec3 m_sigma_s(Point p)    // Scattering coefficient
vec3 m_sigma_a(Point p)    // Absorption coefficient
float m_phase_g(Point p)   // Phase function asymmetry [-1,1]
float m_phase_eval(Direction wi, Direction wo, Point p)
Direction m_phase_sample(Direction wi, Point p, vec2 xi, out float pdf)
```

**Generation Pipeline:**
```typescript
// Analyze what materials actually use
const usage = MaterialAnalyzer.analyze(scene);
// Generate optimized BRDF containing only needed features
const module = MaterialCompiler.compile(usage);
```

**Optimization Examples:**
```glsl
// Before: Full Disney BRDF with all features
vec3 disney_brdf(...) {
  vec3 diffuse = ...;     // 30 lines
  vec3 metallic = ...;    // 40 lines  
  vec3 clearcoat = ...;   // 35 lines
  vec3 subsurface = ...;  // 25 lines
  return mix(mix(diffuse, metallic, m), clearcoat, c);
}

// After: Scene only uses diffuse
vec3 m_interact(...) {
  // Just diffuse calculation - 30 lines total
  wo = sample_cosine_hemisphere(hit.n, xi);
  pdf = dot(wo, hit.n) / PI;
  return albedos[hit.object_id] / PI;
}
```

**Standard material priorities:**
- Air/Vacuum: 1
- Water: 10
- Glass: 20
- Diamond: 100

**Implementation notes:**
- All functions auto-prefixed with `m_` by the engine
- Materials use geometry functions for all operations (g_dot, g_frame, etc.)
- Interface information provided in Hit structure - no need to determine entering/exiting

### Scene Module

Manages spatial queries and object arrangement. Generated from scene descriptions.

**Required functions:**
```glsl
bool sc_intersect(Ray ray, out Hit hit)       // Find closest intersection
bool sc_intersect_any(Ray ray, float max_t)   // Shadow/occlusion test
bool sc_inside(Point p, int object_id)        // Inside/outside test
```

**Optional functions:**
```glsl
float sc_distance_bound(Point p)              // Distance estimate for marching
void sc_get_bounds(int object_id, out Point min, out Point max)
float sc_get_material_priority(int material_id)
```

**Material Property Access:**
```glsl
// Batched property access for better cache coherence
struct MaterialProperties {
  vec3 albedo;
  float roughness;
  float metallic;
  vec3 emission;
  // Only properties actually used in scene (determined at compile time)
};

// Single fetch for all properties
MaterialProperties sc_get_material_properties(int object_id);

// Legacy individual accessors (still available but discouraged)
vec3 sc_get_vec3_param(int object_id, int param_id);
float sc_get_float_param(int object_id, int param_id);

// Standard parameter IDs
#define PARAM_ALBEDO 0
#define PARAM_ROUGHNESS 1
#define PARAM_METALLIC 2
#define PARAM_IOR 3
#define PARAM_EMISSION 4
```

**Hit Structure:**
```glsl
struct Hit {
  // Geometric information
  Point p;              // Hit point
  Direction n;          // Normal (outward facing)
  Direction incident;   // Ray direction that created hit
  float t;              // Ray parameter at hit
  vec2 uv;              // Texture coordinates [0,1]²
  
  // Precomputed helpers
  Frame frame;          // Orthonormal frame at hit point (computed once by scene)
  
  // Object information
  int object_id;        // Which object/compound
  int part_id;          // Which part (-1 for simple objects)
  
  // Material interface (ALWAYS populated by scene)
  int material_from;    // Material ray is traveling through
  int material_to;      // Material ray would enter
  float ior_ratio;      // ior_from / ior_to (precomputed - the only value materials need)
}
```

**Generation Pipeline:**
```typescript
const builder = new SceneBuilder();
builder.addSphere([0,0,0], 1);
builder.addBox([2,0,0], [1,1,1]);
const sceneModule = builder.compile();
```

**Generates optimized SDF with analytic normals:**
```glsl
// Inlined and optimized with analytic normals
float scene_sdf(Point p) {
  float d = sphere_sdf(p - vec3(0,0,0), 1.0);
  d = min(d, box_sdf(p - vec3(2,0,0), vec3(1)));
  return d;  // Compiler optimizes constant expressions
}

// Generated normal computation using object knowledge
Direction compute_normal(Point p, int object_id) {
  switch(object_id) {
    case 0: // Sphere at origin - analytic normal
      return normalize(p);
    case 1: // Box at (2,0,0) - analytic normal
      return box_normal_analytic(p - vec3(2,0,0), vec3(1));
    default: // Fallback to finite differences
      const float h = 0.001;
      return normalize(vec3(
        scene_sdf(p + vec3(h,0,0)) - scene_sdf(p - vec3(h,0,0)),
        scene_sdf(p + vec3(0,h,0)) - scene_sdf(p - vec3(0,0,h)),
        scene_sdf(p + vec3(0,0,h)) - scene_sdf(p - vec3(0,0,h))
      ));
  }
}

// Analytic normal for box
Direction box_normal_analytic(Point p, vec3 size) {
  vec3 d = abs(p) - size;
  float m = max(d.x, max(d.y, d.z));
  return normalize(step(m - 0.001, d) * sign(p));
}
```

**Interface Resolution:**

For **simple objects**, the scene checks ray direction against normal:
```glsl
bool sc_intersect(Ray ray, out Hit hit) {
  // ... find intersection point ...
  
  // Compute hit properties
  hit.p = p;
  hit.t = t;
  hit.n = compute_normal(p, object_id);  // Uses analytic when possible
  hit.incident = ray.direction;
  hit.object_id = object_id;
  hit.uv = compute_uv(p, object_id);
  
  // Precompute frame once
  hit.frame = g_frame(hit.p, hit.n);
  
  // Resolve material interface
  bool entering = dot(ray.direction, hit.n) < 0;
  if (entering) {
    hit.material_from = MATERIAL_AIR;
    hit.material_to = object_materials[hit.object_id];
    // Look up IORs and compute ratio
    float ior_from = 1.0;
    float ior_to = material_iors[hit.material_to];
    hit.ior_ratio = ior_from / ior_to;
  } else {
    hit.material_from = object_materials[hit.object_id];
    hit.material_to = MATERIAL_AIR;
    // Look up IORs and compute ratio
    float ior_from = material_iors[hit.material_from];
    float ior_to = 1.0;
    hit.ior_ratio = ior_from / ior_to;
  }
  
  return true;
}
```

For **compound objects**, use priority-based resolution:
```glsl
void resolve_compound_interface(inout Hit hit) {
  Point before = hit.p - hit.incident * EPSILON;
  Point after = hit.p + hit.incident * EPSILON;
  
  // Only test parts of THIS compound (2-5 tests)
  hit.material_from = get_material_at_point(before, hit.object_id);
  hit.material_to = get_material_at_point(after, hit.object_id);
  
  // Compute only the ratio (materials can look up IORs if needed)
  float ior_from = material_iors[hit.material_from];
  float ior_to = material_iors[hit.material_to];
  hit.ior_ratio = ior_from / ior_to;
  
  // Frame already computed by sc_intersect
}
```

**Implementation notes:**
- All functions auto-prefixed with `sc_` by the engine
- Scene ALWAYS populates material interface - materials never determine this
- Compound objects only test their own parts (2-5 tests), not entire scene
- Priority system ensures correct behavior for nested dielectrics

### Lights Module

Defines emitters and importance sampling strategies. Simple lights are hand-written, complex setups are generated.

**Required functions:**
```glsl
LightSample l_sample_light(Point p, vec2 xi)
vec3 l_eval_light(Point p, Direction wi)
float l_pdf_light(Point p, Direction wi)
```

**Optional functions:**
```glsl
EmissionSample l_sample_emission(vec2 xi1, vec2 xi2)  // For bidirectional
vec3 l_direct_light(int light_id, Point p)            // Specific light eval
int l_light_count()                                    // Number of lights
float l_light_power()                                  // Total power
```

**Light sample structure:**
```glsl
struct LightSample {
  Direction wi;         // Direction toward light
  float distance;       // Distance to light (inf for env)
  vec3 radiance;        // Incoming radiance
  float pdf;            // Sampling PDF
  int light_id;         // Which light was sampled
  bool is_delta;        // True for point/directional
}
```

**Hand-written example (Point Light):**
```glsl
LightSample l_sample_light(Point p, vec2 xi) {
  LightSample ls;
  Direction to_light = u_light_position - p;
  ls.distance = length(to_light);
  ls.wi = normalize(to_light);
  
  float falloff = 1.0 / (ls.distance * ls.distance);
  ls.radiance = u_light_color * u_light_intensity * falloff;
  ls.pdf = 1.0;
  ls.is_delta = true;
  
  return ls;
}
```

**Generated example (Environment Map):**
```typescript
// Build time: analyze HDRI and generate sampling
const hdri = loadHDRI('sunset.exr');
const cdf = computeEnvironmentCDF(hdri);
const module = EnvironmentLightCompiler.compile(hdri, cdf);
```

**Geometry-agnostic implementation:**
```glsl
// DON'T: Assume Euclidean distance
float distance = length(light_pos - p);  // WRONG in curved space!

// DO: Use geodesic distance
float distance = g_distance(p, light_pos);  // Correct

// DO: Consider geodesic bending for visibility
Ray ray;
ray.origin = p;
ray.direction = initial_direction_to(light_pos, p);
bool visible = !sc_intersect_any(ray, distance);
```

**Implementation notes:**
- All functions auto-prefixed with `l_` by the engine
- Light transport follows geodesics
- Solid angles computed using metric
- Importance sampling for variance reduction

## Material Property System

Properties are managed through generated accessors optimized at compile time:

### Scene Description
```javascript
{
  objects: [
    {
      type: "sphere",
      material: {
        albedo: [0.8, 0.2, 0.2],        // Constant
        roughness: 0.5                  // Constant
      }
    },
    {
      type: "sphere", 
      material: {
        albedo: "marble_pattern(p)",    // Procedural
        roughness: { uniform: true, default: 0.5 }  // UI controllable
      }
    }
  ]
}
```

### Generated Accessors
```glsl
// Batched property fetch - optimized based on usage patterns
struct MaterialProperties {
  vec3 albedo;
  float roughness;
  float metallic;
  // Only fields actually used in the scene
};

// Single optimized fetch
MaterialProperties get_material_properties(int obj_id) {
  MaterialProperties props;
  
  // Fast path: compile-time constants
  if (obj_id < 47) {
    const vec3 albedos[47] = vec3[](...);
    const float roughness[47] = float[](...);
    props.albedo = albedos[obj_id];
    props.roughness = roughness[obj_id];
    props.metallic = 0.0;  // Never used, compile to constant
    return props;
  }
  
  // Procedural materials
  switch(obj_id) {
    case 47: 
      props.albedo = marble_pattern(hit.p);
      props.roughness = 0.5;
      props.metallic = 0.0;
      break;
    case 48: 
      props.albedo = wood_grain(hit.p);
      props.roughness = u_roughness[obj_id];  // UI controllable
      props.metallic = 0.0;
      break;
  }
  return props;
}
```

## Example: Glass of Water

Demonstrates compound object with correct interface resolution:

```glsl
// Material priorities
#define MATERIAL_AIR 0     // Priority: 1
#define MATERIAL_WATER 1   // Priority: 10
#define MATERIAL_GLASS 2   // Priority: 20

// Scene intersection populates interface
bool sc_intersect(Ray ray, out Hit hit) {
  // Find hit point...
  
  // Compute geometric properties
  hit.p = p;
  hit.t = t;
  hit.object_id = COMPOUND_GLASS_WATER;
  
  // Use analytic normal for glass sphere
  hit.n = normalize(hit.p);  // Sphere centered at origin
  hit.incident = ray.direction;
  
  // Precompute frame once
  hit.frame = g_frame(hit.p, hit.n);
  
  if (hit.object_id == COMPOUND_GLASS_WATER) {
    // Sample before/after points
    Point before = hit.p - hit.incident * EPSILON;
    Point after = hit.p + hit.incident * EPSILON;
    
    // Only test glass and water SDFs (not entire scene!)
    bool before_glass = glass_sdf(before) < 0;
    bool before_water = water_sdf(before) < 0;
    bool after_glass = glass_sdf(after) < 0;
    bool after_water = water_sdf(after) < 0;
    
    // Priority resolution
    if (before_water) hit.material_from = MATERIAL_WATER;
    else if (before_glass) hit.material_from = MATERIAL_GLASS;
    else hit.material_from = MATERIAL_AIR;
    
    if (after_water) hit.material_to = MATERIAL_WATER;
    else if (after_glass) hit.material_to = MATERIAL_GLASS;
    else hit.material_to = MATERIAL_AIR;
    
    // Only compute and store the ratio
    float ior_from = material_iors[hit.material_from];
    float ior_to = material_iors[hit.material_to];
    hit.ior_ratio = ior_from / ior_to;
  }
  
  return true;
}

// Material just uses the interface info
vec3 glass_interact(Direction wi, Hit hit, vec2 xi, out Direction wo, out float pdf) {
  // No need to figure out entering/exiting!
  float eta = hit.ior_ratio;  // The only value needed
  
  float cos_theta = -g_dot(wi, hit.n, hit.p);
  float F = fresnel(cos_theta, eta);
  
  if (xi.x < F) {
    // Use precomputed frame for efficient reflection
    wo = reflect_using_frame(wi, hit.frame);
    pdf = F;
    return vec3(1.0);
  } else {
    wo = refract(wi, hit.n, eta);
    pdf = 1.0 - F;
    return vec3(eta * eta);
  }
}
```

## Module Communication

Modules communicate through:
- **Function calls** - Using clean names, auto-resolved by engine
- **Shared types** - Ray, Hit, Frame
- **Engine uniforms** - `u_resolution`, `u_frame_index`, etc.

Photography modules use functions from World:
- `g_geodesic(origin, direction, t)` - Ray marching
- `sc_intersect(ray, hit)` - Scene queries
- `m_eval(wi, wo, hit)` - Material evaluation
- `m_sample(wi, hit, xi)` - Material sampling
- `l_sample_light()` - Light sampling

## File Organization

```
world/
├── geometry/
│   └── modules/           # Hand-written geometry modules
│       ├── euclidean.ts
│       └── hyperbolic.ts
│
├── materials/
│   ├── builders/         # Material construction
│   │   ├── MaterialBuilder.ts
│   │   └── MaterialCompiler.ts
│   └── library/          # Material definitions
│       ├── diffuse.ts
│       └── disney.ts
│
├── scene/
│   ├── builders/         # Scene construction
│   │   ├── SceneBuilder.ts
│   │   ├── SDFCompiler.ts
│   │   └── CSGOperations.ts
│   └── objects/          # Object definitions
│       ├── SDFObject.ts
│       └── primitives.ts
│
└── lights/
    ├── modules/          # Hand-written simple lights
    └── builders/         # Complex light generation
        └── LightCompiler.ts
```

## Validation Requirements

The engine validates that modules:
1. Provide all required functions
2. Return valid (non-NaN, non-negative) values
3. Maintain energy conservation
4. Return normalized directions
5. Handle edge cases properly

## Performance Considerations

Generated modules achieve:
- **30-70% fewer instructions** through dead code elimination
- **Zero overhead** for constant properties
- **Minimal branching** in hot paths
- **Better GPU occupancy** from reduced register pressure
- **Compile-time CSG** operations

## Key Design Decisions

1. **Build vs Runtime**: Generation happens at scene load, not every frame
2. **Universal interface tracking**: Every hit has material_from/material_to
3. **Priority-based nesting**: Simple solution for overlapping dielectrics
4. **Hybrid generation**: Mix hand-written (geometry) with generated (scene/materials)
5. **Compile-time optimization**: Fast constants, flexible procedurals
6. **Geometry-agnostic operations**: Everything uses g_dot, g_frame, etc.

## Future Extensions

The architecture supports:
- **Meshes**: Scene provides same `intersect()` interface
- **Isosurfaces**: Another intersection backend
- **Spectral rendering**: Materials provide wavelength-dependent properties
- **Advanced volumes**: Heterogeneous media with spatial variation
- **Multiple coordinate charts**: For manifolds requiring patches
