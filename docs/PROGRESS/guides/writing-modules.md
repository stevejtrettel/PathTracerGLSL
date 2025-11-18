# Writing Custom Modules

A complete guide to creating your own modules for PathTracerGLSL.

## Overview

**Modules** are the fundamental building blocks of PathTracerGLSL. Each module provides:
- GLSL shader code (constants, uniforms, functions)
- Parameter metadata (types, ranges, defaults)
- Uniform bindings (connecting parameters to shader uniforms)

This guide walks through creating a custom module from scratch.

---

## Module Anatomy

Every module follows this structure:

```typescript
export const myModule: ModuleDescriptor = {
    // Module identification
    id: {
        kind: 'interaction',     // Module slot
        name: 'my-module',       // Unique name
        version: '1.0.0'         // Semantic version
    },

    // GLSL shader code
    fragment: {
        constants: '...',        // Optional: compile-time constants
        uniforms: '...',         // Optional: uniform declarations
        functions: '...'         // Required: GLSL functions
    },

    // Parameter → uniform connections
    uniformBindings: [...],     // Optional: bindings array

    // Parameter metadata
    parameters: {...}           // Optional: parameter definitions
};
```

---

## Step 1: Choose a Module Kind

Modules fit into specific **slots** in a recipe. Choose the appropriate kind:

### World Modules

- **`ambient`** - Mathematical space (Euclidean, hyperbolic, spherical)
  - Required function: `ambient_transform()`
- **`scene`** - Scene geometry (SDFs, meshes)
  - Required function: `scene_raymarch()`
- **`environment`** - Environment lighting (HDRI, constant, gradient)
  - Required function: `environment_sample()`
- **`lighting`** - Light sources (quad lights, point lights, area lights)
  - Required function: `lighting_sample()`

### Optics Modules

- **`camera`** - Ray generation (pinhole, thin lens, orthographic)
  - Required function: `camera_generateRay()`
- **`interaction`** - Surface shading (BRDFs, materials)
  - Required function: `interaction_surface_shade()`
- **`transport`** - Light transport (path tracing, direct lighting, AO)
  - Required function: `transport_trace()`
- **`accumulator`** - Sample accumulation (averaging, denoising)
  - Required function: `accumulator_accumulate()`
- **`developer`** - Tone mapping (gamma, filmic, ACES)
  - Required function: `developer_tonemap()`

---

## Step 2: Implement Required Functions

Each module kind requires specific functions with specific signatures.

### Example: Simple Diffuse BRDF (interaction)

```typescript
export const simpleDiffuse: ModuleDescriptor = {
    id: {
        kind: 'interaction',
        name: 'simple-diffuse',
        version: '1.0.0'
    },

    fragment: {
        functions: `
            // Required function for 'interaction' modules
            Surface interaction_surface_shade(Point p, Ray ray, Hit hit) {
                Surface surf;

                // Simple white diffuse material
                surf.albedo = vec3(0.8);
                surf.emission = vec3(0.0);
                surf.roughness = 1.0;

                return surf;
            }
        `
    }
};
```

**Key Points**:
- Function name MUST be `interaction_surface_shade` for interaction modules
- Signature MUST match: `Surface interaction_surface_shade(Point p, Ray ray, Hit hit)`
- Return type MUST be `Surface`

---

## Step 3: Add Uniforms

Uniforms make your module configurable at runtime.

```typescript
export const coloredDiffuse: ModuleDescriptor = {
    id: {
        kind: 'interaction',
        name: 'colored-diffuse',
        version: '1.0.0'
    },

    fragment: {
        // Declare uniforms
        uniforms: `
            uniform vec3 u_material_albedo;
            uniform float u_material_roughness;
        `,

        functions: `
            Surface interaction_surface_shade(Point p, Ray ray, Hit hit) {
                Surface surf;

                // Use uniforms instead of hardcoded values
                surf.albedo = u_material_albedo;
                surf.emission = vec3(0.0);
                surf.roughness = u_material_roughness;

                return surf;
            }
        `
    }
};
```

**Naming Convention**:
- Prefix with `u_` (uniform)
- Follow with module kind or semantic name
- Use underscores: `u_material_albedo`

---

## Step 4: Bind Parameters to Uniforms

Connect application parameters to shader uniforms:

```typescript
export const coloredDiffuse: ModuleDescriptor = {
    id: {
        kind: 'interaction',
        name: 'colored-diffuse',
        version: '1.0.0'
    },

    fragment: {
        uniforms: `
            uniform vec3 u_material_albedo;
            uniform float u_material_roughness;
        `,
        functions: `
            Surface interaction_surface_shade(Point p, Ray ray, Hit hit) {
                Surface surf;
                surf.albedo = u_material_albedo;
                surf.emission = vec3(0.0);
                surf.roughness = u_material_roughness;
                return surf;
            }
        `
    },

    // Connect parameters to uniforms
    uniformBindings: [
        {
            uniform: 'u_material_albedo',
            parameters: ['material.albedo'],
            type: 'vec3',
            compute: (params) => params['material.albedo']
        },
        {
            uniform: 'u_material_roughness',
            parameters: ['material.roughness'],
            type: 'float',
            compute: (params) => params['material.roughness']
        }
    ]
};
```

**Binding Structure**:
- `uniform`: Name of shader uniform (must match declaration)
- `parameters`: Array of parameter paths this binding depends on
- `type`: GLSL type (`float`, `vec3`, `mat4`, etc.)
- `compute`: Function to compute uniform value from parameters

---

## Step 5: Add Parameter Metadata

Define parameters with defaults, ranges, and types:

```typescript
export const coloredDiffuse: ModuleDescriptor = {
    id: {
        kind: 'interaction',
        name: 'colored-diffuse',
        version: '1.0.0'
    },

    fragment: {
        uniforms: `
            uniform vec3 u_material_albedo;
            uniform float u_material_roughness;
        `,
        functions: `
            Surface interaction_surface_shade(Point p, Ray ray, Hit hit) {
                Surface surf;
                surf.albedo = u_material_albedo;
                surf.emission = vec3(0.0);
                surf.roughness = u_material_roughness;
                return surf;
            }
        `
    },

    uniformBindings: [
        {
            uniform: 'u_material_albedo',
            parameters: ['material.albedo'],
            type: 'vec3',
            compute: (params) => params['material.albedo']
        },
        {
            uniform: 'u_material_roughness',
            parameters: ['material.roughness'],
            type: 'float',
            compute: (params) => params['material.roughness']
        }
    ],

    // Parameter metadata
    parameters: {
        'material.albedo': {
            type: 'color',
            default: [0.8, 0.8, 0.8],
            label: 'Material Color'
        },
        'material.roughness': {
            type: 'float',
            default: 0.5,
            min: 0.0,
            max: 1.0,
            step: 0.01,
            label: 'Roughness'
        }
    }
};
```

**Parameter Types**:
- `float` - Single number with min/max/step
- `vec3` - Three numbers (position, direction)
- `color` - RGB color (0-1 range)
- `int` - Integer value
- `bool` - True/false

---

## Step 6: Advanced Features

### Constants

Use constants for compile-time values:

```typescript
fragment: {
    constants: `
        #define MAX_BOUNCES 4
        #define USE_BLUE_NOISE true
    `,
    uniforms: `...`,
    functions: `...`
}
```

### Multiple Parameters per Uniform

Compute uniforms from multiple parameters:

```typescript
uniformBindings: [
    {
        uniform: 'u_camera_matrix',
        parameters: ['camera.position', 'camera.target', 'camera.up'],
        type: 'mat4',
        compute: (params) => {
            const pos = params['camera.position'];
            const target = params['camera.target'];
            const up = params['camera.up'];
            return buildViewMatrix(pos, target, up);
        }
    }
]
```

### Unit Conversions

Convert parameter units to shader units:

```typescript
uniformBindings: [
    {
        uniform: 'u_camera_fov',
        parameters: ['camera.fov'],
        type: 'float',
        compute: (params) => {
            // Convert degrees to radians
            return params['camera.fov'] * (Math.PI / 180);
        }
    }
]
```

### Dependent Parameters

Derive values from other parameters:

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

### Trigger Accumulation Reset

Mark parameters that should reset accumulation when changed:

```typescript
parameters: {
    'camera.position': {
        type: 'vec3',
        default: [0, 0, 5],
        triggersReset: true  // Reset when camera moves
    },
    'developer.exposure': {
        type: 'float',
        default: 0,
        triggersReset: false  // Don't reset for exposure changes
    }
}
```

---

## Complete Example: Emissive Material

Here's a complete module with emission:

```typescript
export const emissiveMaterial: ModuleDescriptor = {
    id: {
        kind: 'interaction',
        name: 'emissive-material',
        version: '1.0.0'
    },

    fragment: {
        uniforms: `
            uniform vec3 u_material_albedo;
            uniform vec3 u_material_emission;
            uniform float u_material_emission_strength;
        `,

        functions: `
            Surface interaction_surface_shade(Point p, Ray ray, Hit hit) {
                Surface surf;
                surf.albedo = u_material_albedo;
                surf.emission = u_material_emission * u_material_emission_strength;
                surf.roughness = 1.0;
                return surf;
            }
        `
    },

    uniformBindings: [
        {
            uniform: 'u_material_albedo',
            parameters: ['material.albedo'],
            type: 'vec3',
            compute: (params) => params['material.albedo']
        },
        {
            uniform: 'u_material_emission',
            parameters: ['material.emissionColor'],
            type: 'vec3',
            compute: (params) => params['material.emissionColor']
        },
        {
            uniform: 'u_material_emission_strength',
            parameters: ['material.emissionStrength'],
            type: 'float',
            compute: (params) => params['material.emissionStrength']
        }
    ],

    parameters: {
        'material.albedo': {
            type: 'color',
            default: [0.8, 0.8, 0.8],
            label: 'Base Color'
        },
        'material.emissionColor': {
            type: 'color',
            default: [1.0, 1.0, 1.0],
            label: 'Emission Color'
        },
        'material.emissionStrength': {
            type: 'float',
            default: 0.0,
            min: 0.0,
            max: 100.0,
            step: 0.1,
            label: 'Emission Strength'
        }
    }
};
```

---

## Testing Your Module

### 1. Create a Test Recipe

```typescript
import { emissiveMaterial } from './my-modules/emissive-material';

const testRecipe: Recipe = {
    id: 'test-emissive',
    name: 'Test Emissive Material',

    world: {
        ambient: euclideanAmbient,
        environment: constEnvironment,
        scene: raymarchScene,
        lighting: quadLight
    },

    optics: {
        camera: pinholeCamera,
        interaction: emissiveMaterial,  // Your module!
        transport: pathTracerDirect,
        accumulator: averageAccumulator,
        developer: gammaDeveloper
    }
};
```

### 2. Initialize and Test

```typescript
const app = new App(canvas);
await app.initialize([testRecipe]);
app.start();

// Test parameter updates
app.setParameter('material.emissionStrength', 10.0);
```

### 3. Check for Errors

Watch the console for:
- **Recipe validation errors** - Incorrect structure
- **Uniform validation errors** - Missing bindings
- **Shader compilation errors** - GLSL syntax errors

---

## Common Patterns

### Pattern: Texture Sampling

```typescript
fragment: {
    uniforms: `
        uniform sampler2D u_diffuse_texture;
    `,
    functions: `
        Surface interaction_surface_shade(Point p, Ray ray, Hit hit) {
            // Compute UV coordinates
            vec2 uv = computeUV(hit.position);

            // Sample texture
            vec3 albedo = texture(u_diffuse_texture, uv).rgb;

            Surface surf;
            surf.albedo = albedo;
            surf.emission = vec3(0.0);
            surf.roughness = 1.0;
            return surf;
        }
    `
}
```

### Pattern: Normal Mapping

```typescript
fragment: {
    uniforms: `
        uniform sampler2D u_normal_map;
        uniform float u_normal_strength;
    `,
    functions: `
        Surface interaction_surface_shade(Point p, Ray ray, Hit hit) {
            vec2 uv = computeUV(hit.position);

            // Sample normal map
            vec3 normalMap = texture(u_normal_map, uv).rgb * 2.0 - 1.0;
            normalMap.xy *= u_normal_strength;

            // Perturb surface normal
            vec3 normal = perturbNormal(hit.normal, normalMap);

            Surface surf;
            surf.albedo = vec3(0.8);
            surf.emission = vec3(0.0);
            surf.normal = normal;  // Use perturbed normal
            surf.roughness = 1.0;
            return surf;
        }
    `
}
```

### Pattern: Procedural Texture

```typescript
fragment: {
    uniforms: `
        uniform float u_checker_scale;
    `,
    functions: `
        Surface interaction_surface_shade(Point p, Ray ray, Hit hit) {
            // Procedural checkerboard
            vec3 pos = hit.position * u_checker_scale;
            float checker = mod(floor(pos.x) + floor(pos.y) + floor(pos.z), 2.0);
            vec3 albedo = mix(vec3(0.2), vec3(0.8), checker);

            Surface surf;
            surf.albedo = albedo;
            surf.emission = vec3(0.0);
            surf.roughness = 1.0;
            return surf;
        }
    `
}
```

---

## Function Signatures Reference

### Camera Modules

```glsl
Ray camera_generateRay(vec2 uv, vec2 resolution);
```

**Parameters**:
- `uv` - Normalized coordinates (0-1)
- `resolution` - Canvas resolution

**Returns**: `Ray` with origin and direction

### Scene Modules

```glsl
Hit scene_raymarch(Ray ray);
```

**Parameters**:
- `ray` - Ray to march

**Returns**: `Hit` with distance, position, normal

### Interaction Modules

```glsl
Surface interaction_surface_shade(Point p, Ray ray, Hit hit);
```

**Parameters**:
- `p` - Point in space (ambient-transformed)
- `ray` - Incoming ray
- `hit` - Ray hit information

**Returns**: `Surface` with albedo, emission, roughness

### Transport Modules

```glsl
vec3 transport_trace(Ray ray);
```

**Parameters**:
- `ray` - Camera ray

**Returns**: RGB radiance

### Environment Modules

```glsl
vec3 environment_sample(vec3 direction);
```

**Parameters**:
- `direction` - Direction to sample

**Returns**: RGB radiance from environment

### Lighting Modules

```glsl
LightSample lighting_sample(vec3 position, inout uint seed);
```

**Parameters**:
- `position` - Surface position
- `seed` - Random seed (modified in-place)

**Returns**: `LightSample` with position, intensity, direction

### Accumulator Modules

```glsl
vec3 accumulator_accumulate(vec3 newSample, vec3 accumulated, float sampleCount);
```

**Parameters**:
- `newSample` - Current frame's sample
- `accumulated` - Previous accumulation
- `sampleCount` - Number of samples so far

**Returns**: Updated accumulated value

### Developer Modules

```glsl
vec3 developer_tonemap(vec3 hdrColor);
```

**Parameters**:
- `hdrColor` - High dynamic range color

**Returns**: Tone-mapped RGB (0-1 range)

---

## Best Practices

1. **Follow naming conventions** - Use `kind_function` pattern
2. **Validate parameters** - Check ranges, clamp values
3. **Document uniforms** - Add comments explaining each uniform
4. **Test thoroughly** - Verify with different parameter values
5. **Use constants** - For compile-time configuration
6. **Keep functions focused** - One responsibility per function
7. **Handle edge cases** - Zero divisions, NaN, infinity
8. **Optimize carefully** - Profile before optimizing
9. **Version semantically** - Use semver (major.minor.patch)
10. **Write examples** - Document usage in recipes

---

## Next Steps

- [Creating Recipes](creating-recipes.md) - Compose modules into pipelines
- [Adding Parameters](adding-parameters.md) - Advanced parameter patterns
- [Module Reference](../reference/module-descriptor.md) - Complete type definitions
- [Uniform Bindings Reference](../reference/uniform-bindings.md) - Binding patterns
