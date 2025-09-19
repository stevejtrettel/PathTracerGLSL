# Scene Module Contract

## Purpose
Scene modules organize spatial queries, manage object arrangement, and resolve material interfaces. They are generated at build time from scene descriptions and compiled object definitions, producing optimized GLSL that implements efficient ray-object intersection with material boundary handling.

## Core Architecture

### Scene Definition Structure

```typescript
interface SceneDefinition {
  // Objects placed in the scene
  objects: Array<{
    definition: CompiledObject;  // From Objects module
    transform: Transform;         // Position/rotation/scale
    id: number;                  // Scene-specific ID
  }>;
  
  // Material IDs used (for Material module)
  usedMaterials: Set<MaterialID>;
  
  // Acceleration structure hints
  acceleration?: {
    type: 'none' | 'grid' | 'bvh' | 'bounded';
    cellSize?: number;
    maxDepth?: number;
  };
  
  // Optimization hints
  hints?: {
    expectedComplexity: 'simple' | 'medium' | 'complex';
    primaryRayOnly?: boolean;
    shadowRaysFrequent?: boolean;
  };
}
```

### Generation Pipeline

```typescript
// Build time: Arrange objects and generate optimized traversal
SceneOrganizer → analyze(objects) → optimize() → compile() → ModuleDescriptor
```

### Module Descriptor

```typescript
{
  id: {
    kind: 'scene',
    name: string,                // e.g., 'optimized_sdf_scene'
    version: string
  },
  provides: ['intersect', 'intersect_any', 'inside'],
  requires: ['geometry', 'objects'],  // Needs both modules
  fragment: {
    functions: string,           // Generated traversal code
    uniforms: string,           // Transform matrices, etc.
    dispatch: string,           // Object dispatch functions
  },
  metadata: {
    objectCount: number,
    usedMaterials: MaterialID[],
    hasVolumes: boolean,
    hasDielectrics: boolean
  }
}
```

## Required Functions

All Scene modules must implement:

### intersect
Find the closest intersection along a ray.
```glsl
bool sc_intersect(Ray ray, out Hit hit)
```
- **ray**: Ray to test (origin, direction, tmin, tmax)
- **hit**: Output - complete intersection information including material interface
- **returns**: True if intersection found

### intersect_any
Test if ray hits anything (for shadows/occlusion).
```glsl
bool sc_intersect_any(Ray ray, float max_t)
```
- **ray**: Ray to test
- **max_t**: Maximum distance to test
- **returns**: True if any intersection exists

### inside
Test if a point is inside an object.
```glsl
bool sc_inside(Point p, int object_id)
```
- **p**: Point to test
- **object_id**: Which object to test against (-1 for any)
- **returns**: True if point is inside object

## Nearby Object Tracking System

The core optimization for efficient material interface resolution:

```glsl
// Structure for tracking nearby objects during marching
struct NearbyObjects {
    float dists[3];      // Distances to closest 3 objects
    int ids[3];          // Object IDs of closest 3
    int count;           // How many are within BOUNDARY_THRESHOLD
};

// Helper to maintain top 3 closest objects
void track_object(inout NearbyObjects nearby, float dist, int obj_id) {
    if (dist < nearby.dists[2]) {
        nearby.dists[2] = dist;
        nearby.ids[2] = obj_id;
        
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
```

## Object Dispatch System

Scene maintains dispatch functions to call object-specific code:

```glsl
// Dispatch to object distance functions
float eval_object_sdf(int obj_id, vec3 p) {
    switch(obj_id) {
        case 0: return sphere_sdf(p, sphere_0_transform);
        case 1: return box_sdf(p, box_1_transform);
        case 2: return gyroid_distance(p);
        // ... generated for all objects
    }
    return MAX_DIST;
}

// Dispatch to object classifiers
int get_object_material(int obj_id, vec3 p) {
    switch(obj_id) {
        case 0: return classify_sphere_0(p);
        case 1: return classify_box_1(p);
        case 2: return classify_gyroid_0(p);
        // ... generated for all objects
    }
    return MATERIAL_AIR;
}

// Dispatch to object normals
vec3 get_object_normal(int obj_id, vec3 p) {
    switch(obj_id) {
        case 0: return normal_sphere_0(p);
        case 1: return normal_box_1(p);
        case 2: return normal_gyroid_0(p);
        // ... generated for all objects
    }
    return vec3(0, 1, 0);
}
```

## Material Interface Resolution

Scene resolves which material is at any point using nearby object tracking:

```glsl
// Efficient material resolution using only nearby objects
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

## Generation Examples

### Simple SDF Scene

```typescript
const scene: SceneDefinition = {
  objects: [
    { 
      definition: sphereObject,  // From Objects module
      transform: { position: [0,0,0], scale: 1.0 },
      id: 0
    },
    {
      definition: boxObject,
      transform: { position: [2,0,0], scale: 1.0 },
      id: 1
    }
  ],
  usedMaterials: new Set([MATERIAL_GLASS, MATERIAL_WOOD]),
  acceleration: { type: 'none' }  // Small scene, no acceleration
};

// Generates:
```
```glsl
// Constants for boundary detection
const float BOUNDARY_THRESHOLD = 0.01;
const float EPSILON = 0.0001;

// Object transforms (if not identity)
const mat4 sphere_0_transform = mat4(1.0);
const mat4 box_1_transform = mat4(
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    2, 0, 0, 1  // Translation
);

// Main marching with nearby tracking
bool march_objects(Ray ray, out float hit_t, out int hit_object, 
                   out NearbyObjects hit_nearby, float max_t) {
    float t = ray.tmin;
    
    for (int i = 0; i < MAX_STEPS && t < max_t; i++) {
        Point p = g_geodesic(ray.origin, ray.direction, t);
        
        // Track closest objects
        NearbyObjects nearby;
        nearby.dists = float[3](MAX_DIST, MAX_DIST, MAX_DIST);
        nearby.ids = int[3](-1, -1, -1);
        
        // Evaluate all objects (unrolled for small scenes)
        track_object(nearby, sphere_sdf(transform_point(p, sphere_0_transform)), 0);
        track_object(nearby, box_sdf(transform_point(p, box_1_transform)), 1);
        
        // Count objects within boundary threshold
        nearby.count = 0;
        for(int j = 0; j < 3; j++) {
            if(abs(nearby.dists[j]) < BOUNDARY_THRESHOLD) {
                nearby.count++;
            }
        }
        
        // Check for hit
        if (nearby.dists[0] < EPSILON) {
            hit_t = t;
            hit_object = nearby.ids[0];
            hit_nearby = nearby;
            return true;
        }
        
        t += nearby.dists[0] * 0.9;  // Conservative step
    }
    return false;
}

// Create hit with material interface resolution
Hit create_hit(float t, vec3 p, vec3 ray_dir, int object_id, 
               NearbyObjects nearby) {
    Hit hit;
    hit.t = t;
    hit.p = p;
    hit.object_id = object_id;
    hit.n = get_object_normal(object_id, p);
    
    // Material interface using only nearby objects
    vec3 before = p - ray_dir * EPSILON;
    vec3 after = p + ray_dir * EPSILON;
    
    // Update distances for offset points (only 3 objects max)
    NearbyObjects nearby_before = nearby;
    NearbyObjects nearby_after = nearby;
    
    for(int i = 0; i < 3; i++) {
        if(nearby.ids[i] >= 0) {
            nearby_before.dists[i] = eval_object_sdf(nearby.ids[i], before);
            nearby_after.dists[i] = eval_object_sdf(nearby.ids[i], after);
        }
    }
    
    hit.material_from = resolve_material(before, nearby_before);
    hit.material_to = resolve_material(after, nearby_after);
    
    // Precompute helpers
    hit.frame = g_frame(hit.p, hit.n);
    hit.ior_ratio = material_iors[hit.material_from] / material_iors[hit.material_to];
    
    return hit;
}

// Main intersection
bool sc_intersect(Ray ray, out Hit hit) {
    float t;
    int obj_id;
    NearbyObjects nearby;
    
    if(march_objects(ray, t, obj_id, nearby, ray.tmax)) {
        vec3 hit_p = ray.origin + ray.direction * t;
        hit = create_hit(t, hit_p, ray.direction, obj_id, nearby);
        return true;
    }
    
    return false;
}

// Shadow test (can be simpler)
bool sc_intersect_any(Ray ray, float max_t) {
    float t = ray.tmin;
    
    for (int i = 0; i < MAX_STEPS && t < max_t; i++) {
        Point p = g_geodesic(ray.origin, ray.direction, t);
        
        float d = MAX_DIST;
        d = min(d, sphere_sdf(transform_point(p, sphere_0_transform)));
        d = min(d, box_sdf(transform_point(p, box_1_transform)));
        
        if (d < EPSILON) return true;
        t += d * 0.9;
    }
    return false;
}
```

### Mixed SDF and Isosurface Scene

```typescript
const scene: SceneDefinition = {
  objects: [
    { definition: sphereSDF, transform: identity, id: 0 },
    { definition: gyroidIsosurface, transform: identity, id: 1 }
  ],
  usedMaterials: new Set([MATERIAL_GLASS, MATERIAL_PORCELAIN])
};

// Generates unified marching with zero-crossing detection:
```
```glsl
bool march_mixed(Ray ray, out float hit_t, out int hit_object, 
                 out NearbyObjects hit_nearby, float max_t) {
    float t = ray.tmin;
    float last_gyroid_f = 0.0;  // For zero-crossing
    
    for (int i = 0; i < MAX_STEPS && t < max_t; i++) {
        Point p = g_geodesic(ray.origin, ray.direction, t);
        
        NearbyObjects nearby;
        nearby.dists = float[3](MAX_DIST, MAX_DIST, MAX_DIST);
        nearby.ids = int[3](-1, -1, -1);
        
        // SDF object
        track_object(nearby, sphere_sdf(p), 0);
        
        // Isosurface with zero-crossing check
        float f = gyroid_f(p);
        vec3 grad = gyroid_gradient(p);
        float d = abs(f) / max(length(grad), 0.001);
        track_object(nearby, d, 1);
        
        // Check for zero crossing
        if(i > 0 && last_gyroid_f * f < 0.0) {
            // Bisect to find exact intersection
            hit_t = bisect_isosurface(ray, t - last_step, t, 1);
            hit_object = 1;
            vec3 hit_p = ray.origin + ray.direction * hit_t;
            hit_nearby = find_nearby_at_point(hit_p);
            return true;
        }
        last_gyroid_f = f;
        
        // Count nearby
        nearby.count = 0;
        for(int j = 0; j < 3; j++) {
            if(abs(nearby.dists[j]) < BOUNDARY_THRESHOLD) {
                nearby.count++;
            }
        }
        
        // Regular hit detection
        if (nearby.dists[0] < EPSILON) {
            hit_t = t;
            hit_object = nearby.ids[0];
            hit_nearby = nearby;
            return true;
        }
        
        t += nearby.dists[0] * 0.9;
    }
    return false;
}
```

### Acceleration Structure Generation

For larger scenes, generate spatial acceleration:

```typescript
const scene: SceneDefinition = {
  objects: [...100+ objects...],
  acceleration: { 
    type: 'grid',
    cellSize: 2.0
  }
};

// Generates grid acceleration:
```
```glsl
// Grid acceleration structure
const ivec3 GRID_DIM = ivec3(32, 32, 32);
const float CELL_SIZE = 2.0;

// Precomputed object-cell mapping
const int cell_starts[GRID_DIM.x * GRID_DIM.y * GRID_DIM.z];
const int cell_counts[GRID_DIM.x * GRID_DIM.y * GRID_DIM.z];
const int cell_objects[MAX_CELL_OBJECTS];

int hash_cell(ivec3 cell) {
    return cell.x + cell.y * GRID_DIM.x + cell.z * GRID_DIM.x * GRID_DIM.y;
}

bool march_accelerated(Ray ray, out float hit_t, out int hit_object,
                       out NearbyObjects hit_nearby, float max_t) {
    float t = ray.tmin;
    
    for (int i = 0; i < MAX_STEPS && t < max_t; i++) {
        Point p = g_geodesic(ray.origin, ray.direction, t);
        
        // Find which cell we're in
        ivec3 cell = ivec3(floor(p / CELL_SIZE));
        int cell_hash = hash_cell(cell);
        
        NearbyObjects nearby;
        nearby.dists = float[3](MAX_DIST, MAX_DIST, MAX_DIST);
        nearby.ids = int[3](-1, -1, -1);
        
        // Only test objects in this cell
        int start = cell_starts[cell_hash];
        int count = cell_counts[cell_hash];
        
        for(int j = 0; j < count; j++) {
            int obj_id = cell_objects[start + j];
            float d = eval_object_sdf(obj_id, p);
            track_object(nearby, d, obj_id);
        }
        
        // Rest of marching logic...
    }
}
```

## Optimization Strategies

### 1. Scene Complexity Adaptation

```glsl
// Small scenes (< 20 objects): Fully unrolled
track_object(nearby, sphere_sdf(p - vec3(0,0,0), 1.0), 0);
track_object(nearby, sphere_sdf(p - vec3(2,0,0), 0.5), 1);
// ... unrolled for each object

// Medium scenes (20-100): Loop with uniforms
uniform vec3 u_sphere_centers[50];
uniform float u_sphere_radii[50];
for(int i = 0; i < 50; i++) {
    float d = sphere_sdf(p - u_sphere_centers[i], u_sphere_radii[i]);
    track_object(nearby, d, i);
}

// Large scenes (100+): Spatial acceleration required
```

### 2. Transform Optimization

```glsl
// Identity transforms compiled away
vec3 p_local = p;  // No transform needed

// Simple translations compiled inline
vec3 p_local = p - vec3(2, 0, 0);

// Complex transforms use matrices
vec3 p_local = (inverse(object_transform) * vec4(p, 1.0)).xyz;
```

### 3. Early Rejection

```glsl
// Bounding volume test before expensive SDF
float bound = sphere_sdf(p - fractal_center, fractal_radius);
if (bound > 0.1) {
    track_object(nearby, bound, fractal_id);  // Use bound
} else {
    track_object(nearby, fractal_sdf(p), fractal_id);  // Full eval
}
```

### 4. Shadow Ray Optimization

```glsl
bool sc_intersect_any(Ray ray, float max_t) {
    // Simplified: no nearby tracking, no material resolution
    // Can use larger steps, less conservative factor
    float t = ray.tmin;
    for (int i = 0; i < MAX_STEPS/2 && t < max_t; i++) {
        Point p = g_geodesic(ray.origin, ray.direction, t);
        float d = scene_sdf_simple(p);  // Just distance, no tracking
        if (d < EPSILON) return true;
        t += d;  // Less conservative for shadows
    }
    return false;
}
```

## Scene Compiler

```typescript
class SceneCompiler {
  private objects: CompiledObject[];
  private transforms: Transform[];
  
  analyze(scene: SceneDefinition): SceneAnalysis {
    return {
      objectCount: scene.objects.length,
      hasIsosurfaces: scene.objects.some(o => o.type === 'isosurface'),
      hasAnalyticShapes: scene.objects.some(o => o.hasAnalyticIntersect),
      boundingVolume: this.computeSceneBounds(scene),
      complexity: this.estimateComplexity(scene),
      usedMaterials: this.collectMaterials(scene)
    };
  }
  
  compile(scene: SceneDefinition, analysis: SceneAnalysis): ModuleDescriptor {
    const dispatch = this.generateDispatchFunctions(scene);
    const marching = this.generateMarchingFunction(scene, analysis);
    const acceleration = this.generateAcceleration(scene, analysis);
    const uniforms = this.generateUniforms(scene, analysis);
    
    return {
      id: { kind: 'scene', name: 'compiled_scene', version: '1.0.0' },
      provides: ['intersect', 'intersect_any', 'inside'],
      requires: ['geometry', 'objects'],
      fragment: {
        dispatch,
        functions: marching + acceleration,
        uniforms
      },
      metadata: {
        objectCount: analysis.objectCount,
        usedMaterials: Array.from(analysis.usedMaterials),
        hasVolumes: analysis.hasVolumes,
        hasDielectrics: analysis.hasDielectrics
      }
    };
  }
  
  generateDispatchFunctions(scene: SceneDefinition): string {
    // Generate switch statements for object dispatch
    const distanceCases = scene.objects.map(obj => 
      `case ${obj.id}: return ${obj.definition.distanceFunction}(p);`
    ).join('\n');
    
    const materialCases = scene.objects.map(obj => 
      `case ${obj.id}: return ${obj.definition.classifierFunction}(p);`
    ).join('\n');
    
    return `
float eval_object_sdf(int obj_id, vec3 p) {
    switch(obj_id) {
        ${distanceCases}
    }
    return MAX_DIST;
}

int get_object_material(int obj_id, vec3 p) {
    switch(obj_id) {
        ${materialCases}
    }
    return MATERIAL_AIR;
}`;
  }
}
```

## Performance Considerations

- **Minimal branching**: Predictable control flow in tight loops
- **Memory coherence**: Group similar object types
- **Register pressure**: Track only 3 nearby objects
- **Conservative marching**: 0.9 factor for reliability
- **Early termination**: Update ray.tmax on hits
- **LOD selection**: Simpler SDFs at distance
- **Efficient boundaries**: Only test 2-3 objects at interfaces
- **Shadow optimization**: Simplified traversal for occlusion
- **Transform caching**: Precompute inverse matrices

## Integration with Other Modules

### From Objects Module
Scene receives compiled objects with:
- Distance/evaluation functions
- Classification functions
- Normal computation functions
- Material IDs they use

### To Material Module
Scene provides:
- Material IDs at interfaces (material_from, material_to)
- Precomputed IOR ratios
- Hit structure with all required fields

### With Geometry Module
Scene uses geometry functions for:
- Geodesic ray marching
- Frame construction
- Distance calculations in curved space

## Validation Requirements

Generated scenes must:
1. Implement all three required functions
2. Populate ALL Hit structure fields
3. Resolve material interfaces consistently
4. Handle edge cases (grazing rays, coincident surfaces)
5. Maintain normals pointing outward
6. Respect ray parameter bounds (tmin < t < tmax)
7. Track nearby objects correctly (max 3)
8. Dispatch to correct object functions
9. Work with geometry module's coordinate system

## Design Principles

1. **Scene arranges, doesn't create** - Objects come pre-compiled
2. **Efficient boundary resolution** - Track only nearby objects
3. **Material interfaces are Scene's job** - Not Objects or Materials
4. **Optimize for common case** - Single object intersections
5. **Acceleration is optional** - Small scenes don't need it
6. **Dispatch is simple** - Just switch statements
7. **Transforms are Scene's concern** - Objects work in local space

## Future Extensions

- **BVH traversal**: Hierarchical acceleration for complex scenes
- **Mesh integration**: Hybrid SDF/mesh scenes
- **LOD systems**: Multiple object representations by distance
- **Instancing**: Reuse object definitions with different transforms
- **Temporal caching**: Reuse intersection results across frames
- **Smart prediction**: Predict nearby objects from ray direction
- **Dynamic scenes**: Update acceleration structures incrementally
