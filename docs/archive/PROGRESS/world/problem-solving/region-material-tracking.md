# The Region/Material Identity Problem – Problem Description

## 1. Overview

We have a fundamental tension in how we identify and track geometric regions and their associated materials during rendering. This document describes the problem space without proposing solutions.

---

## 2. The Core Information We Need to Track

### 2.1. At Surface Intersections

When a ray hits a surface, we need to know:

**For shading/interaction:**
- `material_from`: Which material are we coming from?
- `material_to`: Which material are we entering?

These are needed to:
- Compute Fresnel terms (depends on IOR difference)
- Determine refraction vs reflection
- Handle nested dielectrics correctly

**For volumetrics (if entering a volume):**
- Which specific geometric region are we in?
- This tells us which distance function or containment test to use for volume stepping

### 2.2. During Volume Stepping

When Transport is marching through a volume, at each step it needs:

**For material properties:**
- Which material ID to query for density, absorption, scattering coefficients

**For containment:**
- "Am I still in the same geometric region?"
- Need to query a specific SDF or containment function
- Cannot afford to query all objects in the scene

### 2.3. Summary: Two Different Kinds of Information

1. **Material identity**: What material properties to use (for shading/scattering)
2. **Geometric identity**: Which geometric region/volume we're in (for containment queries)

These are related but not the same thing.

---

## 3. The Complexity: Shared Materials

### 3.1. Material Sharing Across Regions

Multiple geometric regions can use the same material:

**Example scene:**
```
sphere1: uses material "gold"
sphere2: uses material "glass" 
snow_globe:
  - glass shell: uses material "glass"  (SHARED with sphere2)
  - water: uses material "water"
  - air bubble: uses material "air"
  - base: uses material "wood"
```

So we have:
- 5 geometric regions total (sphere1, sphere2, and 3 snow_globe regions)
- 4 unique materials (gold, glass, water, wood)
- sphere2 and snow_globe glass shell share the same material

### 3.2. Why This Creates Problems

**For material queries:**
If we only track material ID, we can query material properties fine:
```glsl
MaterialProperties props = scene_material_properties(material_id, p);
```

**For volume containment:**
But if we're in the glass material, which region are we in?
- Could be sphere2
- Could be snow_globe's glass shell

These need different containment checks:
```glsl
// For sphere2:
bool still_inside = sdf_sphere2_distance(p) < 0.0;

// For snow_globe glass:
bool still_inside = (sdf_snow_globe_distance(p) < 0.0) 
                    && (sdf_snow_globe_material_at(p) == glass_mat_id);
```

We can't distinguish these with only material_id.

---

## 4. What We Need at Each Stage

### 4.1. During Ray Marching (Finding Intersections)

**SDF marching loop:**
```glsl
for each step:
  vec3 p = current position
  evaluate all SDF distance functions
  find minimum distance
  
  if minimum < threshold:
    // HIT! Now what do we know?
    // - We know which distance function was minimum
    // - For single-material objects: that tells us everything
    // - For multi-region objects: we know which object, 
    //   but not which region inside it
```

**The question**: What information do we store in the Hit struct to enable everything downstream?

### 4.2. After Finding a Hit (Interface Resolution)

Need to determine:
```glsl
hit.material_from = ???
hit.material_to = ???
```

Via epsilon sampling:
```glsl
vec3 p_before = hit.p - eps * ray.direction;
vec3 p_after = hit.p + eps * ray.direction;

// What material is at p_before?
// What material is at p_after?
```

To answer these questions, we need to:
- Check all objects to see if these points are inside them
- For multi-region objects, classify which region

This gives us material IDs.

### 4.3. During Volume Transport

Transport has just entered a volume:
```glsl
// From the hit:
int current_material = hit.material_to;  // e.g., glass (material 2)

// Marching through volume:
while (in_volume) {
  MaterialProperties props = scene_material_properties(current_material, p);
  // Use props.density, etc.
  
  p += step * direction;
  
  // KEY QUESTION: How do we check if still in the same volume?
  // Material ID alone isn't enough (sphere2 vs snow_globe glass)
  // Need geometric identity
}
```

**The problem**: We need to know **which specific geometric region** we're in, not just which material.

---

## 5. The ID Tracking Problem

### 5.1. One ID or Multiple IDs?

**Option A: Just material ID**
- Track only material_id
- Problem: Can't distinguish geometric regions sharing materials
- Volume containment fails

**Option B: Just region ID (unique per region)**
- Track region_id (globally unique across all regions)
- Problem: Need separate lookup to get material_id
- Two IDs to manage

**Option C: Duplicate materials (no sharing)**
- Each region gets its own material copy
- region_id directly maps to unique material
- Problem: Code bloat (material switch with 100+ cases)

### 5.2. What Information Lives Where?

If we use separate region_id and material_id:

**In Hit struct:**
```glsl
struct Hit {
  vec3 p, n;
  float t;
  
  int region_id;      // Which geometric region?
  int material_from;  // Which material coming from?
  int material_to;    // Which material entering?
};
```

Now we have 3 IDs per hit!

**In Transport:**
```glsl
// After hitting glass shell of snow globe:
int current_region = hit.region_id;     // snow_globe glass region
int current_material = hit.material_to;  // glass material

// During volume stepping:
MaterialProperties props = scene_material_properties(current_material, p);
if (!inside_region(p, current_region)) { ... }
```

**Questions:**
- Is tracking 3 IDs too much?
- Is there redundancy we can eliminate?
- Can we derive one from another?

---

## 6. The Marching Kernel Challenge

### 6.1. The Hit Classification Problem

When marching finds a surface:

**For single-material objects:**
- Know which distance function was minimum → know the region → done

**For multi-region objects:**
- Know which distance function was minimum (e.g., snow_globe)
- Don't know which region inside (glass vs water vs air vs base)
- Need to classify

**How to classify?**

Could call a material classifier:
```glsl
int mat = sdf_snow_globe_material_at(hit.p);
// Returns material ID (e.g., 2 for glass)
```

But then how do we get region_id from material_id?
- Multiple regions might have the same material
- Need geometric predicates to distinguish

**The core issue**: The distance function tells us "we hit snow_globe outer surface" but doesn't tell us which region we're at. Classification requires evaluating more expensive region predicates.

### 6.2. Distance Function Granularity

**Current approach:**
- One distance function per object: `sdf_snow_globe_distance(p)`
- Returns distance to the outer surface
- Cheap(ish) for marching

**Alternative:**
- Distance function could return (distance, region_id) pairs?
- But this requires classifying region at every march step (expensive!)
- vs classifying only at hit point (once per intersection)

**Tradeoff**: Efficiency during marching vs information available at hit.

---

## 7. The Ambiguity Problems

### 7.1. Multiple Regions with Same Material

Snow globe could have:
- Air bubble (material: air)
- Exterior ambient air (material: air) - wait, this is outside the object!

Actually, exterior isn't part of the object. But consider:
- A complex object with multiple pockets of water
- Both use material "water"
- Need geometric predicates to distinguish

The material classifier `sdf_complex_material_at(p)` returns the material ID, but if multiple regions have the same material, we need additional geometric checks to determine which specific region.

### 7.2. Overlapping Objects

If two objects overlap:
```glsl
int query_material_at_point(vec3 p) {
  if (sdf_sphere1_distance(p) < 0.0) return material_1;
  if (sdf_sphere2_distance(p) < 0.0) return material_2;
  // Which one if both?
}
```

This affects interface resolution (epsilon sampling might give inconsistent results) and volume stepping (which region are we in?).

---

## 8. Summary of Pain Points

### 8.1. Information Overload
- Need to track region identity AND material identity
- Hit struct might need 3 IDs (region_id, material_from, material_to)
- Transport tracks multiple IDs during volume stepping

### 8.2. Material Sharing Creates Ambiguity
- Multiple regions can use same material
- Material ID alone insufficient for geometric queries
- Need mapping from material → possible regions → geometric tests

### 8.3. Multi-Region Classification Costs
- Distance function is cheap (for marching)
- Region/material classification is more expensive
- When do we pay the classification cost?

### 8.4. Code Generation Complexity
- Need to generate appropriate classifier functions
- Need dispatch mechanisms (region_id → distance function, etc.)
- Need lookups/mappings (region ↔ material)

### 8.5. Conceptual Complexity
- Hard to reason about what information exists where
- Easy to confuse region identity with material identity
- Multiple IDs with different purposes

---

## 9. What We Need to Decide

1. **ID Strategy**: One ID or multiple? How do we handle shared materials?

2. **Hit Struct Contents**: What goes in Hit? Just material interface? Region ID too?

3. **Classification Timing**: When do we classify multi-region hits? During marching or at hit point?

4. **Lookup/Mapping**: How do we map between region_id ↔ material_id ↔ distance functions?

5. **Ambiguity Resolution**: How do we handle multiple regions with the same material?

6. **Code Generation**: What functions do we generate and how do they coordinate?

---

This is a genuinely hard problem because we have two overlapping but distinct concepts (geometric regions and material properties) that need to be tracked efficiently in a performance-critical inner loop (marching) and used correctly in downstream systems (Transport).
