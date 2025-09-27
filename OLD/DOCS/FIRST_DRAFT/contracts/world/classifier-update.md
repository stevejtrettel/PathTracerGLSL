# Unified Material Interface Resolution System

## Problem Statement

The current architecture requires checking ALL objects in the scene when determining material interfaces at hit points. This is inefficient and doesn't handle multi-region objects correctly:

```glsl
// CURRENT INEFFICIENT APPROACH
Material get_material_at_point(vec3 p) {
    // Must test EVERY object in scene
    for(int i = 0; i < NUM_OBJECTS; i++) {
        if(object_sdf[i](p) < 0) return object_materials[i];
    }
    return MATERIAL_AIR;
}
```

This approach:
- Tests all objects twice per hit (before and after point)
- Cannot handle multi-region objects (which have multiple materials)
- Wastes computation since we already know which object was hit

## Proposed Solution: Object-Owned Classification

Each object provides its own material classification function. When we detect a hit, we only call the classifier for the specific object we hit.

## Implementation Details

### 1. Object Classification Functions

Every object (simple or multi-region) generates a classification function:

```glsl
// SIMPLE OBJECT: Single material
int classify_sphere_0(vec3 p) {
    return sphere_0_sdf(p) < 0.0 ? MATERIAL_GLASS : MATERIAL_AIR;
}

// MULTI-REGION OBJECT: Multiple materials
int classify_glass_fog_0(vec3 p) {
    float base = mandelbulb_sdf(p);
    if(abs(base) < 0.1) return MATERIAL_GLASS;
    if(base < -0.1) return MATERIAL_FOG;
    return MATERIAL_AIR;
}
```

### 2. Tracking During Marching

The marching loop already tracks which object is closest:

```glsl
float march_objects(Ray ray, out float hit_t, out int hit_object_id, float max_t) {
    float t = 0.01;
    
    for(int i = 0; i < MAX_STEPS && t < max_t; i++) {
        vec3 p = ray.origin + ray.direction * t;
        
        float min_dist = MAX_DIST;
        int closest_object = -1;
        
        // Test objects and track which is closest
        float d0 = sphere_0_sdf(p);
        if(d0 < min_dist) {
            min_dist = d0;
            closest_object = 0;
        }
        
        // Multi-region object
        int region;  // Internal use only
        float d1 = eval_multi_region_0(p, region);
        if(d1 < min_dist) {
            min_dist = d1;
            closest_object = 1;
        }
        
        // Hit detected - we know the object!
        if(min_dist < 0.001) {
            hit_t = t;
            hit_object_id = closest_object;
            return true;
        }
        
        t += min_dist * 0.9;
    }
    return false;
}
```

### 3. Unified Hit Creation

Once we know which object was hit, we create the Hit structure using only that object's functions:

```glsl
Hit create_hit(float t, vec3 p, vec3 ray_dir, int object_id) {
    Hit hit;
    hit.t = t;
    hit.p = p;
    hit.object_id = object_id;
    
    // Interface resolution using ONLY the hit object's classifier
    vec3 before = p - ray_dir * EPSILON;
    vec3 after = p + ray_dir * EPSILON;
    
    // Generated switch/dispatch to object-specific functions
    switch(object_id) {
        case 0:  // Simple sphere
            hit.material_from = classify_sphere_0(before);
            hit.material_to = classify_sphere_0(after);
            hit.n = normal_sphere_0(p);
            break;
            
        case 1:  // Multi-region object
            hit.material_from = classify_glass_fog_0(before);
            hit.material_to = classify_glass_fog_0(after);
            hit.n = normal_glass_fog_0(p);
            break;
    }
    
    // Compute derived properties
    hit.frame = g_frame(hit.p, hit.n);
    hit.ior_ratio = ior_table[hit.material_from] / ior_table[hit.material_to];
    
    return hit;
}
```

### 4. Scene Intersection Integration

The main intersection function coordinates different tracing strategies:

```glsl
Hit intersect_scene(Ray ray) {
    Hit closest = no_hit();
    
    // Analytic tracing
    float t_analytic;
    int obj_analytic;
    if(trace_analytic_objects(ray, t_analytic, obj_analytic) && t_analytic < closest.t) {
        vec3 p = ray.origin + ray.direction * t_analytic;
        closest = create_hit(t_analytic, p, ray.direction, obj_analytic);
    }
    
    // Distance marching (SDFs + isosurfaces + multi-region)
    float t_march;
    int obj_march;
    if(march_objects(ray, t_march, obj_march, closest.t) && t_march < closest.t) {
        vec3 p = ray.origin + ray.direction * t_march;
        closest = create_hit(t_march, p, ray.direction, obj_march);
    }
    
    // Mesh BVH traversal
    float t_mesh;
    int mesh_id;
    vec3 mesh_normal;
    if(trace_meshes(ray, t_mesh, mesh_id, mesh_normal, closest.t) && t_mesh < closest.t) {
        // Meshes handle hits slightly differently
        closest = create_mesh_hit(t_mesh, ray.origin + ray.direction * t_mesh, 
                                  mesh_normal, mesh_id);
    }
    
    return closest;
}
```

## Compiler Generation

The compiler must generate:

### 1. Classification Functions (per object)
```typescript
generateClassifier(object: SceneObject, id: number): string {
  if (object.type === 'multi_region') {
    return generateMultiRegionClassifier(object, id);
  } else {
    return `
int classify_object_${id}(vec3 p) {
    return ${object.name}_sdf(p) < 0.0 ? 
           MATERIAL_${object.material} : MATERIAL_AIR;
}`;
  }
}
```

### 2. Normal Functions (per object)
```typescript
generateNormal(object: SceneObject, id: number): string {
  if (object.hasAnalyticNormal) {
    return object.analyticNormal;
  } else {
    return generateNumericalGradient(object, id);
  }
}
```

### 3. Hit Creator Dispatcher
```typescript
generateHitCreator(objects: SceneObject[]): string {
  const cases = objects.map((obj, i) => `
    case ${i}:
      hit.material_from = classify_object_${i}(before);
      hit.material_to = classify_object_${i}(after);
      hit.n = normal_object_${i}(p);
      break;
  `).join('\n');
  
  return `
Hit create_hit(float t, vec3 p, vec3 ray_dir, int object_id) {
    Hit hit;
    hit.t = t;
    hit.p = p;
    hit.object_id = object_id;
    
    vec3 before = p - ray_dir * EPSILON;
    vec3 after = p + ray_dir * EPSILON;
    
    switch(object_id) {
      ${cases}
    }
    
    hit.frame = g_frame(hit.p, hit.n);
    hit.ior_ratio = ior_table[hit.material_from] / ior_table[hit.material_to];
    
    return hit;
}`;
}
```

## Benefits

1. **Efficiency**: Only test the hit object for material classification, not all objects
2. **Correctness**: Multi-region objects can properly report their internal materials
3. **Simplicity**: Object ID is already known from marching - no extra computation
4. **Uniformity**: All objects (simple, multi-region, mesh) use same interface
5. **Locality**: Objects encapsulate their own material logic

## Migration Requirements

To implement this system:

1. **Object modules** must provide classification functions
2. **Scene module** must track object IDs during marching
3. **Hit creation** must dispatch to object-specific classifiers
4. **Material module** remains unchanged - it still receives material IDs from Hit

This replaces global material checking with efficient, object-local classification while maintaining compatibility with the existing material evaluation system.
