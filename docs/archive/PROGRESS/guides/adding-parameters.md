# Adding Parameters

Advanced guide to parameter metadata, bindings, and patterns.

## Overview

Parameters are the bridge between application state and GPU uniforms. They enable:
- **Live updates** without shader recompilation
- **Type safety** with metadata
- **Complex computations** from simple inputs
- **UI integration** for interactive controls

---

## Parameter Flow

```
User Input
  ↓
ParameterStore (application state)
  ↓
EventBus emits 'parameters:changed'
  ↓
UniformBinding (compute function)
  ↓
GPU Uniform (shader variable)
```

---

## Basic Parameter Definition

Parameters are defined in module metadata:

```typescript
parameters: {
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
```

**Fields**:
- `type` - Parameter type (`float`, `vec3`, `color`, `int`, `bool`)
- `default` - Initial value
- `min` / `max` - Range limits (for `float` / `int`)
- `step` - Increment for sliders (for `float` / `int`)
- `label` - Display name for UI
- `triggersReset` - Reset accumulation when changed (default: `true`)

---

## Parameter Types

### Float

Single numeric value with range.

```typescript
parameters: {
    'material.roughness': {
        type: 'float',
        default: 0.5,
        min: 0.0,
        max: 1.0,
        step: 0.01,
        label: 'Roughness'
    },
    'quad.intensity': {
        type: 'float',
        default: 30.0,
        min: 0.0,
        max: 1000.0,
        step: 1.0,
        label: 'Light Intensity'
    }
}
```

### Vec3

Three-component vector (position, direction, etc.).

```typescript
parameters: {
    'camera.position': {
        type: 'vec3',
        default: [0, 1, 5],
        label: 'Camera Position',
        triggersReset: true
    },
    'camera.up': {
        type: 'vec3',
        default: [0, 1, 0],
        label: 'Camera Up Vector'
    }
}
```

### Color

RGB color (displayed with color picker in UI).

```typescript
parameters: {
    'quad.color': {
        type: 'color',
        default: [1.0, 1.0, 1.0],  // White
        label: 'Light Color',
        triggersReset: false  // Color changes don't need reset
    },
    'material.albedo': {
        type: 'color',
        default: [0.8, 0.8, 0.8],
        label: 'Base Color'
    }
}
```

### Int

Integer value.

```typescript
parameters: {
    'transport.maxBounces': {
        type: 'int',
        default: 4,
        min: 1,
        max: 16,
        step: 1,
        label: 'Max Bounces',
        triggersReset: true
    }
}
```

### Bool

True/false toggle.

```typescript
parameters: {
    'developer.useACES': {
        type: 'bool',
        default: false,
        label: 'Use ACES Tonemapping',
        triggersReset: false
    }
}
```

---

## Uniform Bindings

Bindings connect parameters to shader uniforms.

### Simple 1:1 Binding

```typescript
uniformBindings: [
    {
        uniform: 'u_roughness',
        parameters: ['material.roughness'],
        type: 'float',
        compute: (params) => params['material.roughness']
    }
]
```

### Unit Conversion

Convert parameter units to shader units:

```typescript
uniformBindings: [
    {
        uniform: 'u_camera_fov',
        parameters: ['camera.fov'],
        type: 'float',
        compute: (params) => {
            // Degrees to radians
            return params['camera.fov'] * (Math.PI / 180);
        }
    }
]
```

### Derived Values

Compute uniform from multiple parameters:

```typescript
uniformBindings: [
    {
        uniform: 'u_aspect_ratio',
        parameters: ['resolution.width', 'resolution.height'],
        type: 'float',
        compute: (params) => {
            return params['resolution.width'] / params['resolution.height'];
        }
    }
]
```

### Matrix Construction

Build matrices from parameters:

```typescript
uniformBindings: [
    {
        uniform: 'u_view_matrix',
        parameters: ['camera.position', 'camera.target', 'camera.up'],
        type: 'mat4',
        compute: (params) => {
            const pos = params['camera.position'];
            const target = params['camera.target'];
            const up = params['camera.up'];

            // Build view matrix (lookAt)
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
]
```

### Color Space Conversion

```typescript
uniformBindings: [
    {
        uniform: 'u_light_color_linear',
        parameters: ['light.color'],
        type: 'vec3',
        compute: (params) => {
            const srgb = params['light.color'];
            // sRGB to linear
            return srgb.map(c => Math.pow(c, 2.2));
        }
    }
]
```

### Exposure Calculation

```typescript
uniformBindings: [
    {
        uniform: 'u_exposure_scale',
        parameters: ['developer.exposureEV'],
        type: 'float',
        compute: (params) => {
            // EV to linear scale: 2^EV
            return Math.pow(2, params['developer.exposureEV']);
        }
    }
]
```

---

## Advanced Patterns

### Pattern: Min/Max Clamping

```typescript
uniformBindings: [
    {
        uniform: 'u_samples_per_frame',
        parameters: ['accumulator.samplesPerFrame'],
        type: 'int',
        compute: (params) => {
            const samples = params['accumulator.samplesPerFrame'];
            // Clamp to safe range
            return Math.max(1, Math.min(samples, 16));
        }
    }
]
```

### Pattern: Conditional Values

```typescript
uniformBindings: [
    {
        uniform: 'u_use_importance_sampling',
        parameters: ['environment.useImportanceSampling'],
        type: 'int',
        compute: (params) => {
            // Convert bool to int for shader
            return params['environment.useImportanceSampling'] ? 1 : 0;
        }
    }
]
```

### Pattern: Normalized Vectors

```typescript
uniformBindings: [
    {
        uniform: 'u_light_direction',
        parameters: ['light.direction'],
        type: 'vec3',
        compute: (params) => {
            const dir = params['light.direction'];
            const len = Math.sqrt(dir[0]**2 + dir[1]**2 + dir[2]**2);
            // Ensure normalized
            return [dir[0]/len, dir[1]/len, dir[2]/len];
        }
    }
]
```

### Pattern: Time-based Animation

```typescript
parameters: {
    'animation.speed': {
        type: 'float',
        default: 1.0,
        min: 0.0,
        max: 10.0,
        step: 0.1,
        label: 'Animation Speed',
        triggersReset: false  // Animation shouldn't reset
    }
}

uniformBindings: [
    {
        uniform: 'u_animation_time',
        parameters: ['animation.speed'],
        type: 'float',
        compute: (params, context) => {
            // Use engine time
            return context.time * params['animation.speed'];
        }
    }
]
```

### Pattern: Array Parameters

```typescript
parameters: {
    'lights.positions': {
        type: 'array',  // Custom type
        default: [
            [1, 2, 0],
            [-1, 2, 0],
            [0, 2, 1]
        ],
        label: 'Light Positions'
    }
}

uniformBindings: [
    {
        uniform: 'u_light_positions',
        parameters: ['lights.positions'],
        type: 'vec3[]',
        compute: (params) => {
            // Flatten array for uniform
            return params['lights.positions'].flat();
        }
    }
]
```

---

## Trigger Reset Semantics

Control when accumulation resets:

### Always Reset (Default)

```typescript
parameters: {
    'camera.position': {
        type: 'vec3',
        default: [0, 1, 5],
        triggersReset: true  // Reset when camera moves
    }
}
```

**Use for**: Camera, geometry, lighting changes

### Never Reset

```typescript
parameters: {
    'developer.exposureEV': {
        type: 'float',
        default: 0,
        triggersReset: false  // Don't reset for post-process
    }
}
```

**Use for**: Post-processing, tone mapping, display settings

### Conditional Reset

```typescript
parameters: {
    'material.roughness': {
        type: 'float',
        default: 0.5,
        triggersReset: true  // Reset for material changes
    },
    'material.visualize': {
        type: 'bool',
        default: false,
        triggersReset: false  // Don't reset for debug viz
    }
}
```

---

## Parameter Namespacing

Use dot notation for organization:

```typescript
parameters: {
    // Camera parameters
    'camera.position': { /* ... */ },
    'camera.target': { /* ... */ },
    'camera.fov': { /* ... */ },
    'camera.aperture': { /* ... */ },
    'camera.focusDistance': { /* ... */ },

    // Material parameters
    'material.albedo': { /* ... */ },
    'material.roughness': { /* ... */ },
    'material.metallic': { /* ... */ },

    // Developer parameters
    'developer.exposureEV': { /* ... */ },
    'developer.gamma': { /* ... */ },
    'developer.useACES': { /* ... */ }
}
```

**Benefits**:
- Logical grouping
- Avoids naming conflicts
- Easy to find related parameters
- Natural UI organization

---

## Default Values Strategy

### Use Sensible Defaults

```typescript
// ✅ Good: Sensible defaults
parameters: {
    'camera.fov': {
        type: 'float',
        default: 60,  // Standard FOV
        min: 10,
        max: 120,
        step: 1,
        label: 'FOV'
    }
}

// ❌ Bad: Extreme defaults
parameters: {
    'camera.fov': {
        type: 'float',
        default: 179,  // Fisheye!
        min: 10,
        max: 120,
        step: 1,
        label: 'FOV'
    }
}
```

### Match Common Usage

```typescript
// For a studio lighting setup
parameters: {
    'quad.position': {
        type: 'vec3',
        default: [0, 2, 0],  // Overhead
        label: 'Light Position'
    },
    'quad.intensity': {
        type: 'float',
        default: 30.0,  // Moderate brightness
        min: 0,
        max: 1000,
        step: 1,
        label: 'Intensity'
    }
}
```

---

## Runtime Parameter Updates

### From Extensions

```typescript
class MyExtension implements Extension {
    initialize(context: ExtensionContext) {
        context.bus.on('click', (event) => {
            // Update parameter on click
            context.store.setParameter('camera.position', [
                event.x, event.y, 5
            ]);
        });
    }
}
```

### From User Code

```typescript
// Set single parameter
app.setParameter('camera.fov', 75);

// Set multiple parameters
app.setParameters({
    'camera.position': [3, 2, 5],
    'camera.target': [0, 0, 0],
    'camera.fov': 60
});

// Get current value
const fov = app.getParameter('camera.fov');
```

### Listening to Changes

```typescript
app.on('parameters:changed', (changes) => {
    for (const [path, { prev, next }] of Object.entries(changes)) {
        console.log(`${path}: ${prev} → ${next}`);
    }
});
```

---

## Validation

### Range Validation

Parameters are automatically clamped to min/max:

```typescript
parameters: {
    'roughness': {
        type: 'float',
        default: 0.5,
        min: 0.0,
        max: 1.0
    }
}

// User sets out-of-range value
app.setParameter('roughness', 1.5);

// Automatically clamped to 1.0
console.log(app.getParameter('roughness'));  // 1.0
```

### Type Validation

Type mismatches are caught:

```typescript
parameters: {
    'camera.position': {
        type: 'vec3',
        default: [0, 1, 5]
    }
}

// ❌ Wrong type
app.setParameter('camera.position', 5);  // Error: Expected vec3

// ✅ Correct type
app.setParameter('camera.position', [0, 2, 3]);
```

### Custom Validation

Add validation in compute function:

```typescript
uniformBindings: [
    {
        uniform: 'u_camera_fov',
        parameters: ['camera.fov'],
        type: 'float',
        compute: (params) => {
            const fov = params['camera.fov'];

            // Validate range
            if (fov < 1 || fov > 179) {
                console.warn(`FOV ${fov} out of range, clamping`);
                return Math.max(1, Math.min(fov, 179));
            }

            return fov * (Math.PI / 180);
        }
    }
]
```

---

## Performance Considerations

### Avoid Expensive Computations

```typescript
// ❌ Bad: Expensive computation every frame
uniformBindings: [
    {
        uniform: 'u_expensive',
        parameters: ['value'],
        type: 'float',
        compute: (params) => {
            // Runs EVERY parameter update!
            return expensiveCalculation(params['value']);
        }
    }
]

// ✅ Good: Cache if possible
let cached = null;
let cachedValue = null;

uniformBindings: [
    {
        uniform: 'u_expensive',
        parameters: ['value'],
        type: 'float',
        compute: (params) => {
            if (params['value'] !== cachedValue) {
                cached = expensiveCalculation(params['value']);
                cachedValue = params['value'];
            }
            return cached;
        }
    }
]
```

### Minimize Uniform Updates

Only include parameters that actually change:

```typescript
// ❌ Bad: Recompute static value
uniformBindings: [
    {
        uniform: 'u_pi',
        parameters: [],
        type: 'float',
        compute: () => Math.PI  // Why compute every frame?
    }
]

// ✅ Good: Use constant in shader
fragment: {
    constants: `
        #define PI 3.14159265359
    `
}
```

---

## Complete Example

Here's a complete module with advanced parameters:

```typescript
export const advancedCamera: ModuleDescriptor = {
    id: {
        kind: 'camera',
        name: 'advanced-camera',
        version: '1.0.0'
    },

    fragment: {
        uniforms: `
            uniform mat4 u_camera_matrix;
            uniform float u_camera_fov_rad;
            uniform float u_camera_aspect;
            uniform float u_camera_aperture;
            uniform float u_camera_focus_distance;
        `,
        functions: `
            Ray camera_generateRay(vec2 uv, vec2 resolution) {
                // Use uniforms to generate ray
                // ... implementation
            }
        `
    },

    uniformBindings: [
        {
            uniform: 'u_camera_matrix',
            parameters: ['camera.position', 'camera.target', 'camera.up'],
            type: 'mat4',
            compute: (params) => buildViewMatrix(
                params['camera.position'],
                params['camera.target'],
                params['camera.up']
            )
        },
        {
            uniform: 'u_camera_fov_rad',
            parameters: ['camera.fov'],
            type: 'float',
            compute: (params) => params['camera.fov'] * (Math.PI / 180)
        },
        {
            uniform: 'u_camera_aspect',
            parameters: ['resolution.width', 'resolution.height'],
            type: 'float',
            compute: (params) =>
                params['resolution.width'] / params['resolution.height']
        },
        {
            uniform: 'u_camera_aperture',
            parameters: ['camera.aperture'],
            type: 'float',
            compute: (params) => params['camera.aperture']
        },
        {
            uniform: 'u_camera_focus_distance',
            parameters: ['camera.focusDistance'],
            type: 'float',
            compute: (params) => params['camera.focusDistance']
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
        },
        'camera.aperture': {
            type: 'float',
            default: 0.0,
            min: 0.0,
            max: 1.0,
            step: 0.01,
            label: 'Aperture (DoF)',
            triggersReset: true
        },
        'camera.focusDistance': {
            type: 'float',
            default: 5.0,
            min: 0.1,
            max: 100.0,
            step: 0.1,
            label: 'Focus Distance',
            triggersReset: true
        }
    }
};
```

---

## Best Practices

1. **Use descriptive names** - `camera.fov` not `cfov`
2. **Group related parameters** - Use dot notation
3. **Provide sensible defaults** - Match common usage
4. **Set appropriate ranges** - min/max for safety
5. **Use triggersReset wisely** - Only for geometric changes
6. **Document compute functions** - Explain transformations
7. **Validate in compute** - Catch edge cases
8. **Cache expensive computations** - Avoid redundant work
9. **Use constants when possible** - For truly static values
10. **Test with extreme values** - Verify robustness

---

## Next Steps

- [Writing Modules](writing-modules.md) - Create modules with parameters
- [Parameter System](../app/parameter-system.md) - Internal architecture
- [Uniform Bindings Reference](../reference/uniform-bindings.md) - Complete specification
- [Extensions](../app/extensions.md) - Using parameters in extensions
