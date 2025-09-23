# Objects Contract (Revised)

## Purpose

Objects define **shapes and material ID assignment** that get compiled into the Scene module. They are not standalone modules but building blocks that Scene uses to construct its intersection and material resolution functions. Each object knows its geometry and which MaterialID applies where, but nothing about material properties or light behavior.

## Object Definition Structure

```typescript
interface ObjectDefinition {
    name: string;                    // Unique identifier for this instance
    type: string;                    // 'sphere' | 'box' | 'torus' | 'custom'

    geometry: {
    base: 'sdf' | 'implicit' | 'procedural';
    parameters: any;              // Type-specific parameters
    bounds?: BoundingBox;         // Optional for acceleration
};

materials: {
// Simple: uniform material
uniform?: MaterialID;

// Complex: spatial variation
regions?: Array<{
test: string;               // GLSL expression: "p.y < 0.0"
material: MaterialID;
priority?: number;          // For overlap resolution
}>;

// Procedural: function-based
function?: string;            // Name of material selection function
};

transform?: {
position: vec3;
rotation: vec3;               // Euler angles or quaternion
scale: vec3 | number;
};

features?: {
hasAnalyticNormal?: boolean;
hasAnalyticUV?: boolean;
isConvex?: boolean;           // For optimization hints
maxDistance?: number;         // Bounding sphere radius
};
}
```

## Generated Functions Per Object

Each object generates functions that Scene will call through its dispatch system:

```glsl
// Core functions for an object instance (e.g., "sphere_0")
float [type]_[instance]_distance(vec3 p)     // Distance to surface
int [type]_[instance]_material(vec3 p)       // MaterialID at point
vec3 [type]_[instance]_normal(vec3 p)        // Surface normal

// Optional functions
vec2 [type]_[instance]_uv(vec3 p)           // Texture coordinates
bool [type]_[instance]_inside(vec3 p)       // Inside test
```

## Base Shape Library

### SDF Primitives

```glsl
// Sphere
float sphere_distance(vec3 p, vec3 center, float radius) {
    return length(p - center) - radius;
}

vec3 sphere_normal(vec3 p, vec3 center) {
    return normalize(p - center);
}

vec2 sphere_uv(vec3 p, vec3 center) {
    vec3 d = normalize(p - center);
    return vec2(
    atan(d.z, d.x) / (2.0 * PI) + 0.5,
    asin(d.y) / PI + 0.5
    );
}

// Box
float box_distance(vec3 p, vec3 center, vec3 half_extents) {
    vec3 q = abs(p - center) - half_extents;
    return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0);
}

// Torus
float torus_distance(vec3 p, vec3 center, vec2 radii) {
    vec3 q = p - center;
    vec2 xz = vec2(length(q.xz) - radii.x, q.y);
    return length(xz) - radii.y;
}

// Rounded primitives
float round_box_distance(vec3 p, vec3 center, vec3 half_extents, float radius) {
    vec3 q = abs(p - center) - half_extents + radius;
    return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0) - radius;
}
```

### CSG Operations

```glsl
// Basic operations
float csg_union(float d1, float d2) {
    return min(d1, d2);
}

float csg_subtract(float d1, float d2) {
    return max(d1, -d2);
}

float csg_intersect(float d1, float d2) {
    return max(d1, d2);
}

// Smooth operations
float csg_smooth_union(float d1, float d2, float k) {
    float h = clamp(0.5 + 0.5*(d2-d1)/k, 0.0, 1.0);
    return mix(d2, d1, h) - k*h*(1.0-h);
}

float csg_smooth_subtract(float d1, float d2, float k) {
    float h = clamp(0.5 - 0.5*(d2+d1)/k, 0.0, 1.0);
    return mix(d2, -d1, h) + k*h*(1.0-h);
}
```

## Instance Generation Examples

### Simple Sphere

```typescript
// Definition
const sphere: ObjectDefinition = {
name: "glass_sphere",
type: "sphere",
geometry: {
base: "sdf",
parameters: { center: [0, 1, 0], radius: 0.5 }
},
materials: { uniform: MATERIAL_GLASS },
features: { hasAnalyticNormal: true, hasAnalyticUV: true }
};
```

```glsl
// Generated functions
float sphere_glass_sphere_distance(vec3 p) {
    return sphere_distance(p, vec3(0, 1, 0), 0.5);
}

int sphere_glass_sphere_material(vec3 p) {
    // Simple uniform material
    return sphere_glass_sphere_distance(p) < 0.0 ?
    MATERIAL_GLASS : MATERIAL_AIR;
}

vec3 sphere_glass_sphere_normal(vec3 p) {
    return sphere_normal(p, vec3(0, 1, 0));
}

vec2 sphere_glass_sphere_uv(vec3 p) {
    return sphere_uv(p, vec3(0, 1, 0));
}
```

### Multi-Material Object

```typescript
// Definition - sphere with different materials for upper/lower hemisphere
const split_sphere: ObjectDefinition = {
name: "split_sphere",
type: "sphere",
geometry: {
base: "sdf",
parameters: { center: [0, 0, 0], radius: 1 }
},
materials: {
regions: [
{ test: "p.y > 0.0", material: MATERIAL_METAL, priority: 1 },
{ test: "p.y <= 0.0", material: MATERIAL_PLASTIC, priority: 1 }
]
}
};
```

```glsl
// Generated material function with spatial variation
int sphere_split_sphere_material(vec3 p) {
    if (sphere_split_sphere_distance(p) >= 0.0) {
        return MATERIAL_AIR;
    }

    // Region tests
    if (p.y > 0.0) return MATERIAL_METAL;
    if (p.y <= 0.0) return MATERIAL_PLASTIC;

    return MATERIAL_AIR; // Shouldn't reach here
}
```

### CSG Composite

```typescript
// Definition - hollow sphere (sphere minus smaller sphere)
const hollow: ObjectDefinition = {
name: "hollow_ball",
type: "custom",
geometry: {
base: "sdf",
parameters: { outer: 1.0, inner: 0.8 }
},
materials: { uniform: MATERIAL_CERAMIC }
};
```

```glsl
// Generated CSG object
float custom_hollow_ball_distance(vec3 p) {
    float outer = sphere_distance(p, vec3(0), 1.0);
    float inner = sphere_distance(p, vec3(0), 0.8);
    return csg_subtract(outer, inner);
}

int custom_hollow_ball_material(vec3 p) {
    return custom_hollow_ball_distance(p) < 0.0 ?
    MATERIAL_CERAMIC : MATERIAL_AIR;
}

vec3 custom_hollow_ball_normal(vec3 p) {
    // Gradient-based normal for CSG
    const float h = 0.0001;
    return normalize(vec3(
    custom_hollow_ball_distance(vec3(p.x+h,p.y,p.z)) -
    custom_hollow_ball_distance(vec3(p.x-h,p.y,p.z)),
    custom_hollow_ball_distance(vec3(p.x,p.y+h,p.z)) -
    custom_hollow_ball_distance(vec3(p.x,p.y-h,p.z)),
    custom_hollow_ball_distance(vec3(p.x,p.y,p.z+h)) -
    custom_hollow_ball_distance(vec3(p.x,p.y,p.z-h))
    ));
}
```

### Procedural Object

```typescript
// Definition - Gyroid with varying material based on field value
const gyroid: ObjectDefinition = {
name: "gyroid_lattice",
type: "gyroid",
geometry: {
base: "implicit",
parameters: { scale: 10.0, thickness: 0.1 }
},
materials: {
function: "gyroid_material_function"
}
};
```

```glsl
// Base gyroid function
float gyroid_field(vec3 p, float scale) {
    p *= scale;
    return sin(p.x)*cos(p.y) + sin(p.y)*cos(p.z) + sin(p.z)*cos(p.x);
}

// Distance approximation for implicit surface
float gyroid_gyroid_lattice_distance(vec3 p) {
    float f = gyroid_field(p, 10.0);

    // Distance to zero isosurface
    const float h = 0.01;
    vec3 grad = vec3(
    gyroid_field(p + vec3(h,0,0), 10.0) - gyroid_field(p - vec3(h,0,0), 10.0),
    gyroid_field(p + vec3(0,h,0), 10.0) - gyroid_field(p - vec3(0,h,0), 10.0),
    gyroid_field(p + vec3(0,0,h), 10.0) - gyroid_field(p - vec3(0,0,h), 10.0)
    ) / (2.0 * h);

    return abs(f) / (length(grad) + 0.0001) - 0.1; // Thickness
}

// Procedural material assignment
int gyroid_gyroid_lattice_material(vec3 p) {
    if (gyroid_gyroid_lattice_distance(p) >= 0.0) {
        return MATERIAL_AIR;
    }

    // Use field value to determine material
    float f = gyroid_field(p, 10.0);
    return (f > 0.0) ? MATERIAL_METAL : MATERIAL_PLASTIC;
}
```

## Transform Support

```glsl
// Generated transform function
vec3 transform_[name](vec3 p) {
// Inverse transform (world to object space)
p -= [name]_position;
p = inverse_rotate(p, [name]_rotation);
p /= [name]_scale;
return p;
}

// Usage in distance function
float box_transformed_box_distance(vec3 p) {
    p = transform_transformed_box(p);
    return box_distance(p, vec3(0), vec3(0.5));
}
```

## Compilation Process

```typescript
class ObjectCompiler {
    compile(definition: ObjectDefinition): CompiledObject {
    const base = this.getBaseImplementation(definition.type);
    const instance = this.generateInstance(definition, base);

    return {
    distance: instance.distance,
material: instance.material,
normal: instance.normal || this.generateGradientNormal(definition),
    uv: instance.uv || this.generateDefaultUV(definition),
    helpers: instance.helpers
};
}

generateInstance(def: ObjectDefinition, base: BaseShape): Instance {
    const name = `${def.type}_${def.name}`;

// Generate distance function
const distance = `
float ${name}_distance(vec3 p) {
${def.transform ? `p = transform_${def.name}(p);` : ''}
return ${base.distanceCall}(p, ${this.formatParams(def.geometry.parameters)});
}
`;

// Generate material function based on material definition
const material = this.generateMaterialFunction(def, name);

// Generate normal (analytic if available)
const normal = def.features?.hasAnalyticNormal ?
this.generateAnalyticNormal(def, name) :
null; // Scene will use gradient

return { distance, material, normal };
}

generateMaterialFunction(def: ObjectDefinition, name: string): string {
    if (def.materials.uniform !== undefined) {
    // Simple uniform material
    return `
    int ${name}_material(vec3 p) {
return ${name}_distance(p) < 0.0 ?
${def.materials.uniform} : MATERIAL_AIR;
}
`;
} else if (def.materials.regions) {
    // Multi-region material
    return `
int ${name}_material(vec3 p) {
    if (${name}_distance(p) >= 0.0) return MATERIAL_AIR;

${def.materials.regions.map(r =>
`if (${r.test}) return ${r.material};`
).join('\n')}

return MATERIAL_AIR;
}
`;
} else if (def.materials.function) {
    // Custom function
    return `
int ${name}_material(vec3 p) {
    if (${name}_distance(p) >= 0.0) return MATERIAL_AIR;
return ${def.materials.function}(p);
}
`;
}
}
}
```

## Optimization Hints

Objects can provide hints to help Scene optimize:

```typescript
interface OptimizationHints {
    isConvex: boolean;           // Can use simpler intersection
    boundingSphere: number;       // Maximum extent from origin
    isUniformMaterial: boolean;   // No spatial material variation
    hasSharpFeatures: boolean;    // Needs smaller marching steps
    expectedHitRate: number;      // 0-1, helps with ordering
}
```

## Validation Rules

1. **Distance functions** must return valid SDFs or distance estimates
2. **Material functions** must return valid MaterialIDs or MATERIAL_AIR
3. **Normal functions** must return unit vectors pointing outward
4. **UV functions** must return values in [0,1]²
5. **Transform functions** must preserve handedness
6. **MaterialIDs** must exist in scene's material list

## Key Design Principles

1. **Objects are Building Blocks**: Not modules, but components compiled into Scene
2. **Type-Based Naming**: Functions named after object type (sphere_*, box_*)
3. **Material ID Only**: Objects assign IDs, Materials provides properties
4. **No Physics Knowledge**: Objects know geometry and material assignment, nothing else
5. **Instance Generation**: Each object instance gets unique functions
6. **Optimization Ready**: Provide hints for Scene to optimize marching

This design keeps objects focused purely on geometry and material ID assignment, with all actual material properties handled by the Materials module and all physics handled by Photography.
