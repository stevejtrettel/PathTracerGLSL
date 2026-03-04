Ah, you're absolutely right - I was confusing things! Let me clarify my thinking:

## Material Interfaces: When Do We Need What?

When we compute an intersection, we get geometric info (p, n, t). Then separately, we need to figure out **what material interface we're crossing**.

You're right that we don't need `material_from` during the intersection calculation itself - we only need it when **filling the Hit struct** to tell Transport what's happening at this boundary.

So the question becomes: **who is responsible for knowing `material_from`?**

### Option A: Transport tracks it
```glsl
// In transport module
int current_medium = MATERIAL_AIR;

if (scene_intersect(ray, hit)) {
    hit.material_from = current_medium;
    // Now compute material_to based on geometry
    hit.material_to = figure_out_what_we_hit(...);
    
    // Update for next bounce
    current_medium = hit.material_to;
}
```

This makes sense for simple cases, but breaks down with multi-region SDFs. If we're in the glass shell and hit the inner water surface, Transport thinks `material_from = GLASS`, which is correct! But how does the geometry code know to set `material_to = WATER` without understanding the multi-region structure?

### Option B: Geometry resolves both sides

```glsl
bool scene_intersect(Ray ray, out Hit hit) {
    // ... find intersection geometry ...
    
    // Then resolve interface by sampling both sides
    vec3 before = hit.p - EPSILON * ray.direction;
    vec3 after = hit.p + EPSILON * ray.direction;
    
    hit.material_from = scene_material_at(before);
    hit.material_to = scene_material_at(after);
}
```

This is self-contained but requires `scene_material_at` to work correctly.

**I think Option B is what you're describing?** The geometry system is responsible for the full interface resolution, and Transport just uses whatever materials it gets back.

---

## scene_material_at: Not as expensive as I thought

You're right about volume scattering! If Transport is in a volume, it's tracking which material ID it's in, and it only needs:

```glsl
// In volume scattering
if (still_inside_current_volume(current_pos, current_material_id)) {
    // Just query material properties
    MaterialProperties props = scene_material_properties(current_material_id, current_pos);
    // Use props.density, props.albedo, etc.
}
```

So `scene_material_at` only gets called:
- At surface hits (for interface resolution)
- When checking if we've exited a volume

Not at every volume step. Much better!

---

## Focusing on SDF Compilation

Let's think through what an SDF object needs to provide. Starting simple:

### Single-material SDF

```typescript
{
  id: 'blob',
  geometry: {
    type: 'sdf',
    sdf_glsl: `
      float d1 = sphere_sdf(p, vec3(0,0,0), 1.0);
      float d2 = sphere_sdf(p, vec3(0.5,0.5,0), 0.8);
      return smooth_union(d1, d2, 0.3);
    `
  },
  material: 'glass'
}
```

**What needs to be generated?**

1. A distance function:
```glsl
float sdf_blob_distance(vec3 p) {
    // inline the user's GLSL
    float d1 = sphere_sdf(p, vec3(0,0,0), 1.0);
    float d2 = sphere_sdf(p, vec3(0.5,0.5,0), 0.8);
    return smooth_union(d1, d2, 0.3);
}
```

2. Material info (compiled into a lookup):
```glsl
int sdf_blob_material = 2;  // glass
```

### Multi-region SDF

```typescript
{
  id: 'water_shell',
  geometry: {
    type: 'multi_region_sdf',
    regions: [
      {
        id: 0,
        name: 'exterior',
        material: 'air',
        predicate_glsl: `
          float outer = sphere_sdf(p, vec3(0,2,0), 2.0);
          return outer > 0.0;
        `
      },
      {
        id: 1, 
        name: 'shell',
        material: 'glass',
        predicate_glsl: `
          float outer = sphere_sdf(p, vec3(0,2,0), 2.0);
          float inner = sphere_sdf(p, vec3(0,2,0), 1.8);
          return outer <= 0.0 && inner > 0.0;
        `
      },
      {
        id: 2,
        name: 'interior',
        material: 'water',
        predicate_glsl: `
          float inner = sphere_sdf(p, vec3(0,2,0), 1.8);
          return inner <= 0.0;
        `
      }
    ]
  }
}
```

**What needs to be generated?**

1. A distance function (for marching):
```glsl
float sdf_water_shell_distance(vec3 p) {
    // March on the outer shell surface
    return sphere_sdf(p, vec3(0,2,0), 2.0);
}
```

2. A region classifier:
```glsl
int sdf_water_shell_region_at(vec3 p) {
    // Evaluate predicates in order, return first match
    {
        float outer = sphere_sdf(p, vec3(0,2,0), 2.0);
        if (outer > 0.0) return 0;
    }
    {
        float outer = sphere_sdf(p, vec3(0,2,0), 2.0);
        float inner = sphere_sdf(p, vec3(0,2,0), 1.8);
        if (outer <= 0.0 && inner > 0.0) return 1;
    }
    {
        float inner = sphere_sdf(p, vec3(0,2,0), 1.8);
        if (inner <= 0.0) return 2;
    }
    return 0;  // fallback
}
```

3. Region-to-material mapping:
```glsl
const int sdf_water_shell_region_materials[3] = int[3](0, 2, 3);  // air, glass, water
```

---

## Question: Can we optimize the region classifier?

Notice that `sdf_water_shell_region_at` recomputes the sphere SDFs multiple times. For complex SDFs, this could be expensive!

**Option 1:** Let the author provide a combined function:
```typescript
geometry: {
  type: 'multi_region_sdf',
  combined_glsl: `
    float outer = sphere_sdf(p, vec3(0,2,0), 2.0);
    float inner = sphere_sdf(p, vec3(0,2,0), 1.8);
    
    // Return: distance, region_id
    if (outer > 0.0) return vec2(outer, 0.0);
    if (inner > 0.0) return vec2(outer, 1.0);
    return vec2(outer, 2.0);
  `
}
```

Then generate:
```glsl
vec2 sdf_water_shell_distance_and_region(vec3 p) {
    // inline user GLSL
    float outer = sphere_sdf(p, vec3(0,2,0), 2.0);
    float inner = sphere_sdf(p, vec3(0,2,0), 1.8);
    
    if (outer > 0.0) return vec2(outer, 0.0);
    if (inner > 0.0) return vec2(outer, 1.0);
    return vec2(outer, 2.0);
}

float sdf_water_shell_distance(vec3 p) {
    return sdf_water_shell_distance_and_region(p).x;
}

int sdf_water_shell_region_at(vec3 p) {
    return int(sdf_water_shell_distance_and_region(p).y);
}
```

**Option 2:** Compiler tries to extract common subexpressions (much harder!)

**Option 3:** Accept some redundant computation - SDFs are called at marching steps (distance) and once at the hit point (region), so maybe it's not that bad?

---

## What properties should SDF objects have?

Based on this, I think an SDF object needs:

**Required:**
- `distance_glsl`: The marching SDF (or combined distance+region)
- `material`: Single material ID, OR
- `regions`: List of regions with predicates and materials

**Generated functions:**
- `float sdf_{id}_distance(vec3 p)`
- `int sdf_{id}_region_at(vec3 p)` (if multi-region)
- Material mapping data

**For the marching kernel to use:**
- A way to call distance for all SDFs and take the minimum
- A way to call region classifier by SDF index

---

Does this structure make sense for what you're building? Should we talk through analytic objects next, or dig deeper into how the marching loop combines multiple SDFs?
