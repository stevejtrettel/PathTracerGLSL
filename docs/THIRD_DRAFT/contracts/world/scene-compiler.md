# SceneCompiler

## Purpose
Takes a list of objects and materials, produces a GLSL module with intersection and material property functions.

## Input

```typescript
interface SceneCompilerInput {
  objects: CompilerObject[];
  materials: CompilerMaterial[];
}

interface CompilerObject {
  id: string;
  sdf: string;           // GLSL function body for SDF
  materialId: number;    
  transform: mat4;
}

interface CompilerMaterial {
  id: number;
  albedo: vec3;
  roughness: number;
  metallic: number;
  ior: number;
  emission: vec3;
  flags: number;
}
```

## Output

A GLSL module with these exported functions:

```glsl
// Required exports
bool scene_intersect(Ray ray, out Hit hit)
bool scene_intersect_any(Ray ray, float max_t)
MaterialProperties scene_material_properties(int mat_id, Point p)
int scene_material_at(Point p)
float scene_bounding_radius()
```

## Compilation Strategy

### 1. Object SDF Generation

For each object, generate:
```glsl
float object_${id}_sdf(Point p) {
  // Apply inverse transform
  Point local = inverse_transform_${id}(p);
  // Evaluate SDF
  ${object.sdf}
}

int object_${id}_material() {
  return ${object.materialId};
}
```

### 2. Dispatch Function

Generate based on object count:

**Few objects (<5): Unrolled**
```glsl
float dispatch_sdf(Point p) {
  float d0 = object_0_sdf(p);
  float d1 = object_1_sdf(p);
  float d2 = object_2_sdf(p);
  return min(min(d0, d1), d2);
}
```

**Many objects: Loop**
```glsl
float dispatch_sdf(Point p) {
  float d = MAX_DIST;
  for (int i = 0; i < NUM_OBJECTS; i++) {
    d = min(d, eval_object_sdf(i, p));
  }
  return d;
}

float eval_object_sdf(int id, Point p) {
  switch(id) {
    case 0: return object_0_sdf(p);
    case 1: return object_1_sdf(p);
    // ...
  }
  return MAX_DIST;
}
```

### 3. Ray Marching

```glsl
bool scene_intersect(Ray ray, out Hit hit) {
  float t = 0.0;
  
  for (int step = 0; step < MAX_STEPS; step++) {
    Point p = geometry_geodesic(ray.origin, ray.direction, t);
    
    float d = dispatch_sdf(p);
    
    if (d < EPSILON) {
      hit.t = t;
      hit.p = p;
      hit.n = compute_normal(p);
      hit.frame = geometry_frame(p, hit.n);
      
      // Material interface resolution
      resolve_materials(ray, p, hit);
      
      return true;
    }
    
    t += d * 0.9;  // Conservative factor
    if (t > ray.max_t) break;
  }
  
  return false;
}
```

### 4. Material Resolution

Track nearby objects for boundary detection:

```glsl
void resolve_materials(Ray ray, Point p, out Hit hit) {
  // Find which object we hit
  int hit_object = find_closest_object(p);
  
  // Sample on either side of surface
  Point p_before = p - ray.direction * EPSILON;
  Point p_after = p + ray.direction * EPSILON;
  
  // Determine materials
  hit.material_from = material_at_point(p_before);
  hit.material_to = material_at_point(p_after);
  
  // Handle edge case: exiting volume
  if (dot(hit.n, ray.direction) > 0) {
    swap(hit.material_from, hit.material_to);
  }
}

int material_at_point(Point p) {
  // Find deepest object containing point
  int material = MATERIAL_AIR;
  float deepest = 0.0;
  
  for (int i = 0; i < NUM_OBJECTS; i++) {
    float d = object_${i}_sdf(p);
    if (d < 0 && -d > deepest) {
      deepest = -d;
      material = object_${i}_material();
    }
  }
  
  return material;
}
```

### 5. Material Properties

Generate based on analysis of material usage:

```glsl
// If roughness is constant across all materials:
#define CONST_ROUGHNESS 0.5

// Pack materials efficiently
uniform vec4 u_material_albedo_metallic[NUM_MATERIALS];
uniform vec4 u_material_ior_flags[NUM_MATERIALS];
uniform vec3 u_material_emission[NUM_MATERIALS];

MaterialProperties scene_material_properties(int id, Point p) {
  MaterialProperties props;
  
  vec4 am = u_material_albedo_metallic[id];
  props.albedo = am.rgb;
  props.metallic = am.a;
  
  props.roughness = CONST_ROUGHNESS;  // Or from array if varying
  
  vec4 if = u_material_ior_flags[id];
  props.ior = if.x;
  props.flags = int(if.y);
  
  props.emission = u_material_emission[id];
  
  return props;
}
```

## Optimization Strategies

### Constant Folding
If all materials share a property value, make it a compile-time constant.

### Dead Code Elimination
- No volume code if no participating media
- No emission lookup if no emissive materials
- No metallic calculations if all dielectrics

### Loop Unrolling
For <5 objects, unroll all loops for better GPU performance.

### Identity Transforms
Skip transform multiplication for objects at origin.

## Example Output

For a scene with 2 objects (sphere and box):

```glsl
// Generated object SDFs
float object_sphere_0_sdf(Point p) {
  return length(p - vec3(0,1,0)) - 1.0;
}

float object_box_1_sdf(Point p) {
  vec3 q = abs(p - vec3(2,0,0)) - vec3(1,1,1);
  return length(max(q,0.0)) + min(max(q.x,max(q.y,q.z)),0.0);
}

// Unrolled dispatch (only 2 objects)
float dispatch_sdf(Point p) {
  return min(object_sphere_0_sdf(p), object_box_1_sdf(p));
}

// Material properties (roughness constant for all)
#define CONST_ROUGHNESS 0.5

uniform vec4 u_material_albedo_metallic[2];
uniform vec4 u_material_ior_flags[2];
uniform vec3 u_material_emission[2];

MaterialProperties scene_material_properties(int id, Point p) {
  MaterialProperties props;
  vec4 am = u_material_albedo_metallic[id];
  props.albedo = am.rgb;
  props.metallic = am.a;
  props.roughness = CONST_ROUGHNESS;
  vec4 if = u_material_ior_flags[id];
  props.ior = if.x;
  props.emission = u_material_emission[id];
  props.flags = int(if.y);
  return props;
}

// Main intersection
bool scene_intersect(Ray ray, out Hit hit) {
  // ... marching loop using dispatch_sdf
}
```

The compiler produces clean, optimized GLSL without knowing where its input came from - it just compiles what it's given.
