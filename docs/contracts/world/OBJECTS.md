# Object Module Contract

## Purpose

Object modules define geometric entities and their material assignments in the renderer. Each object provides distance estimation for ray marching and material classification logic, but does NOT handle shading or material properties (those belong to the Material module).

## Core Architecture

### Object Definition Structure

```typescript
interface ObjectDefinition {
  // Geometry specification
  geometry: {
    type: 'sdf' | 'isosurface' | 'mesh' | 'multi_region';
    function: string;           // e.g., "sphere_sdf(p, radius)"
    bounds?: BoundingVolume;    // For acceleration
    analyticIntersect?: boolean; // Has closed-form solution
  };
  
  // Material assignment (not properties!)
  materials: {
    // Simple: single material
    default?: MaterialID;
    
    // Complex: spatial material distribution
    regions?: Array<{
      condition: string;  // e.g., "sdf(p) < -0.1"
      material: MaterialID;
      priority?: number;  // For overlapping regions
    }>;
  };
  
  // Optional optimizations
  hints?: {
    hasAnalyticNormal?: boolean;
    isConvex?: boolean;
    maxComplexity?: number;
  };
}
```

### Object Types

1. **SDF Objects**: Provide true signed distance, enabling exact marching and CSG operations
2. **Isosurface Objects**: Implicit surfaces where f(p) = 0, using gradient-based distance estimation
3. **Multi-Region Objects**: Composite objects with multiple materials defined by spatial predicates
4. **Mesh Objects**: Triangle geometry with BVH traversal (separate system)

### Required Functions

Every object must provide:

```glsl
// Distance estimation (one of these)
float [name]_sdf(vec3 p);           // For SDFs
float [name]_f(vec3 p);              // For isosurfaces
float [name]_eval(vec3 p, out int region);  // For multi-region

// Material classification (required)
// Returns MaterialID (int) NOT material properties
int classify_[name](vec3 p);

// Surface normal (auto-generated if not provided)
vec3 normal_[name](vec3 p);
```

### File Organization

```
objects/
├── primitives/              # Basic geometric primitives
│   ├── sphere/
│   │   ├── definition.json    # Object definition
│   │   ├── euc_sdf.glsl      # Euclidean distance function
│   │   ├── euc_analytic.glsl # Optional: closed-form intersection
│   │   ├── euc_props.glsl    # Optional: optimized normal
│   │   └── hyp_sdf.glsl      # Non-Euclidean variant
│   └── box/
│       └── ...
│
├── isosurfaces/            # Implicit surface objects
│   └── gyroid/
│       ├── definition.json
│       ├── euc_implicit.glsl  # f(p) = 0 function
│       ├── euc_gradient.glsl  # Optional: analytic gradient
│       └── euc_distance.glsl  # Optional: custom distance
│
├── compounds/              # CSG and complex combinations
│   ├── operations.glsl      # Union, intersection, difference
│   └── library/
│       └── teacup.json      # Pre-defined compound object
│
└── procedural/             # Runtime-defined objects
    └── templates.glsl
```

## Implementation Examples

### Simple SDF with Single Material

```json
// sphere/definition.json
{
  "geometry": {
    "type": "sdf",
    "function": "sphere_sdf",
    "analyticIntersect": true
  },
  "materials": {
    "default": "MATERIAL_GLASS"
  }
}
```

```glsl
// sphere/euc_sdf.glsl
float sphere_sdf(vec3 p, vec3 center, float radius) {
    return length(p - center) - radius;
}

// Generated classifier
int classify_sphere_0(vec3 p) {
    return sphere_sdf(p, sphere_0_params.center, sphere_0_params.radius) < 0.0 ? 
           MATERIAL_GLASS : MATERIAL_AIR;
}

// sphere/euc_props.glsl (optional optimization)
vec3 normal_sphere_0(vec3 p) {
    return normalize(p - sphere_0_params.center);
}
```

### Isosurface Object

```json
// gyroid/definition.json
{
  "geometry": {
    "type": "isosurface",
    "function": "gyroid_f"
  },
  "materials": {
    "default": "MATERIAL_PORCELAIN"
  }
}
```

```glsl
// gyroid/euc_implicit.glsl
float gyroid_f(vec3 p) {
    return sin(p.x)*cos(p.y) + sin(p.y)*cos(p.z) + sin(p.z)*cos(p.x);
}

// gyroid/euc_gradient.glsl (optional)
vec3 gyroid_gradient(vec3 p) {
    return vec3(
        cos(p.x)*cos(p.y) - sin(p.z)*sin(p.x),
        cos(p.y)*cos(p.z) - sin(p.x)*sin(p.y),
        cos(p.z)*cos(p.x) - sin(p.y)*sin(p.z)
    );
}

// Generated distance estimate
float gyroid_distance(vec3 p) {
    float f = gyroid_f(p);
    vec3 grad = gyroid_gradient(p);
    return abs(f) / max(length(grad), 0.001);
}

// Generated classifier
int classify_gyroid_0(vec3 p) {
    return gyroid_f(p) < 0.0 ? MATERIAL_PORCELAIN : MATERIAL_AIR;
}
```

### Multi-Region Object

```json
// glass_fog/definition.json
{
  "geometry": {
    "type": "multi_region",
    "function": "mandelbulb_sdf"
  },
  "materials": {
    "regions": [
      {
        "condition": "abs(base_sdf) < 0.1",
        "material": "MATERIAL_GLASS",
        "priority": 2
      },
      {
        "condition": "base_sdf < -0.1",
        "material": "MATERIAL_FOG",
        "priority": 1
      }
    ]
  }
}
```

```glsl
// Generated multi-region evaluator
float eval_glass_fog(vec3 p, out int region_id) {
    float base_sdf = mandelbulb_sdf(p);  // Single evaluation
    
    float min_dist = MAX_DIST;
    region_id = REGION_AIR;
    
    // Shell region
    float d_shell = abs(base_sdf) - 0.1;
    if(d_shell < min_dist) {
        min_dist = d_shell;
        region_id = REGION_GLASS_FOG_SHELL;
    }
    
    // Interior region
    float d_interior = base_sdf + 0.1;
    if(d_interior < min_dist) {
        min_dist = d_interior;
        region_id = REGION_GLASS_FOG_INTERIOR;
    }
    
    return min_dist;
}

// Generated classifier
int classify_glass_fog(vec3 p) {
    float base_sdf = mandelbulb_sdf(p);
    if(abs(base_sdf) < 0.1) return MATERIAL_GLASS;
    if(base_sdf < -0.1) return MATERIAL_FOG;
    return MATERIAL_AIR;
}

// Generated normal (numerical gradient)
vec3 normal_glass_fog(vec3 p) {
    const float h = 0.0001;
    int dummy;
    return normalize(vec3(
        eval_glass_fog(p + vec3(h,0,0), dummy) - eval_glass_fog(p - vec3(h,0,0), dummy),
        eval_glass_fog(p + vec3(0,h,0), dummy) - eval_glass_fog(p - vec3(0,0,h), dummy),
        eval_glass_fog(p + vec3(0,0,h), dummy) - eval_glass_fog(p - vec3(0,0,h), dummy)
    ) / (2.0 * h));
}
```

## CSG Operations

CSG operations are primitive operations provided by the Objects module:

```glsl
// objects/compounds/operations.glsl
float op_union(float d1, float d2) {
    return min(d1, d2);
}

float op_subtract(float d1, float d2) {
    return max(d1, -d2);
}

float op_intersect(float d1, float d2) {
    return max(d1, d2);
}

float op_smooth_union(float d1, float d2, float k) {
    float h = clamp(0.5 + 0.5*(d2-d1)/k, 0.0, 1.0);
    return mix(d2, d1, h) - k*h*(1.0-h);
}
```

### Compound Object Definition

```json
// teacup/definition.json
{
  "geometry": {
    "type": "compound",
    "operations": [
      {
        "type": "subtract",
        "a": {
          "type": "union",
          "a": { "primitive": "cylinder", "params": {...} },
          "b": { "primitive": "torus", "params": {...} }
        },
        "b": { "primitive": "cylinder", "params": {...} }
      }
    ]
  },
  "materials": {
    "default": "MATERIAL_CERAMIC"
  }
}
```

## Procedural Objects

Runtime-defined objects using templates:

```typescript
// Input specification
{
  type: "procedural_sdf",
  id: "blob",
  code: "length(p) - 1.0 + 0.3*sin(10.0*p.x)*sin(10.0*p.y)",
  material: "MATERIAL_WAX"
}
```

```glsl
// Generated implementation
float procedural_blob_sdf(vec3 p) {
    return length(p) - 1.0 + 0.3*sin(10.0*p.x)*sin(10.0*p.y);
}

int classify_procedural_blob(vec3 p) {
    return procedural_blob_sdf(p) < 0.0 ? MATERIAL_WAX : MATERIAL_AIR;
}

vec3 normal_procedural_blob(vec3 p) {
    // Auto-generated numerical gradient
    const float h = 0.0001;
    return normalize(vec3(
        procedural_blob_sdf(p + vec3(h,0,0)) - procedural_blob_sdf(p - vec3(h,0,0)),
        procedural_blob_sdf(p + vec3(0,h,0)) - procedural_blob_sdf(p - vec3(0,0,h)),
        procedural_blob_sdf(p + vec3(0,0,h)) - procedural_blob_sdf(p - vec3(0,0,h))
    ) / (2.0 * h));
}
```

## Two-Sided Materials

Objects can return different materials based on which side is hit:

```glsl
int classify_leaf(vec3 p, vec3 ray_dir) {
    float d = leaf_sdf(p);
    if (abs(d) > EPSILON) {
        return d < 0 ? MATERIAL_LEAF_INTERIOR : MATERIAL_AIR;
    }
    
    // At surface - check which side
    vec3 n = normal_leaf(p);
    bool front_face = dot(ray_dir, n) < 0;
    return front_face ? MATERIAL_LEAF_FRONT : MATERIAL_LEAF_BACK;
}
```

## Volume Support

Objects with volumetric materials work identically:

```glsl
int classify_fog_sphere(vec3 p) {
    return sphere_sdf(p) < 0.0 ? MATERIAL_FOG : MATERIAL_AIR;
}

// Material system recognizes MATERIAL_FOG as volume type
// Scene triggers volumetric transport when entering
```

## Geometry-Agnostic Implementation

Objects must use geometry module functions for all geometric operations:

```glsl
// DON'T: Assume Euclidean space
float NdotL = dot(normal, light_dir);  // WRONG!

// DO: Use geometry module
float NdotL = g_dot(normal, light_dir, hit.p);  // Correct

// For reflection/refraction in curved space
Direction reflect_curved(Direction I, Direction N, Point p) {
    float NdotI = g_dot(N, I, p);
    Direction refl_local = I - 2.0 * NdotI * N;
    return normalize(refl_local);
}
```

## Object Compiler

```typescript
class ObjectCompiler {
  compile(definition: ObjectDefinition): CompiledObject {
    const distance = this.generateDistanceFunction(definition);
    const classifier = this.generateClassifier(definition);
    const normal = definition.hints?.hasAnalyticNormal ? 
                   this.loadAnalyticNormal(definition) : 
                   this.generateNumericalNormal(definition);
    
    return {
      id: definition.id,
      glsl: {
        distance,
        classifier,
        normal
      },
      metadata: {
        usedMaterials: this.extractMaterialIds(definition),
        boundingVolume: definition.geometry.bounds,
        hasAnalyticIntersect: definition.geometry.analyticIntersect
      }
    };
  }
  
  generateClassifier(definition: ObjectDefinition): string {
    if (definition.materials.default) {
      return `
int classify_${definition.id}(vec3 p) {
    return ${definition.geometry.function}(p) < 0.0 ? 
           ${definition.materials.default} : MATERIAL_AIR;
}`;
    }
    
    // Multi-region classifier
    const conditions = definition.materials.regions.map(r => 
      `if(${r.condition}) return ${r.material};`
    ).join('\n    ');
    
    return `
int classify_${definition.id}(vec3 p) {
    float base = ${definition.geometry.function}(p);
    ${conditions}
    return MATERIAL_AIR;
}`;
  }
}
```

## Performance Optimizations

- **Single base evaluation** for multi-region objects
- **Analytic normals** when available
- **Bounding volumes** for early rejection
- **Conservative marching** factor (0.9) for reliability
- **Precomputed constants** where possible
- **Unrolled classifiers** for simple objects
- **Cached evaluations** for expensive SDFs

## Design Principles

1. **Objects own geometry + material assignment** - NOT material properties
2. **Material IDs are integers** - Lightweight to pass around
3. **Classification is object-local** - Each object knows its own materials
4. **CSG is a primitive operation** - Available to all, not special
5. **Separation of concerns** - Objects don't know about shading or scene arrangement
6. **Mathematical clarity** - SDFs and isosurfaces remain distinct
7. **Extensibility** - Easy to add new object types

## Validation Requirements

The compiler ensures generated objects:
1. Implement all required functions (distance, classify, normal)
2. Return valid material IDs that exist in the material library
3. Maintain normals pointing outward
4. Handle edge cases (grazing rays, surface boundaries)
5. Produce finite distance values
6. Classify consistently (same point always returns same material)
7. Support the geometry module's coordinate system
