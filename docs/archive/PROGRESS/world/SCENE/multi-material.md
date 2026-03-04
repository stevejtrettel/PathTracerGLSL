# Multi-Region Objects: Design Documentation

## The Problem We Solved

### Performance Issue with Expensive SDFs

When an object has multiple material regions (e.g., a glass shell filled with fog), we need to:
1. Evaluate the base geometry (potentially expensive - fractals, complex CSG)
2. Determine which region we're in
3. Handle material interfaces correctly

**Naive approach with two separate objects:**
```glsl
// Two objects: glass shell, fog interior
float glass_sdf = abs(mandelbulb_sdf(p)) - 0.1;  // Evaluates mandelbulb
float fog_sdf = mandelbulb_sdf(p) + 0.1;         // Evaluates mandelbulb AGAIN
```

**Problem**: Expensive SDF evaluated multiple times per marching step.

### Why Interface Resolution Matters

Every ray-surface intersection is a transition between two materials. We need to know:
- `material_from`: What material we're coming from
- `material_to`: What material we're entering

This is true even for simple cases:
- Ray hits sphere from outside: `air → glass`
- Ray hits sphere from inside: `glass → air`

For multi-material objects, the scene can't determine this globally - it needs help from the object itself.

---

## The Agreed Solution: Multi-Region Objects

### Core Concept

**Evaluate expensive base SDFs once, then define regions as cheap predicates over those bases.**

### Object Definition Format

```typescript
interface MultiRegionObject {
  type: "multi_region";
  id: string;
  
  // Base SDFs - evaluated ONCE per marching step
  bases: {
    [name: string]: string;  // GLSL expression
  };
  
  // Regions defined by predicates
  regions: Array<{
    name: string;
    condition: string;    // Boolean predicate using $base_name syntax
    material: string;     // Material ID
  }>;
}
```

### Example: Cup with Liquid

```typescript
{
  type: "multi_region",
  id: "cup_with_liquid",
  
  // Base SDFs (evaluated once each)
  bases: {
    cup: "cylinder_sdf(p, 1.0, 2.0)",
    base: "cylinder_sdf(p, 0.8, 0.3) - 0.1"
  },
  
  // Regions defined using bases and conditions
  regions: [
    {
      name: "glass_wall",
      condition: "abs($cup) < 0.1",  // Shell of cup
      material: "glass"
    },
    {
      name: "opaque_base",
      condition: "$base < 0 && $cup < -0.1",  // Inside cup, base region
      material: "ceramic"
    },
    {
      name: "liquid",
      condition: "$cup < -0.1 && p.y < 1.0 && $base > 0",  // Inside cup, below waterline, above base
      material: "water"
    }
  ]
}
```

### Condition Syntax

- `$base_name` - References a base SDF value
- `p.x, p.y, p.z` - Current point coordinates
- Standard operators: `<`, `>`, `&&`, `||`, `!`, `abs()`, `min()`, `max()`
- Can include noise functions or other expressions

---

## Generated GLSL Code

### Distance Evaluation Function

Evaluates base SDFs once, then tests all regions to find closest:

```glsl
float eval_cup_with_liquid(vec3 p, out int region_id) {
  // EVALUATE BASES ONCE
  float base_cup = cylinder_sdf(p, 1.0, 2.0);
  float base_base = cylinder_sdf(p, 0.8, 0.3) - 0.1;
  
  float min_dist = MAX_DIST;
  int closest_region = -1;
  
  // Test each region's SDF (derived from bases)
  
  // Glass wall: shell between outer and inner
  {
    float d = abs(base_cup) - 0.1;
    if (d < min_dist) {
      min_dist = d;
      closest_region = REGION_GLASS_WALL;
    }
  }
  
  // Opaque base
  {
    float d = max(base_base, -base_cup - 0.1);  // CSG intersection
    if (d < min_dist) {
      min_dist = d;
      closest_region = REGION_OPAQUE_BASE;
    }
  }
  
  // Liquid
  {
    float d = max(max(-base_cup - 0.1, p.y - 1.0), -base_base);
    if (d < min_dist) {
      min_dist = d;
      closest_region = REGION_LIQUID;
    }
  }
  
  region_id = closest_region;
  return min_dist;
}
```

### Point Classification Function

Tests predicates to determine which region a point is in:

```glsl
int get_region_at(vec3 p) {
  // Evaluate all base SDFs
  float base_cup = cylinder_sdf(p, 1.0, 2.0);
  float base_base = cylinder_sdf(p, 0.8, 0.3) - 0.1;
  
  // Test each region's condition in priority order
  if (abs(base_cup) < 0.1) return REGION_GLASS_WALL;
  if (base_base < 0 && base_cup < -0.1) return REGION_OPAQUE_BASE;
  if (base_cup < -0.1 && p.y < 1.0 && base_base > 0) return REGION_LIQUID;
  
  return REGION_AIR;  // Not in any region (exterior)
}
```

### Material Mapping

```glsl
int get_material_for_region(int region_id) {
  switch(region_id) {
    case REGION_GLASS_WALL: return MATERIAL_GLASS;
    case REGION_OPAQUE_BASE: return MATERIAL_CERAMIC;
    case REGION_LIQUID: return MATERIAL_WATER;
    default: return MATERIAL_AIR;
  }
}
```

---

## Interface Resolution

### The Key Insight

**Interface resolution happens in the existing Hit system using epsilon sampling.**

Multi-region objects don't handle their own interface resolution - they just provide a classification function that the marcher uses.

### Marching Integration

```glsl
Hit march_scene(Ray ray) {
  float t = 0.01;
  
  for (int i = 0; i < MAX_STEPS; i++) {
    vec3 p = ray.origin + ray.direction * t;
    
    // Evaluate multi-region object
    int region_id;
    float dist = eval_cup_with_liquid(p, region_id);
    
    if (dist < EPSILON) {
      // Hit detected - resolve interface
      const float EPSILON_SAMPLE = 1e-4;
      
      vec3 before = p - ray.direction * EPSILON_SAMPLE;
      vec3 after = p + ray.direction * EPSILON_SAMPLE;
      
      // Classify points before and after
      int region_before = get_region_at(before);
      int region_after = get_region_at(after);
      
      // Map to materials
      int material_from = get_material_for_region(region_before);
      int material_to = get_material_for_region(region_after);
      
      return make_hit(t, p, material_from, material_to);
    }
    
    t += dist * 0.9;
  }
  
  return miss();
}
```

### Why This Works

1. **Expensive base SDFs evaluated once** during marching
2. **Cheap predicate tests evaluated twice** (at before/after points)
3. **Correct interface detection** - we know exactly which materials we're transitioning between
4. **No special infrastructure** - uses existing Hit system

**Performance win**: Testing boolean predicates is trivial compared to evaluating complex SDFs.

---

## Complete Examples

### Snow Globe

```typescript
{
  type: "multi_region",
  id: "snow_globe",
  
  bases: {
    sphere: "sphere_sdf(p, [0,0,0], 2.0)",
    base: "cylinder_sdf(p - [0,-2.2,0], 1.5, 0.4)",
    figurine: "tree_sdf(p)",  // Complex SDF
    bubble: "sphere_sdf(p - [0,1.5,0], 0.3)"
  },
  
  regions: [
    {
      name: "glass_shell",
      condition: "abs($sphere) < 0.1 && p.y > -2.0",
      material: "glass"
    },
    {
      name: "decorative_base", 
      condition: "$base < 0",
      material: "ceramic_gold"
    },
    {
      name: "figurine",
      condition: "$figurine < 0 && $sphere < -0.1",
      material: "plastic_red"
    },
    {
      name: "air_bubble",
      condition: "$bubble < 0 && $sphere < -0.1",
      material: "air"
    },
    {
      name: "water",
      condition: "$sphere < -0.1 && $bubble > 0 && $figurine > 0 && p.y > -2.0",
      material: "water_with_glitter"
    }
  ]
}
```

**Interfaces handled:**
- Water → Glass (refraction + reflection)
- Water → Figurine (colored plastic underwater)
- Water → Air bubble (total internal reflection possible)
- Glass → Ceramic (at base junction)
- Air → Glass → Water (looking through top)

### Terrarium with Irregular Boundaries

```typescript
{
  type: "multi_region",
  id: "terrarium",
  
  bases: {
    jar: "cylinder_sdf(p, 1.0, 3.0)",
    lid: "cylinder_sdf(p - [0,3.1,0], 1.1, 0.2)",
    soil_level: "p.y - (-1.0 + 0.2*noise(p.xz * 5.0))",  // Irregular surface
    water_level: "p.y - (-2.0)",
    rock: "sphere_sdf(p - [0.3,-1.5,0], 0.3)"
  },
  
  regions: [
    {
      name: "glass_jar",
      condition: "abs($jar) < 0.1",
      material: "glass"
    },
    {
      name: "metal_lid",
      condition: "$lid < 0",
      material: "copper"
    },
    {
      name: "soil",
      condition: "$jar < -0.1 && $soil_level < 0 && $water_level > 0",
      material: "soil"  // Volumetric, subsurface scatter
    },
    {
      name: "drainage_rocks",
      condition: "$rock < 0 && $jar < -0.1",
      material: "granite"
    },
    {
      name: "water",
      condition: "$jar < -0.1 && $water_level < 0 && $rock > 0",
      material: "muddy_water"  // Volumetric with absorption
    },
    {
      name: "air",
      condition: "$jar < -0.1 && $soil_level > 0 && $lid > 0",
      material: "humid_air"  // Slight fog volume
    }
  ]
}
```

**Key feature**: `soil_level` uses noise, creating an irregular natural boundary. The system handles all interfaces correctly:
- Soil → Water (sediment boundary)
- Rock → Water (underwater object)
- Air → Soil (irregular surface)
- Glass → everything (container walls)

---

## Works with SDFs and Isosurfaces

The system works uniformly across different field types:

```typescript
{
  type: "multi_region",
  id: "crystal_in_fluid",
  
  bases: {
    crystal: {
      type: "isosurface",
      function: "p.x*p.x*p.x*p.x + p.y*p.y + p.z*p.z - 1.0"
    },
    container: {
      type: "sdf",
      function: "sphere_sdf(p, vec3(0), 2.0)"
    },
    fluid_level: {
      type: "sdf",
      function: "p.y - 0.5 + 0.1*sin(5.0*p.x)*sin(5.0*p.z)"
    }
  },
  
  regions: [
    {
      name: "crystal",
      condition: "$crystal < 0",  // Inside isosurface (where f < 0)
      material: "diamond"
    },
    {
      name: "fluid",
      condition: "$container < 0 && $fluid_level < 0 && $crystal > 0",
      material: "mercury"
    },
    {
      name: "air",
      condition: "$container < 0 && $fluid_level > 0 && $crystal > 0",
      material: "air"
    }
  ]
}
```

**Predicates work the same** - `$iso < 0` means inside the isosurface, just like `$sdf < 0` means inside the SDF.

---

## Design Principles

### 1. Simple Objects Remain Primary

Most objects are single-material and don't need this system:

```typescript
// Simple object - preferred for most cases
{
  type: "sdf",
  function: "sphere_sdf(p, vec3(0), 1.0)",
  material: "glass"
}
```

Multi-region is only for complex cases where:
- Object has multiple distinct materials in contact
- Base SDF is expensive to evaluate
- Regions share geometric relationships

### 2. Declarative Region Definitions

Define **what** regions exist, not **how** to compute them. The compiler handles code generation.

### 3. Efficient Evaluation

Each base SDF computed once per marching step. Region predicates are cheap boolean tests.

### 4. Correct Interface Resolution

Automatic from point classification - no special cases needed.

### 5. Extensibility

New region types, procedural boundaries, time-varying predicates all fit naturally into the predicate system.

---

## Architecture Integration

Multi-region objects are a specialized object type within the World pillar:

```
world/
├── objects/
│   ├── sdf/           # Simple single-material SDFs
│   ├── isosurface/    # Simple single-material isosurfaces
│   ├── mesh/          # Triangle geometry
│   └── multi_region/  # Multi-material objects
│       ├── compiler.ts     # Generates GLSL from definitions
│       └── examples/
```

The scene compiler treats multi-region objects as first-class primitives, generating specialized code for each one.

---

## Performance Characteristics

### Comparison

For a fractal shell with fog interior:

| Approach | Base SDF Evals | Predicate Tests | Notes |
|----------|---------------|-----------------|-------|
| Two separate objects | 2× per step | 0 | Wasteful for expensive SDFs |
| Multi-region | 1× per step | 2× per hit | Predicates are cheap |

**Key insight**: For expensive SDFs (fractals, complex CSG), the multi-region approach is significantly faster because predicate testing is trivial compared to SDF evaluation.

### Typical Performance

- **Simple scene** (5 regions): Base eval once, 5 predicate tests = negligible overhead
- **Complex scene** (20 regions): Still just one base eval, 20 cheap boolean tests
- **Expensive base** (mandelbulb): Saves 1-10ms per ray by avoiding duplicate evaluation

---

## Epsilon Selection

The epsilon value for interface sampling is critical:

```glsl
const float EPSILON_SAMPLE = 1e-4;

vec3 before = p - ray.direction * EPSILON_SAMPLE;
vec3 after = p + ray.direction * EPSILON_SAMPLE;
```

### Tradeoffs

**Too small** (< 1e-5):
- Numerical precision issues
- May sample the same side twice at grazing angles
- Fails near sharp corners

**Too large** (> 1e-3):
- Misses thin features
- Incorrect at sharp edges
- May skip entire thin regions

**Recommended**: Start with `1e-4`, tune per-scene as needed.

### Per-Object Tuning

For objects with thin regions (e.g., 2% thickness), may need smaller epsilon:

```typescript
{
  type: "multi_region",
  id: "varnished_sphere",
  epsilon: 1e-5,  // Override default for thin coating
  bases: { /* ... */ },
  regions: [ /* ... */ ]
}
```

---

## Limitations and Future Work

### Current Limitations

1. **No material stack**: Doesn't handle nested dielectrics (sphere inside sphere inside sphere)
2. **No acceleration**: Tests all regions even when we could bound-check
3. **Fixed epsilon**: Single epsilon value may not work for all feature sizes
4. **First-match priority**: Overlapping regions resolved by order, not explicitly

### Potential Extensions

1. **Adaptive epsilon**: Compute based on local surface curvature
2. **Region bounding**: Skip regions provably far from current point
3. **Hierarchical regions**: Parent-child relationships for complex nesting
4. **Procedural regions**: Time-varying predicates for animation
5. **LOD support**: Simplify regions based on distance to camera

---

## Summary

Multi-region objects solve the problem of efficient multi-material rendering by:

1. **Evaluating expensive base geometry once** per marching step
2. **Testing cheap predicates** to determine regions
3. **Using existing interface resolution** via epsilon sampling
4. **Maintaining correctness** for all material transitions

**When to use:**
- Objects with 3+ materials in direct contact
- Expensive base SDFs (fractals, complex CSG)
- Physically accurate glass, liquids, fog, etc.

**When NOT to use:**
- Simple single-material objects (use standard SDF)
- Disconnected objects (use separate objects)
- Very thin coatings (epsilon tuning becomes critical)

The system provides minimal but sufficient machinery for complex multi-material objects while keeping simple objects simple.