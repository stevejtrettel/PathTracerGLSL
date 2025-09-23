
# SceneCompiler

## Purpose
Takes a list of objects and materials and produces a GLSL module with intersection and material property functions. The key change from before: we now need to track object IDs so the Transport module can determine if an emissive object could have been sampled directly (for MIS).

## The ID Tracking Challenge

When a ray hits an emissive object, we need to know:
1. Which object we hit (object ID)
2. What material it has (material ID)
3. Whether this object corresponds to a samplable light (via cross-reference)

This means our Hit structure must now include the object ID, not just material IDs.

## Input Structure

```typescript
interface SceneCompilerInput {
  objects: CompilerObject[];
  materials: CompilerMaterial[];
}
```

No changes to input - the SceneCompiler remains agnostic about where objects came from.

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

// NEW: For bbox light sampling
float scene_evaluate_object_sdf(int obj_id, Point p)
vec3 scene_compute_object_normal(int obj_id, Point p)
```

## Updated Hit Structure

The critical change - we now track which object was hit:

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
  
  // NEW: Object tracking for MIS
  int object_id;  // Which object did we hit?
  
  // Frame
  Frame frame;
}
```

## Compilation Strategy

### Step 1: Generate Object SDFs with IDs

Each object needs a unique, stable ID that matches what the WorldCompiler assigned:

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

For ray marching, we need the minimum distance to any object, but we also need to track which object gives that minimum:

#### Few Objects (<5): Unrolled with Tracking
```glsl
void dispatch_sdf(Point p, out float dist, out int closest_object) {
  float d0 = object_0_sdf(p);
  float d1 = object_1_sdf(p);
  float d2 = object_2_sdf(p);
  
  dist = d0;
  closest_object = 0;
  
  if (d1 < dist) {
    dist = d1;
    closest_object = 1;
  }
  
  if (d2 < dist) {
    dist = d2;
    closest_object = 2;
  }
}
```

#### Many Objects: Loop with Tracking
```glsl
void dispatch_sdf(Point p, out float dist, out int closest_object) {
  dist = MAX_DIST;
  closest_object = -1;
  
  for (int i = 0; i < NUM_OBJECTS; i++) {
    float d = evaluate_object_sdf(i, p);
    if (d < dist) {
      dist = d;
      closest_object = i;
    }
  }
}
```

### Step 3: Ray Marching with Object Tracking

The ray marcher now tracks which object we hit:

```glsl
bool scene_intersect(Ray ray, out Hit hit) {
  float t = 0.0;
  int closest_object = -1;
  
  for (int step = 0; step < MAX_STEPS; step++) {
    Point p = geometry_geodesic(ray.origin, ray.direction, t);
    
    float d;
    dispatch_sdf(p, d, closest_object);
    
    if (d < EPSILON) {
      // We hit object 'closest_object'
      hit.t = t;
      hit.p = p;
      hit.object_id = closest_object;  // NEW: Store object ID
      hit.n = compute_normal(p);
      hit.frame = geometry_frame(p, hit.n);
      
      // Resolve materials at the interface
      resolve_materials(ray, p, closest_object, hit);
      
      return true;
    }
    
    t += d * 0.9;
    if (t > ray.max_t) break;
  }
  
  return false;
}
```

### Step 4: Material Interface Resolution

When we hit a surface, we need to determine materials on both sides. This is trickier with multiple objects:

```glsl
void resolve_materials(Ray ray, Point p, int hit_object, out Hit hit) {
  // The object we hit determines one material
  int hit_material = object_material(hit_object);
  
  // Sample just inside and outside the surface
  Point p_outside = p + hit.n * EPSILON;
  Point p_inside = p - hit.n * EPSILON;
  
  // What materials are at these points?
  int material_outside = material_at_point(p_outside);
  int material_inside = material_at_point(p_inside);
  
  // Determine which is which based on ray direction
  if (dot(ray.direction, hit.n) < 0) {
    // Ray hitting from outside
    hit.material_from = material_outside;
    hit.material_to = material_inside;
  } else {
    // Ray hitting from inside (or grazing)
    hit.material_from = material_inside;
    hit.material_to = material_outside;
  }
}

int material_at_point(Point p) {
  // Check all objects to see which ones contain this point
  // Return material of the "deepest" one
  int material = MATERIAL_AIR;
  float deepest_inside = 0.0;
  
  for (int i = 0; i < NUM_OBJECTS; i++) {
    float d = evaluate_object_sdf(i, p);
    
    if (d < 0.0) {  // Inside this object
      float depth = -d;
      if (depth > deepest_inside) {
        deepest_inside = depth;
        material = object_material(i);
      }
    }
  }
  
  return material;
}
```

### Step 5: Export Functions for Light Sampling

The bbox light sampler needs to evaluate SDFs and normals for specific objects:

```glsl
// Called by lighting module for bbox rejection sampling
float scene_evaluate_object_sdf(int obj_id, Point p) {
  switch(obj_id) {
    case 0: return object_0_sdf(p);
    case 1: return object_1_sdf(p);
    // ... generated for each object
  }
  return MAX_DIST;
}

// Compute normal for a specific object
vec3 scene_compute_object_normal(int obj_id, Point p) {
  const float eps = 0.001;
  
  float d = scene_evaluate_object_sdf(obj_id, p);
  
  float dx = scene_evaluate_object_sdf(obj_id, p + vec3(eps, 0, 0)) - d;
  float dy = scene_evaluate_object_sdf(obj_id, p + vec3(0, eps, 0)) - d;
  float dz = scene_evaluate_object_sdf(obj_id, p + vec3(0, 0, eps)) - d;
  
  return normalize(vec3(dx, dy, dz));
}
```

### Step 6: Material Properties with Emission

Material properties must include emission for emissive objects:

```glsl
// Pack materials efficiently
uniform vec4 u_material_albedo_metallic[NUM_MATERIALS];
uniform vec4 u_material_emission_strength[NUM_MATERIALS];
uniform vec4 u_material_ior_roughness[NUM_MATERIALS];

MaterialProperties scene_material_properties(int id, Point p) {
  MaterialProperties props;
  
  vec4 am = u_material_albedo_metallic[id];
  props.albedo = am.rgb;
  props.metallic = am.a;
  
  vec4 es = u_material_emission_strength[id];
  props.emission = es.rgb;
  props.emission_strength = es.a;
  
  vec4 ir = u_material_ior_roughness[id];
  props.ior = ir.x;
  props.roughness = ir.y;
  props.flags = int(ir.z);
  
  return props;
}
```

## Optimization Strategies

### Object Batching by Material
If multiple objects share the same material, we can optimize:

```glsl
// Objects 0,2,5 use material 1
// Objects 1,3,4 use material 2
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
If all materials share a property, make it a constant:

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
// 2 objects, 3 materials (including air)
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

// Dispatch with object tracking
void dispatch_sdf(Point p, out float dist, out int closest_object) {
  float d0 = object_0_sdf(p);
  float d1 = object_1_sdf(p);
  
  if (d0 < d1) {
    dist = d0;
    closest_object = 0;
  } else {
    dist = d1;
    closest_object = 1;
  }
}

// Main intersection with object ID tracking
bool scene_intersect(Ray ray, out Hit hit) {
  float t = 0.0;
  int closest_object = -1;
  
  for (int step = 0; step < MAX_STEPS; step++) {
    Point p = ray.origin + ray.direction * t;
    
    float d;
    dispatch_sdf(p, d, closest_object);
    
    if (d < EPSILON) {
      hit.t = t;
      hit.p = p;
      hit.object_id = closest_object;  // Store which object
      hit.n = compute_normal(p);
      
      // Material resolution...
      
      return true;
    }
    
    t += d * 0.9;
    if (t > MAX_DIST) break;
  }
  
  return false;
}

// Export for light sampling
float scene_evaluate_object_sdf(int obj_id, Point p) {
  switch(obj_id) {
    case 0: return object_0_sdf(p);
    case 1: return object_1_sdf(p);
    default: return MAX_DIST;
  }
}

// Material properties including emission
MaterialProperties scene_material_properties(int id, Point p) {
  MaterialProperties props;
  
  // Material 1 is emissive (from sphere)
  if (id == 1) {
    props.emission = vec3(10.0, 5.0, 2.0);
    props.emission_strength = 1.0;
  } else {
    props.emission = vec3(0.0);
    props.emission_strength = 0.0;
  }
  
  // ... rest of properties
  
  return props;
}
```

## Why These Changes?

1. **Object ID tracking**: Essential for MIS - we need to know which object we hit
2. **Export SDF evaluation**: Allows bbox light sampling to test if points are on surfaces
3. **Material interface resolution**: Correctly handles overlapping objects
4. **Normal computation per object**: Needed for proper PDF calculation in lighting
5. **Emission in materials**: Emissive objects need their emission values accessible

The SceneCompiler remains agnostic about the source of objects while providing the necessary infrastructure for MIS and cross-referenced lighting.
