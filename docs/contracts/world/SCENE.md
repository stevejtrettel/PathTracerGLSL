# Scene Module Contract

## Purpose
Scene modules manage spatial queries and object arrangement. They are generated at build time from high-level scene descriptions, producing optimized GLSL that implements the required intersection functions.

## Generation Pipeline
```typescript
// Build time: TypeScript constructs optimized GLSL
SceneBuilder → analyze() → optimize() → compile() → ModuleDescriptor
```

## Module Descriptor
```typescript
{
  id: {
    kind: 'scene',
    name: string,                // e.g., 'optimized_sdf_scene'
    version: string
  },
  provides: ['intersect', 'intersect_any', 'inside'],
  requires: ['geometry'],         // For geodesic marching
  fragment: {
    functions: string,           // Generated optimized GLSL
    uniforms: string,           // Generated uniform declarations
  },
  parameters: Array<{           // Scene configuration parameters
    name: string,
    type: string,
    default: any
  }>
}
```

## Required Functions

All generated Scene modules must implement these functions:

### intersect
Find the closest intersection along a ray.
```glsl
bool sc_intersect(Ray ray, out Hit hit)
```
- **ray**: Ray to test (origin, direction, tmin, tmax)
- **hit**: Output - complete intersection information including material interface
- **returns**: True if intersection found
- **Note**: Must populate all Hit fields including material interface

### intersect_any
Test if ray hits anything (for shadows/occlusion).
```glsl
bool sc_intersect_any(Ray ray, float max_t)
```
- **ray**: Ray to test
- **max_t**: Maximum distance to test
- **returns**: True if any intersection exists
- **Note**: Can early-exit for efficiency

### inside
Test if a point is inside an object.
```glsl
bool sc_inside(Point p, int object_id)
```
- **p**: Point to test
- **object_id**: Which object to test against (-1 for any)
- **returns**: True if point is inside object

## Generation Examples

### Simple SDF Scene
```typescript
const builder = new SceneBuilder();
builder.addSphere([0,0,0], 1, { albedo: [0.8, 0.2, 0.2] });
builder.addBox([2,0,0], [1,1,1], { roughness: 0.5 });

const module = builder.compile();
// Generates:
```
```glsl
// Optimized SDF with inlined constants
float scene_sdf(Point p) {
  float d = sphere_sdf(p - vec3(0,0,0), 1.0);
  d = min(d, box_sdf(p - vec3(2,0,0), vec3(1)));
  return d;
}

// Material properties compiled to arrays
const vec3 object_albedos[2] = vec3[](
  vec3(0.8, 0.2, 0.2),
  vec3(0.8, 0.8, 0.8)  // Default for second object
);

bool sc_intersect(Ray ray, out Hit hit) {
  // Optimized marching implementation
  float t = ray.tmin;
  for (int i = 0; i < MAX_STEPS && t < ray.tmax; i++) {
    Point p = g_geodesic(ray.origin, ray.direction, t);
    float d = scene_sdf(p);
    
    if (d < EPSILON) {
      hit.p = p;
      hit.t = t;
      hit.n = compute_normal(p);
      hit.object_id = identify_object(p);
      
      // Material interface resolution (inlined logic)
      resolve_interface(hit);
      return true;
    }
    t += d * 0.9;
  }
  return false;
}
```

### CSG Operations
```typescript
// CSG operations happen at build time in TypeScript
const sphere1 = builder.sphere([0,0,0], 1);
const sphere2 = builder.sphere([0.5,0,0], 0.8);
const result = builder.smoothUnion(sphere1, sphere2, 0.1);

// Generates optimized SDF:
float scene_sdf(Point p) {
  float d1 = sphere_sdf(p - vec3(0,0,0), 1.0);
  float d2 = sphere_sdf(p - vec3(0.5,0,0), 0.8);
  
  // Smooth union compiled inline
  float k = 0.1;
  float h = clamp(0.5 + 0.5*(d2-d1)/k, 0.0, 1.0);
  return mix(d2, d1, h) - k*h*(1.0-h);
}
```

### Acceleration Structures
```typescript
// Builder analyzes scene and generates acceleration
const builder = new SceneBuilder();
builder.addComplexSDF(myFractal, boundingSphere);
builder.enableAcceleration('bounded');

// Generates:
float scene_sdf(Point p) {
  // Check bounding volumes first
  float bound = sphere_sdf(p - fractal_center, fractal_radius);
  if (bound > 0.1) return bound;  // Early exit
  
  // Only evaluate expensive SDF when close
  return fractal_sdf(p);
}
```

## Optimization Strategies

Generated scenes are optimized through:

### 1. Constant Folding
```glsl
// Before: Dynamic positions
vec3 positions[N];
float d = sphere_sdf(p - positions[0], radii[0]);

// After: Compile-time constants
float d = sphere_sdf(p - vec3(0,0,0), 1.0);
```

### 2. Dead Object Elimination
```typescript
// Objects outside view frustum can be eliminated
if (!builder.isVisible(object)) {
  // Don't include in generated SDF
}
```

### 3. Property Array Optimization
```glsl
// Separate constant and varying properties
const vec3 const_albedos[32] = vec3[](...);  // Compile-time
uniform float u_roughness[8];                  // Runtime varying
```

### 4. Inline Expansion
```glsl
// Small loops unrolled
// Instead of: for(int i = 0; i < 3; i++) d = min(d, spheres[i]);
d = sphere_sdf(p - vec3(0,0,0), 1.0);
d = min(d, sphere_sdf(p - vec3(2,0,0), 0.5));
d = min(d, sphere_sdf(p - vec3(-2,0,0), 0.7));
```

## Material Interface Resolution

Scene modules must resolve material interfaces:

```glsl
// Generated interface resolution (optimized per scene)
void resolve_interface(inout Hit hit) {
  // For simple objects
  if (hit.object_id < SIMPLE_OBJECT_COUNT) {
    float cos_theta = dot(ray.direction, hit.n);
    if (cos_theta < 0) {
      hit.material_from = MATERIAL_AIR;
      hit.material_to = object_materials[hit.object_id];
    } else {
      hit.material_from = object_materials[hit.object_id];
      hit.material_to = MATERIAL_AIR;
    }
  } 
  // For compound objects (generated specialized code)
  else {
    resolve_compound_interface(hit);
  }
  
  hit.ior_from = material_iors[hit.material_from];
  hit.ior_to = material_iors[hit.material_to];
  hit.ior_ratio = hit.ior_from / hit.ior_to;
}
```

## Builder Interface

```typescript
class SceneBuilder {
  // Object creation
  addSphere(center: Vec3, radius: number, material?: MaterialProps): void;
  addBox(center: Vec3, size: Vec3, material?: MaterialProps): void;
  addSDF(sdf: SDFExpression, bounds: BoundingVolume): void;
  
  // CSG operations (computed at build time)
  union(a: SDFObject, b: SDFObject): SDFObject;
  intersection(a: SDFObject, b: SDFObject): SDFObject;
  difference(a: SDFObject, b: SDFObject): SDFObject;
  smoothUnion(a: SDFObject, b: SDFObject, k: number): SDFObject;
  
  // Optimization hints
  enableAcceleration(type: 'bounded' | 'hierarchical' | 'grid'): void;
  setComplexity(level: 'simple' | 'moderate' | 'complex'): void;
  
  // Compilation
  analyze(): SceneAnalysis;  // What optimizations are possible
  compile(): ModuleDescriptor;  // Generate optimized GLSL
}
```

## Compound Objects

For multi-material objects like glass containing water:

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
  
  // Test only parts of this compound (not entire scene!)
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

## Spatial Acceleration

Generated scenes can include acceleration structures:

```glsl
// Divide space into regions
int get_region(Point p) {
  ivec3 grid = ivec3(floor(p / GRID_SIZE));
  return grid.x + grid.y * GRID_DIM + grid.z * GRID_DIM * GRID_DIM;
}

bool sc_intersect_accelerated(Ray ray, out Hit hit) {
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

## Performance Considerations

Generated scenes optimize for:
- **Minimal branching**: Predictable control flow
- **Memory coherence**: Group similar accesses
- **Register pressure**: Minimize live variables
- **Instruction count**: Fold operations at compile time
- **Conservative marching**: Adaptive step sizes for SDFs
- **Early termination**: Update ray.tmax on hits
- **LOD selection**: Simpler SDFs at distance
- **Cached lookups**: Reuse material properties

## Validation Requirements

The builder ensures generated code:
1. Implements all required functions correctly
2. Populates ALL Hit structure fields (including material interface)
3. Resolves material interfaces consistently
4. Maintains normals pointing outward
5. Handles edge cases (grazing rays, coincident surfaces)
6. Returns consistent normals (outward facing)
7. Sets proper UV coordinates
8. Maintains t parameter ordering (tmin < t < tmax)

## Integration Notes

- **SDF scenes** benefit from adaptive step sizes
- **Compounds** should cache material lookups
- **Consider LOD** for distant objects
- **Precompute** static acceleration structures
- **Use conservative bounds** for early rejection
- **Batch property access** when possible
- **Profile generated code** to verify optimizations

## Future Extensions

The generation approach supports:
- **Mesh integration**: Generate hybrid SDF/mesh intersection
- **LOD systems**: Multiple detail levels based on distance
- **Instancing**: Efficient repeated geometry
- **Procedural generation**: Noise-based surfaces
- **Hybrid representations**: Mix SDFs, meshes, and voxels
- **Temporal caching**: Reuse computations across frames
