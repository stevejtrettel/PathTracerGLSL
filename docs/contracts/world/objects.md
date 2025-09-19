# Objects Contract

## Object Definition

```typescript
interface ObjectDefinition {
  geometry: {
    type: 'sdf' | 'isosurface' | 'multi_region';
    function: string;           // Base function name
    bounds?: BoundingVolume;
    analyticIntersect?: boolean;
  };
  
  materials: {
    // Simple: single material
    default?: MaterialID;
    
    // Complex: spatial regions
    regions?: Array<{
      condition: string;        // GLSL boolean expression
      material: MaterialID;
      priority?: number;        // Higher priority overrides
    }>;
  };
  
  hints?: {
    hasAnalyticNormal?: boolean;
    isConvex?: boolean;
  };
}
```

## Required Functions

Each object instance must provide:

```glsl
// Distance function (one required)
float [name]_sdf(vec3 p)              // Signed distance
float [name]_f(vec3 p)                // Implicit f(p) = 0
float [name]_eval(vec3 p, out int region)  // Multi-region

// Material classifier (required)
int classify_[name](vec3 p)           // Returns MaterialID

// Surface normal (auto-generated via gradient if not provided)
vec3 normal_[name](vec3 p)
```

## CSG Operations

Provided by Objects module, available to all:

```glsl
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

## SDF Object

```glsl
// Definition
{
  "geometry": { "type": "sdf", "function": "sphere_sdf" },
  "materials": { "default": 0 }  // MaterialID 0
}

// Implementation
float sphere_sdf(vec3 p, vec3 center, float radius) {
  return length(p - center) - radius;
}

// Generated instance
float sphere_0_sdf(vec3 p) {
  return sphere_sdf(p, sphere_0_center, sphere_0_radius);
}

int classify_sphere_0(vec3 p) {
  return sphere_0_sdf(p) < 0.0 ? 0 : MATERIAL_AIR;
}
```

## Isosurface Object

```glsl
// Definition
{
  "geometry": { "type": "isosurface", "function": "gyroid_f" },
  "materials": { "default": 1 }
}

// Base function
float gyroid_f(vec3 p) {
  return sin(p.x)*cos(p.y) + sin(p.y)*cos(p.z) + sin(p.z)*cos(p.x);
}

// Generated distance estimate
float gyroid_0_distance(vec3 p) {
  float f = gyroid_f(p);
  vec3 grad = gyroid_gradient(p);  // Analytic or numerical
  return abs(f) / max(length(grad), 0.001);
}

int classify_gyroid_0(vec3 p) {
  return gyroid_f(p) < 0.0 ? 1 : MATERIAL_AIR;
}
```

## Multi-Region Object

```glsl
// Definition
{
  "geometry": { "type": "multi_region", "function": "shell_eval" },
  "materials": {
    "regions": [
      { "condition": "d < -0.1", "material": 2, "priority": 1 },
      { "condition": "abs(d) < 0.1", "material": 3, "priority": 2 }
    ]
  }
}

// Implementation
float shell_eval(vec3 p, out int region) {
  float base_d = sphere_sdf(p, vec3(0), 1.0);
  
  if (abs(base_d) < 0.1) {
    region = 1;  // Shell region
    return abs(base_d) - 0.1;
  } else if (base_d < -0.1) {
    region = 0;  // Core region
    return base_d + 0.1;
  }
  
  region = -1;  // Outside
  return base_d;
}

// Generated classifier
int classify_shell_0(vec3 p) {
  int region;
  float d = shell_eval(p, region);
  
  switch(region) {
    case 0: return 2;  // Core material
    case 1: return 3;  // Shell material
    default: return MATERIAL_AIR;
  }
}
```

## Compilation

Objects are compiled to:
1. Distance function for marching
2. Classification function returning MaterialID
3. Normal function (gradient if not provided)
4. Instance-specific parameter bindings

## Validation

1. classify_[name] must return valid MaterialID or MATERIAL_AIR
2. Distance functions must return finite values
3. Normals must be unit vectors pointing outward
4. Multi-region evaluators must set region parameter
5. CSG operations preserve SDF properties (when inputs are SDFs)
