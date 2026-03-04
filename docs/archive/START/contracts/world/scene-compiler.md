Looking at the scene-compiler.md document, it needs a significant rewrite. It's still based on the old object-tracking system for MIS, but in our new architecture:

1. **No object_id needed** - Materials directly reference lights via `light_id`
2. **No special SDF exports** - We removed `scene_evaluate_object_sdf` and `scene_compute_object_normal`
3. **Simpler Hit structure** - No object tracking
4. **Materials have light_id** - Direct reference, no cross-referencing

Here's the updated version:

# SceneCompiler

## Purpose
Takes a list of objects and materials and produces a GLSL module with intersection and material property functions. Materials directly reference their associated lights through `light_id`, eliminating the need for object tracking.

## Input Structure

```typescript
interface SceneCompilerInput {
  objects: CompilerObject[];
  materials: CompilerMaterial[];
}

interface CompilerObject {
  id: string;
  sdf: string;            // GLSL function for SDF
  materialId: number;     // Which material it uses
  transform: mat4;
}

interface CompilerMaterial {
  id: number;
  albedo: vec3;
  roughness: number;
  metallic: number;
  ior: number;
  emission: vec3;
  light_id: number;      // -1 if non-emissive, else index into light array
  flags: number;
}
```

## Output Requirements

The module must export these functions:

```glsl
// Core intersection
bool scene_intersect(Ray ray, out Hit hit)
bool scene_intersect_any(Ray ray, float max_t)

// Material queries  
MaterialProperties scene_material_properties(int mat_id, Point p)
int scene_material_at(Point p)

// Scene information
float scene_bounding_radius()
```

## Hit Structure

Clean and simple - no object tracking needed:

```glsl
struct Hit {
  // Geometric data
  Point p;
  Normal n;
  vec2 uv;
  float t;
  
  // Material interface
  int material_from;
  int material_to;
  
  // Frame
  Frame frame;
}
```

## Compilation Strategy

### Step 1: Generate Object SDFs

Each object gets an SDF function:

```typescript
private generateObjectSDFs(objects: CompilerObject[]): string {
  return objects.map((obj, index) => `
    // Object ${index}: ${obj.id}
    float object_${index}_sdf(Point p) {
      // Apply inverse transform
      Point local = inverse_transform_${index}(p);
      
      // Evaluate SDF
      ${obj.sdf}
    }
    
    int object_${index}_material() {
      return ${obj.materialId};
    }
  `).join('\n');
}
```

### Step 2: The Dispatch Function

For ray marching, we need the minimum distance to any object:

#### Few Objects (<5): Unrolled
```glsl
float dispatch_sdf(Point p) {
  float d0 = object_0_sdf(p);
  float d1 = object_1_sdf(p);
  float d2 = object_2_sdf(p);
  
  return min(min(d0, d1), d2);
}
```

#### Many Objects: Loop
```glsl
float dispatch_sdf(Point p) {
  float dist = MAX_DIST;
  
  for (int i = 0; i < NUM_OBJECTS; i++) {
    float d = evaluate_object_sdf(i, p);
    dist = min(dist, d);
  }
  
  return dist;
}
```

### Step 3: Ray Marching

Simple marching without object tracking:

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
      
      // Resolve materials at the interface
      resolve_materials(ray, p, hit);
      
      return true;
    }
    
    t += d * 0.9;
    if (t > ray.max_t) break;
  }
  
  return false;
}
```

### Step 4: Material Interface Resolution

Determine materials on both sides of the surface:

```glsl
void resolve_materials(Ray ray, Point p, out Hit hit) {
  // Sample just inside and outside the surface
  Point p_outside = p + hit.n * EPSILON;
  Point p_inside = p - hit.n * EPSILON;
  
  // What materials are at these points?
  int material_outside = scene_material_at(p_outside);
  int material_inside = scene_material_at(p_inside);
  
  // Determine which is which based on ray direction
  if (dot(ray.direction, hit.n) < 0) {
    // Ray hitting from outside
    hit.material_from = material_outside;
    hit.material_to = material_inside;
  } else {
    // Ray hitting from inside
    hit.material_from = material_inside;
    hit.material_to = material_outside;
  }
}

int scene_material_at(Point p) {
  // Check all world to see which ones contain this point
  // Return material of the "deepest" one
  int material = MATERIAL_AIR;
  float deepest_inside = 0.0;
  
  for (int i = 0; i < NUM_OBJECTS; i++) {
    float d = evaluate_object_sdf(i, p);
    
    if (d < 0.0) {  // Inside this object
      float depth = -d;
      if (depth > deepest_inside) {
        deepest_inside = depth;
        material = object_${i}_material();
      }
    }
  }
  
  return material;
}
```

### Step 5: Material Properties with Light References

Material properties include direct light references:

```glsl
// Pack materials efficiently
uniform vec4 u_material_albedo_metallic[NUM_MATERIALS];
uniform vec4 u_material_emission_strength[NUM_MATERIALS];
uniform vec4 u_material_ior_roughness_light[NUM_MATERIALS];

MaterialProperties scene_material_properties(int id, Point p) {
  MaterialProperties props;
  
  vec4 am = u_material_albedo_metallic[id];
  props.albedo = am.rgb;
  props.metallic = am.a;
  
  vec4 es = u_material_emission_strength[id];
  props.emission = es.rgb;
  props.emission_strength = es.a;
  
  vec4 irl = u_material_ior_roughness_light[id];
  props.ior = irl.x;
  props.roughness = irl.y;
  props.light_id = int(irl.z);  // Direct light reference
  props.flags = int(irl.w);
  
  return props;
}
```

## Optimization Strategies

### Object Batching by Material
If multiple objects share the same material:

```glsl
// Objects 0,2,5 use material 1
float dispatch_material_1(Point p) {
  return min(min(object_0_sdf(p), object_2_sdf(p)), object_5_sdf(p));
}
```

### Skip Transform for Identity
Don't apply transforms for objects at the origin:

```glsl
float object_${index}_sdf(Point p) {
  #if HAS_TRANSFORM_${index}
    Point local = inverse_transform_${index}(p);
  #else
    Point local = p;  // No transform needed
  #endif
  
  ${obj.sdf}
}
```

### Constant Material Properties
If all materials share a property:

```glsl
#if ALL_MATERIALS_HAVE_SAME_ROUGHNESS
  #define CONST_ROUGHNESS ${sharedRoughness}
#endif
```

## Example Output

For a scene with 2 objects (one emissive sphere, one box):

```glsl
// ============================================
// Generated by SceneCompiler
// 2 world, 3 materials (including air)
// ============================================

#define NUM_OBJECTS 2
#define NUM_MATERIALS 3
#define MATERIAL_AIR 0

// Object 0: emissive sphere
float object_0_sdf(Point p) {
  return length(p - vec3(0,1,0)) - 1.0;
}

// Object 1: box
float object_1_sdf(Point p) {
  vec3 q = abs(p - vec3(2,0,0)) - vec3(1,1,1);
  return length(max(q,0.0)) + min(max(q.x,max(q.y,q.z)),0.0);
}

// Simple dispatch - no object tracking
float dispatch_sdf(Point p) {
  float d0 = object_0_sdf(p);
  float d1 = object_1_sdf(p);
  return min(d0, d1);
}

// Main intersection - no object_id needed
bool scene_intersect(Ray ray, out Hit hit) {
  float t = 0.0;
  
  for (int step = 0; step < MAX_STEPS; step++) {
    Point p = ray.origin + ray.direction * t;
    
    float d = dispatch_sdf(p);
    
    if (d < EPSILON) {
      hit.t = t;
      hit.p = p;
      hit.n = compute_normal(p);
      
      // Material resolution
      resolve_materials(ray, p, hit);
      
      return true;
    }
    
    t += d * 0.9;
    if (t > MAX_DIST) break;
  }
  
  return false;
}

// Material properties with light_id
MaterialProperties scene_material_properties(int id, Point p) {
  MaterialProperties props;
  
  // Material 1 is emissive (from sphere)
  if (id == 1) {
    props.emission = vec3(10.0, 5.0, 2.0);
    props.emission_strength = 1.0;
    props.light_id = 0;  // Direct reference to light array
  } else {
    props.emission = vec3(0.0);
    props.emission_strength = 0.0;
    props.light_id = -1;  // Non-emissive
  }
  
  // ... rest of properties
  
  return props;
}
```

## Key Simplifications

1. **No object tracking**: Hit structure is simpler
2. **Direct light references**: Materials know their light_id
3. **No special exports**: No need for object-specific SDF evaluation
4. **Cleaner interface**: Scene only deals with geometry and materials
5. **Simpler MIS**: Transport just checks material.light_id

The SceneCompiler focuses on its core job: compiling SDFs and material lookups, without complex cross-referencing infrastructure.
