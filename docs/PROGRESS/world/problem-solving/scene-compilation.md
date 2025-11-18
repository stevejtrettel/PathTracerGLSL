# SDF Scene Compilation – Problem Description and Design

## 1. Overview and Goals

The SDF Scene compiler takes a list of SDF object descriptions and generates efficient GLSL code for ray marching. This module compiles **after** the Material module, so material IDs are already assigned and available.

**Main outputs:**
1. Distance functions for each SDF object
2. Material classifier functions for multi-region objects
3. A marching kernel that combines all SDFs
4. Containment queries for volumetric rendering
5. Interface resolution functions

---

## 2. CRITICAL DESIGN DECISION: Region IDs for Volumetric Rendering

### 2.1. The Problem

**Original intent**: Scene module would not expose object identity. The `Hit` struct would only contain material interface information (`material_from`, `material_to`).

**However**: Volumetric rendering creates a fundamental problem. When Transport is inside a volume (e.g., water inside a snow globe), it needs to:

1. Query material properties for density, absorption, scattering
2. **Determine when it exits that specific volume**

The second requirement is challenging without region identity:
- Can't query entire scene at every volume step (too expensive)
- Need targeted "am I still in the snow globe's water region?" query
- Multiple objects might use the same material (multiple water regions)
- Multi-region objects have multiple distinct volumes using different materials

### 2.2. The Solution: Global Unique Region IDs

**Decision**: Add `region_id` to the `Hit` struct to uniquely identify what was hit.

```glsl
struct Hit {
  // Geometry
  vec3 p;
  vec3 n;
  vec2 uv;
  float t;
  Frame frame;
  
  // Identity - ADDED FOR VOLUMETRICS
  int region_id;      // Globally unique identifier
  
  // Material interface
  int material_from;  // Material we're coming from
  int material_to;    // Material we're entering
};
```

**Region ID assignment**:
- Single-material objects get one region_id
- Multi-region composite objects get one region_id per region

**Scene module provides**:
```glsl
bool inside_region(vec3 p, int region_id);
```

**Transport can efficiently trace volumes**:
```glsl
// Inside water region of snow globe
int current_region = hit.region_id;  
int current_material = hit.material_to;

while (in_volume) {
  MaterialProperties props = scene_material_properties(current_material, pos);
  // Use density, absorption, etc.
  
  pos += step * direction;
  
  // Cheap, targeted check
  if (!inside_region(pos, current_region)) {
    // Exited! Find next boundary
  }
}
```

### 2.3. Why This Deviates From Original Design

The "no object IDs" architecture aimed for pure material-based abstraction. Adding `region_id`:
- ✅ Solves volumetric rendering efficiently
- ✅ Allows targeted containment queries
- ✅ Separates geometry (region_id) from shading (material_id)
- ❌ Leaks region/object identity outside Scene module
- ❌ Adds bookkeeping complexity

**⚠️ This is a pragmatic compromise.** Volumetric rendering is first-class and this is the cleanest solution we've found. Alternative approaches (querying entire scene) are prohibitively expensive. This decision should be revisited if we find a better approach.

---

## 3. Input to SDF Compilation

### 3.1. Material Module Output

The Material module has already compiled and provides:

```typescript
interface MaterialModuleMetadata {
  materialIdMap: Record<string, number>;  // 'gold' -> 1, 'water' -> 3
  idToNameMap: Record<number, string>;
  ambientMaterialId?: number;
}
```

SDF compiler uses `materialIdMap` to resolve material names to IDs.

### 3.2. SDF Object Descriptions

**Single-material object:**
```typescript
{
  id: 'sphere1',
  geometry: {
    type: 'sphere',
    center: [0, 0, 0],
    radius: 1.0
  },
  material: 'gold'  // → material_id = 1
}
```

**Multi-region composite object:**
```typescript
{
  id: 'snow_globe',
  geometry: {
    type: 'snow_globe',
    center: [0, 1, 0],
    outer_radius: 1.2,
    glass_thickness: 0.08,
    water_level: 0.75,
    base_height: 0.15
  },
  materials: {
    glass_material: 'glass',    // → material_id = 2
    water_material: 'water',    // → material_id = 3
    air_material: 'air',        // → material_id = 0
    base_material: 'wood'       // → material_id = 4
  }
}
```

**Key insight**: Multi-region objects only define regions **inside** the object (where distance < 0). The exterior is not part of the object.

---

## 4. Region ID Assignment

### 4.1. Assignment Strategy

Assign globally unique region IDs during compilation:

```typescript
let nextRegionId = 0;
const regionMetadata: RegionMetadata[] = [];

for (const object of scene.objects) {
  if (isSingleMaterial(object)) {
    const materialId = materialIdMap[object.material];
    regionMetadata.push({
      regionId: nextRegionId++,
      objectId: object.id,
      materialId: materialId
    });
  } else {
    // Multi-region: one ID per region
    const typeDef = getObjectTypeDef(object.geometry.type);
    for (const region of typeDef.regions) {
      const materialName = object.materials[region.materialSlot];
      const materialId = materialIdMap[materialName];
      
      regionMetadata.push({
        regionId: nextRegionId++,
        objectId: object.id,
        regionName: region.name,
        materialId: materialId
      });
    }
  }
}
```

**Example assignment:**
```
Region ID | Object     | Region Name  | Material ID | Material
----------|------------|--------------|-------------|----------
0         | sphere1    | (single)     | 1           | gold
1         | sphere2    | (single)     | 2           | glass
2         | snow_globe | glass_shell  | 2           | glass
3         | snow_globe | water        | 3           | water
4         | snow_globe | air_bubble   | 0           | air
5         | snow_globe | base         | 4           | wood
```

Note: Regions 1 and 2 both use glass (material 2), region 4 uses air (material 0) - but each has a unique region_id.

---

## 5. Generated GLSL Functions - What We Know

### 5.1. Distance Functions (Per Object)

Each SDF object generates a distance function:

```glsl
float sdf_sphere1_distance(vec3 p) {
  // Bounding optimization compiled in
  vec3 to_center = p - vec3(0.0, 0.0, 0.0);
  float dist_to_center = length(to_center);
  float bound_radius = 1.0 * 1.1;
  
  if (dist_to_center > bound_radius) {
    return dist_to_center - bound_radius;
  }
  
  return length(p - vec3(0.0, 0.0, 0.0)) - 1.0;
}
```

```glsl
float sdf_snow_globe_distance(vec3 p) {
  // Bounding check
  vec3 center = vec3(0.0, 1.0, 0.0);
  vec3 to_center = p - center;
  float dist_to_center = length(to_center);
  float bound_radius = 1.2 * 1.1;
  
  if (dist_to_center > bound_radius) {
    return dist_to_center - bound_radius;
  }
  
  // Distance to outer surface (what we march on)
  return length(to_center) - 1.2;
}
```

**Design decision**: Bounding sphere checks compiled directly into distance functions. Simple and effective. Can experiment with alternatives later.

### 5.2. Material Classifier Functions (Multi-Region Only)

For multi-region objects, generate a function that returns **material ID directly** at a point:

```glsl
int sdf_snow_globe_material_at(vec3 p) {
  vec3 center = vec3(0.0, 1.0, 0.0);
  vec3 centered = p - center;
  float r = length(centered);
  
  float outer_r = 1.2;
  float inner_r = outer_r - 0.08;
  
  // Glass shell
  if (r > inner_r && r <= outer_r) return 2;  // glass
  
  // Inside: water vs air bubble vs base
  float water_cutoff = center.y + 0.75 * inner_r;
  
  if (centered.y < water_cutoff - 0.15) {
    return 3;  // water
  }
  if (centered.y < water_cutoff) {
    return 4;  // wood base
  }
  return 0;  // air bubble
}
```

**Important**: This function is only called when `p` is inside the object (distance < 0). It returns material IDs directly, not intermediate region numbers.

**Efficiency note**: Recomputes base fields. Called once at hit point (not during marching), so acceptable. Can optimize later if needed.

### 5.3. Inside Region Function

```glsl
bool inside_region(vec3 p, int region_id) {
  // Dispatch based on region_id
  
  // Single-material objects
  if (region_id == 0) {
    return sdf_sphere1_distance(p) < 0.0;
  }
  
  if (region_id == 1) {
    return sdf_sphere2_distance(p) < 0.0;
  }
  
  // Multi-region snow globe (regions 2-5)
  if (region_id >= 2 && region_id <= 5) {
    // Check if inside object first
    if (sdf_snow_globe_distance(p) >= 0.0) {
      return false;  // outside object entirely
    }
    
    // Inside object - check which region
    int mat = sdf_snow_globe_material_at(p);
    
    // Map: region 2=glass (mat 2), region 3=water (mat 3), 
    //      region 4=air (mat 0), region 5=base (mat 4)
    if (region_id == 2) return mat == 2;
    if (region_id == 3) return mat == 3;
    if (region_id == 4) return mat == 0;
    if (region_id == 5) return mat == 4;
  }
  
  return false;
}
```

**Note**: For multi-region objects, we check material ID and assume the material classifier can distinguish regions. This works when each region has a unique material, but needs more thought for regions sharing materials.

---

## 6. Interface Resolution (Epsilon Sampling)

When we hit a surface, determine material interface:

```glsl
void resolve_sdf_interface(inout Hit hit, vec3 ray_direction) {
  const float eps = 0.0001;
  
  vec3 p_before = hit.p - eps * ray_direction;
  vec3 p_after = hit.p + eps * ray_direction;
  
  int mat_before = query_material_at_point(p_before);
  int mat_after = query_material_at_point(p_after);
  
  hit.material_from = mat_before;
  hit.material_to = mat_after;
}
```

### Material Query Function

```glsl
int query_material_at_point(vec3 p) {
  // Check single-material objects
  if (sdf_sphere1_distance(p) < 0.0) {
    return 1;  // gold
  }
  
  if (sdf_sphere2_distance(p) < 0.0) {
    return 2;  // glass
  }
  
  // Check multi-region objects
  if (sdf_snow_globe_distance(p) < 0.0) {
    return sdf_snow_globe_material_at(p);
  }
  
  // Not inside any object
  return AMBIENT_MATERIAL_ID;
}
```

**Efficiency concern**: Queries all objects sequentially. Called once per surface hit, so acceptable. For scenes with 100+ objects, may need spatial acceleration (future work).

---

## 7. Parameters and Uniforms

Following material convention:

```typescript
geometry: {
  type: 'sphere',
  center: { param: 'sphere.center' },  // uniform
  radius: 1.0  // constant
}
```

Generates:
```glsl
uniform vec3 u_scene_sphere_center;

float sdf_sphere1_distance(vec3 p) {
  return length(p - u_scene_sphere_center) - 1.0;
}
```

**Naming convention**: `u_scene_{param_name}` where param_name comes from the parameter reference.

---

## 8. What We're Still Figuring Out

### 8.1. The Marching Kernel - Open Questions

We know the marching kernel needs to:
1. Evaluate all SDF distance functions at each step
2. Find the minimum distance
3. When min_d < SURFACE_THRESHOLD, determine which region_id was hit
4. Fill the Hit struct

**What we're stuck on**:

**Question 1**: How do we determine region_id at the hit point?

For single-material objects it's straightforward - we know which distance function was minimum, we know its region_id.

For multi-region objects (snow globe), the distance function only tells us we're at the outer surface. We need to classify which specific region. Options:
- Call the material classifier at hit point: `sdf_snow_globe_material_at(hit.p)`
- But how do we map material_id back to region_id when multiple regions might share materials?
- Do we need region classifiers that return region_id directly, separate from material classifiers?

**Question 2**: What's the evaluation strategy?

Options:
- Unrolled: `float d0 = sdf_0(p); float d1 = sdf_1(p); min_d = min(d0, d1);`
- Loop-based: `for (int i = 0; i < N; i++) { d = evaluate_sdf(i, p); }`
- Combined mega-SDF function

For first version, probably unrolled is simplest. Document and experiment later.

**Question 3**: Normal estimation

Need to compute normals via finite differences, but which distance function do we use? Need a way to map region_id back to the appropriate distance function.

### 8.2. Multi-Region Ambiguity

**Problem**: What if a multi-region object has multiple regions with the same material?

Example: A snow globe might have:
- Air bubble inside (material = air)
- Could also have air pockets in the base

Both regions use material 0 (air), but they're different regions spatially.

**Current approach**: The material classifier `sdf_snow_globe_material_at(p)` can use geometric predicates (position, distance to center, etc.) to distinguish them. But we need to ensure the object type definition provides enough information to generate these predicates.

**Open question**: Is there a cleaner way to handle this, or do we accept that multi-region objects need careful geometric logic in their classifiers?

### 8.3. Overlapping Objects

If two objects overlap, which material does `query_material_at_point` return?

Currently: First one checked wins (arbitrary order).

**Options**:
- Check in specific order (smallest to largest, nearest to farthest?)
- Disallow overlaps (validate at compile time?)
- Explicit priority system?

For initial version: First-wins is simplest. Document as potential issue.

### 8.4. Integration with Other Geometry Types

The marching kernel will need to coordinate with:
- Analytic intersection kernel (spheres with closed-form solutions)
- Mesh intersection kernel (BVH traversal)

**Overall scene_intersect**:
```glsl
bool scene_intersect(Ray ray, out Hit hit) {
  // Check analytic objects (cheap, bounded)
  // March SDFs (expensive, bounded by analytic results)
  // Check meshes (medium, BVH-accelerated)
  // Return nearest hit
}
```

Details deferred to overall Scene compilation design.

---

## 9. Module Structure (What We Know)

```typescript
const sdfSceneModule: ModuleDescriptor = {
  id: {
    kind: 'scene',
    name: 'scene_sdf',
    version: '1.0.0'
  },
  
  fragment: {
    functions: `
      // Distance functions (one per object)
      float sdf_sphere1_distance(vec3 p) { ... }
      float sdf_snow_globe_distance(vec3 p) { ... }
      
      // Material classifiers (multi-region only)
      int sdf_snow_globe_material_at(vec3 p) { ... }
      
      // Interface resolution
      int query_material_at_point(vec3 p) { ... }
      void resolve_sdf_interface(inout Hit hit, vec3 ray_dir) { ... }
      
      // Volume queries
      bool inside_region(vec3 p, int region_id) { ... }
      
      // Marching kernel (details TBD)
      bool march_sdf_objects(Ray ray, float max_t, out Hit hit) { ... }
    `,
    
    uniforms: `
      uniform vec3 u_scene_sphere_center;
    `,
  },
  
  uniformBindings: [ ... ],
  
  exports: [
    'march_sdf_objects',
    'inside_region'
  ],
  
  metadata: {
    regionMetadata: [
      { regionId: 0, objectId: 'sphere1', materialId: 1 },
      { regionId: 1, objectId: 'sphere2', materialId: 2 },
      { regionId: 2, objectId: 'snow_globe', regionName: 'glass', materialId: 2 },
      { regionId: 3, objectId: 'snow_globe', regionName: 'water', materialId: 3 },
      { regionId: 4, objectId: 'snow_globe', regionName: 'air_bubble', materialId: 0 },
      { regionId: 5, objectId: 'snow_globe', regionName: 'base', materialId: 4 }
    ]
  }
};
```

---

## 10. Next Steps

### What's Clear:
1. ✅ Region ID system for volumetrics
2. ✅ Distance functions per object
3. ✅ Material classifiers for multi-region objects
4. ✅ Interface resolution via epsilon sampling
5. ✅ inside_region for volume containment
6. ✅ Parameter system integration

### What Needs Design:
1. ❓ Marching kernel details (how to classify to region_id at hit)
2. ❓ Multi-region disambiguation when materials overlap
3. ❓ Normal estimation (mapping region_id to distance function)
4. ❓ Evaluation strategy (unroll vs loop vs other)
5. ❓ Overlapping object handling

### Future Optimizations:
1. Spatial acceleration for many objects
2. Separate bounding functions vs inline bounds
3. Multi-region base field caching
4. Evaluation strategy experiments

---

## 11. Success Criteria

A working SDF Scene implementation will:
1. Generate correct distance and material classifier functions
2. Support volumetric rendering with efficient containment queries
3. Handle both single and multi-region objects
4. Integrate with Material module (material IDs) and Transport (Hit struct)
5. Be performant for typical scenes (5-20 objects)
6. Document open questions clearly for future work

---

This document establishes what we know for certain about SDF compilation and honestly identifies what we're still figuring out. The core architecture (region IDs, material classifiers, volumetric support) is solid. The marching kernel details need more thought, but that's okay - we can implement a simple version first and iterate.
