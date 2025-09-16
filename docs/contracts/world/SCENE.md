# Scene Module Contract

## Purpose
Scene modules manage spatial queries and object arrangement, providing intersection tests that work regardless of the underlying representation (SDF, mesh, isosurface). They handle both simple objects and compounds with multiple materials, resolving material interfaces correctly.

## Module Descriptor
```typescript
{
  type: 'scene',
  id: string,                    // e.g., 'sdf_scene', 'mesh_scene', 'hybrid'
  provides: ['scene'],
  requires: ['geometry'],         // For geodesic marching
  uniforms: [],                   // Scene-specific parameters
  resources: [],                  // Meshes, BVH buffers, etc.
  defines: {
    SCENE_TYPE: 'sdf' | 'mesh' | 'hybrid',
    MAX_MARCH_STEPS?: number,      // For SDF marching (default: 100)
    SUPPORTS_COMPOUNDS?: boolean,  // Multi-material objects
    HAS_ACCELERATION?: boolean     // BVH, spatial hash, etc.
  }
}
```

## Required Functions

### intersect
Find the closest intersection along a ray.
```glsl
bool sc_intersect(Ray ray, out Hit hit)
```
- **ray**: Ray to test (origin, direction, tmin, tmax)
- **hit**: Output - intersection information
- **returns**: True if intersection found
- **Note**: Updates ray.tmax to hit.t for early termination

### intersect_any
Test if ray hits anything (for shadows/occlusion).
```glsl
bool sc_intersect_any(Ray ray, float max_t)
```
- **ray**: Ray to test
- **max_t**: Maximum distance to test
- **returns**: True if any intersection exists
- **Note**: Can return early, doesn't need closest hit

### inside
Test if a point is inside an object.
```glsl
bool sc_inside(Point p, int object_id)
```
- **p**: Point to test
- **object_id**: Which object to test against (-1 for any)
- **returns**: True if point is inside object
- **Note**: Essential for volume rendering and nested materials

## Optional Functions

### distance_bound
Get conservative distance to nearest surface (for sphere marching).
```glsl
float sc_distance_bound(Point p)
```
- **p**: Query point
- **returns**: Conservative distance to nearest surface
- **Note**: Used by SDF-based scenes

### get_bounds
Get bounding volume of an object or entire scene.
```glsl
void sc_get_bounds(int object_id, out Point min, out Point max)
```
- **object_id**: Which object (-1 for entire scene)
- **min, max**: Output - axis-aligned bounds
- **Note**: Used for acceleration structures

### get_material_priority
Get priority value for a material (for nested dielectrics).
```glsl
float sc_get_material_priority(int material_id)
```
- **material_id**: Material to query
- **returns**: Priority value (higher wins at interfaces)
- **Note**: Standard values: Air=1, Water=10, Glass=20, Diamond=100

## Material Property Access

Scenes provide material property lookup for objects:
```glsl
// Required for material modules to access per-object data
vec3 sc_get_vec3_param(int object_id, int param_id)
float sc_get_float_param(int object_id, int param_id)
int sc_get_int_param(int object_id, int param_id)

// Standard parameter IDs
#define PARAM_ALBEDO 0
#define PARAM_ROUGHNESS 1
#define PARAM_METALLIC 2
#define PARAM_IOR 3
#define PARAM_EMISSION 4
```

## Core Types

### Ray Structure
```glsl
struct Ray {
  Point origin;
  Direction direction;  // Normalized
  float tmin;          // Minimum t value (usually epsilon)
  float tmax;          // Maximum t value (initially large)
}
```

### Hit Structure
```glsl
struct Hit {
  // Geometric information
  Point p;              // Hit point
  Direction n;          // Normal (outward facing)
  Direction incident;   // Ray direction that created hit
  float t;              // Ray parameter at hit
  vec2 uv;              // Texture coordinates [0,1]²
  
  // Object information
  int object_id;        // Which object/compound
  int part_id;          // Which part (-1 for simple objects)
  
  // Material interface (ALWAYS populated by scene)
  int material_from;    // Material ray is traveling through
  int material_to;      // Material ray would enter
  float ior_from;       // IOR of from material
  float ior_to;         // IOR of to material  
  float ior_ratio;      // ior_from / ior_to (precomputed)
}
```

## Interface Resolution

The scene MUST determine both materials at every hit point:

### Simple Objects
```glsl
bool sc_intersect(Ray ray, out Hit hit) {
  // ... find intersection ...
  
  // Determine material interface
  float cos_theta = dot(ray.direction, hit.n);
  bool entering = cos_theta < 0;
  
  if (entering) {
    // Ray entering object from outside
    hit.material_from = MATERIAL_AIR;
    hit.material_to = object_materials[hit.object_id];
    hit.ior_from = 1.0;
    hit.ior_to = material_iors[hit.material_to];
  } else {
    // Ray exiting object to outside
    hit.material_from = object_materials[hit.object_id];
    hit.material_to = MATERIAL_AIR;
    hit.ior_from = material_iors[hit.material_from];
    hit.ior_to = 1.0;
  }
  
  hit.ior_ratio = hit.ior_from / hit.ior_to;
  return true;
}
```

### Compound Objects
```glsl
// For complex objects, use priority system
void resolve_compound_interface(inout Hit hit) {
  Point before = hit.p - hit.incident * EPSILON;
  Point after = hit.p + hit.incident * EPSILON;
  
  // Find highest priority material at each point
  hit.material_from = get_material_at_point(before, hit.object_id);
  hit.material_to = get_material_at_point(after, hit.object_id);
  
  hit.ior_from = material_iors[hit.material_from];
  hit.ior_to = material_iors[hit.material_to];
  hit.ior_ratio = hit.ior_from / hit.ior_to;
}

int get_material_at_point(Point p, int compound_id) {
  CompoundObject obj = compounds[compound_id];
  
  int material = MATERIAL_AIR;
  float priority = 0.0;
  
  // Check each part of compound
  for (int i = 0; i < obj.num_parts; i++) {
    if (is_inside_part(p, obj.part_ids[i])) {
      float part_priority = material_priorities[obj.material_ids[i]];
      if (part_priority > priority) {
        material = obj.material_ids[i];
        priority = part_priority;
      }
    }
  }
  
  return material;
}
```

## Compound Objects

For multi-material objects (e.g., glass containing water):

```glsl
struct CompoundObject {
  int id;                      // Compound identifier
  int num_parts;               // Number of sub-parts
  int part_ids[MAX_PARTS];     // IDs of constituent parts
  int material_ids[MAX_PARTS]; // Material for each part
  float priorities[MAX_PARTS]; // Priority for interface resolution
}

// Specialized intersection for compound parts
MaterialInterface get_compound_interface(int compound_id, Point p, Direction dir) {
  CompoundObject obj = compounds[compound_id];
  
  // Test only parts of this compound (not entire scene)
  Point before = p - dir * EPSILON;
  Point after = p + dir * EPSILON;
  
  int mat_before = -1;
  float priority_before = -1.0;
  
  int mat_after = -1;
  float priority_after = -1.0;
  
  // Only test the 2-5 parts of this compound
  for (int i = 0; i < obj.num_parts; i++) {
    if (sc_inside(before, obj.part_ids[i])) {
      if (obj.priorities[i] > priority_before) {
        mat_before = obj.material_ids[i];
        priority_before = obj.priorities[i];
      }
    }
    if (sc_inside(after, obj.part_ids[i])) {
      if (obj.priorities[i] > priority_after) {
        mat_after = obj.material_ids[i];
        priority_after = obj.priorities[i];
      }
    }
  }
  
  // If outside compound entirely, it's air/vacuum
  if (mat_before < 0) mat_before = MATERIAL_AIR;
  if (mat_after < 0) mat_after = MATERIAL_AIR;
  
  return create_interface(mat_before, mat_after);
}
```

## Implementation Examples

### SDF Scene
```glsl
#define SCENE_TYPE sdf
#define MAX_MARCH_STEPS 100

// Scene SDF combining multiple objects
float scene_sdf(Point p) {
  float d = 1e10;
  d = min(d, sphere_sdf(p - vec3(0, 0, 0), 1.0));
  d = min(d, box_sdf(p - vec3(3, 0, 0), vec3(1)));
  d = min(d, torus_sdf(p - vec3(-3, 0, 0), vec2(1, 0.3)));
  return d;
}

bool sc_intersect(Ray ray, out Hit hit) {
  Point p = ray.origin;
  float t = ray.tmin;
  
  for (int i = 0; i < MAX_MARCH_STEPS && t < ray.tmax; i++) {
    p = g_geodesic(ray.origin, ray.direction, t);
    float d = scene_sdf(p);
    
    if (d < EPSILON) {
      hit.p = p;
      hit.t = t;
      hit.n = compute_normal(p);
      hit.incident = ray.direction;
      hit.object_id = identify_object(p);
      hit.material_id = object_materials[hit.object_id];
      hit.uv = compute_uv(p, hit.object_id);
      return true;
    }
    
    t += d * 0.9;  // Conservative step
  }
  return false;
}

Direction compute_normal(Point p) {
  const float h = 0.001;
  return normalize(vec3(
    scene_sdf(p + vec3(h,0,0)) - scene_sdf(p - vec3(h,0,0)),
    scene_sdf(p + vec3(0,h,0)) - scene_sdf(p - vec3(0,h,0)),
    scene_sdf(p + vec3(0,0,h)) - scene_sdf(p - vec3(0,0,h))
  ));
}

float sc_distance_bound(Point p) {
  return scene_sdf(p);
}
```

### Glass of Water (Compound)
```glsl
#define SUPPORTS_COMPOUNDS true

// Individual SDFs
float glass_sdf(Point p) {
  float outer = sphere_sdf(p, 1.0);
  float inner = sphere_sdf(p, 0.95);
  return max(outer, -inner);  // Hollow sphere
}

float water_sdf(Point p) {
  float level = p.y - 0.2;  // Water level
  float container = sphere_sdf(p, 0.94);  // Inside glass
  return max(level, container);
}

bool sc_inside(Point p, int object_id) {
  switch(object_id) {
    case OBJ_GLASS: return glass_sdf(p) < 0.0;
    case OBJ_WATER: return water_sdf(p) < 0.0;
    default: return false;
  }
}

MaterialInterface sc_get_interface(Hit hit, Direction incident) {
  if (hit.object_id == COMPOUND_GLASS_WATER) {
    return get_compound_interface(COMPOUND_GLASS_WATER, hit.p, incident);
  }
  // Simple object - interface with air
  return create_interface(MATERIAL_AIR, hit.material_id);
}
```

### Mesh Scene (Future)
```glsl
#define SCENE_TYPE mesh
#define HAS_ACCELERATION true

bool sc_intersect(Ray ray, out Hit hit) {
  // Use BVH traversal
  return bvh_intersect(ray, hit);
}

bool sc_intersect_any(Ray ray, float max_t) {
  // Early-exit BVH traversal
  return bvh_any_hit(ray, max_t);
}
```

## Performance Optimizations

### Spatial Acceleration
```glsl
// Divide space into regions
int get_region(Point p) {
  ivec3 grid = ivec3(floor(p / GRID_SIZE));
  return grid.x + grid.y * GRID_DIM + grid.z * GRID_DIM * GRID_DIM;
}

bool sc_intersect(Ray ray, out Hit hit) {
  // Only test objects in traversed regions
  int regions[MAX_REGIONS];
  int num_regions = traverse_regions(ray, regions);
  
  for (int i = 0; i < num_regions; i++) {
    if (intersect_region(ray, regions[i], hit)) {
      return true;
    }
  }
  return false;
}
```

## Validation Requirements
The engine validates that scene modules:
1. Provide all required intersection functions
2. Return consistent normals (outward facing)
3. Set all fields of Hit structure
4. Maintain material interface consistency
5. Handle edge cases (grazing rays, coincident surfaces)

## Integration Notes
- SDF scenes benefit from adaptive step sizes
- Compounds should cache material lookups
- Consider LOD for distant objects
- Precompute static acceleration structures
- Use conservative bounds for early rejection
