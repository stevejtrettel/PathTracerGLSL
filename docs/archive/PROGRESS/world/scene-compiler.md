# SceneCompiler

## Overview

**SceneCompiler** transforms high-level scene descriptions into optimized GLSL modules. It handles object SDFs, material properties, ray-marching intersection code, and automatic uniform generation for UI-controllable parameters.

**Key Feature**: Properties can be constants, parameter references, or procedural GLSL code. The compiler automatically generates uniforms only for referenced parameters.

---

## Input Structure

### SceneDescription

```typescript
interface SceneDescription {
  objects: SimpleObject[];
  materials: Map<string, MaterialDescription>;
  parameters?: Record<string, ParameterMetadata>;
}
```

### SimpleObject

```typescript
interface SimpleObject {
  id: string;
  sdf: string;        // Complete GLSL function definition
  material: string;   // Material name (key in materials map)
}
```

**Important**: The `sdf` field must contain a **complete GLSL function**:

```glsl
// ✅ Correct - complete function
float sdf(vec3 p) { return length(p) - 1.0; }

// ❌ Wrong - expression only
length(p) - 1.0
```

### MaterialDescription

```typescript
interface MaterialDescription {
  albedo: MaterialPropertyValue<vec3>;
  roughness: MaterialPropertyValue<number>;
  metallic: MaterialPropertyValue<number>;
  ior: MaterialPropertyValue<number>;
  emission: MaterialPropertyValue<vec3>;
  emission_strength: MaterialPropertyValue<number>;
}
```

### MaterialPropertyValue Pattern

This is the **core abstraction** that enables flexible property specification:

```typescript
type MaterialPropertyValue<T> =
  | T                      // Constant value (inlined as GLSL constant)
  | { param: string }      // Parameter reference (becomes uniform)
  | { glsl: string }       // Procedural GLSL code (becomes helper function)
```

**Examples**:

```typescript
// Constant (inlined)
roughness: 0.8

// Parameter reference (uniform with UI control)
roughness: { param: 'floor.roughness' }

// Procedural (GLSL helper function)
albedo: {
  glsl: `
    vec3 checkerboard(vec3 p) {
      float checker = mod(floor(p.x) + floor(p.z), 2.0);
      return mix(vec3(0.8), vec3(0.3), checker);
    }
  `
}
```

### ParameterMetadata

When using parameter references, you must define the parameter:

```typescript
interface ParameterMetadata {
  type: 'float' | 'vec3' | 'color' | 'int';
  default: number | vec3;
  range?: [number, number];  // For numeric types
  step?: number;
  name?: string;             // Display name in UI
  group?: string;            // UI grouping
  help?: string;             // Tooltip
  triggersReset?: boolean;   // Does changing this require render reset?
}
```

---

## Output Structure

### ModuleDescriptor

```typescript
interface ModuleDescriptor {
  id: { kind: 'scene'; name: string; version: string };
  fragment: {
    constants: string;     // #define directives
    uniforms?: string;     // uniform declarations (only if params used)
    functions: string;     // All GLSL functions
  };
  uniformBindings?: UniformBinding[];
  parameters?: Record<string, ParameterMetadata>;
}
```

### Required GLSL Functions

The compiled module **must** export these functions:

```glsl
// Ray intersection
bool scene_intersect(Ray ray, out Hit hit)
bool scene_intersect_any(Ray ray, float max_distance)

// Material queries
MaterialProperties scene_material_properties(int mat_id, Point p)
int scene_material_at(Point p)

// Utility
vec3 scene_normal(vec3 p)
```

---

## Compilation Process

### 1. Analyze Parameter Usage

The compiler scans all material properties to find parameter references:

```typescript
private analyzeParameterUsage(
  materials: Map<string, MaterialDescription>,
  parameters: Record<string, any>
): Map<string, 'vec3' | 'float'> {
  const usage = new Map();

  // Find explicit parameter references
  for (const [_, mat] of materials) {
    if (this.isParam(mat.albedo)) {
      usage.set(mat.albedo.param, 'vec3');
    }
    if (this.isParam(mat.roughness)) {
      usage.set(mat.roughness.param, 'float');
    }
    // ... check all properties
  }

  // Add ALL scene parameters (for procedural GLSL usage)
  for (const [paramPath, paramMeta] of Object.entries(parameters)) {
    if (!usage.has(paramPath)) {
      const type = paramMeta.type === 'vec3' || paramMeta.type === 'color'
        ? 'vec3' : 'float';
      usage.set(paramPath, type);
    }
  }

  return usage;
}
```

**Why add all parameters?** Procedural GLSL code can reference any parameter via uniforms, so we generate uniforms for everything defined in `parameters`.

### 2. Generate Constants

```glsl
#define NUM_OBJECTS 3
#define NUM_MATERIALS 4
#define MATERIAL_AIR 0
#define MATERIAL_FLOOR 1
#define MATERIAL_SPHERE 2
#define MATERIAL_WALL 3
#define MAX_MARCH_STEPS 256
#define MARCH_EPSILON 0.0001
```

### 3. Generate Uniforms (if needed)

**Only if** there are parameter references:

```typescript
private generateUniforms(paramUsage: Map<string, 'vec3' | 'float'>): string | null {
  if (paramUsage.size === 0) return null;

  const lines: string[] = [];
  for (const [paramPath, type] of paramUsage) {
    const uniformName = this.paramToUniform(paramPath);
    lines.push(`uniform ${type} ${uniformName};`);
  }

  return lines.join('\n');
}

private paramToUniform(paramPath: string): string {
  return 'u_scene_' + paramPath.replace(/\./g, '_');
}
```

**Example output**:

```glsl
// Generated uniforms for parameter references
uniform vec3 u_scene_floor_color;
uniform float u_scene_floor_roughness;
uniform vec3 u_scene_sphere_albedo;
```

### 4. Generate Object SDFs

Each object's SDF function is wrapped and renamed:

```typescript
private generateObjectSDFs(objects: SimpleObject[]): string {
  const functions = objects.map((obj) => {
    const funcName = `sdf_${this.sanitizeId(obj.id)}`;
    const trimmedSdf = obj.sdf.trim();

    // Parse function: float name(params) { body }
    const functionMatch = trimmedSdf.match(
      /^\s*float\s+(\w+)\s*\(([^)]*)\)\s*\{([\s\S]*)\}\s*$/
    );

    if (!functionMatch) {
      throw new Error(`SDF must be a complete function. Got: ${trimmedSdf}`);
    }

    const [, originalName, params, body] = functionMatch;

    return `
// ${obj.id}
float ${funcName}(${params}) {${body}}`;
  });

  return functions.join('\n\n');
}
```

**Example output**:

```glsl
// floor
float sdf_floor(vec3 p) { return p.y + 1.0; }

// sphere
float sdf_sphere(vec3 p) { return length(p - vec3(0.0, 0.5, 0.0)) - 0.8; }
```

### 5. Generate Dispatch Function

Finds the minimum distance to any object and tracks which material it belongs to:

```glsl
float dispatch_sdf(vec3 p, out int closest_material) {
  float min_d = 1e10;
  float d;

  d = sdf_floor(p);
  if (d < min_d) {
    min_d = d;
    closest_material = MATERIAL_FLOOR;
  }

  d = sdf_sphere(p);
  if (d < min_d) {
    min_d = d;
    closest_material = MATERIAL_SPHERE;
  }

  return min_d;
}
```

### 6. Generate Material Classification

Determines which material a point is inside (for refraction):

```glsl
int scene_material_at(vec3 p) {
  int inside_material = MATERIAL_AIR;
  float deepest = 0.0;
  float d;

  d = sdf_floor(p);
  if (d < 0.0 && -d > deepest) {
    deepest = -d;
    inside_material = MATERIAL_FLOOR;
  }

  d = sdf_sphere(p);
  if (d < 0.0 && -d > deepest) {
    deepest = -d;
    inside_material = MATERIAL_SPHERE;
  }

  return inside_material;
}
```

### 7. Generate Material Properties

This is where the **MaterialPropertyValue pattern** is applied:

```typescript
private generateMaterialProperties(
  materials: Map<string, MaterialDescription>,
  materialIds: Map<string, number>,
  paramUsage: Map<string, 'vec3' | 'float'>
): string {
  // First, generate procedural helper functions
  const helperFunctions: string[] = [];

  for (const [name, mat] of materials) {
    const sanitizedName = this.sanitizeId(name);

    if (this.isProcedural(mat.albedo)) {
      helperFunctions.push(this.generateProceduralHelper(
        'vec3',
        `material_${sanitizedName}_albedo`,
        mat.albedo.glsl
      ));
    }
    // ... same for other properties
  }

  // Then, generate property lookup function
  const cases: string[] = [];

  for (const [name, mat] of materials) {
    const constName = `MATERIAL_${this.toConstantName(name)}`;
    const sanitizedName = this.sanitizeId(name);

    // THIS IS THE KEY: Choose constant, uniform, or procedural
    const albedoValue = this.isProcedural(mat.albedo)
      ? `material_${sanitizedName}_albedo(p)`           // Procedural
      : this.isParam(mat.albedo)
      ? this.paramToUniform(mat.albedo.param)           // Uniform
      : `vec3(${mat.albedo.map(v => v.toFixed(6)).join(', ')})`;  // Constant

    const roughnessValue = this.isProcedural(mat.roughness)
      ? `material_${sanitizedName}_roughness(p)`
      : this.isParam(mat.roughness)
      ? this.paramToUniform(mat.roughness.param)
      : mat.roughness.toFixed(6);

    // ... same pattern for all properties

    cases.push(`
  else if (mat_id == ${constName}) {
    props.albedo = ${albedoValue};
    props.roughness = ${roughnessValue};
    props.metallic = ${metallicValue};
    props.ior = ${iorValue};
    props.emission = ${emissionValue};
    props.emission_strength = ${emissionStrengthValue};
    props.light_id = -1;
  }`);
  }

  return helperSection + mainFunction;
}
```

**Example output**:

```glsl
// ========== PROCEDURAL MATERIAL HELPERS ==========

vec3 material_floor_albedo(vec3 p) {
  float checker = mod(floor(p.x * 2.0) + floor(p.z * 2.0), 2.0);
  return mix(vec3(0.8), vec3(0.3), checker);
}

// ========== MATERIAL PROPERTIES ==========

MaterialProperties scene_material_properties(int mat_id, Point p) {
  MaterialProperties props;

  if (mat_id == MATERIAL_AIR) {
    props.albedo = vec3(0.0);
    props.roughness = 0.0;
    props.metallic = 0.0;
    props.ior = 1.0;
    props.emission = vec3(0.0);
    props.emission_strength = 0.0;
    props.light_id = -1;
  }
  else if (mat_id == MATERIAL_FLOOR) {
    props.albedo = material_floor_albedo(p);           // Procedural!
    props.roughness = u_scene_floor_roughness;         // Uniform!
    props.metallic = 0.0;                               // Constant!
    props.ior = 1.5;
    props.emission = vec3(0.0);
    props.emission_strength = 0.0;
    props.light_id = -1;
  }
  // ... more materials

  return props;
}
```

### 8. Generate Intersection Functions

Standard ray-marching boilerplate (same for all scenes):

```glsl
bool scene_intersect(Ray ray, out Hit hit) {
  float t = ray.tmin;
  int material = MATERIAL_AIR;

  for (int step = 0; step < MAX_MARCH_STEPS; step++) {
    vec3 p = ambient_geodesic(ray.origin, ray.direction, t);

    float d = dispatch_sdf(p, material);

    if (d < MARCH_EPSILON) {
      hit.t = t;
      hit.p = p;
      hit.n = scene_normal(p);
      hit.uv = vec2(p.x * 0.1, p.z * 0.1);

      // Material interface
      hit.material_from = MATERIAL_AIR;
      hit.material_to = material;

      hit.frame = ambient_frame(hit.p, hit.n);

      return true;
    }

    if (t > ray.tmax) break;

    t += d * 0.9;
  }

  return false;
}
```

### 9. Generate Uniform Bindings

Creates runtime bindings that connect parameters to uniforms:

```typescript
private generateUniformBindings(
  paramUsage: Map<string, 'vec3' | 'float'>,
  parameters: Record<string, any>
): UniformBinding[] {
  const bindings: UniformBinding[] = [];

  for (const [paramPath, type] of paramUsage) {
    const uniformName = this.paramToUniform(paramPath);
    const paramMeta = parameters[paramPath];
    const defaultValue = paramMeta?.default || (type === 'vec3' ? [1, 1, 1] : 1.0);

    bindings.push({
      uniform: uniformName,
      parameters: [paramPath],
      type: type,
      compute: (params) => params[paramPath] || defaultValue
    });
  }

  return bindings;
}
```

**Result**: The engine can call `compute()` with current parameter values to get the uniform value.

---

## Complete Example

### Input Scene

```typescript
const scene: SceneDescription = {
  objects: [
    {
      id: 'floor',
      sdf: 'float sdf(vec3 p) { return p.y + 1.0; }',
      material: 'checkerboard'
    },
    {
      id: 'sphere',
      sdf: 'float sdf(vec3 p) { return length(p - vec3(0, 0.5, 0)) - 0.8; }',
      material: 'metal'
    }
  ],

  materials: new Map([
    ['checkerboard', {
      albedo: {
        glsl: `
          vec3 checkerboard(vec3 p) {
            float checker = mod(floor(p.x * 2.0) + floor(p.z * 2.0), 2.0);
            return mix(vec3(0.8), vec3(0.3), checker);
          }
        `
      },
      roughness: { param: 'floor.roughness' },
      metallic: 0.0,
      ior: 1.5,
      emission: [0, 0, 0],
      emission_strength: 0.0
    }],
    ['metal', {
      albedo: { param: 'metal.color' },
      roughness: { param: 'metal.roughness' },
      metallic: 0.9,
      ior: 1.5,
      emission: [0, 0, 0],
      emission_strength: 0.0
    }]
  ]),

  parameters: {
    'floor.roughness': {
      type: 'float',
      default: 0.8,
      range: [0, 1],
      name: 'Floor Roughness'
    },
    'metal.color': {
      type: 'color',
      default: [0.9, 0.9, 0.95],
      name: 'Metal Color'
    },
    'metal.roughness': {
      type: 'float',
      default: 0.1,
      range: [0, 1],
      name: 'Metal Roughness'
    }
  }
};
```

### Compilation

```typescript
const compiler = new SceneCompiler();
const module = compiler.compile(scene);
```

### Generated GLSL (fragment.functions)

```glsl
// ========== OBJECT SDFs ==========

// floor
float sdf_floor(vec3 p) { return p.y + 1.0; }

// sphere
float sdf_sphere(vec3 p) { return length(p - vec3(0.0, 0.5, 0.0)) - 0.8; }

// ========== DISPATCH ==========

float dispatch_sdf(vec3 p, out int closest_material) {
  float min_d = 1e10;
  float d;

  d = sdf_floor(p);
  if (d < min_d) {
    min_d = d;
    closest_material = MATERIAL_CHECKERBOARD;
  }

  d = sdf_sphere(p);
  if (d < min_d) {
    min_d = d;
    closest_material = MATERIAL_METAL;
  }

  return min_d;
}

// ========== MATERIAL CLASSIFICATION ==========

int scene_material_at(vec3 p) {
  int inside_material = MATERIAL_AIR;
  float deepest = 0.0;
  float d;

  d = sdf_floor(p);
  if (d < 0.0 && -d > deepest) {
    deepest = -d;
    inside_material = MATERIAL_CHECKERBOARD;
  }

  d = sdf_sphere(p);
  if (d < 0.0 && -d > deepest) {
    deepest = -d;
    inside_material = MATERIAL_METAL;
  }

  return inside_material;
}

// ========== PROCEDURAL MATERIAL HELPERS ==========

vec3 material_checkerboard_albedo(vec3 p) {
  float checker = mod(floor(p.x * 2.0) + floor(p.z * 2.0), 2.0);
  return mix(vec3(0.8), vec3(0.3), checker);
}

// ========== MATERIAL PROPERTIES ==========

MaterialProperties scene_material_properties(int mat_id, Point p) {
  MaterialProperties props;

  props.albedo = vec3(1.0, 0.0, 1.0);  // Magenta = error
  props.roughness = 0.8;
  props.metallic = 0.0;
  props.ior = 1.5;
  props.emission = vec3(0.0);
  props.emission_strength = 0.0;
  props.light_id = -1;

  if (mat_id == MATERIAL_AIR) {
    props.albedo = vec3(0.0);
    props.roughness = 0.0;
    props.metallic = 0.0;
    props.ior = 1.0;
    props.emission = vec3(0.0);
    props.emission_strength = 0.0;
    props.light_id = -1;
  }
  else if (mat_id == MATERIAL_CHECKERBOARD) {
    props.albedo = material_checkerboard_albedo(p);  // Procedural
    props.roughness = u_scene_floor_roughness;        // Uniform
    props.metallic = 0.0;                              // Constant
    props.ior = 1.5;
    props.emission = vec3(0.0);
    props.emission_strength = 0.0;
    props.light_id = -1;
  }
  else if (mat_id == MATERIAL_METAL) {
    props.albedo = u_scene_metal_color;               // Uniform
    props.roughness = u_scene_metal_roughness;        // Uniform
    props.metallic = 0.9;                              // Constant
    props.ior = 1.5;
    props.emission = vec3(0.0);
    props.emission_strength = 0.0;
    props.light_id = -1;
  }

  return props;
}

// ========== INTERSECTION ==========

vec3 scene_normal(vec3 p) {
  int dummy_mat;
  const vec2 e = vec2(0.001, 0.0);

  vec3 n = vec3(
    dispatch_sdf(p + e.xyy, dummy_mat) - dispatch_sdf(p - e.xyy, dummy_mat),
    dispatch_sdf(p + e.yxy, dummy_mat) - dispatch_sdf(p - e.yxy, dummy_mat),
    dispatch_sdf(p + e.yyx, dummy_mat) - dispatch_sdf(p - e.yyx, dummy_mat)
  );

  return normalize(n);
}

bool scene_intersect(Ray ray, out Hit hit) {
  // ... (standard ray marching code)
}

bool scene_intersect_any(Ray ray, float max_distance) {
  // ... (standard shadow ray code)
}
```

### Generated Constants

```glsl
#define NUM_OBJECTS 2
#define NUM_MATERIALS 3
#define MATERIAL_AIR 0
#define MATERIAL_CHECKERBOARD 1
#define MATERIAL_METAL 2
#define MAX_MARCH_STEPS 256
#define MARCH_EPSILON 0.0001
```

### Generated Uniforms

```glsl
uniform float u_scene_floor_roughness;
uniform vec3 u_scene_metal_color;
uniform float u_scene_metal_roughness;
```

### Generated Uniform Bindings

```typescript
[
  {
    uniform: 'u_scene_floor_roughness',
    parameters: ['floor.roughness'],
    type: 'float',
    compute: (params) => params['floor.roughness'] || 0.8
  },
  {
    uniform: 'u_scene_metal_color',
    parameters: ['metal.color'],
    type: 'vec3',
    compute: (params) => params['metal.color'] || [0.9, 0.9, 0.95]
  },
  {
    uniform: 'u_scene_metal_roughness',
    parameters: ['metal.roughness'],
    type: 'float',
    compute: (params) => params['metal.roughness'] || 0.1
  }
]
```

---

## Key Design Decisions

### 1. User Provides SDF Functions

Unlike materials (which use the property value pattern), object SDFs are **raw GLSL strings** provided by the user. The compiler just wraps and renames them.

**Why?** Maximum flexibility. Users can write any SDF they want (fractals, CSG operations, domain repetitions, etc.) without being limited to predefined primitives.

### 2. Material Properties Are Flexible

The `MaterialPropertyValue<T>` pattern gives users three choices for EVERY property:
- **Constant**: Fast, inlined
- **Parameter**: UI-controllable at runtime
- **Procedural**: GLSL code for complex patterns

This flexibility is CRITICAL for creative control.

### 3. Automatic Uniform Generation

No manual uniform declarations! The compiler:
1. Scans for `{ param: '...' }` references
2. Generates uniforms automatically
3. Creates bindings automatically

**Result**: Users just write `{ param: 'floor.color' }` and everything else happens automatically.

### 4. All Parameters Available to Procedural Code

Even parameters not explicitly referenced are turned into uniforms. Why?

Procedural GLSL code can reference ANY parameter:

```glsl
vec3 animatedColor(vec3 p) {
  // Reference a parameter we defined
  float freq = u_scene_animation_speed;
  return vec3(sin(p.x * freq), cos(p.y * freq), 0.0);
}
```

The compiler doesn't parse GLSL code to find references, so it makes ALL defined parameters available.

### 5. Procedural Functions Must Be Complete

To avoid GLSL parsing complexity, procedural code must be **complete functions**:

```glsl
// ✅ Correct
vec3 myColor(vec3 p) {
  return vec3(1.0, 0.0, 0.0);
}

// ❌ Wrong - expression only
vec3(1.0, 0.0, 0.0)
```

The compiler extracts the signature and body, then renames the function.

---

## Summary

**SceneCompiler** is a sophisticated code generator that:

1. **Wraps user SDF functions** into a dispatch system
2. **Generates material property lookups** with three modes (constant/uniform/procedural)
3. **Automatically creates uniforms** for parameter references
4. **Generates uniform bindings** for runtime parameter updates
5. **Produces ray-marching code** for intersection testing
6. **Handles material classification** for refraction

The result is a complete GLSL module that integrates seamlessly with the path tracer, with full UI control over any property marked as `{ param: '...' }`.
