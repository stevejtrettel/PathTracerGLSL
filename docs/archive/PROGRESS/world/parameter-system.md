# Parameter System

## Overview

The **Parameter System** provides UI-controllable values that can be referenced in both scene and lighting descriptions. Parameters are automatically converted to GLSL uniforms, with runtime bindings that connect UI changes to shader updates.

This system is **shared** by both SceneCompiler and LightsCompiler, using identical patterns and conventions.

---

## Core Concepts

### What is a Parameter?

A **parameter** is a named value that:
1. Can be **controlled by the UI** (sliders, color pickers, etc.)
2. Is **automatically converted to a uniform** in GLSL
3. Can be **referenced in material or light properties**
4. Updates **without recompiling shaders**

### Parameter Reference Syntax

To reference a parameter instead of using a constant:

```typescript
// ❌ Constant value (cannot be changed at runtime)
roughness: 0.8

// ✅ Parameter reference (UI-controllable!)
roughness: { param: 'material.roughness' }
```

The `{ param: '...' }` syntax tells the compiler: "This value comes from a parameter, generate a uniform for it."

---

## Parameter Paths

### Naming Convention

Parameter paths use **dot notation** for hierarchical organization:

```
<category>.<subcategory>.<property>
```

**Examples**:

```typescript
'floor.roughness'           // Simple
'red_light.position'        // Light property
'metal.surface.roughness'   // Nested grouping
```

### Path to Uniform Conversion

Compilers convert parameter paths to uniform names:

```typescript
// SceneCompiler
'floor.roughness'  →  'u_scene_floor_roughness'
'metal.color'      →  'u_scene_metal_color'

// LightsCompiler
'red_light.position'  →  'u_light_red_light_position'
'sun.intensity'       →  'u_light_sun_intensity'
```

**Pattern**:
```
u_<module>_<path_with_underscores>
```

Where:
- `<module>` is `scene` or `light`
- `<path_with_underscores>` replaces dots with underscores

---

## Parameter Metadata

### ParameterMetadata Interface

Every parameter must have metadata that describes its type and UI representation:

```typescript
interface ParameterMetadata {
  // Core properties
  type: 'float' | 'vec3' | 'color' | 'int';
  default: number | vec3;

  // Numeric constraints
  range?: [number, number];  // Min and max values
  step?: number;             // Increment for sliders

  // UI presentation
  name?: string;             // Display name in UI
  group?: string;            // Which UI group to show in
  help?: string;             // Tooltip text

  // Render control
  triggersReset?: boolean;   // Does changing this require render reset?
}
```

### Examples

#### Float Parameter (Slider)

```typescript
'floor.roughness': {
  type: 'float',
  default: 0.8,
  range: [0.0, 1.0],
  step: 0.01,
  name: 'Floor Roughness',
  group: 'Materials',
  help: '0 = mirror, 1 = fully diffuse',
  triggersReset: false
}
```

**UI**: Renders as a slider from 0.0 to 1.0, increments of 0.01.

#### Vec3 Parameter (3D Position)

```typescript
'red_light.position': {
  type: 'vec3',
  default: [-2.5, 1.5, 2.0],
  name: 'Red Light Position',
  group: 'Red Light',
  triggersReset: false
}
```

**UI**: Renders as three number inputs (X, Y, Z).

#### Color Parameter (Color Picker)

```typescript
'metal.color': {
  type: 'color',
  default: [0.9, 0.9, 0.95],
  name: 'Metal Color',
  group: 'Materials',
  help: 'Base color of the metallic surface',
  triggersReset: false
}
```

**UI**: Renders as a color picker widget.

#### Int Parameter (Discrete Values)

```typescript
'fractal.iterations': {
  type: 'int',
  default: 4,
  range: [1, 8],
  step: 1,
  name: 'Fractal Detail',
  group: 'Geometry',
  help: 'Higher = more detail, slower render',
  triggersReset: true  // Changing this requires render reset!
}
```

**UI**: Renders as integer slider or stepper.

---

## Using Parameters

### In Scene Descriptions

```typescript
const scene: SceneDescription = {
  objects: [/* ... */],

  materials: new Map([
    ['floor', {
      albedo: { param: 'floor.color' },         // Parameter!
      roughness: { param: 'floor.roughness' },
      metallic: 0.0,                             // Constant
      ior: 1.5,
      emission: [0, 0, 0],
      emission_strength: 0.0
    }]
  ]),

  parameters: {
    'floor.color': {
      type: 'color',
      default: [0.8, 0.8, 0.8],
      name: 'Floor Color',
      group: 'Materials'
    },
    'floor.roughness': {
      type: 'float',
      default: 0.8,
      range: [0, 1],
      step: 0.01,
      name: 'Floor Roughness',
      group: 'Materials'
    }
  }
};
```

**Result**: UI shows two controls in the "Materials" group:
- Color picker for "Floor Color"
- Slider for "Floor Roughness"

### In Lighting Descriptions

```typescript
const lighting: LightingDescription = {
  lights: [
    {
      type: 'point',
      id: 'red_light',
      position: { param: 'red_light.position' },  // Parameter!
      color: { param: 'red_light.color' },
      intensity: { param: 'red_light.intensity' }
    },
    {
      type: 'point',
      id: 'blue_light',
      position: [2.5, 1.5, 2.0],  // Constant (no UI control)
      color: [0, 0, 1],
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
      default: [1, 0, 0],
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
    }
  }
};
```

**Result**: UI shows "Red Light" group with 3 controls, no controls for blue light.

---

## Compilation Process

### 1. Parameter Discovery

Compilers scan property values for `{ param: '...' }` references:

```typescript
private analyzeParameterUsage(
  /* materials or lights */,
  parameters: Record<string, ParameterMetadata>
): Map<string, 'vec3' | 'float'> {
  const usage = new Map();

  // Find all { param: '...' } references
  for (const item of items) {
    for (const property of properties) {
      if (this.isParam(property)) {
        const type = inferType(property);  // 'vec3' or 'float'
        usage.set(property.param, type);
      }
    }
  }

  return usage;
}
```

### 2. Uniform Generation

For each referenced parameter, generate a uniform:

```typescript
private generateUniforms(paramUsage: Map<string, 'vec3' | 'float'>): string {
  const lines: string[] = [];

  for (const [paramPath, type] of paramUsage) {
    const uniformName = this.paramToUniform(paramPath);
    lines.push(`uniform ${type} ${uniformName};`);
  }

  return lines.join('\n');
}
```

**Example output**:

```glsl
uniform vec3 u_scene_floor_color;
uniform float u_scene_floor_roughness;
uniform vec3 u_light_red_light_position;
uniform vec3 u_light_red_light_color;
uniform float u_light_red_light_intensity;
```

### 3. Uniform Binding Generation

Create runtime bindings that compute uniform values from parameters:

```typescript
private generateUniformBindings(
  paramUsage: Map<string, 'vec3' | 'float'>,
  parameters: Record<string, ParameterMetadata>
): UniformBinding[] {
  const bindings: UniformBinding[] = [];

  for (const [paramPath, type] of paramUsage) {
    const uniformName = this.paramToUniform(paramPath);
    const paramMeta = parameters[paramPath];

    bindings.push({
      uniform: uniformName,           // Which uniform to update
      parameters: [paramPath],        // Which parameter(s) to read
      type: type,                     // 'vec3' or 'float'
      compute: (params) => {          // How to compute the value
        return params[paramPath] || paramMeta.default;
      }
    });
  }

  return bindings;
}
```

### 4. Property Value Generation

In property lookup code, use the uniform:

```typescript
// Generate property assignment
const roughnessValue = this.isParam(material.roughness)
  ? this.paramToUniform(material.roughness.param)  // → 'u_scene_floor_roughness'
  : material.roughness.toFixed(6);                 // → '0.800000'
```

**GLSL output**:

```glsl
// Parameter reference
props.roughness = u_scene_floor_roughness;

// Constant value
props.roughness = 0.800000;
```

---

## Runtime Flow

### Initial Setup

1. **Compile modules**:
   ```typescript
   const sceneModule = sceneCompiler.compile(scene);
   const lightingModule = lightsCompiler.compile(lighting);
   ```

2. **Engine receives modules** with:
   - GLSL code (with uniform declarations)
   - Uniform bindings (with compute functions)
   - Parameter metadata (for UI)

3. **UI builds controls** from parameter metadata

### Parameter Updates

When user adjusts a slider:

1. **UI updates parameter value**:
   ```typescript
   parameterStore.set('floor.roughness', 0.5);
   ```

2. **Engine detects change**, finds affected uniform bindings:
   ```typescript
   const binding = bindings.find(b => b.parameters.includes('floor.roughness'));
   // binding.uniform = 'u_scene_floor_roughness'
   // binding.compute = (params) => params['floor.roughness']
   ```

3. **Compute new uniform value**:
   ```typescript
   const newValue = binding.compute(parameterStore.getAll());
   // newValue = 0.5
   ```

4. **Update uniform in shader**:
   ```typescript
   gl.uniform1f(uniformLocation, newValue);
   ```

5. **Render continues** with new value - **no recompilation!**

### Diagram

```
User adjusts slider
        ↓
ParameterStore updated
        ↓
Engine notified of change
        ↓
UniformBinding.compute() called
        ↓
Uniform updated in GPU
        ↓
Next frame uses new value
```

**Key insight**: Shader code never changes, only uniform values update.

---

## Advanced Patterns

### Computed Parameters

Bindings can compute values from multiple parameters:

```typescript
{
  uniform: 'u_light_sun_radiance',
  parameters: ['sun.color', 'sun.intensity'],
  type: 'vec3',
  compute: (params) => {
    const color = params['sun.color'];
    const intensity = params['sun.intensity'];
    return [
      color[0] * intensity,
      color[1] * intensity,
      color[2] * intensity
    ];
  }
}
```

**Usage in GLSL**:

```glsl
// Single uniform holds the computed result
vec3 radiance = u_light_sun_radiance;  // Already multiplied!
```

### Procedural Material Access

Procedural GLSL code can reference parameters:

```typescript
{
  albedo: {
    glsl: `
      vec3 animatedColor(vec3 p) {
        float speed = u_scene_animation_speed;  // Parameter reference!
        float t = sin(p.x * speed);
        return vec3(t, 1.0 - t, 0.5);
      }
    `
  }
}
```

The parameter `'animation.speed'` becomes uniform `u_scene_animation_speed`, available to all procedural code.

### Parameter Groups

The `group` field organizes UI:

```typescript
parameters: {
  'floor.color': { group: 'Materials', /* ... */ },
  'floor.roughness': { group: 'Materials', /* ... */ },
  'wall.color': { group: 'Materials', /* ... */ },

  'sun.position': { group: 'Lighting', /* ... */ },
  'sun.intensity': { group: 'Lighting', /* ... */ }
}
```

**UI result**:
```
┌─ Materials ──────────┐
│ Floor Color:   [▓▓▓] │
│ Floor Roughness: ─●─ │
│ Wall Color:    [▓▓▓] │
└──────────────────────┘

┌─ Lighting ───────────┐
│ Sun Position: X Y Z  │
│ Sun Intensity:  ─●─  │
└──────────────────────┘
```

### Render Reset Control

`triggersReset` determines if changing a parameter requires clearing the accumulation buffer:

```typescript
'floor.color': {
  triggersReset: false  // Color change → keep accumulating
}

'camera.fov': {
  triggersReset: true   // FOV change → reset accumulation
}
```

**Why?** Some changes (colors) are compatible with progressive rendering. Others (geometry, camera) invalidate accumulated samples.

---

## Type Mapping

### TypeScript to GLSL

| TypeScript Type | GLSL Type | Example |
|-----------------|-----------|---------|
| `type: 'float'` | `uniform float` | `uniform float u_scene_floor_roughness;` |
| `type: 'vec3'` | `uniform vec3` | `uniform vec3 u_scene_floor_color;` |
| `type: 'color'` | `uniform vec3` | `uniform vec3 u_light_sun_color;` |
| `type: 'int'` | `uniform int` | `uniform int u_fractal_iterations;` |

**Note**: `'color'` and `'vec3'` both map to `vec3`, but `'color'` tells the UI to show a color picker instead of numeric inputs.

### Default Values

Defaults must match the type:

```typescript
// ✅ Correct
{ type: 'float', default: 0.8 }
{ type: 'vec3', default: [1, 0, 0] }
{ type: 'color', default: [0.5, 0.5, 0.5] }

// ❌ Wrong
{ type: 'float', default: [0.8] }     // Array for float
{ type: 'vec3', default: 0.8 }        // Scalar for vec3
{ type: 'color', default: '#ff0000' } // String for color
```

---

## Common Patterns

### Material with UI Controls

```typescript
materials: new Map([
  ['interactive_material', {
    albedo: { param: 'mat.albedo' },
    roughness: { param: 'mat.roughness' },
    metallic: { param: 'mat.metallic' },
    ior: 1.5,  // Constant - no UI control
    emission: [0, 0, 0],
    emission_strength: 0.0
  }]
]),

parameters: {
  'mat.albedo': {
    type: 'color',
    default: [0.8, 0.3, 0.3],
    name: 'Material Color',
    group: 'Material'
  },
  'mat.roughness': {
    type: 'float',
    default: 0.5,
    range: [0, 1],
    step: 0.01,
    name: 'Roughness',
    group: 'Material',
    help: '0 = smooth, 1 = rough'
  },
  'mat.metallic': {
    type: 'float',
    default: 0.0,
    range: [0, 1],
    step: 0.01,
    name: 'Metallic',
    group: 'Material',
    help: '0 = dielectric, 1 = metal'
  }
}
```

### Light with UI Controls

```typescript
lights: [
  {
    type: 'point',
    id: 'key_light',
    position: { param: 'key.position' },
    color: { param: 'key.color' },
    intensity: { param: 'key.intensity' }
  }
],

parameters: {
  'key.position': {
    type: 'vec3',
    default: [5, 10, 5],
    name: 'Position',
    group: 'Key Light'
  },
  'key.color': {
    type: 'color',
    default: [1, 1, 1],
    name: 'Color',
    group: 'Key Light'
  },
  'key.intensity': {
    type: 'float',
    default: 100.0,
    range: [0, 500],
    step: 1,
    name: 'Intensity',
    group: 'Key Light'
  }
}
```

### Mixed Constant and Parameter

```typescript
// Some properties constant, some controllable
albedo: { param: 'mat.color' },    // UI-controllable
roughness: 0.8,                     // Constant
metallic: { param: 'mat.metallic' }, // UI-controllable
ior: 1.5                             // Constant
```

**Result**: UI shows controls for `mat.color` and `mat.metallic` only.

---

## Best Practices

### 1. Consistent Naming

Use hierarchical paths that group related parameters:

```typescript
// ✅ Good - clear hierarchy
'floor.material.roughness'
'floor.material.color'
'ceiling.material.roughness'

// ❌ Bad - flat, unclear relationships
'floor_roughness'
'color_floor'
'ceiling_rough'
```

### 2. Meaningful Defaults

Choose defaults that produce good-looking results:

```typescript
// ✅ Good - realistic default
'metal.roughness': {
  default: 0.3  // Slightly rough, natural look
}

// ❌ Bad - extreme default
'metal.roughness': {
  default: 0.0  // Perfect mirror, unrealistic
}
```

### 3. Appropriate Ranges

Set ranges that make sense for the parameter:

```typescript
// ✅ Good - roughness is [0, 1]
'roughness': {
  type: 'float',
  range: [0.0, 1.0]
}

// ❌ Bad - unnecessarily wide range
'roughness': {
  type: 'float',
  range: [-100, 100]
}
```

### 4. Helpful UI Text

Provide clear names and help text:

```typescript
// ✅ Good - descriptive
'mat.roughness': {
  name: 'Surface Roughness',
  help: '0 = smooth/glossy, 1 = rough/matte'
}

// ❌ Bad - unclear
'mat.roughness': {
  name: 'r',
  help: 'roughness value'
}
```

### 5. Logical Grouping

Group related parameters:

```typescript
// ✅ Good - grouped by material
parameters: {
  'floor.color': { group: 'Floor Material' },
  'floor.roughness': { group: 'Floor Material' },

  'wall.color': { group: 'Wall Material' },
  'wall.roughness': { group: 'Wall Material' }
}

// ❌ Bad - mixed grouping
parameters: {
  'floor.color': { group: 'Colors' },
  'floor.roughness': { group: 'Materials' },
  'wall.color': { group: 'Colors' },
  'wall.roughness': { group: 'Walls' }
}
```

---

## Summary

The **Parameter System** enables:

1. **UI-controllable values** in scene and lighting descriptions
2. **Automatic uniform generation** (no manual GLSL declarations)
3. **Runtime updates** (no shader recompilation)
4. **Type safety** (TypeScript → GLSL type mapping)
5. **Flexible binding logic** (simple pass-through or complex computation)
6. **Organized UI** (grouping, labels, help text)

**Key syntax**:
```typescript
// Reference a parameter
propertyValue: { param: 'path.to.parameter' }

// Define the parameter
parameters: {
  'path.to.parameter': {
    type: 'float',
    default: 0.5,
    // ... metadata
  }
}
```

**Result**: Compilers generate uniforms and bindings automatically. The engine handles runtime updates. The UI builds controls from metadata.

This system is the **foundation** for interactive path tracing - change values in real-time without recompiling shaders!
