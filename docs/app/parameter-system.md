# Parameter System

Complete guide to the parameter system: how parameters flow from application state to GPU uniforms.

## Overview

The parameter system connects user-facing values to shader uniforms through a multi-stage pipeline:

```
ParameterStore → UniformBinding → Compute Function → WebGL Uniform
```

This enables:
- Live parameter updates without recompilation
- Unit conversions (degrees → radians)
- Complex derivations (color + intensity → radiance)
- Type validation
- UI generation

---

## Parameter Paths

Parameters use hierarchical dot-notation:

```
<group>.<property>.<subproperty>
```

**Examples**:
```typescript
'camera.position'           // vec3
'camera.target'             // vec3
'camera.fov'                // float
'light.color'               // vec3
'light.intensity'           // float
'developer.exposureEV'      // float
'developer.whiteBalance'    // vec3
```

**Conventions**:
- Lowercase with dots
- No spaces or special characters
- Group by module kind (`camera`, `light`, `developer`, etc.)

---

## Parameter Metadata

Modules define metadata for each parameter:

```typescript
parameters: {
    'camera.fov': {
        type: 'float',                  // Parameter type
        default: 60,                    // Default value
        range: [10, 120],               // Valid range (optional)
        step: 1,                        // UI increment (optional)
        name: 'Field of View',          // Display name
        unit: '°',                      // Unit label
        group: 'Camera',                // UI grouping
        help: 'Vertical field of view', // Tooltip
        triggersReset: true             // Clear accumulation when changed
    }
}
```

### Metadata Fields

**Required**:
- `type` - Parameter type
- `default` - Default value

**Optional**:
- `range` - `[min, max]` for numeric types
- `step` - Increment for UI controls
- `values` - Array of valid values (for enums)
- `name` - Human-readable label
- `unit` - Unit label ('°', 'px', 'm', etc.)
- `group` - UI grouping
- `help` - Tooltip/help text
- `triggersReset` - Whether to clear accumulation

### Parameter Types

```typescript
type ParameterType =
    | 'float'   // Single number
    | 'int'     // Integer
    | 'bool'    // Boolean
    | 'vec2'    // [x, y]
    | 'vec3'    // [x, y, z]
    | 'vec4'    // [x, y, z, w]
    | 'color';  // [r, g, b] (0-1 range)
```

---

## Uniform Bindings

Uniform bindings connect parameters to shader uniforms.

### Basic Binding

```typescript
uniformBindings: [{
    uniform: 'u_camera_fov',        // GLSL uniform name
    parameters: ['camera.fov'],     // Parameter path(s) this depends on
    type: 'float',                  // Uniform type
    compute: (params) => {
        // Transform degrees → radians
        return params['camera.fov'] * (Math.PI / 180);
    }
}]
```

**GLSL Declaration**:
```glsl
uniform float u_camera_fov;  // Radians
```

### Multi-Parameter Binding

Compute values from multiple parameters:

```typescript
uniformBindings: [{
    uniform: 'u_light_radiance',
    parameters: ['light.color', 'light.intensity'],
    type: 'vec3',
    compute: (params) => {
        const color = params['light.color'] || [1, 1, 1];
        const intensity = params['light.intensity'] || 10;
        return [
            color[0] * intensity,
            color[1] * intensity,
            color[2] * intensity
        ];
    }
}]
```

**GLSL Declaration**:
```glsl
uniform vec3 u_light_radiance;  // Color × intensity
```

### Compute Functions

The compute function transforms parameters into uniform values.

**Signature**:
```typescript
compute: (params: Record<string, any>) => any
```

**Input**: All parameters as object
**Output**: Value matching `type`

**Examples**:

**1. Unit conversion**:
```typescript
compute: (params) => params['camera.fov'] * (Math.PI / 180)
```

**2. Vector scaling**:
```typescript
compute: (params) => {
    const pos = params['camera.position'];
    return [pos[0], pos[1], pos[2]];
}
```

**3. Derived value**:
```typescript
compute: (params) => {
    const fov = params['camera.fov'] * (Math.PI / 180);
    const aspect = params['resolution'][0] / params['resolution'][1];
    return Math.tan(fov / 2) * aspect;
}
```

**4. Conditional logic**:
```typescript
compute: (params) => {
    return params['useHDRI'] ? 1 : 0;
}
```

---

## Parameter Flow

### 1. User Updates Parameter

```typescript
app.setParameter('camera.fov', 45);
```

### 2. ParameterStore Validates

```typescript
// Check type
if (typeof value !== 'number') {
    throw new Error('camera.fov must be a number');
}

// Check range (if defined)
const metadata = getMetadata('camera.fov');
if (metadata.range) {
    const [min, max] = metadata.range;
    if (value < min || value > max) {
        throw new Error(`camera.fov must be in range [${min}, ${max}]`);
    }
}
```

### 3. ParameterStore Computes Changes

```typescript
const changes = {
    'camera.fov': {
        prev: 60,
        next: 45
    }
};
```

### 4. EventBus Emits Event

```typescript
bus.emit('parameters:changed', changes);
```

### 5. App Receives Event

```typescript
app.on('parameters:changed', (changes) => {
    // Forward to engine
    engine.updateParameters(changes);

    // Reset accumulation if needed
    if (shouldResetAccumulation(changes)) {
        engine.clearAccumulation();
    }
});
```

### 6. ParameterManager Updates Uniforms

```typescript
updateUniforms(changes) {
    for (const [path, change] of Object.entries(changes)) {
        // Find bindings that depend on this parameter
        const bindings = getBindingsForParameter(path);

        for (const binding of bindings) {
            // Compute new value
            const value = binding.compute(this.allParameters);

            // Update WebGL uniform
            this.setUniform(binding.uniform, binding.type, value);
        }
    }
}
```

### 7. WebGL Uniform Updated

```typescript
gl.uniform1f(location, 45 * (Math.PI / 180));  // 0.785 radians
```

---

## Accumulation Reset

Some parameters trigger accumulation reset when changed.

### Marking Parameters

```typescript
parameters: {
    'camera.position': {
        // ...
        triggersReset: true  // Moving camera invalidates samples
    },
    'developer.exposureEV': {
        // ...
        triggersReset: false  // Tone mapping doesn't affect samples
    }
}
```

### Reset Logic

```typescript
function shouldResetAccumulation(changes: ParameterChanges): boolean {
    for (const path of Object.keys(changes)) {
        const metadata = getMetadata(path);
        if (metadata?.triggersReset) {
            return true;
        }
    }
    return false;
}
```

**Parameters that typically trigger reset**:
- Camera position, target, FOV
- Scene geometry changes
- Light positions
- Material properties (albedo, roughness)

**Parameters that don't trigger reset**:
- Tone mapping (exposure, gamma)
- Post-processing effects
- UI settings

---

## Default Parameters

### Module Defaults

Modules specify defaults in metadata:

```typescript
parameters: {
    'camera.fov': { default: 60 },
    'camera.position': { default: [0, 1, 5] },
    'camera.target': { default: [0, 0, 0] }
}
```

### Recipe Overrides

Recipes can override defaults:

```typescript
const recipe: Recipe = {
    // ...
    parameters: {
        'camera.fov': 45,           // Override default
        'camera.position': [2, 3, 8]  // Override default
    }
};
```

### Initialization Order

```
1. Module defaults
2. Recipe overrides
3. User overrides (from saved state, URL params, etc.)
```

---

## Type System

### Type Mapping

| Parameter Type | Uniform Type | GLSL Type | JavaScript Type |
|----------------|--------------|-----------|-----------------|
| `float` | `float` | `float` | `number` |
| `int` | `int` | `int` | `number` |
| `bool` | `bool` | `bool` | `boolean` |
| `vec2` | `vec2` | `vec2` | `[number, number]` |
| `vec3` | `vec3` | `vec3` | `[number, number, number]` |
| `vec4` | `vec4` | `vec4` | `[number, number, number, number]` |
| `color` | `vec3` | `vec3` | `[number, number, number]` |

### Type Validation

```typescript
function validateParameterValue(path: string, value: any): void {
    const metadata = getMetadata(path);
    if (!metadata) return;

    switch (metadata.type) {
        case 'float':
        case 'int':
            if (typeof value !== 'number') {
                throw new Error(`${path} must be a number`);
            }
            break;

        case 'bool':
            if (typeof value !== 'boolean') {
                throw new Error(`${path} must be a boolean`);
            }
            break;

        case 'vec2':
            if (!Array.isArray(value) || value.length !== 2) {
                throw new Error(`${path} must be [x, y]`);
            }
            break;

        case 'vec3':
        case 'color':
            if (!Array.isArray(value) || value.length !== 3) {
                throw new Error(`${path} must be [x, y, z]`);
            }
            break;

        case 'vec4':
            if (!Array.isArray(value) || value.length !== 4) {
                throw new Error(`${path} must be [x, y, z, w]`);
            }
            break;
    }

    // Range validation for numeric types
    if (metadata.range && (metadata.type === 'float' || metadata.type === 'int')) {
        const [min, max] = metadata.range;
        if (value < min || value > max) {
            throw new Error(`${path} must be in range [${min}, ${max}]`);
        }
    }
}
```

---

## UI Generation

Parameter metadata enables automatic UI generation.

### Example: Tweakpane Integration

```typescript
import { Pane } from 'tweakpane';

function generateUI(parameters: Record<string, ParameterMetadata>, app: App) {
    const pane = new Pane();

    // Group by metadata.group
    const groups = new Map<string, any>();

    for (const [path, meta] of Object.entries(parameters)) {
        const groupName = meta.group || 'Default';

        if (!groups.has(groupName)) {
            groups.set(groupName, pane.addFolder({ title: groupName }));
        }

        const folder = groups.get(groupName);

        // Add control based on type
        switch (meta.type) {
            case 'float':
                folder.addInput({ value: app.getParameter(path) }, 'value', {
                    label: meta.name || path,
                    min: meta.range?.[0],
                    max: meta.range?.[1],
                    step: meta.step
                }).on('change', (ev) => {
                    app.setParameter(path, ev.value);
                });
                break;

            case 'vec3':
                folder.addInput({ value: app.getParameter(path) }, 'value', {
                    label: meta.name || path
                }).on('change', (ev) => {
                    app.setParameter(path, ev.value);
                });
                break;

            case 'bool':
                folder.addInput({ value: app.getParameter(path) }, 'value', {
                    label: meta.name || path
                }).on('change', (ev) => {
                    app.setParameter(path, ev.value);
                });
                break;
        }
    }
}
```

---

## Advanced Patterns

### Dependent Parameters

Some parameters depend on others:

```typescript
// Aspect ratio depends on resolution
uniformBindings: [{
    uniform: 'u_aspect',
    parameters: ['resolution'],  // Depends on resolution
    type: 'float',
    compute: (params) => {
        const [width, height] = params['resolution'];
        return width / height;
    }
}]
```

### Computed Matrices

Generate transformation matrices:

```typescript
uniformBindings: [{
    uniform: 'u_view_matrix',
    parameters: ['camera.position', 'camera.target'],
    type: 'mat4',
    compute: (params) => {
        const eye = params['camera.position'];
        const target = params['camera.target'];
        return computeLookAtMatrix(eye, target, [0, 1, 0]);
    }
}]
```

### Color Space Conversion

Convert sRGB to linear:

```typescript
uniformBindings: [{
    uniform: 'u_albedo_linear',
    parameters: ['material.albedo'],
    type: 'vec3',
    compute: (params) => {
        const srgb = params['material.albedo'];
        return srgb.map(c => Math.pow(c, 2.2));  // sRGB → linear
    }
}]
```

---

## Best Practices

1. **Use descriptive paths**: `camera.fov` not `fov`
2. **Provide metadata**: Enables better UX
3. **Set appropriate ranges**: Prevent invalid values
4. **Mark reset triggers**: Only when necessary
5. **Group related parameters**: Use `group` field
6. **Document units**: Use `unit` field
7. **Validate in compute**: Handle missing/invalid values
8. **Cache expensive computations**: If compute is heavy

---

## Next Steps

- [Extensions](extensions.md) - Using parameters in extensions
- [Event Bus](event-bus.md) - Parameter change events
- [Engine API](../engine/api-reference.md) - Uniform updates
- [Writing Modules](../guides/writing-modules.md) - Defining parameters
