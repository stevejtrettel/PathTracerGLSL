# Mixed Tracing Strategies: Discussion Notes

## Context

When building a path tracer that supports multiple object representations (SDFs, analytic intersections, meshes, isosurfaces), we need to think about how these different types work together efficiently. These are notes from our September discussions exploring various approaches - presented as options to consider, not final decisions.

---

## The Fundamental Question

**Should we have separate tracing methods for different object types, or try to unify them?**

Different objects have natural representations:
- **Spheres, planes, boxes** → Can be intersected analytically with closed-form solutions (fast)
- **Fractals, procedural shapes** → Only work as SDFs with ray marching (no mesh possible)
- **Imported models** → Triangle meshes with BVH traversal
- **Mathematical surfaces** → Isosurfaces where f(x,y,z) = 0

---

## Discussion 1: Dual-Mode Primitives

### The Idea

Some primitives (like spheres) could provide **both** an SDF and an analytic intersection. The system could choose which to use based on context.

```glsl
// Sphere providing both methods
float sdf(vec3 p, vec3 center, float radius) {
    return length(p - center) - radius;
}

Hit intersect(Ray ray, vec3 center, float radius) {
    vec3 oc = ray.origin - center;
    float b = dot(oc, ray.dir);
    float c = dot(oc, oc) - radius * radius;
    float d = b * b - c;
    // ... solve quadratic
}
```

### When to use which?

**Analytic intersection:**
- When the sphere is standalone (not in CSG)
- Much faster - single calculation vs many marching steps

**SDF:**
- When the sphere is part of CSG operations (need distance field)
- When combined with other SDFs in a unified march

### Open Questions

- Should the compiler automatically choose? Or should users specify explicitly?
- How do we handle the file/code organization? One file with both methods? Separate files?
- Is the duplication worth the optimization for simple scenes?

---

## Discussion 2: Analytic vs Marching Separation

### Two-Kernel Approach

Instead of three strategies (analytic, SDF, isosurface), consider just two:

```glsl
Hit trace_scene(Ray ray) {
    Hit closest = no_hit();
    
    // Kernel 1: All one-shot traces
    closest = trace_analytic_objects(ray);
    
    // Kernel 2: All distance-marched objects (SDFs + isosurfaces)
    Hit march_hit = march_objects(ray);
    if (march_hit.t < closest.t) closest = march_hit;
    
    return closest;
}
```

**Rationale:** The real distinction is "can we compute intersection directly?" vs "do we need to march?"

### Combined Marching for SDFs and Isosurfaces

SDFs and isosurfaces could share the same marching loop:

```glsl
float march_combined(Ray ray) {
    float t = 0.0;
    
    for (int i = 0; i < MAX_STEPS; i++) {
        vec3 p = ray.origin + t * ray.direction;
        
        // Get step size from both SDFs and isosurfaces
        float step = scene_sdf(p);  // True distance from SDFs
        
        // Isosurfaces provide conservative estimates
        float iso_step = estimate_isosurface_distance(p);
        step = min(step, iso_step);
        
        if (step < EPSILON) {
            // Refine for isosurfaces if needed
            return refine_hit(ray, t);
        }
        
        t += step * 0.9;
    }
}
```

### Trade-offs

**Pros:**
- Simpler conceptual model (two strategies instead of three)
- Single march through space tests all marched objects
- Fewer GPU kernel dispatches

**Cons:**
- Isosurfaces need refinement step (extra work)
- May need to handle different epsilon thresholds
- Could be less clear which objects use which strategy

---

## Discussion 3: Bounding Volumes for Acceleration

### The Problem

Expensive SDFs (fractals, complex CSG) evaluated many times during marching wastes computation.

### Option: Two-Phase Marching

**Phase 1:** March using cheap bounding volumes only
```glsl
// Only test bounding spheres
for (int i = 0; i < num_objects; i++) {
    float bound_dist = sphere_sdf(p, obj_center[i], obj_bound_radius[i]);
    min_dist = min(min_dist, bound_dist);
}
```

**Phase 2:** When close to bounds, evaluate expensive SDF
```glsl
if (bound_dist < EPSILON * 2.0) {
    // Now compute the actual expensive SDF
    float exact_dist = mandelbulb_sdf(p);
}
```

**Idea:** Avoid evaluating expensive SDFs when far away from objects.

### Alternative: Hierarchical Evaluation

```glsl
float scene_sdf(vec3 p) {
    float d = MAX_DIST;
    
    // Phase 1: Simple objects (always evaluate)
    for (int i = 0; i < num_simple; i++) {
        d = min(d, eval_simple_sdf(i, p));
    }
    
    // Phase 2: Complex objects (only if bounds are competitive)
    float threshold = d * 2.0;  // Adaptive threshold
    
    for (int i = 0; i < num_complex; i++) {
        float bound = eval_bound_sdf(i, p);
        
        if (bound < threshold) {
            float exact = eval_complex_sdf(i, p);
            d = min(d, exact);
        }
    }
    
    return d;
}
```

**Idea:** Only evaluate expensive SDFs when their bounds suggest they might be the closest object.

### Open Questions

- Does the branching overhead negate the savings?
- How much faster is bound evaluation vs actual SDF?
- Should bounds be compile-time known or runtime uniforms?
- Where does this optimization code live? Scene module? Separate acceleration module?

---

## Discussion 4: Scene Compilation Strategies

### The Observation

For small scenes (< 10 objects), we discussed whether to:

**Option A: Fully unroll**
```glsl
float scene_sdf(vec3 p) {
    float d = sphere_sdf(p, vec3(0,0,0), 1.0);
    d = min(d, sphere_sdf(p, vec3(2,0,0), 0.5));
    d = min(d, box_sdf(p, vec3(-1,1,0), vec3(0.5)));
    // ... hardcoded for all objects
}
```

**Option B: Data-driven**
```glsl
uniform vec4 u_spheres[10];  // xyz = center, w = radius

float scene_sdf(vec3 p) {
    float d = MAX_DIST;
    for (int i = 0; i < 10; i++) {
        d = min(d, sphere_sdf(p, u_spheres[i].xyz, u_spheres[i].w));
    }
    return d;
}
```

**Option C: Hybrid**
```glsl
// Unroll first few (most important)
float d = sphere_sdf(p, vec3(0,0,0), 1.0);
d = min(d, sphere_sdf(p, vec3(2,0,0), 0.5));

// Rest in array
for (int i = 0; i < remaining; i++) {
    d = min(d, sphere_sdf(p, u_spheres[i].xyz, u_spheres[i].w));
}
```

### Trade-offs

| Approach | Pros | Cons |
|----------|------|------|
| Fully unrolled | No array lookups, compiler optimizations, constant folding | Large shaders, recompile for changes |
| Data-driven | Small shaders, runtime flexibility | Memory bandwidth, loop overhead |
| Hybrid | Balance of speed and flexibility | More complex compilation |

### Considerations for Research

- How often do scenes change?
- Are you iterating on algorithms or scenes?
- Does shader compilation time matter?
- Do you need to animate object positions?

---

## Discussion 5: Mixed SDF/Mesh Scenes

### The Challenge

A scene with both SDFs and triangle meshes needs different acceleration strategies:
- **SDFs** → Bounding volumes + marching
- **Meshes** → BVH traversal

### Discussed Approach

```glsl
bool intersect_scene(Ray ray, out Hit hit) {
    Hit closest = no_hit();
    
    // March through SDFs
    Hit sdf_hit = march_sdfs(ray);
    if (sdf_hit.valid) {
        closest = sdf_hit;
        ray.tmax = sdf_hit.t;  // Early termination for mesh BVH
    }
    
    // Traverse mesh BVH
    Hit mesh_hit = traverse_bvh(ray);
    if (mesh_hit.valid && mesh_hit.t < closest.t) {
        closest = mesh_hit;
    }
    
    return closest;
}
```

**Key insight:** Use the SDF hit to limit BVH traversal depth (early termination).

### Where Does BVH Code Live?

We discussed whether BVH should be:
- Part of Scene module (Scene owns all spatial queries)
- Separate Acceleration module (mesh-specific acceleration)

**Leaning toward:** Scene module for SDF acceleration, separate Acceleration module for generic BVH that Scene can use.

---

## Discussion 6: Inside Testing for Volumes

### The Problem

Volumetric rendering (fog, glass, subsurface scattering) needs `inside(point)` tests to know if we're inside an object.

**With SDFs:** Trivial - `sdf(p) < 0.0`

**With analytic intersection only:** Need explicit inside test

### Solution: Always Provide Inside Test

Even if an object has analytic intersection, it should provide:

```glsl
bool inside(vec3 p, vec3 center, float radius) {
    return length(p - center) < radius;
}
```

For most primitives this is simple. For complex objects, can fall back to SDF.

### Why This Matters

```glsl
// Marching through glass volume
while (inside_glass(p)) {
    // Apply Beer's law absorption
    throughput *= exp(-absorption * step_size);
    
    // Check for scattering event
    if (should_scatter()) break;
    
    p += ray.direction * step_size;
}
```

Without `inside()`, volumetric effects become much harder.

---

## Discussion 7: CSG Operations

### Where Should CSG Live?

CSG (Constructive Solid Geometry) operations like union, intersection, subtraction:

```glsl
float union(float d1, float d2) { return min(d1, d2); }
float intersection(float d1, float d2) { return max(d1, d2); }
float subtraction(float d1, float d2) { return max(d1, -d2); }
```

**Discussed approach:** CSG happens in TypeScript scene builder, generates optimized GLSL.

```typescript
// In TypeScript
const sphere1 = builder.sphere([0,0,0], 1);
const sphere2 = builder.sphere([0.5,0,0], 0.8);
const result = builder.union(sphere1, sphere2);

// Generates GLSL
float scene_sdf(vec3 p) {
    float d1 = sphere_sdf(p, vec3(0,0,0), 1.0);
    float d2 = sphere_sdf(p, vec3(0.5,0,0), 0.8);
    return min(d1, d2);  // Inlined union
}
```

**Advantage:** Compiler can inline and optimize CSG trees at compile time.

---

## Discussion 8: Compile-Time Optimization

### General Philosophy

Generate scene-specific optimized shaders rather than uber-shaders.

**Examples of optimizations discussed:**

1. **Constant folding** - Hardcode object positions/radii
2. **Dead code elimination** - Remove unused material properties
3. **Loop unrolling** - For small object counts
4. **Inline expansion** - Expand CSG operations inline

### Trade-off

**Compile-time optimization:**
- Faster runtime
- Longer compile time
- Less runtime flexibility

**Runtime flexibility:**
- Slower runtime (branches, array lookups)
- Instant changes
- Easier debugging

**For research:** Depends on whether you're iterating on algorithms (need flexibility) or scenes (can precompile).

---

## Open Architectural Questions

These came up but weren't resolved:

1. **Module boundaries:** Where does acceleration code live? Scene? Separate module?

2. **Object organization:** Files per mathematical object? Files per tracing strategy? Hybrid?

3. **Compilation triggers:** Compile on startup? Cache compiled shaders? Hot reload?

4. **Strategy selection:** Automatic compiler choice? Explicit user specification? Configuration flags?

5. **Performance targets:** Optimize for simple scenes (< 10 objects)? Complex scenes (100+)? Both?

6. **Non-Euclidean geometries:** How do BVH and acceleration structures work when geodesics aren't straight lines?

---

## Summary

These discussions explored various ways to handle mixed object types efficiently. The key themes were:

1. **Separation by capability** - Analytic vs marched objects
2. **Bounding volume acceleration** - Skip expensive SDF evaluation when possible
3. **Compile-time specialization** - Generate optimized code per scene
4. **Unified interfaces** - All objects provide `inside()` for volumes
5. **CSG in TypeScript** - Build CSG trees at compile time

**None of these are locked in.** They're options to consider based on:
- Scene complexity you're targeting
- How often scenes change vs algorithms change
- Whether you're optimizing for simple or complex scenes
- Your tolerance for compilation time vs runtime performance

The right choices will become clearer as you build and measure actual performance on real scenes.