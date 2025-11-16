# Uniform Bindings Reference

Complete reference for connecting parameters to shader uniforms.

## Overview

**Uniform bindings** connect application parameters to GPU shader uniforms. They enable:
- Dynamic parameter updates without recompilation
- Unit conversions (degrees → radians)
- Complex computations (view matrices from position/target)
- Multiple parameters → single uniform

---

## Type Definition

```typescript
interface UniformBinding {
    uniform: string;
    parameters: string[];
    type: UniformType;
    compute: (params: ParameterValues, context?: ComputeContext) => any;
}
```

---

## Fields

### uniform

**Type**: `string`

**Description**: Name of the shader uniform (must match GLSL declaration).

**Example**:
```typescript
uniform: 'u_camera_fov'
```

**Requirements**:
- Must match uniform name in `fragment.uniforms`
- Use snake_case
- Prefix with `u_`

### parameters

**Type**: `string[]`

**Description**: Array of parameter paths this binding depends on.

**Examples**:
```typescript
// Single parameter
parameters: ['camera.fov']

// Multiple parameters
parameters: ['camera.position', 'camera.target', 'camera.up']

// No parameters (constants)
parameters: []
```

**Notes**:
- Parameters use dot notation
- All listed parameters trigger uniform recomputation when changed
- Can be empty for computed constants

### type

**Type**: `UniformType`

**Description**: GLSL type of the uniform.

**Values**:
```typescript
type UniformType =
    | 'float'
    | 'int'
    | 'bool'
    | 'vec2'
    | 'vec3'
    | 'vec4'
    | 'mat2'
    | 'mat3'
    | 'mat4'
    | 'sampler2D'
    | 'sampler3D'
    | 'samplerCube';
```

**Example**:
```typescript
type: 'float'
type: 'vec3'
type: 'mat4'
```

### compute

**Type**: `(params: ParameterValues, context?: ComputeContext) => any`

**Description**: Function to compute uniform value from parameters.

**Signature**:
```typescript
compute: (params, context) => uniformValue
```

**Parameters**:
- `params` - Object mapping parameter paths to values
- `context` - Optional context (time, resolution, etc.)

**Returns**: Value matching the binding's `type`

**Example**:
```typescript
compute: (params) => params['camera.fov'] * (Math.PI / 180)
```

---

## ParameterValues

Object mapping parameter paths to their current values.

```typescript
type ParameterValues = Record<string, any>;
```

**Example**:
```typescript
{
    'camera.position': [0, 1, 5],
    'camera.target': [0, 0, 0],
    'camera.fov': 60,
    'material.roughness': 0.5
}
```

**Usage**:
```typescript
compute: (params) => {
    const position = params['camera.position'];  // [0, 1, 5]
    const fov = params['camera.fov'];            // 60
    // ...
}
```

---

## ComputeContext

Optional context provided to compute functions.

```typescript
interface ComputeContext {
    time?: number;        // Milliseconds since start
    resolution?: [number, number];  // [width, height]
    sampleCount?: number; // Current sample count
}
```

**Example**:
```typescript
uniformBindings: [{
    uniform: 'u_time',
    parameters: [],
    type: 'float',
    compute: (params, context) => {
        return context?.time ?? 0;
    }
}]
```

---

## Binding Patterns

### Pattern: Identity (1:1)

Direct parameter → uniform mapping.

```typescript
{
    uniform: 'u_roughness',
    parameters: ['material.roughness'],
    type: 'float',
    compute: (params) => params['material.roughness']
}
```

**When to use**: Simple pass-through values.

### Pattern: Unit Conversion

Convert parameter units to shader units.

```typescript
{
    uniform: 'u_camera_fov',
    parameters: ['camera.fov'],
    type: 'float',
    compute: (params) => {
        // Degrees to radians
        return params['camera.fov'] * (Math.PI / 180);
    }
}
```

**Common conversions**:
- Degrees → Radians: `* (Math.PI / 180)`
- Radians → Degrees: `* (180 / Math.PI)`
- sRGB → Linear: `Math.pow(c, 2.2)`
- Linear → sRGB: `Math.pow(c, 1/2.2)`
- EV → Scale: `Math.pow(2, ev)`

### Pattern: Derived Value

Compute uniform from multiple parameters.

```typescript
{
    uniform: 'u_aspect_ratio',
    parameters: ['resolution.width', 'resolution.height'],
    type: 'float',
    compute: (params) => {
        return params['resolution.width'] / params['resolution.height'];
    }
}
```

**When to use**: Values computed from other parameters.

### Pattern: Matrix Construction

Build matrices from component parameters.

```typescript
{
    uniform: 'u_view_matrix',
    parameters: ['camera.position', 'camera.target', 'camera.up'],
    type: 'mat4',
    compute: (params) => {
        const pos = params['camera.position'];
        const target = params['camera.target'];
        const up = params['camera.up'];

        // Build lookAt matrix
        const z = normalize(subtract(pos, target));
        const x = normalize(cross(up, z));
        const y = cross(z, x);

        return [
            x[0], y[0], z[0], 0,
            x[1], y[1], z[1], 0,
            x[2], y[2], z[2], 0,
            -dot(x, pos), -dot(y, pos), -dot(z, pos), 1
        ];
    }
}
```

**Common matrices**:
- View matrix (lookAt)
- Projection matrix
- Model matrix
- Normal matrix

### Pattern: Normalization

Ensure vectors are unit length.

```typescript
{
    uniform: 'u_light_direction',
    parameters: ['light.direction'],
    type: 'vec3',
    compute: (params) => {
        const dir = params['light.direction'];
        const len = Math.sqrt(dir[0]**2 + dir[1]**2 + dir[2]**2);

        if (len === 0) return [0, 1, 0];  // Fallback

        return [dir[0]/len, dir[1]/len, dir[2]/len];
    }
}
```

**When to use**: Direction vectors, normals.

### Pattern: Clamping

Enforce value ranges.

```typescript
{
    uniform: 'u_samples_per_frame',
    parameters: ['accumulator.samplesPerFrame'],
    type: 'int',
    compute: (params) => {
        const samples = params['accumulator.samplesPerFrame'];
        return Math.max(1, Math.min(samples, 16));  // Clamp [1, 16]
    }
}
```

**When to use**: Safety limits, GPU constraints.

### Pattern: Conditional Logic

Select values based on conditions.

```typescript
{
    uniform: 'u_use_importance_sampling',
    parameters: ['environment.useImportanceSampling'],
    type: 'int',
    compute: (params) => {
        // Bool → int for shader
        return params['environment.useImportanceSampling'] ? 1 : 0;
    }
}
```

**When to use**: Feature toggles, mode selection.

### Pattern: Array Flattening

Convert array of vectors to flat array.

```typescript
{
    uniform: 'u_light_positions',
    parameters: ['lights.positions'],
    type: 'vec3[]',  // Array type
    compute: (params) => {
        const positions = params['lights.positions'];
        // [[x1,y1,z1], [x2,y2,z2]] → [x1,y1,z1, x2,y2,z2]
        return positions.flat();
    }
}
```

**When to use**: Uniform arrays in shaders.

### Pattern: Color Space Conversion

Convert between color spaces.

```typescript
{
    uniform: 'u_light_color_linear',
    parameters: ['light.color'],
    type: 'vec3',
    compute: (params) => {
        const srgb = params['light.color'];

        // sRGB to linear
        return srgb.map(c => c <= 0.04045
            ? c / 12.92
            : Math.pow((c + 0.055) / 1.055, 2.4)
        );
    }
}
```

**Common conversions**:
- sRGB → Linear (accurate)
- Linear → sRGB
- RGB → HSV
- Temperature → RGB

### Pattern: Exposure Calculation

Convert exposure values to multipliers.

```typescript
{
    uniform: 'u_exposure_scale',
    parameters: ['developer.exposureEV'],
    type: 'float',
    compute: (params) => {
        // EV to linear scale: 2^EV
        return Math.pow(2, params['developer.exposureEV']);
    }
}
```

**When to use**: Tone mapping, exposure control.

### Pattern: Time-based Animation

Use context for animated values.

```typescript
{
    uniform: 'u_animation_time',
    parameters: ['animation.speed'],
    type: 'float',
    compute: (params, context) => {
        const time = context?.time ?? 0;
        const speed = params['animation.speed'];
        return (time / 1000) * speed;  // ms to seconds
    }
}
```

**When to use**: Animations, time-varying effects.

### Pattern: Cached Computation

Cache expensive computations.

```typescript
let cached = null;
let cachedKey = null;

{
    uniform: 'u_expensive_value',
    parameters: ['input'],
    type: 'float',
    compute: (params) => {
        const key = JSON.stringify(params['input']);

        if (key !== cachedKey) {
            cached = expensiveCalculation(params['input']);
            cachedKey = key;
        }

        return cached;
    }
}
```

**When to use**: Matrix decomposition, FFT, expensive math.

---

## Type-Specific Examples

### Float

```typescript
{
    uniform: 'u_roughness',
    parameters: ['material.roughness'],
    type: 'float',
    compute: (params) => params['material.roughness']
}
```

### Int

```typescript
{
    uniform: 'u_max_bounces',
    parameters: ['transport.maxBounces'],
    type: 'int',
    compute: (params) => Math.floor(params['transport.maxBounces'])
}
```

### Bool (as int)

```typescript
{
    uniform: 'u_use_feature',
    parameters: ['feature.enabled'],
    type: 'int',  // GLSL doesn't have uniform bool in some versions
    compute: (params) => params['feature.enabled'] ? 1 : 0
}
```

### Vec2

```typescript
{
    uniform: 'u_resolution',
    parameters: ['resolution.width', 'resolution.height'],
    type: 'vec2',
    compute: (params) => [
        params['resolution.width'],
        params['resolution.height']
    ]
}
```

### Vec3

```typescript
{
    uniform: 'u_camera_position',
    parameters: ['camera.position'],
    type: 'vec3',
    compute: (params) => params['camera.position']
}
```

### Vec4

```typescript
{
    uniform: 'u_color_with_alpha',
    parameters: ['material.color', 'material.alpha'],
    type: 'vec4',
    compute: (params) => [
        ...params['material.color'],  // RGB
        params['material.alpha']       // A
    ]
}
```

### Mat4

```typescript
{
    uniform: 'u_projection_matrix',
    parameters: ['camera.fov', 'camera.aspect', 'camera.near', 'camera.far'],
    type: 'mat4',
    compute: (params) => {
        const fov = params['camera.fov'];
        const aspect = params['camera.aspect'];
        const near = params['camera.near'];
        const far = params['camera.far'];

        return buildPerspectiveMatrix(fov, aspect, near, far);
    }
}
```

### Sampler2D

```typescript
{
    uniform: 'u_environment_map',
    parameters: ['hdri.path'],
    type: 'sampler2D',
    compute: (params) => {
        // Return texture handle (engine manages texture loading)
        return textureRegistry.get('environment');
    }
}
```

---

## Validation

Bindings are validated on module load:

### Uniform Exists

Uniform must be declared in `fragment.uniforms`.

**Error**:
```
❌ Uniform 'u_missing' has binding but is not declared in shader
```

### Type Match

Binding type must match uniform declaration.

**Error**:
```
❌ Uniform 'u_camera_fov' declared as float, bound as vec3
```

### Parameter Exists

Referenced parameters should be defined.

**Warning**:
```
⚠️  Binding for 'u_foo' references undefined parameter: 'bar.baz'
```

### Return Value Type

Compute function should return correct type.

**Runtime Error**:
```
❌ Uniform 'u_roughness' expects number, got array
```

---

## Performance Considerations

### Minimize Computation

```typescript
// ❌ Bad: Recompute constant every update
{
    uniform: 'u_pi',
    parameters: [],
    type: 'float',
    compute: () => Math.PI
}

// ✅ Good: Use shader constant
fragment: {
    constants: `#define PI 3.14159265359`
}
```

### Cache When Possible

```typescript
// ❌ Bad: Expensive computation every update
{
    uniform: 'u_transform',
    parameters: ['position', 'rotation', 'scale'],
    type: 'mat4',
    compute: (params) => {
        // Expensive matrix composition
        return composeMatrix(/* ... */);
    }
}

// ✅ Better: Cache based on parameters
let cache = null;
let cacheKey = null;

{
    uniform: 'u_transform',
    parameters: ['position', 'rotation', 'scale'],
    type: 'mat4',
    compute: (params) => {
        const key = `${params.position}|${params.rotation}|${params.scale}`;

        if (key !== cacheKey) {
            cache = composeMatrix(/* ... */);
            cacheKey = key;
        }

        return cache;
    }
}
```

### Avoid Redundant Bindings

```typescript
// ❌ Bad: Duplicate binding
{
    uniform: 'u_fov_degrees',
    parameters: ['camera.fov'],
    type: 'float',
    compute: (params) => params['camera.fov']
},
{
    uniform: 'u_fov_radians',
    parameters: ['camera.fov'],
    type: 'float',
    compute: (params) => params['camera.fov'] * (Math.PI / 180)
}

// ✅ Good: Single binding, compute in shader
{
    uniform: 'u_fov_radians',
    parameters: ['camera.fov'],
    type: 'float',
    compute: (params) => params['camera.fov'] * (Math.PI / 180)
}
// In shader: float fov_degrees = u_fov_radians * (180.0 / PI);
```

---

## Error Handling

### Safe Default Values

```typescript
{
    uniform: 'u_direction',
    parameters: ['light.direction'],
    type: 'vec3',
    compute: (params) => {
        const dir = params['light.direction'];

        // Handle missing or invalid
        if (!dir || dir.length !== 3) {
            return [0, 1, 0];  // Default up
        }

        return dir;
    }
}
```

### Validate Ranges

```typescript
{
    uniform: 'u_roughness',
    parameters: ['material.roughness'],
    type: 'float',
    compute: (params) => {
        const roughness = params['material.roughness'];

        // Clamp to valid range
        return Math.max(0, Math.min(roughness, 1));
    }
}
```

### Handle Division by Zero

```typescript
{
    uniform: 'u_aspect_ratio',
    parameters: ['resolution.width', 'resolution.height'],
    type: 'float',
    compute: (params) => {
        const width = params['resolution.width'];
        const height = params['resolution.height'];

        // Avoid division by zero
        if (height === 0) return 1.0;

        return width / height;
    }
}
```

---

## Best Practices

1. **Match types** - Ensure compute return matches uniform type
2. **Validate inputs** - Check parameter values, provide fallbacks
3. **Cache expensive computations** - Avoid redundant work
4. **Use constants in shader** - For truly static values
5. **Document transformations** - Comment unit conversions
6. **Handle edge cases** - Zero, NaN, infinity
7. **Minimize bindings** - Compute in shader when possible
8. **Use descriptive names** - `u_camera_fov_rad` not `u_cfov`
9. **Group related uniforms** - Keep bindings organized
10. **Test thoroughly** - Verify with extreme parameter values

---

## Complete Example

```typescript
export const advancedCamera: ModuleDescriptor = {
    id: {
        kind: 'camera',
        name: 'advanced-camera',
        version: '1.0.0'
    },

    fragment: {
        uniforms: `
            uniform vec3 u_camera_position;
            uniform vec3 u_camera_forward;
            uniform vec3 u_camera_right;
            uniform vec3 u_camera_up;
            uniform float u_camera_fov_rad;
            uniform float u_camera_aspect;
        `,
        functions: `
            Ray camera_generateRay(vec2 uv, vec2 resolution) {
                // Use precomputed camera basis vectors
                float halfHeight = tan(u_camera_fov_rad / 2.0);
                float halfWidth = u_camera_aspect * halfHeight;

                vec3 horizontal = u_camera_right * halfWidth * 2.0;
                vec3 vertical = u_camera_up * halfHeight * 2.0;
                vec3 lowerLeft = u_camera_forward - halfWidth * u_camera_right - halfHeight * u_camera_up;

                vec3 direction = normalize(lowerLeft + uv.x * horizontal + uv.y * vertical);

                Ray ray;
                ray.origin = u_camera_position;
                ray.direction = direction;
                return ray;
            }
        `
    },

    uniformBindings: [
        {
            uniform: 'u_camera_position',
            parameters: ['camera.position'],
            type: 'vec3',
            compute: (params) => params['camera.position']
        },
        {
            uniform: 'u_camera_forward',
            parameters: ['camera.position', 'camera.target'],
            type: 'vec3',
            compute: (params) => {
                const pos = params['camera.position'];
                const target = params['camera.target'];
                return normalize(subtract(target, pos));
            }
        },
        {
            uniform: 'u_camera_right',
            parameters: ['camera.position', 'camera.target', 'camera.up'],
            type: 'vec3',
            compute: (params) => {
                const pos = params['camera.position'];
                const target = params['camera.target'];
                const up = params['camera.up'];

                const forward = normalize(subtract(target, pos));
                return normalize(cross(forward, up));
            }
        },
        {
            uniform: 'u_camera_up',
            parameters: ['camera.position', 'camera.target', 'camera.up'],
            type: 'vec3',
            compute: (params) => {
                const pos = params['camera.position'];
                const target = params['camera.target'];
                const up = params['camera.up'];

                const forward = normalize(subtract(target, pos));
                const right = normalize(cross(forward, up));
                return cross(right, forward);
            }
        },
        {
            uniform: 'u_camera_fov_rad',
            parameters: ['camera.fov'],
            type: 'float',
            compute: (params) => {
                // Degrees to radians with validation
                const fov = params['camera.fov'];
                const clamped = Math.max(1, Math.min(fov, 179));
                return clamped * (Math.PI / 180);
            }
        },
        {
            uniform: 'u_camera_aspect',
            parameters: ['resolution.width', 'resolution.height'],
            type: 'float',
            compute: (params) => {
                const width = params['resolution.width'];
                const height = params['resolution.height'];

                // Avoid division by zero
                if (height === 0) return 1.0;

                return width / height;
            }
        }
    ],

    parameters: {
        'camera.position': {
            type: 'vec3',
            default: [0, 1, 5],
            label: 'Position',
            triggersReset: true
        },
        'camera.target': {
            type: 'vec3',
            default: [0, 0, 0],
            label: 'Target',
            triggersReset: true
        },
        'camera.up': {
            type: 'vec3',
            default: [0, 1, 0],
            label: 'Up Vector',
            triggersReset: true
        },
        'camera.fov': {
            type: 'float',
            default: 60,
            min: 10,
            max: 120,
            step: 1,
            label: 'Field of View',
            triggersReset: true
        }
    }
};
```

---

## Next Steps

- [Module Descriptor Reference](module-descriptor.md) - Complete module types
- [Adding Parameters Guide](../guides/adding-parameters.md) - Parameter patterns
- [Writing Modules Guide](../guides/writing-modules.md) - Practical tutorial
- [Parameter System](../app/parameter-system.md) - Internal architecture
