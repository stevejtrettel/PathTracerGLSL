# World Pillar: Complete Specification

## Purpose

The World pillar defines the mathematical and physical reality that the renderer observes. It provides four types of modules that together describe what exists, how it's arranged, how light interacts with it, and where light originates.

## Core Design Principles

1. **Geometry-agnostic physics**: Materials and lights work in any geometry by referencing only geometric operations, not assuming Euclidean space
2. **Universal interface tracking**: Every ray-surface hit is treated as a transition between two materials (even if one is air/vacuum)
3. **Intersection abstraction**: Scenes provide intersection tests regardless of representation (SDF, mesh, isosurface)
4. **Priority-based material resolution**: Nested dielectrics handled through material priorities
5. **Compile-time property optimization**: Mixed constant/procedural properties with zero overhead for constants

## Module Types

### Geometry Module

Defines the differential geometric structure of space.

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

Defines surface and volumetric light interaction.

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

Manages spatial queries and object arrangement, providing unified interface resolution.

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

**Hit structure with universal interface:**
```glsl
struct Hit {
  // Geometric information
  Point p;              // Hit point
  Direction n;          // Normal (outward facing)
  Direction incident;   // Ray direction that created hit
  float t;              // Ray parameter
  vec2 uv;              // Texture coordinates
  
  // Object information
  int object_id;        // Which object/compound
  int part_id;          // Which part (-1 for simple objects)
  
  // Material interface (ALWAYS populated)
  int material_from;    // Material ray is traveling through
  int material_to;      // Material ray would enter
  float ior_from;       // IOR of from material
  float ior_to;         // IOR of to material
  float ior_ratio;      // ior_from / ior_to (precomputed)
}
```

**Interface Resolution:**

For **simple objects**, the scene checks ray direction against normal:
- Entering (cos θ < 0): `from=AIR, to=OBJECT_MATERIAL`
- Exiting (cos θ > 0): `from=OBJECT_MATERIAL, to=AIR`

For **compound objects**, the scene uses priority-based resolution:
1. Sample points before and after the hit
2. Find highest-priority material at each point
3. Set interface based on these materials

**Material property access:**
```glsl
vec3 sc_get_vec3_param(int object_id, int param_id)
float sc_get_float_param(int object_id, int param_id)
int sc_get_int_param(int object_id, int param_id)
```

**Implementation notes:**
- All functions auto-prefixed with `sc_` by the engine
- Scene ALWAYS populates material interface - materials never determine this
- Compound objects only test their own parts (2-5 tests), not entire scene
- Priority system ensures correct behavior for nested dielectrics

### Lights Module

Defines emitters and importance sampling strategies.

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

**Light types supported:**
- Analytic (point, directional, spot, area)
- Environment maps (HDR spherical)
- Emissive surfaces (materials with emission > 0)

**Implementation notes:**
- All functions auto-prefixed with `l_` by the engine
- Light transport follows geodesics
- Solid angles computed using metric
- Importance sampling for variance reduction

## Material Property System

The engine optimizes material property access through compile-time analysis.

### Scene Description

Materials specify properties as constants or functions:
```javascript
{
  objects: [
    {
      type: "sphere",
      material: {
        albedo: [0.8, 0.2, 0.2],        // Constant
        roughness: 0.5,                 // Constant
        emission: 0
      }
    },
    {
      type: "sphere", 
      material: {
        albedo: "marble_pattern(p)",    // Procedural
        roughness: "wear_map(p, hit.n)", // Uses hit info
        emission: 0
      }
    }
  ]
}
```

### Compile-Time Optimization

The engine generates specialized accessors based on usage patterns:

```glsl
// Fast path for constants (no branching if all constant)
vec3 get_albedo(int obj_id, Point p, Hit hit) {
  if (obj_id < 47) {
    return albedo_constants[obj_id];  // Direct array lookup
  }
  // Slow path only for procedural materials
  switch(obj_id) {
    case 47: return marble_pattern(p);
    case 48: return wood_grain(p);
  }
}

// Single material sample per hit
MaterialSample sample_material(int obj_id, Point p, Hit hit) {
  return MaterialSample(
    get_albedo(obj_id, p, hit),
    get_roughness(obj_id),
    get_emission(obj_id, p, hit)
  );
}
```

## Example: Glass of Water

Demonstrates compound object with correct interface resolution:

```glsl
// Define materials with priorities
#define MATERIAL_AIR 0     // Priority: 1
#define MATERIAL_WATER 1   // Priority: 10
#define MATERIAL_GLASS 2   // Priority: 20

// Scene intersection populates interface
bool sc_intersect(Ray ray, out Hit hit) {
  // Find hit point...
  
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
    
    // Set IORs
    hit.ior_from = material_iors[hit.material_from];
    hit.ior_to = material_iors[hit.material_to];
    hit.ior_ratio = hit.ior_from / hit.ior_to;
  }
  
  return true;
}

// Material just uses the interface info
vec3 glass_interact(Direction wi, Hit hit, vec2 xi, out Direction wo, out float pdf) {
  // No need to figure out entering/exiting!
  float eta = hit.ior_ratio;  // Already correct
  
  float cos_theta = -g_dot(wi, hit.n, hit.p);
  float F = fresnel(cos_theta, eta);
  
  if (xi.x < F) {
    wo = reflect(wi, hit.n);
    pdf = F;
    return vec3(1.0);
  } else {
    wo = refract(wi, hit.n, eta);
    pdf = 1.0 - F;
    return vec3(eta * eta);
  }
}
```

## Module Composition

A complete World consists of one module of each type:

```typescript
const world = {
  geometry: new HyperbolicGeometry(),
  materials: [
    new DisneyBRDF(),
    new Glass(),
    new Volume()
  ],
  scene: new SDFScene({
    objects: [...],
    compounds: [...]
  }),
  lights: new EnvironmentMap(hdri)
};
```

## Key Design Decisions

1. **Universal interface tracking**: Every hit has material_from/material_to - no special cases
2. **Scene owns interface resolution**: Materials never determine entering/exiting
3. **Priority-based nesting**: Simple, robust solution for overlapping dielectrics
4. **Compile-time property optimization**: Fast constants, flexible procedurals
5. **Geometry-agnostic operations**: Everything uses g_dot, g_frame, etc.
6. **Compound-aware intersection**: Test only relevant parts, not entire scene

## Future Extensions

The architecture supports future additions without breaking changes:
- **Meshes**: Scene provides same `intersect()` interface
- **Isosurfaces**: Another intersection backend
- **Spectral rendering**: Materials provide wavelength-dependent properties
- **Advanced volumes**: Heterogeneous media with spatial variation
- **Curved space optimizations**: Caching geodesic computations
- **Multiple coordinate charts**: For manifolds requiring patches
