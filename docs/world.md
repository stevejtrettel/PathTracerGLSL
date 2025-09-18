# World Pillar: Complete Specification

## Purpose

The World pillar defines the mathematical and physical reality that the renderer observes. It provides four types of modules that together describe what exists, how it's arranged, how light interacts with it, and where light originates.

## Architecture Overview

World modules use a hybrid approach:
- **Geometry modules**: Hand-written (pure mathematics)
- **Objects modules**: Hybrid - definitions and CSG operations provided, compiled to optimized code
- **Scene modules**: Generated from object arrangements (optimized traversal)
- **Material modules**: Generated from scene analysis (optimized BRDFs and properties)
- **Light modules**: Hand-written for simple, generated for complex

Each module type provides:
1. **Builder classes** (TypeScript) - Construct and optimize implementations
2. **Module descriptor** - GLSL + metadata passed to Engine
3. **Contract satisfaction** - Generated code always implements required functions

## Core Design Principles

1. **Build-time optimization**: Generate specialized GLSL based on actual usage
2. **Geometry-agnostic physics**: Materials and lights work in any geometry
3. **Clear separation of concerns**: Objects define shapes and material IDs, Materials provide properties, Scene arranges and resolves interfaces
4. **Universal interface tracking**: Every hit is a transition between materials
5. **Priority-based nesting**: Simple solution for overlapping dielectrics
6. **Compile-time property optimization**: Zero overhead for constants

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

### Objects Module

Defines geometric entities and their material assignments. Objects own their shape and know which material ID they are made of, but do NOT handle shading or material properties.

**Core Principle:** Objects provide geometry (distance functions) and material classification (which material ID at a point), but not material properties or shading behavior.

**Required functions (per object):**
```glsl
// Distance estimation (one of these)
float [name]_sdf(vec3 p)           // For SDFs
float [name]_f(vec3 p)              // For isosurfaces
float [name]_eval(vec3 p, out int region)  // For multi-region

// Material classification (required)
int classify_[name](vec3 p)  // Returns material ID

// Surface normal (auto-generated if not provided)
vec3 normal_[name](vec3 p)
```

**CSG Operations (provided by Objects module):**
```glsl
float op_union(float d1, float d2)
float op_subtract(float d1, float d2)
float op_intersect(float d1, float d2)
float op_smooth_union(float d1, float d2, float k)
```

**Object Definition Structure:**
```typescript
interface ObjectDefinition {
  // Shape specification
  shape: {
    type: 'sdf' | 'isosurface' | 'mesh' | 'multi_region';
    function: string;           // e.g., "sphere_sdf(p, radius)"
    bounds?: BoundingVolume;    // For acceleration
    analyticIntersect?: boolean; // Has closed-form solution
  };
  
  // Material assignment (NOT properties!)
  materials: {
    // Simple: single material ID
    default?: MaterialID;
    
    // Complex: spatial material distribution
    regions?: Array<{
      condition: string;  // e.g., "sdf(p) < -0.1"
      material: MaterialID;
      priority?: number;  // For overlapping regions
    }>;
  };
}
```

**Implementation notes:**
- Objects return material IDs (integers), not material properties
- CSG operations are primitive operations available to all
- Multi-region objects handle their own internal material boundaries
- All functions auto-prefixed by object instance name

### Scene Module

Manages spatial queries, object arrangement, and material interface resolution. Generated from compiled object definitions.

**Core Principle:** Scene arranges pre-compiled objects, resolves material interfaces using nearby object tracking, and provides dispatch to object-specific functions.

**Required functions:**
```glsl
bool sc_intersect(Ray ray, out Hit hit)       // Find closest intersection
bool sc_intersect_any(Ray ray, float max_t)   // Shadow/occlusion test
bool sc_inside(Point p, int object_id)        // Inside/outside test
int sc_classify_point(Point p, int object_id) // Material at point
```

**Optional functions:**
```glsl
float sc_distance_bound(Point p)              // Distance estimate for marching
void sc_get_bounds(int object_id, out Point min, out Point max)
float sc_get_material_priority(int material_id)
```

**Nearby Object Tracking:**
```glsl
// Structure for tracking nearby objects during marching
struct NearbyObjects {
    float dists[3];      // Distances to closest 3 objects
    int ids[3];          // Object IDs of closest 3
    int count;           // How many are within BOUNDARY_THRESHOLD
};
```

**Object Dispatch System:**
```glsl
// Dispatch to object distance functions
float eval_object_sdf(int obj_id, vec3 p) {
    switch(obj_id) {
        case 0: return sphere_sdf(p, sphere_0_transform);
        case 1: return box_sdf(p, box_1_transform);
        // ... generated for all objects
    }
}

// Dispatch to object classifiers
int get_object_material(int obj_id, vec3 p) {
    switch(obj_id) {
        case 0: return classify_sphere_0(p);
        case 1: return classify_box_1(p);
        // ... objects know their material IDs
    }
}
```

**Material Interface Resolution (using nearby tracking):**
```glsl
// Efficient resolution using only 1-3 nearby objects
int resolve_material(vec3 p, NearbyObjects nearby) {
    // Fast path: only one object nearby (90%+ of cases)
    if(nearby.count <= 1) {
        if(nearby.ids[0] >= 0 && nearby.dists[0] < 0.0) {
            return get_object_material(nearby.ids[0], p);
        }
        return MATERIAL_AIR;
    }
    
    // Boundary case: check 2-3 nearby objects only
    int material = MATERIAL_AIR;
    float deepest = 0.0;
    
    for(int i = 0; i < nearby.count; i++) {
        if(nearby.dists[i] < 0.0) {  // Inside this object
            float depth = -nearby.dists[i];
            if(depth > deepest) {
                deepest = depth;
                material = get_object_material(nearby.ids[i], p);
            }
        }
    }
    
    return material;
}
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
  int object_id;        // Which object was hit
  int part_id;          // Which part (-1 for simple objects)
  
  // Material interface (ALWAYS populated by scene using nearby tracking)
  int material_from;    // Material ray is traveling through
  int material_to;      // Material ray would enter
  float ior_ratio;      // ior_from / ior_to (precomputed)
}
```

**Generation Pipeline:**
```typescript
const scene: SceneDefinition = {
  objects: [
    { 
      definition: sphereObject,  // From Objects module
      transform: { position: [0,0,0], scale: 1.0 },
      id: 0
    }
  ],
  usedMaterials: new Set([MATERIAL_GLASS, MATERIAL_WOOD]),
  acceleration: { type: 'none' }  // Small scene, no acceleration
};

const module = SceneCompiler.compile(scene);
```

**Implementation notes:**
- Scene arranges objects, doesn't create them
- Efficiently tracks only 3 nearest objects for boundary resolution
- Material interface resolution uses nearby objects, not entire scene
- All functions auto-prefixed with `sc_` by the engine

### Material Module

Defines how surfaces and volumes interact with light. Maps material IDs to shading properties and behaviors.

**Core Principle:** Materials work with material IDs (from Objects), not object IDs. They provide properties and local scattering behavior, but do NOT own transport strategy (that's the Estimator's job).

**Direction Convention:**
- `wi`: Incident direction - points TOWARD the surface (incoming light)
- `wo`: Outgoing direction - points AWAY from surface (scattered light)
- At hit point: `wi = -ray.direction`

**Material Library Structure:**
```typescript
interface MaterialLibrary {
  // Material ID definitions (shared with Objects module)
  materials: Map<MaterialID, MaterialDefinition>;
  
  // Analysis of which features are actually used
  analysis: MaterialAnalysis;
  
  // Generated optimized shaders
  shaders: {
    interact?: string;  // For path tracing
    shade?: string;     // For direct illumination only
    eval?: string;      // For BRDF evaluation
    sample?: string;    // For importance sampling
  };
}
```

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
bool m_is_delta(int mat_id)          // Perfect specular/transmission
```

**Volumetric properties - Optional (for participating media):**
```glsl
// Properties at a point (used by Estimator for transport)
vec3 m_sigma_s(Point p, int mat_id)    // Scattering coefficient
vec3 m_sigma_a(Point p, int mat_id)    // Absorption coefficient
float m_sigma_max(int mat_id)          // Majorant for delta tracking

// Phase function for scattering direction
Direction m_sample_phase(Direction wi, Point p, int mat_id, vec2 xi, out float pdf)
float m_eval_phase(Direction wi, Direction wo, Point p, int mat_id)
```

**Material Type Flags (for efficient dispatch):**
```glsl
// Pack material type and properties into a single int
const int material_types[NUM_MATERIALS] = int[](
    MAT_TYPE_OPAQUE,                           // Wall
    MAT_TYPE_DIELECTRIC,                       // Glass
    MAT_TYPE_PARTICIPATING,                    // Fog
    MAT_TYPE_OPAQUE | MAT_TYPE_SUBSURFACE,    // Skin
);

// Fast type checking without branching
bool is_participating(int mat_id) {
    return (material_types[mat_id] & MAT_TYPE_PARTICIPATING) != 0;
}
```

**Property Access (by material ID):**
```glsl
// Properties indexed by material ID, not object ID
struct MaterialProperties {
    vec3 albedo;
    float roughness;
    float metallic;
    // Only properties actually used
};

// Direct access by material ID
MaterialProperties get_material_properties(int material_id) {
    return material_props[material_id];
}
```

**Generation Pipeline:**
```typescript
// Analyze which material IDs are used
const usedMaterialIds = scene.collectMaterialIds();
const analysis = MaterialAnalyzer.analyze(usedMaterialIds);

// Generate optimized shaders containing only needed features
const module = MaterialCompiler.compile(analysis);
```

**Implementation notes:**
- Materials provide properties, Estimator owns transport strategy
- All property access is by material ID, not object ID
- Volume properties are queries, not transport algorithms
- Materials never determine entering/exiting (Scene provides this)
- All functions auto-prefixed with `m_` by the engine

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

**Implementation notes:**
- All functions auto-prefixed with `l_` by the engine
- Light transport follows geodesics
- Solid angles computed using metric
- Importance sampling for variance reduction

## Module Communication Flow

The key architectural change is the clear separation of responsibilities:

1. **Objects** define shapes and assign material IDs
2. **Scene** arranges objects and resolves material interfaces using nearby tracking
3. **Materials** provide properties and local scattering for material IDs
4. **Estimators** (in Photography) own transport strategy and integration methods

This separation enables:
- **Easy material swapping**: Change material IDs without touching geometry
- **Instancing**: Same object, different materials
- **Clear transport ownership**: Estimator decides how to integrate, materials just provide properties
- **Efficient boundaries**: Only check 2-3 nearby objects, not entire scene

## Example: Glass Containing Participating Medium

Demonstrates the new architecture with clear separations:

```glsl
// Object defines shape and material ID
int classify_glass_sphere(vec3 p) {
    float d = sphere_sdf(p);
    return (d < 0.0) ? MATERIAL_GLASS : MATERIAL_AIR;
}

int classify_fog_volume(vec3 p) {
    float d = box_sdf(p - fog_center, fog_size);
    return (d < 0.0) ? MATERIAL_FOG : MATERIAL_AIR;
}

// Scene resolves interfaces using nearby tracking
Hit create_hit(float t, vec3 p, vec3 ray_dir, int object_id, 
               NearbyObjects nearby) {
    // ... geometric properties ...
    
    // Efficient material resolution using only nearby objects
    hit.material_from = resolve_material(p - ray_dir * EPSILON, nearby);
    hit.material_to = resolve_material(p + ray_dir * EPSILON, nearby);
    hit.ior_ratio = material_iors[hit.material_from] / 
                    material_iors[hit.material_to];
    
    return hit;
}

// Material provides properties (not transport!)
vec3 m_sigma_s(Point p, int mat_id) {
    if (mat_id == MATERIAL_FOG) {
        return vec3(0.5) * fog_density(p);  // Scattering
    }
    return vec3(0);
}

vec3 m_sigma_a(Point p, int mat_id) {
    if (mat_id == MATERIAL_FOG) {
        return vec3(0.1) * fog_density(p);  // Absorption  
    }
    if (mat_id == MATERIAL_GLASS) {
        return vec3(0.01, 0.02, 0.03);  // Colored glass
    }
    return vec3(0);
}

// Estimator owns transport strategy
TransportResult transport_enter_volume(Ray ray, Hit entry, TransportState state) {
    #if VOLUME_STRATEGY == DELTA_TRACKING
        // Estimator chooses delta tracking
        return delta_track_volume(ray, entry, state);
    #elif VOLUME_STRATEGY == RAY_MARCHING
        // Or ray marching - materials don't care!
        return raymarch_volume(ray, entry, state);
    #endif
}
```

## File Organization

```
world/
├── geometry/
│   └── modules/           # Hand-written geometry modules
│       ├── euclidean.ts
│       └── hyperbolic.ts
│
├── objects/
│   ├── primitives/        # Basic geometric primitives
│   │   ├── sphere/
│   │   └── box/
│   ├── compounds/         # CSG operations and complex objects
│   │   └── operations.glsl
│   └── procedural/        # Runtime-defined objects
│
├── scene/
│   ├── builders/         # Scene arrangement and optimization
│   │   ├── SceneCompiler.ts
│   │   └── NearbyTracker.ts
│   └── acceleration/     # Spatial data structures
│
├── materials/
│   ├── builders/         # Material compilation
│   │   ├── MaterialAnalyzer.ts
│   │   └── MaterialCompiler.ts
│   └── library/          # Material definitions
│       ├── surfaces/     # Opaque, metal, dielectric
│       └── volumes/      # Participating media properties
│
└── lights/
    ├── modules/          # Hand-written simple lights
    └── builders/         # Complex light generation
```

## Validation Requirements

The engine validates that modules:
1. Provide all required functions
2. Objects return valid material IDs
3. Materials handle all used material IDs
4. Scene correctly resolves material interfaces
5. Return valid (non-NaN, non-negative) values
6. Maintain energy conservation

## Performance Considerations

Generated modules achieve:
- **Efficient boundary resolution**: Only check 2-3 nearby objects
- **30-70% fewer instructions** through dead code elimination
- **Zero overhead** for constant properties
- **Minimal branching** in hot paths
- **Better GPU occupancy** from reduced register pressure
- **Clear transport separation**: No hidden complexity

## Key Design Decisions

1. **Objects own shape + material ID**: Not properties or shading
2. **Materials work with IDs**: Not object references
3. **Scene handles interfaces**: Using efficient nearby tracking
4. **Estimator owns transport**: Materials just provide properties
5. **Build vs Runtime**: Generation happens at scene load, not every frame
6. **Universal interface tracking**: Every hit has material_from/material_to
7. **Priority-based nesting**: Simple solution for overlapping dielectrics

## Future Extensions

The architecture supports:
- **Meshes**: Objects provide same classification interface
- **Procedural materials**: Objects return material IDs that map to procedural shaders
- **LOD systems**: Scene can choose simplified object representations
- **Dynamic scenes**: Add/remove objects without recompiling materials
- **Spectral rendering**: Materials provide wavelength-dependent properties
- **Advanced volumes**: Heterogeneous media with spatial variation
