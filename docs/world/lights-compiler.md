# LightsCompiler

## Overview

**LightsCompiler** transforms high-level lighting descriptions into optimized GLSL modules. It handles light sampling, PDF calculations, and automatic uniform generation for UI-controllable parameters.

**Key Feature**: Light properties can be constants or parameter references. The compiler automatically generates uniforms only for referenced parameters. All light sampling code works **identically** regardless of whether values are constants or uniforms.

---

## Input Structure

### LightingDescription

```typescript
interface LightingDescription {
  lights: Light[];
  environment?: EnvironmentDescription;
  parameters?: Record<string, ParameterMetadata>;
}
```

### Light Types

All light types follow the same pattern - each property can be a constant or parameter reference:

```typescript
type LightPropertyValue<T> =
  | T                      // Constant value (inlined in GLSL)
  | { param: string };     // Parameter reference (becomes uniform)
```

#### Point Light

```typescript
interface PointLight {
  type: 'point';
  id: string;
  position: LightPropertyValue<vec3>;
  color: LightPropertyValue<vec3>;
  intensity: LightPropertyValue<number>;
}
```

#### Sphere Light

```typescript
interface SphereLight {
  type: 'sphere';
  id: string;
  center: LightPropertyValue<vec3>;
  radius: LightPropertyValue<number>;
  color: LightPropertyValue<vec3>;
  intensity: LightPropertyValue<number>;
}
```

#### Quad Light

```typescript
interface QuadLight {
  type: 'quad';
  id: string;
  corner: LightPropertyValue<vec3>;
  edge1: LightPropertyValue<vec3>;
  edge2: LightPropertyValue<vec3>;
  color: LightPropertyValue<vec3>;
  intensity: LightPropertyValue<number>;
}
```

### ParameterMetadata

Same structure as SceneCompiler:

```typescript
interface ParameterMetadata {
  type: 'float' | 'vec3' | 'color' | 'int';
  default: number | vec3;
  range?: [number, number];
  step?: number;
  name?: string;
  group?: string;
  help?: string;
  triggersReset?: boolean;
}
```

---

## Output Structure

### ModuleDescriptor

```typescript
interface ModuleDescriptor {
  id: { kind: 'lighting'; name: string; version: string };
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

```glsl
// Sampling interface
LightSample lighting_sample(Point p, vec2 xi)
float lighting_pdf(Point p, Direction wi)

// Light data access
LightData lighting_get_light(int light_id)

// Count
int lighting_count()
```

### LightData Structure

All lights are represented in a unified format:

```glsl
struct LightData {
  vec3 radiance;    // color * intensity
  vec4 param0;      // Light-specific parameters
  vec4 param1;
  vec4 param2;
}
```

**Parameter packing** (type-specific):

```
Point Light:
  param0.xyz = position

Sphere Light:
  param0.xyz = center
  param0.w   = radius

Quad Light:
  param0.xyz = corner
  param1.xyz = edge1
  param2.xyz = edge2
```

---

## Compilation Process

### 1. Analyze Parameter Usage

Scan all lights to find parameter references:

```typescript
private analyzeParameterUsage(
  lights: Light[],
  parameters: Record<string, ParameterMetadata>
): Map<string, 'vec3' | 'float'> {
  const usage = new Map();

  for (const light of lights) {
    // Check all properties of each light type
    if (this.isParam(light.position)) {
      usage.set(light.position.param, 'vec3');
    }
    if (this.isParam(light.color)) {
      usage.set(light.color.param, 'vec3');
    }
    if (this.isParam(light.intensity)) {
      usage.set(light.intensity.param, 'float');
    }
    // ... check all type-specific properties
  }

  return usage;
}

private isParam<T>(value: LightPropertyValue<T>): value is { param: string } {
  return typeof value === 'object' && value !== null && 'param' in value;
}
```

### 2. Generate Constants

```typescript
private generateConstants(numLights: number): string {
  return `
#define NUM_LIGHTS ${numLights}
#define LIGHT_SAMPLE_COUNT 1
`.trim();
}
```

**Output**:

```glsl
#define NUM_LIGHTS 3
#define LIGHT_SAMPLE_COUNT 1
```

### 3. Generate Uniforms

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
  return 'u_light_' + paramPath.replace(/\./g, '_');
}
```

**Example output**:

```glsl
uniform vec3 u_light_red_light_position;
uniform vec3 u_light_red_light_color;
uniform float u_light_red_light_intensity;
uniform vec3 u_light_green_light_position;
uniform vec3 u_light_green_light_color;
uniform float u_light_green_light_intensity;
```

### 4. Generate lighting_get_light()

This is the **key abstraction** that makes everything work identically.

**Two strategies** based on whether parameters are used:

#### Strategy A: Constants Mode (No Parameters)

All light data is in a const array:

```glsl
const LightData u_lights[3] = LightData[](
  LightData(
    vec3(1.000000, 0.000000, 0.000000) * 10.000000,  // radiance = color * intensity
    vec4(-2.500000, 1.500000, 2.000000, 0.0),         // param0 = position
    vec4(0.0), vec4(0.0)
  ),
  LightData(
    vec3(0.000000, 1.000000, 0.000000) * 10.000000,
    vec4(0.000000, 1.500000, 0.000000, 0.0),
    vec4(0.0), vec4(0.0)
  ),
  LightData(
    vec3(0.000000, 0.000000, 1.000000) * 10.000000,
    vec4(2.500000, 1.500000, 2.000000, 0.0),
    vec4(0.0), vec4(0.0)
  )
);

LightData lighting_get_light(int light_id) {
  if (light_id < 0 || light_id >= NUM_LIGHTS) {
    return LightData(vec3(0.0), vec4(0.0), vec4(0.0), vec4(0.0));
  }
  return u_lights[light_id];
}
```

#### Strategy B: Uniforms Mode (Has Parameters)

Each light is constructed from individual uniforms:

```glsl
LightData lighting_get_light(int light_id) {
  // Light 0: red_light
  if (light_id == 0) {
    vec3 color = u_light_red_light_color;
    float intensity = u_light_red_light_intensity;
    vec3 radiance = color * intensity;

    return LightData(
      radiance,
      vec4(u_light_red_light_position, 0.0),  // param0 = position
      vec4(0.0),
      vec4(0.0)
    );
  }

  // Light 1: green_light
  if (light_id == 1) {
    vec3 color = u_light_green_light_color;
    float intensity = u_light_green_light_intensity;
    vec3 radiance = color * intensity;

    return LightData(
      radiance,
      vec4(u_light_green_light_position, 0.0),
      vec4(0.0),
      vec4(0.0)
    );
  }

  // ... more lights

  // Fallback
  return LightData(vec3(0.0), vec4(0.0), vec4(0.0), vec4(0.0));
}
```

**Critical point**: The SIGNATURE is identical! Samplers don't know or care which mode is used.

### 5. Generate Samplers

Each light gets a sampler function. Samplers **always** call `lighting_get_light()`:

```typescript
// In samplers/point-light.ts
export function generatePointLightSampler(light: PointLight, options: SamplerOptions): string {
  const { index } = options;

  return `
LightSample sample_light_${index}(Point p, vec2 xi) {
  LightSample ls;

  // ALWAYS use lighting_get_light() - mode-agnostic!
  vec3 light_pos = lighting_get_light(${index}).param0.xyz;
  vec3 radiance = lighting_get_light(${index}).radiance;

  vec3 to_light = light_pos - p;
  float distance_sq = dot(to_light, to_light);
  float distance = sqrt(distance_sq);

  ls.wi = to_light / distance;
  ls.distance = distance;
  ls.radiance = radiance / distance_sq;
  ls.pdf = 1.0;  // Delta distribution
  ls.light_id = ${index};

  return ls;
}`;
}
```

**Key principle**: Samplers have **ZERO conditional logic** based on mode. They always call `lighting_get_light()` and work with the returned data.

### 6. Generate Main Sampling Function

Dispatches to individual samplers:

```glsl
LightSample lighting_sample(Point p, vec2 xi) {
  // For single light, direct dispatch
  if (NUM_LIGHTS == 1) {
    return sample_light_0(p, xi);
  }

  // For multiple lights, select one uniformly
  int light_index = int(floor(xi.x * float(NUM_LIGHTS)));
  light_index = clamp(light_index, 0, NUM_LIGHTS - 1);

  // Dispatch to appropriate sampler
  LightSample ls;

  if (light_index == 0) {
    ls = sample_light_0(p, xi);
  }
  else if (light_index == 1) {
    ls = sample_light_1(p, xi);
  }
  else if (light_index == 2) {
    ls = sample_light_2(p, xi);
  }

  // Adjust PDF for light selection
  ls.pdf *= float(NUM_LIGHTS);

  return ls;
}
```

### 7. Generate PDF Function

```glsl
float lighting_pdf(Point p, Direction wi) {
  // Point lights are delta distributions - can't be hit randomly
  return 0.0;
}
```

(More complex for area lights - integrates over surface)

### 8. Generate lighting_count()

```glsl
int lighting_count() {
  return NUM_LIGHTS;
}
```

### 9. Generate Uniform Bindings

```typescript
private generateUniformBindings(
  paramUsage: Map<string, 'vec3' | 'float'>,
  parameters: Record<string, ParameterMetadata>
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

---

## Complete Example

### Input Description

```typescript
const lighting: LightingDescription = {
  lights: [
    {
      type: 'point',
      id: 'red_light',
      position: { param: 'red_light.position' },   // Parameter!
      color: { param: 'red_light.color' },
      intensity: { param: 'red_light.intensity' }
    },
    {
      type: 'point',
      id: 'green_light',
      position: { param: 'green_light.position' },
      color: { param: 'green_light.color' },
      intensity: { param: 'green_light.intensity' }
    },
    {
      type: 'point',
      id: 'blue_light',
      position: [2.5, 1.5, 2.0],     // Constant!
      color: [0.0, 0.0, 1.0],
      intensity: 10.0
    }
  ],

  parameters: {
    'red_light.position': {
      type: 'vec3',
      default: [-2.5, 1.5, 2.0],
      name: 'Red Light Position',
      group: 'Red Light'
    },
    'red_light.color': {
      type: 'color',
      default: [1.0, 0.0, 0.0],
      name: 'Red Light Color',
      group: 'Red Light'
    },
    'red_light.intensity': {
      type: 'float',
      default: 15.0,
      range: [0, 50],
      step: 0.5,
      name: 'Red Light Intensity',
      group: 'Red Light'
    },
    // ... similar for green_light
  }
};
```

### Compilation

```typescript
const compiler = new LightsCompiler();
const module = compiler.compile(lighting);
```

### Generated GLSL

#### Constants

```glsl
#define NUM_LIGHTS 3
#define LIGHT_SAMPLE_COUNT 1
```

#### Uniforms

```glsl
uniform vec3 u_light_red_light_position;
uniform vec3 u_light_red_light_color;
uniform float u_light_red_light_intensity;
uniform vec3 u_light_green_light_position;
uniform vec3 u_light_green_light_color;
uniform float u_light_green_light_intensity;
```

Note: **No uniforms for blue_light** - it uses constants!

#### lighting_get_light()

```glsl
LightData lighting_get_light(int light_id) {
  // Light 0: red_light (uses uniforms)
  if (light_id == 0) {
    vec3 color = u_light_red_light_color;
    float intensity = u_light_red_light_intensity;
    vec3 radiance = color * intensity;

    return LightData(
      radiance,
      vec4(u_light_red_light_position, 0.0),
      vec4(0.0),
      vec4(0.0)
    );
  }

  // Light 1: green_light (uses uniforms)
  if (light_id == 1) {
    vec3 color = u_light_green_light_color;
    float intensity = u_light_green_light_intensity;
    vec3 radiance = color * intensity;

    return LightData(
      radiance,
      vec4(u_light_green_light_position, 0.0),
      vec4(0.0),
      vec4(0.0)
    );
  }

  // Light 2: blue_light (uses constants - no uniforms!)
  if (light_id == 2) {
    vec3 color = vec3(0.000000, 0.000000, 1.000000);
    float intensity = 10.000000;
    vec3 radiance = color * intensity;

    return LightData(
      radiance,
      vec4(2.500000, 1.500000, 2.000000, 0.0),
      vec4(0.0),
      vec4(0.0)
    );
  }

  // Fallback
  return LightData(vec3(0.0), vec4(0.0), vec4(0.0), vec4(0.0));
}
```

**Notice**: Lights 0 and 1 construct from uniforms, light 2 uses inline constants. **Same function, mixed modes!**

#### Samplers

```glsl
// Point light sampler 0 (red)
LightSample sample_light_0(Point p, vec2 xi) {
  LightSample ls;

  vec3 light_pos = lighting_get_light(0).param0.xyz;
  vec3 radiance = lighting_get_light(0).radiance;

  vec3 to_light = light_pos - p;
  float distance_sq = dot(to_light, to_light);
  float distance = sqrt(distance_sq);

  ls.wi = to_light / distance;
  ls.distance = distance;
  ls.radiance = radiance / distance_sq;
  ls.pdf = 1.0;
  ls.light_id = 0;

  return ls;
}

// Point light sampler 1 (green) - IDENTICAL code!
LightSample sample_light_1(Point p, vec2 xi) {
  LightSample ls;

  vec3 light_pos = lighting_get_light(1).param0.xyz;
  vec3 radiance = lighting_get_light(1).radiance;

  vec3 to_light = light_pos - p;
  float distance_sq = dot(to_light, to_light);
  float distance = sqrt(distance_sq);

  ls.wi = to_light / distance;
  ls.distance = distance;
  ls.radiance = radiance / distance_sq;
  ls.pdf = 1.0;
  ls.light_id = 1;

  return ls;
}

// Point light sampler 2 (blue) - IDENTICAL code!
LightSample sample_light_2(Point p, vec2 xi) {
  LightSample ls;

  vec3 light_pos = lighting_get_light(2).param0.xyz;
  vec3 radiance = lighting_get_light(2).radiance;

  vec3 to_light = light_pos - p;
  float distance_sq = dot(to_light, to_light);
  float distance = sqrt(distance_sq);

  ls.wi = to_light / distance;
  ls.distance = distance;
  ls.radiance = radiance / distance_sq;
  ls.pdf = 1.0;
  ls.light_id = 2;

  return ls;
}
```

**Key observation**: ALL samplers are IDENTICAL except for the index passed to `lighting_get_light()`. No conditional logic!

#### Main Sampling

```glsl
LightSample lighting_sample(Point p, vec2 xi) {
  // Select light uniformly
  int light_index = int(floor(xi.x * float(NUM_LIGHTS)));
  light_index = clamp(light_index, 0, NUM_LIGHTS - 1);

  LightSample ls;

  if (light_index == 0) {
    ls = sample_light_0(p, xi);
  }
  else if (light_index == 1) {
    ls = sample_light_1(p, xi);
  }
  else if (light_index == 2) {
    ls = sample_light_2(p, xi);
  }

  // Adjust PDF for selection probability
  ls.pdf *= float(NUM_LIGHTS);

  return ls;
}

float lighting_pdf(Point p, Direction wi) {
  return 0.0;  // Point lights are delta distributions
}

int lighting_count() {
  return NUM_LIGHTS;
}
```

---

## Sampler Architecture

### Sampler Files

Each light type has a dedicated sampler generator:

```
src/world/lighting/samplers/
  point-light.ts       // Point light sampling
  sphere-light.ts      // Sphere light sampling
  quad-light.ts        // Quad light sampling
```

### Sampler Pattern

All samplers follow this template:

```typescript
export interface SamplerOptions {
  index: number;  // Light index in the array
}

export function generateXxxLightSampler(
  light: XxxLight,
  options: SamplerOptions
): string {
  const { index } = options;

  return `
LightSample sample_light_${index}(Point p, vec2 xi) {
  LightSample ls;

  // 1. Get light data (ALWAYS via lighting_get_light)
  vec3 param = lighting_get_light(${index}).paramX.xyz;
  vec3 radiance = lighting_get_light(${index}).radiance;

  // 2. Compute sampling (type-specific logic)
  // ...

  // 3. Return sample
  ls.light_id = ${index};
  return ls;
}`;
}
```

**Critical rules**:
1. **ALWAYS** use `lighting_get_light(index)` for data access
2. **NEVER** have conditional logic based on uniform vs constant mode
3. **ALWAYS** set `ls.light_id = ${index}`
4. Sampling math is type-specific (point vs sphere vs quad)

### Example: Sphere Light Sampler

```typescript
export function generateSphereLightSampler(
  light: SphereLight,
  options: SamplerOptions
): string {
  const { index } = options;

  return `
LightSample sample_light_${index}(Point p, vec2 xi) {
  LightSample ls;

  // Get data from lighting_get_light()
  vec3 center = lighting_get_light(${index}).param0.xyz;
  float radius = lighting_get_light(${index}).param0.w;
  vec3 radiance = lighting_get_light(${index}).radiance;

  // Direction to sphere center
  vec3 to_center = center - p;
  float dist_to_center_sq = dot(to_center, to_center);
  float dist_to_center = sqrt(dist_to_center_sq);

  // Compute subtended solid angle
  float sin_theta_max_sq = (radius * radius) / dist_to_center_sq;
  float cos_theta_max = sqrt(max(0.0, 1.0 - sin_theta_max_sq));

  // Sample cone toward sphere
  float cos_theta = 1.0 - xi.x + xi.x * cos_theta_max;
  float sin_theta = sqrt(max(0.0, 1.0 - cos_theta * cos_theta));
  float phi = 2.0 * PI * xi.y;

  // Build local coordinate system
  vec3 w = to_center / dist_to_center;
  vec3 u = normalize(cross(abs(w.y) < 0.999 ? vec3(0, 1, 0) : vec3(1, 0, 0), w));
  vec3 v = cross(w, u);

  // Sample direction
  vec3 dir = normalize(
    sin_theta * cos(phi) * u +
    sin_theta * sin(phi) * v +
    cos_theta * w
  );

  // Intersect ray with sphere
  // ... (ray-sphere intersection math)

  ls.wi = dir;
  ls.distance = t;
  ls.radiance = radiance;
  ls.pdf = 1.0 / (2.0 * PI * (1.0 - cos_theta_max));
  ls.light_id = ${index};

  return ls;
}`;
}
```

**Note**: Complex sampling math, but still just calls `lighting_get_light()` - mode-agnostic!

---

## Key Design Decisions

### 1. Unified lighting_get_light() Abstraction

This single function **completely decouples** samplers from the constants vs uniforms distinction:

- **Samplers don't know** how data is stored
- **Samplers don't care** if values are constants or uniforms
- **Samplers always work** the same way

This is the **critical insight** that made the refactoring successful.

### 2. No Mode Flags

Unlike the old approach (which had `uniformMode: 'constants' | 'uniforms'`), the new system:

- **Detects automatically** based on `{ param: '...' }` usage
- **Generates only needed uniforms**
- **Mixed modes in same scene** (some lights with params, some without)

No user decision required!

### 3. Matching SceneCompiler Pattern

LightsCompiler now uses the **exact same pattern** as SceneCompiler:

| Feature | SceneCompiler | LightsCompiler |
|---------|---------------|----------------|
| Property values | `MaterialPropertyValue<T>` | `LightPropertyValue<T>` |
| Type guard | `isParam(value)` | `isParam(value)` |
| Uniform naming | `paramToUniform(path)` | `paramToUniform(path)` |
| Parameter analysis | `analyzeParameterUsage()` | `analyzeParameterUsage()` |
| Uniform generation | `generateUniforms()` | `generateUniforms()` |
| Binding generation | `generateUniformBindings()` | `generateUniformBindings()` |

**Consistency** across the codebase!

### 4. Sampler Purity

Samplers are **pure GLSL generators** with zero conditional logic:

```typescript
// ✅ Pure - no conditionals
export function generatePointLightSampler(light, options) {
  return `sample_light_${options.index}(...)`;
}

// ❌ Impure - has conditionals (OLD approach)
export function generatePointLightSampler(light, options) {
  if (options.useUniformAccessor) {
    return `vec3 pos = lighting_get_light(${index}).param0.xyz;`;
  } else {
    return `vec3 pos = u_lights[${index}].param0.xyz;`;
  }
}
```

The new approach is simpler and more maintainable.

### 5. Type-Specific Sampling Logic

Each light type has **different sampling math**:

- **Point**: Delta distribution (PDF = 1.0)
- **Sphere**: Solid angle sampling (PDF depends on subtended cone)
- **Quad**: Area sampling with cosine weighting

This type-specific logic lives in **sampler files**, keeping LightsCompiler clean.

---

## Performance Implications

### Constant Mode (No Parameters)

When no parameters are used:

```glsl
const LightData u_lights[3] = LightData[](/* ... */);

LightData lighting_get_light(int light_id) {
  return u_lights[light_id];  // Simple array access!
}
```

**Performance**: Optimal! Direct array access, all values inlined.

### Uniform Mode (With Parameters)

When parameters are used:

```glsl
LightData lighting_get_light(int light_id) {
  if (light_id == 0) {
    return LightData(
      u_light_red_light_color * u_light_red_light_intensity,
      vec4(u_light_red_light_position, 0.0),
      vec4(0.0), vec4(0.0)
    );
  }
  // ... more branches
}
```

**Performance**: Slightly slower (branches + uniform access), but necessary for UI control.

**Trade-off**: Static scenes use constants (fast). Interactive scenes use uniforms (flexible).

### Mixed Mode

```glsl
LightData lighting_get_light(int light_id) {
  if (light_id == 0) {
    // Uniforms for red light
    return LightData(u_light_red_light_color * u_light_red_light_intensity, ...);
  }
  if (light_id == 1) {
    // Constants for blue light
    return LightData(vec3(0, 0, 1) * 10.0, vec4(2.5, 1.5, 2.0, 0), ...);
  }
}
```

**Best of both worlds**: UI control for lights that need it, constants for static lights.

---

## Summary

**LightsCompiler** is a sophisticated code generator that:

1. **Analyzes parameter references** to determine which uniforms are needed
2. **Generates lighting_get_light()** with constants or uniforms (or mixed)
3. **Generates type-specific samplers** that all call `lighting_get_light()`
4. **Generates uniform bindings** for runtime parameter updates
5. **Maintains identical sampler behavior** regardless of constants vs uniforms

The result is:
- **Flexible**: Mix constants and parameters in the same scene
- **Automatic**: No manual uniform declarations
- **Consistent**: Matches SceneCompiler pattern exactly
- **Simple**: Samplers have zero mode-awareness
- **Performant**: Uses constants when possible, uniforms when needed

This architecture makes UI-controllable lighting trivial - just mark properties as `{ param: '...' }` and everything else is automatic.
