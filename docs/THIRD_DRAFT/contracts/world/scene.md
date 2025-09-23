# Scene Contract (Revised)

## Purpose

Scene arranges objects in space and manages ray-object intersection. It resolves which materials exist at any point through nearby object tracking and material interface resolution. Scene knows about object placement and material IDs, but nothing about material properties or light behavior.

## Module Structure

```typescript
interface SceneModule {
  id: {
    kind: 'scene',
    name: string,              // 'generated' | 'static' | 'dynamic'
    version: string
  },
  fragment: {
    types: string,             // NearbyObjects struct
    dispatch: string,          // Object dispatch functions
    functions: string,         // Intersection and marching
    uniforms: string,          // Transforms, acceleration structures
    constants: string,         // Object count, thresholds
  },
  metadata: {
    objectCount: number,
    usedMaterials: MaterialID[],
    hasDynamicObjects: boolean,
    accelerationStructure: 'none' | 'grid' | 'bvh'
  }
}
```

## Core Types

```glsl
struct NearbyObjects {
  float dists[3];      // Distances to 3 closest objects (sorted)
  int ids[3];          // Object IDs (-1 if none)
  int count;           // Number within BOUNDARY_THRESHOLD
}

// Scene-specific constants
const float BOUNDARY_THRESHOLD = 0.01;  // Material interface width
const float MARCH_EPSILON = 0.0001;
const int MAX_MARCH_STEPS = 256;
const float CONSERVATIVE_FACTOR = 0.9;  // Prevent overshooting
```

## Required Functions

### scene_intersect
```glsl
bool scene_intersect(Ray ray, out Hit hit)
```
- Find closest intersection along ray
- Populate Hit with geometric data and material IDs
- Returns false if no intersection

### scene_intersect_any
```glsl
bool scene_intersect_any(Ray ray, float max_t)
```
- Shadow ray optimization - just test for any hit
- No Hit structure needed
- Can march less conservatively

### scene_get_material
```glsl
int scene_get_material(vec3 p)
```
- Returns MaterialID at point p
- Resolves overlaps using deepest-point or priority rules
- Returns MATERIAL_AIR if outside all objects

### scene_get_distance
```glsl
float scene_get_distance(vec3 p)
```
- Minimum distance to any object surface
- Used by volume integrators
- Negative if inside an object

## Object Dispatch Functions

Scene generates dispatch functions to route to specific objects:

```glsl
// Distance evaluation dispatch
float scene_eval_object_distance(int obj_id, vec3 p) {
  switch(obj_id) {
    case 0: return object_sphere_0_distance(p);
    case 1: return object_box_1_distance(p);
    case 2: return object_torus_2_distance(p);
    // ... generated for all objects
  }
  return MAX_DIST;
}

// Material classification dispatch  
int scene_get_object_material(int obj_id, vec3 p) {
  switch(obj_id) {
    case 0: return object_sphere_0_material(p);
    case 1: return object_box_1_material(p);
    case 2: return object_torus_2_material(p);
    // ...
  }
  return MATERIAL_AIR;
}

// Normal calculation dispatch
vec3 scene_get_object_normal(int obj_id, vec3 p) {
  switch(obj_id) {
    case 0: return object_sphere_0_normal(p);
    case 1: return object_box_1_normal(p);
    case 2: return object_torus_2_normal(p);
    // ...
  }
  return vec3(0, 1, 0);  // Default up
}

// Transform dispatch (if using instances)
vec3 scene_transform_point(int obj_id, vec3 p) {
  switch(obj_id) {
    case 0: return transform_0(p);
    case 1: return p;  // No transform
    case 2: return transform_2(p);
    // ...
  }
  return p;
}
```

## Nearby Object Management

```glsl
// Track closest objects during marching
void scene_track_object(inout NearbyObjects nearby, float dist, int obj_id) {
  // Maintain sorted list of 3 closest
  if (dist < nearby.dists[2]) {
    nearby.dists[2] = dist;
    nearby.ids[2] = obj_id;
    
    // Bubble sort to maintain order
    if (dist < nearby.dists[1]) {
      swap(nearby.dists[2], nearby.dists[1]);
      swap(nearby.ids[2], nearby.ids[1]);
      
      if (dist < nearby.dists[0]) {
        swap(nearby.dists[1], nearby.dists[0]);
        swap(nearby.ids[1], nearby.ids[0]);
      }
    }
  }
}

// Find all nearby objects at a point
NearbyObjects scene_find_nearby(vec3 p) {
  NearbyObjects nearby;
  nearby.dists[0] = nearby.dists[1] = nearby.dists[2] = MAX_DIST;
  nearby.ids[0] = nearby.ids[1] = nearby.ids[2] = -1;
  nearby.count = 0;
  
  // Evaluate all objects (or use acceleration structure)
  #if USE_ACCELERATION
    int candidates[MAX_CANDIDATES];
    int num_candidates = accel_get_candidates(p, candidates);
    for(int i = 0; i < num_candidates; i++) {
      float d = scene_eval_object_distance(candidates[i], p);
      scene_track_object(nearby, d, candidates[i]);
    }
  #else
    // Unrolled for small scenes
    scene_track_object(nearby, scene_eval_object_distance(0, p), 0);
    scene_track_object(nearby, scene_eval_object_distance(1, p), 1);
    scene_track_object(nearby, scene_eval_object_distance(2, p), 2);
    // ... or loop for larger scenes
  #endif
  
  // Count objects within boundary
  for(int i = 0; i < 3; i++) {
    if(abs(nearby.dists[i]) < BOUNDARY_THRESHOLD) {
      nearby.count++;
    }
  }
  
  return nearby;
}

// Update nearby list when moving to new point
NearbyObjects scene_update_nearby(vec3 p, NearbyObjects previous) {
  // Optimization: only re-evaluate the tracked objects
  NearbyObjects nearby = previous;
  
  for(int i = 0; i < 3; i++) {
    if(nearby.ids[i] >= 0) {
      nearby.dists[i] = scene_eval_object_distance(nearby.ids[i], p);
    }
  }
  
  // Re-sort if needed
  // ... sorting logic ...
  
  return nearby;
}
```

## Material Interface Resolution

```glsl
// Resolve material at a point using nearby objects
int scene_resolve_material(vec3 p, NearbyObjects nearby) {
  // Fast path: no objects or outside all
  if(nearby.ids[0] < 0 || nearby.dists[0] > 0.0) {
    return MATERIAL_AIR;
  }
  
  // Single object inside
  if(nearby.count <= 1) {
    return scene_get_object_material(nearby.ids[0], p);
  }
  
  // Multiple objects: resolve by priority or deepest
  #if USE_PRIORITY_RESOLUTION
    int material = MATERIAL_AIR;
    int highest_priority = -1;
    
    for(int i = 0; i < nearby.count; i++) {
      if(nearby.dists[i] < 0.0) {
        int mat = scene_get_object_material(nearby.ids[i], p);
        int priority = material_get_priority(mat);  // From Materials module
        if(priority > highest_priority) {
          highest_priority = priority;
          material = mat;
        }
      }
    }
    return material;
  #else
    // Deepest point wins
    int material = MATERIAL_AIR;
    float deepest = 0.0;
    
    for(int i = 0; i < nearby.count; i++) {
      if(nearby.dists[i] < 0.0) {
        float depth = -nearby.dists[i];
        if(depth > deepest) {
          deepest = depth;
          material = scene_get_object_material(nearby.ids[i], p);
        }
      }
    }
    return material;
  #endif
}
```

## Ray Marching Implementation

```glsl
bool scene_intersect(Ray ray, out Hit hit) {
  float t = ray.tmin;
  NearbyObjects nearby;
  
  for(int steps = 0; steps < MAX_MARCH_STEPS && t < ray.tmax; steps++) {
    vec3 p = geometry_geodesic(ray.origin, ray.direction, t);
    nearby = scene_find_nearby(p);
    
    // Hit detection
    if(nearby.dists[0] < MARCH_EPSILON) {
      // Create hit
      hit.t = t;
      hit.p = p;
      hit.object_id = nearby.ids[0];
      hit.incident = ray.direction;
      hit.n = scene_get_object_normal(nearby.ids[0], p);
      hit.uv = vec2(0);  // Objects may provide UV
      
      // Material interface resolution
      vec3 p_from = p - ray.direction * BOUNDARY_THRESHOLD;
      vec3 p_to = p + ray.direction * BOUNDARY_THRESHOLD;
      
      NearbyObjects nearby_from = scene_update_nearby(p_from, nearby);
      NearbyObjects nearby_to = scene_update_nearby(p_to, nearby);
      
      hit.material_from = scene_resolve_material(p_from, nearby_from);
      hit.material_to = scene_resolve_material(p_to, nearby_to);
      
      // Geometric frame
      hit.frame = geometry_frame(hit.p, hit.n);
      
      return true;
    }
    
    // Conservative marching
    t += nearby.dists[0] * CONSERVATIVE_FACTOR;
  }
  
  return false;
}

// Optimized shadow ray version
bool scene_intersect_any(Ray ray, float max_t) {
  float t = ray.tmin;
  
  for(int steps = 0; steps < MAX_MARCH_STEPS && t < max_t; steps++) {
    vec3 p = geometry_geodesic(ray.origin, ray.direction, t);
    
    // Don't need full nearby tracking for shadows
    float min_dist = MAX_DIST;
    #if UNROLL_OBJECTS
      min_dist = min(min_dist, scene_eval_object_distance(0, p));
      min_dist = min(min_dist, scene_eval_object_distance(1, p));
      min_dist = min(min_dist, scene_eval_object_distance(2, p));
      // ...
    #else
      for(int i = 0; i < NUM_OBJECTS; i++) {
        min_dist = min(min_dist, scene_eval_object_distance(i, p));
      }
    #endif
    
    if(min_dist < MARCH_EPSILON) return true;
    
    // Can be less conservative for shadow rays
    t += min_dist * 0.95;
  }
  
  return false;
}
```

## Build-Time Generation

```typescript
class SceneCompiler {
  compile(objects: ObjectDefinition[], transforms: Transform[]): SceneModule {
    const dispatch = this.generateDispatchFunctions(objects);
    const marching = this.generateMarchingFunctions(objects.length);
    const resolution = this.generateMaterialResolution();
    
    return {
      id: { kind: 'scene', name: 'generated', version: '1.0' },
      fragment: {
        types: NEARBY_OBJECTS_STRUCT,
        dispatch: dispatch,
        functions: marching + resolution,
        uniforms: this.generateTransformUniforms(transforms),
        constants: this.generateConstants(objects)
      },
      metadata: {
        objectCount: objects.length,
        usedMaterials: this.extractUsedMaterials(objects),
        hasDynamicObjects: false,
        accelerationStructure: this.chooseAcceleration(objects.length)
      }
    };
  }
  
  generateDispatchFunctions(objects: ObjectDefinition[]): string {
    const distanceDispatch = this.generateDistanceDispatch(objects);
    const materialDispatch = this.generateMaterialDispatch(objects);
    const normalDispatch = this.generateNormalDispatch(objects);
    
    return distanceDispatch + materialDispatch + normalDispatch;
  }
  
  chooseAcceleration(count: number): 'none' | 'grid' | 'bvh' {
    if (count < 20) return 'none';       // Just check all
    if (count < 100) return 'grid';      // Simple spatial grid
    return 'bvh';                        // Full BVH for complex scenes
  }
}
```

## Optimization Strategies

### Small Scenes (<20 objects)
```glsl
// Fully unroll object evaluation
NearbyObjects scene_find_nearby(vec3 p) {
  NearbyObjects nearby;
  // ... initialization ...
  
  // Unrolled evaluation
  scene_track_object(nearby, object_sphere_0_distance(p), 0);
  scene_track_object(nearby, object_box_1_distance(p), 1);
  scene_track_object(nearby, object_torus_2_distance(p), 2);
  // ... all objects unrolled
  
  return nearby;
}
```

### Medium Scenes (20-100 objects)
```glsl
// Loop with uniform array indexing
uniform mat4 object_transforms[MAX_OBJECTS];
uniform int object_types[MAX_OBJECTS];

float scene_eval_object_distance(int id, vec3 p) {
  vec3 local_p = (object_transforms[id] * vec4(p, 1.0)).xyz;
  return object_distance_by_type(object_types[id], local_p);
}
```

### Large Scenes (100+ objects)
```glsl
// Spatial acceleration required
uniform sampler3D acceleration_grid;

int[MAX_CANDIDATES] scene_get_candidates(vec3 p) {
  ivec3 cell = ivec3(p * GRID_RESOLUTION);
  return decode_cell_objects(texelFetch(acceleration_grid, cell, 0));
}
```

## Validation Rules

1. **scene_intersect** must populate ALL Hit fields except those computed by Photography
2. Material interface resolution must be consistent (same point → same material)
3. Nearby tracking maintains exactly 3 objects, sorted by distance
4. Conservative marching factor prevents surface penetration
5. All MaterialIDs returned must be in scene's usedMaterials list or MATERIAL_AIR
6. Dispatch functions must handle all object IDs [0, objectCount)
7. Normal vectors must be unit length

## Key Design Changes

1. **Manual Prefixing**: All functions use `scene_` prefix
2. **No Material Properties**: Scene only knows MaterialIDs, not properties
3. **No IOR Computation**: Hit doesn't include ior_ratio (Photography computes when needed)
4. **Clear Separation**: Scene handles geometry and IDs, Photography handles physics
5. **Optimization Focus**: Dispatch and marching optimized based on scene complexity

This design makes Scene focused purely on spatial queries and material ID resolution, leaving all material properties and light physics to Photography.
