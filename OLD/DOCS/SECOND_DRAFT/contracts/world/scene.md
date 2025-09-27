# Scene Contract

## Scene Definition

```typescript
interface SceneDefinition {
  objects: Array<{
    definition: CompiledObject;  // From Objects module
    transform: Transform;        // Position/rotation/scale
    id: number;                 // Unique scene object ID
  }>;
  
  usedMaterials: MaterialID[];  // All MaterialIDs referenced
  
  acceleration?: {
    type: 'none' | 'grid' | 'bvh';
    cellSize?: number;
    maxDepth?: number;
  };
}
```

## Module Structure

```typescript
{
  id: {
    kind: 'scene',
    name: string,
    version: string
  },
  provides: ['intersect', 'intersect_any', 'inside'],
  requires: ['geometry', 'objects'],
  fragment: {
    dispatch: string,     // Object dispatch functions
    functions: string,    // Marching and intersection
    uniforms: string,    // Transforms and parameters
  },
  metadata: {
    objectCount: number,
    usedMaterials: MaterialID[]
  }
}
```

## Required Functions

### intersect
```glsl
bool intersect(Ray ray, out Hit hit)
```
- Find closest intersection along ray
- Populate complete Hit structure including material interface
- Use nearby object tracking for material resolution
- Returns false if no intersection
- Note: Engine will auto-prefix to `sc_intersect`

### intersect_any
```glsl
bool intersect_any(Ray ray, float max_t)
```
- Test if ray hits anything before max_t
- Optimized for shadow rays (no Hit needed)
- Can use less conservative marching
- Note: Engine will auto-prefix to `sc_intersect_any`

### inside
```glsl
bool inside(Point p, int object_id)
```
- Test if point p is inside object
- object_id == -1 tests against any object
- Returns true if inside
- Note: Engine will auto-prefix to `sc_inside`

### classify_point
```glsl
int classify_point(Point p, int object_id)
```
- Returns MaterialID at point p
- Used for volume transport
- Note: Engine will auto-prefix to `sc_classify_point`

## Dispatch Functions

Scene generates dispatch to object functions:

```glsl
float eval_object_sdf(int obj_id, vec3 p) {
  switch(obj_id) {
    case 0: return sphere_0_sdf(p);
    case 1: return box_1_sdf(p);
    // ... for all objects
  }
  return MAX_DIST;
}

int get_object_material(int obj_id, vec3 p) {
  switch(obj_id) {
    case 0: return classify_sphere_0(p);
    case 1: return classify_box_1(p);
    // ... for all objects
  }
  return MATERIAL_AIR;
}

vec3 get_object_normal(int obj_id, vec3 p) {
  switch(obj_id) {
    case 0: return normal_sphere_0(p);
    case 1: return normal_box_1(p);
    // ... for all objects
  }
  return vec3(0, 1, 0);
}
```

## Nearby Object Tracking

```glsl
void track_object(inout NearbyObjects nearby, float dist, int obj_id) {
  // Maintain sorted list of 3 closest objects
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

NearbyObjects find_nearby(vec3 p) {
  NearbyObjects nearby;
  nearby.dists = float[3](MAX_DIST, MAX_DIST, MAX_DIST);
  nearby.ids = int[3](-1, -1, -1);
  
  // Evaluate all objects (or use acceleration)
  track_object(nearby, eval_object_sdf(0, p), 0);
  track_object(nearby, eval_object_sdf(1, p), 1);
  // ...
  
  // Count objects within boundary
  nearby.count = 0;
  for(int i = 0; i < 3; i++) {
    if(abs(nearby.dists[i]) < BOUNDARY_THRESHOLD) {
      nearby.count++;
    }
  }
  
  return nearby;
}
```

## Material Interface Resolution

```glsl
int resolve_material(vec3 p, NearbyObjects nearby) {
  // Fast path: single object
  if(nearby.count <= 1) {
    if(nearby.ids[0] >= 0 && nearby.dists[0] < 0.0) {
      return get_object_material(nearby.ids[0], p);
    }
    return MATERIAL_AIR;
  }
  
  // Multiple objects: deepest wins
  int material = MATERIAL_AIR;
  float deepest = 0.0;
  
  for(int i = 0; i < nearby.count; i++) {
    if(nearby.dists[i] < 0.0) {
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

## Hit Creation

```glsl
Hit create_hit(Ray ray, float t, int object_id, NearbyObjects nearby) {
  Hit hit;
  vec3 p = g_geodesic(ray.origin, ray.direction, t);
  
  // Geometric data
  hit.t = t;
  hit.p = p;
  hit.object_id = object_id;
  hit.incident = ray.direction;
  hit.n = get_object_normal(object_id, p);
  hit.uv = vec2(0);  // Object may provide
  
  // Material interface (using nearby objects)
  vec3 p_from = p - ray.direction * EPSILON;
  vec3 p_to = p + ray.direction * EPSILON;
  
  NearbyObjects nearby_from = update_nearby_at(p_from, nearby);
  NearbyObjects nearby_to = update_nearby_at(p_to, nearby);
  
  hit.material_from = resolve_material(p_from, nearby_from);
  hit.material_to = resolve_material(p_to, nearby_to);
  
  // Precompute helpers
  hit.frame = g_frame(hit.p, hit.n);
  hit.ior_ratio = material_iors[hit.material_from] / 
                  material_iors[hit.material_to];
  
  return hit;
}
```

## Marching Loop

```glsl
bool sc_intersect(Ray ray, out Hit hit) {
  float t = ray.tmin;
  
  for (int i = 0; i < MAX_STEPS && t < ray.tmax; i++) {
    Point p = g_geodesic(ray.origin, ray.direction, t);
    NearbyObjects nearby = find_nearby(p);
    
    if (nearby.dists[0] < EPSILON) {
      hit = create_hit(ray, t, nearby.ids[0], nearby);
      return true;
    }
    
    t += nearby.dists[0] * 0.9;  // Conservative factor
  }
  
  return false;
}
```

## Optimization Strategies

1. **Small scenes** (<20 objects): Fully unroll object evaluation
2. **Medium scenes** (20-100): Loop with uniform arrays
3. **Large scenes** (100+): Spatial acceleration required
4. **Shadow rays**: Skip material resolution and nearby tracking
5. **Identity transforms**: Compile away to no-ops
6. **Isosurfaces**: Use zero-crossing detection

## Validation

1. Scene populates ALL Hit fields including material interface
2. Material resolution is consistent (same point → same material)
3. Nearby tracking maintains at most 3 objects
4. Dispatch functions handle all object IDs
5. Conservative marching factor prevents surface penetration
6. IOR ratio correctly computed from material tables
