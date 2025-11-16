# ModuleDescriptor Reference

Complete type reference for module descriptors.

## Overview

`ModuleDescriptor` is the core interface for defining reusable shader modules in PathTracerGLSL.

---

## Type Definition

```typescript
interface ModuleDescriptor {
    id: ModuleId;
    fragment: FragmentShaderSpec;
    uniformBindings?: UniformBinding[];
    parameters?: Record<string, ParameterMetadata>;
}
```

---

## ModuleId

Unique identifier for the module.

```typescript
interface ModuleId {
    kind: ModuleKind;
    name: string;
    version: string;
}
```

### Fields

#### kind

**Type**: `ModuleKind`

**Description**: Module slot classification.

**Values**:
- `'ambient'` - Mathematical space (Euclidean, hyperbolic, spherical)
- `'scene'` - Scene geometry (SDF, mesh)
- `'environment'` - Environment lighting (HDRI, constant, gradient)
- `'lighting'` - Light sources (quad, point, area)
- `'camera'` - Ray generation (pinhole, thin lens, orthographic)
- `'interaction'` - Surface shading (BRDF, material)
- `'transport'` - Light transport (path tracing, direct lighting, AO)
- `'accumulator'` - Sample accumulation (averaging, denoising)
- `'developer'` - Tone mapping (gamma, filmic, ACES)

**Example**:
```typescript
id: {
    kind: 'camera',
    name: 'pinhole-camera',
    version: '1.0.0'
}
```

#### name

**Type**: `string`

**Description**: Unique name for the module within its kind.

**Constraints**:
- Must be unique per kind
- Use kebab-case
- Descriptive of functionality

**Examples**:
- `'pinhole-camera'`
- `'lambert-interaction'`
- `'path-tracer-direct-light'`
- `'hdri-environment-importance'`

#### version

**Type**: `string`

**Description**: Semantic version string.

**Format**: `major.minor.patch`

**Examples**:
- `'1.0.0'` - Initial release
- `'1.1.0'` - Minor update (new features)
- `'2.0.0'` - Major update (breaking changes)

---

## FragmentShaderSpec

GLSL shader code for the module.

```typescript
interface FragmentShaderSpec {
    constants?: string;
    uniforms?: string;
    functions: string;
}
```

### Fields

#### constants

**Type**: `string` (optional)

**Description**: GLSL preprocessor definitions and compile-time constants.

**Example**:
```typescript
constants: `
    #define MAX_BOUNCES 8
    #define PI 3.14159265359
    #define USE_IMPORTANCE_SAMPLING true
`
```

**Use Cases**:
- Compile-time configuration
- Mathematical constants
- Feature flags
- Array sizes

#### uniforms

**Type**: `string` (optional)

**Description**: GLSL uniform declarations.

**Example**:
```typescript
uniforms: `
    uniform vec3 u_camera_position;
    uniform float u_camera_fov;
    uniform mat4 u_camera_matrix;
`
```

**Naming Convention**:
- Prefix with `u_`
- Use snake_case
- Descriptive names

**Types**:
- Scalars: `float`, `int`, `bool`
- Vectors: `vec2`, `vec3`, `vec4`
- Matrices: `mat2`, `mat3`, `mat4`
- Samplers: `sampler2D`, `sampler3D`, `samplerCube`

#### functions

**Type**: `string` (required)

**Description**: GLSL function implementations.

**Example**:
```typescript
functions: `
    Ray camera_generateRay(vec2 uv, vec2 resolution) {
        // Implementation
    }

    vec3 helper_function(vec3 input) {
        // Helper function
    }
`
```

**Requirements**:
- Must include module's required function (based on `kind`)
- Use `kind_functionName` naming for required functions
- Helper functions can use any naming

---

## UniformBinding

Connects parameters to shader uniforms.

```typescript
interface UniformBinding {
    uniform: string;
    parameters: string[];
    type: UniformType;
    compute: (params: ParameterValues, context?: ComputeContext) => any;
}
```

See [Uniform Bindings Reference](uniform-bindings.md) for complete details.

### Quick Example

```typescript
uniformBindings: [
    {
        uniform: 'u_camera_fov',
        parameters: ['camera.fov'],
        type: 'float',
        compute: (params) => params['camera.fov'] * (Math.PI / 180)
    }
]
```

---

## ParameterMetadata

Describes a parameter's type, range, and behavior.

```typescript
interface ParameterMetadata {
    type: ParameterType;
    default: any;
    min?: number;
    max?: number;
    step?: number;
    label?: string;
    triggersReset?: boolean;
}
```

### Fields

#### type

**Type**: `ParameterType`

**Values**:
- `'float'` - Single number
- `'vec3'` - Three numbers (array)
- `'color'` - RGB color (array of 3)
- `'int'` - Integer
- `'bool'` - Boolean

**Example**:
```typescript
type: 'float'
```

#### default

**Type**: `any`

**Description**: Default parameter value.

**Examples**:
```typescript
// Float
default: 60

// Vec3
default: [0, 1, 5]

// Color
default: [1.0, 1.0, 1.0]

// Int
default: 4

// Bool
default: false
```

#### min / max

**Type**: `number` (optional)

**Description**: Range constraints for numeric types.

**Applicable to**: `float`, `int`

**Example**:
```typescript
type: 'float',
default: 0.5,
min: 0.0,
max: 1.0
```

#### step

**Type**: `number` (optional)

**Description**: Increment step for sliders/spinners.

**Applicable to**: `float`, `int`

**Example**:
```typescript
type: 'float',
default: 60,
min: 10,
max: 120,
step: 1  // Increment by 1
```

#### label

**Type**: `string` (optional)

**Description**: Human-readable label for UI.

**Example**:
```typescript
label: 'Field of View'
```

#### triggersReset

**Type**: `boolean` (optional, default: `true`)

**Description**: Whether changing this parameter resets accumulation.

**Examples**:
```typescript
// Reset for camera changes
'camera.position': {
    type: 'vec3',
    default: [0, 1, 5],
    triggersReset: true
}

// Don't reset for exposure
'developer.exposureEV': {
    type: 'float',
    default: 0,
    triggersReset: false
}
```

---

## Required Functions by Kind

Each module kind requires specific function signatures.

### ambient

```glsl
Point ambient_transform(vec3 position);
```

**Returns**: Transformed point in ambient space

### scene

```glsl
Hit scene_raymarch(Ray ray);
```

**Returns**: Ray-scene intersection

### environment

```glsl
vec3 environment_sample(vec3 direction);
```

**Returns**: RGB radiance from environment

### lighting

```glsl
LightSample lighting_sample(vec3 position, inout uint seed);
```

**Returns**: Light sample (position, intensity, direction)

### camera

```glsl
Ray camera_generateRay(vec2 uv, vec2 resolution);
```

**Returns**: Camera ray

### interaction

```glsl
Surface interaction_surface_shade(Point p, Ray ray, Hit hit);
```

**Returns**: Surface properties (albedo, emission, roughness)

### transport

```glsl
vec3 transport_trace(Ray ray);
```

**Returns**: RGB radiance

### accumulator

```glsl
vec3 accumulator_accumulate(vec3 newSample, vec3 accumulated, float sampleCount);
```

**Returns**: Updated accumulated value

### developer

```glsl
vec3 developer_tonemap(vec3 hdrColor);
```

**Returns**: Tone-mapped RGB (0-1 range)

---

## Complete Example

```typescript
export const pinholeCamera: ModuleDescriptor = {
    // Module identification
    id: {
        kind: 'camera',
        name: 'pinhole-camera',
        version: '1.0.0'
    },

    // Shader code
    fragment: {
        // Compile-time constants
        constants: `
            #define PI 3.14159265359
        `,

        // Uniform declarations
        uniforms: `
            uniform vec3 u_camera_position;
            uniform vec3 u_camera_target;
            uniform vec3 u_camera_up;
            uniform float u_camera_fov;
            uniform float u_camera_aspect;
        `,

        // GLSL functions
        functions: `
            // Required function for 'camera' modules
            Ray camera_generateRay(vec2 uv, vec2 resolution) {
                // Build camera coordinate system
                vec3 forward = normalize(u_camera_target - u_camera_position);
                vec3 right = normalize(cross(forward, u_camera_up));
                vec3 up = cross(right, forward);

                // Compute ray direction
                float halfHeight = tan(u_camera_fov / 2.0);
                float halfWidth = u_camera_aspect * halfHeight;

                vec3 horizontal = right * halfWidth * 2.0;
                vec3 vertical = up * halfHeight * 2.0;

                vec3 lowerLeft = forward - halfWidth * right - halfHeight * up;
                vec3 direction = normalize(lowerLeft + uv.x * horizontal + uv.y * vertical);

                Ray ray;
                ray.origin = u_camera_position;
                ray.direction = direction;

                return ray;
            }
        `
    },

    // Parameter → uniform bindings
    uniformBindings: [
        {
            uniform: 'u_camera_position',
            parameters: ['camera.position'],
            type: 'vec3',
            compute: (params) => params['camera.position']
        },
        {
            uniform: 'u_camera_target',
            parameters: ['camera.target'],
            type: 'vec3',
            compute: (params) => params['camera.target']
        },
        {
            uniform: 'u_camera_up',
            parameters: ['camera.up'],
            type: 'vec3',
            compute: (params) => params['camera.up']
        },
        {
            uniform: 'u_camera_fov',
            parameters: ['camera.fov'],
            type: 'float',
            compute: (params) => {
                // Convert degrees to radians
                return params['camera.fov'] * (Math.PI / 180);
            }
        },
        {
            uniform: 'u_camera_aspect',
            parameters: ['resolution.width', 'resolution.height'],
            type: 'float',
            compute: (params) => {
                return params['resolution.width'] / params['resolution.height'];
            }
        }
    ],

    // Parameter metadata
    parameters: {
        'camera.position': {
            type: 'vec3',
            default: [0, 1, 5],
            label: 'Camera Position',
            triggersReset: true
        },
        'camera.target': {
            type: 'vec3',
            default: [0, 0, 0],
            label: 'Camera Target',
            triggersReset: true
        },
        'camera.up': {
            type: 'vec3',
            default: [0, 1, 0],
            label: 'Camera Up Vector',
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

## Validation

Modules are validated on initialization:

### ID Validation

- `kind` must be a valid `ModuleKind`
- `name` must be non-empty string
- `version` should follow semver

### Fragment Validation

- `functions` is required
- Required function for `kind` must be present

### Uniform Validation

- All declared uniforms must have bindings
- Binding types must match uniform types
- Parameter paths in bindings must be valid

### Parameter Validation

- Default values must match parameter type
- Ranges must be valid (min < max)
- Steps must be positive

---

## Type Exports

```typescript
// Module descriptor
export interface ModuleDescriptor { /* ... */ }

// Module ID
export interface ModuleId { /* ... */ }
export type ModuleKind =
    | 'ambient'
    | 'scene'
    | 'environment'
    | 'lighting'
    | 'camera'
    | 'interaction'
    | 'transport'
    | 'accumulator'
    | 'developer';

// Fragment shader
export interface FragmentShaderSpec { /* ... */ }

// Uniform binding
export interface UniformBinding { /* ... */ }
export type UniformType =
    | 'float'
    | 'int'
    | 'bool'
    | 'vec2'
    | 'vec3'
    | 'vec4'
    | 'mat2'
    | 'mat3'
    | 'mat4'
    | 'sampler2D';

// Parameters
export interface ParameterMetadata { /* ... */ }
export type ParameterType =
    | 'float'
    | 'vec3'
    | 'color'
    | 'int'
    | 'bool';
```

---

## Best Practices

1. **Use semantic versioning** - Update version on changes
2. **Document functions** - Add comments explaining behavior
3. **Validate inputs** - Check ranges in compute functions
4. **Use constants** - For true compile-time values
5. **Group uniforms logically** - Related uniforms together
6. **Provide sensible defaults** - Match common usage
7. **Set triggersReset appropriately** - Only for geometric changes
8. **Test thoroughly** - Verify with different parameter values
9. **Follow naming conventions** - `kind_function`, `u_uniform`
10. **Keep functions focused** - Single responsibility

---

## Next Steps

- [Uniform Bindings Reference](uniform-bindings.md) - Detailed binding patterns
- [Recipe Format Reference](recipe-format.md) - Recipe composition
- [Writing Modules Guide](../guides/writing-modules.md) - Practical tutorial
- [Adding Parameters Guide](../guides/adding-parameters.md) - Parameter patterns
