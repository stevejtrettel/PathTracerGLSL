# Engine Core Concepts

Understanding the fundamental concepts of the engine layer.

## Modules

**Modules** are the basic building blocks of the rendering system. Each module is a self-contained GLSL code package with associated metadata.

### Module Structure

```typescript
interface ModuleDescriptor {
    id: {
        kind: ModuleKind;       // 'camera', 'interaction', 'transport', etc.
        name: string;           // 'pinhole-camera'
        version: string;        // '1.0.0'
    };

    fragment: {
        constants?: string;     // GLSL constants
        uniforms?: string;      // GLSL uniform declarations
        functions: string;      // GLSL function definitions
    };

    uniformBindings?: UniformBinding[];
    parameters?: Record<string, ParameterMetadata>;
}
```

### Module Kinds

There are 9 module kinds, each serving a specific purpose:

**World Modules** (define the scene):
- `ambient` - Mathematical space (Euclidean, hyperbolic, spherical)
- `environment` - Environment lighting (HDR maps, constant color)
- `scene` - Geometry (raymarching SDFs, mesh rendering)
- `lighting` - Light sources (point, area, quad lights)

**Optics Modules** (define rendering):
- `camera` - Ray generation (pinhole, thin lens, orthographic)
- `interaction` - Surface properties / BRDFs (Lambert, mirror, glass)
- `transport` - Light transport algorithm (path tracer, direct lighting, AO)
- `accumulator` - Sample accumulation strategy (averaging, oneshot)
- `developer` - Tone mapping / output (gamma, filmic, ACES)

### Module Compilation Order

Modules are concatenated in dependency order:

```typescript
const MODULE_ORDER = [
    'ambient',      // 1. Define space
    'scene',        // 2. Define geometry
    'environment',  // 3. Define environment
    'lighting',     // 4. Define lights
    'camera',       // 5. Generate rays
    'interaction',  // 6. Define materials
    'transport',    // 7. Trace rays
    'accumulator',  // 8. Accumulate samples
    'developer'     // 9. Tone map output
];
```

This order ensures dependencies are available when needed.

### Function Naming Convention

Functions use a naming convention to avoid collisions:

```
<moduleKind>_<functionName>
```

Examples:
- `camera_generateRay()`
- `scene_raymarch()`
- `interaction_surface_shade()`
- `transport_trace()`
- `accumulator_accumulate()`

This makes it clear which module provides each function.

---

## Recipes

**Recipes** compose modules into complete rendering pipelines.

### Recipe Structure

```typescript
interface Recipe {
    id: string;         // Unique identifier
    name: string;       // Display name

    world: {
        ambient: ModuleDescriptor;
        environment: ModuleDescriptor;
        scene: ModuleDescriptor;
        lighting: ModuleDescriptor;
    };

    optics: {
        camera: ModuleDescriptor;
        interaction: ModuleDescriptor;
        transport: ModuleDescriptor;
        accumulator: ModuleDescriptor;
        developer: ModuleDescriptor;
    };

    parameters?: Record<string, any>;
    config?: {
        targetSamples?: number;
        renderMode?: 'interactive' | 'progressive' | 'production';
    };
}
```

### Recipe Validation

Before compilation, recipes are validated:

1. **Structural validation** - Each slot contains correct module kind
   ```
   ✗ optics.transport = pinhole-camera  // Wrong! Needs 'transport' module
   ✓ optics.transport = pathTracerDirect  // Correct
   ```

2. **Uniform validation** - uniformBindings reference declared uniforms
   ```glsl
   uniform vec3 u_light_position;  // Declared

   uniformBindings: [{
       uniform: 'u_lite_position',  // ✗ Typo!
       // ...
   }]
   ```

### Multi-Recipe Support

The engine supports multiple recipes simultaneously:

```typescript
const recipes = [
    pathTracerRecipe,   // Full global illumination
    albedoRecipe,       // Debug: view albedo only
    normalsRecipe       // Debug: view normals only
];

engine.initialize(recipes);
```

Each recipe has:
- Its own shader programs
- Its own accumulation buffers
- Its own sample count

Shared resources:
- Environment maps
- Composite program

Switch recipes instantly:
```typescript
engine.selectRecipe('albedo');  // No recompilation!
```

---

## Shader Programs

The engine creates three shader programs per recipe.

### 1. Main Program

**Purpose**: Path tracing and accumulation

**Vertex Shader**: Simple fullscreen quad

**Fragment Shader**: Concatenated modules
```glsl
// ===== Constants =====
// (from all modules)

// ===== Uniforms =====
// Engine uniforms
uniform vec2 u_resolution;
uniform int u_frameIndex;
// ... etc

// Module uniforms
// (from all modules)

// ===== Functions =====
// ============ ambient (ambient) ============
// ambient module functions...

// ============ scene (scene) ============
// scene module functions...

// ... (all modules in order)

// ===== Main =====
void main() {
    vec2 uv = gl_FragCoord.xy / u_resolution;

    // Generate ray
    Ray ray = camera_generateRay(uv);

    // Trace scene
    vec3 radiance = transport_trace(ray);

    // Accumulate
    vec4 prev = texture(u_accumulator_radiance_previous, uv);
    vec4 result = accumulator_accumulate(radiance, prev, u_sampleCount);

    gl_FragColor = result;
}
```

### 2. Display Program

**Purpose**: Tone mapping (HDR → LDR)

**Fragment Shader**: Only developer module
```glsl
uniform sampler2D u_radiance_texture;

// developer module uniforms and functions

void main() {
    vec2 uv = gl_FragCoord.xy / u_resolution;
    vec3 hdr = texture(u_radiance_texture, uv).rgb;
    vec3 ldr = developer_tonemap(hdr);
    gl_FragColor = vec4(ldr, 1.0);
}
```

### 3. Composite Program

**Purpose**: Final output to screen (shared across recipes)

Simple passthrough with optional post-effects.

---

## Module Boundaries

The shader compiler injects boundary comments:

```glsl
// ============ camera (camera) ============
uniform vec3 u_camera_position;
uniform float u_camera_fov;

Ray camera_generateRay(vec2 uv) {
    // ...
}

// ============ interaction (interaction) ============
uniform vec3 u_albedo;

Surface interaction_surface_shade(Point p, Ray ray, Hit hit) {
    // ...
}
```

These comments enable:
- Error translation (map line numbers to modules)
- Debugging (see which module provides what)
- Source introspection

---

## Types and Interfaces

Modules define common GLSL types for interoperability:

```glsl
// Common types (defined in modules)
struct Point { vec3 position; };
struct Ray { vec3 origin; vec3 direction; float tmin; float tmax; };
struct Hit { float t; vec3 normal; int materialId; };
struct Surface { vec3 albedo; vec3 emission; float roughness; };
struct LightSample { vec3 wi; vec3 radiance; float distance; vec3 position; };
```

Each module kind exports specific functions with specific signatures:

**camera** must provide:
```glsl
Ray camera_generateRay(vec2 uv);
```

**scene** must provide:
```glsl
Hit scene_raymarch(Ray ray);
Point scene_pointAt(vec3 position);
```

**interaction** must provide:
```glsl
Surface interaction_surface_shade(Point p, Ray ray, Hit hit);
```

**transport** must provide:
```glsl
vec3 transport_trace(Ray ray);
```

**accumulator** must provide:
```glsl
vec4 accumulator_accumulate(vec3 radiance, vec4 previous, int sampleCount);
```

**developer** must provide:
```glsl
vec3 developer_tonemap(vec3 hdr);
```

This contract ensures modules can be swapped freely.

---

## Uniform Bindings

Uniform bindings connect parameters to shader uniforms.

### Basic Binding

```typescript
uniformBindings: [{
    uniform: 'u_camera_fov',        // Shader uniform name
    parameters: ['camera.fov'],      // Parameter path(s)
    type: 'float',                   // Uniform type
    compute: (params) => {
        // Transform degrees → radians
        return params['camera.fov'] * (Math.PI / 180);
    }
}]
```

### Multi-Parameter Binding

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

### Supported Types

```typescript
type UniformType =
    | 'float' | 'int' | 'bool'
    | 'vec2' | 'vec3' | 'vec4'
    | 'mat3' | 'mat4'
    | 'sampler2D' | 'samplerCube';
```

---

## Parameter Metadata

Modules can define parameter metadata for UI generation:

```typescript
parameters: {
    'camera.fov': {
        type: 'float',
        default: 60,
        range: [10, 120],
        step: 1,
        name: 'Field of View',
        unit: '°',
        group: 'Camera',
        help: 'Vertical field of view in degrees',
        triggersReset: true  // Clears accumulation when changed
    }
}
```

The App layer uses this to generate UI controls.

---

## Compilation Result

`ShaderCompiler.compile()` returns a discriminated union:

```typescript
type CompilationResult =
    | {
        success: true;
        mainProgram: WebGLProgram;
        displayProgram: WebGLProgram;
        compositeProgram: WebGLProgram;
    }
    | {
        success: false;
        diagnostics: ShaderDiagnostics;
    };
```

On failure, diagnostics include:
- Translated errors with module context
- "Did you mean?" suggestions
- Source code snippets
- Line numbers within modules

---

## Module Example: Pinhole Camera

```typescript
export const pinholeCamera: ModuleDescriptor = {
    id: {
        kind: 'camera',
        name: 'pinhole-camera',
        version: '1.0.0'
    },

    fragment: {
        uniforms: `
            uniform vec3 u_camera_position;
            uniform vec3 u_camera_target;
            uniform float u_camera_fov;
            uniform vec2 u_resolution;
        `,

        functions: `
            Ray camera_generateRay(vec2 uv) {
                // NDC coordinates
                vec2 ndc = (uv * 2.0) - 1.0;
                float aspect = u_resolution.x / u_resolution.y;

                // Compute camera basis
                vec3 forward = normalize(u_camera_target - u_camera_position);
                vec3 right = normalize(cross(forward, vec3(0, 1, 0)));
                vec3 up = cross(right, forward);

                // Ray direction
                float fovRad = u_camera_fov;
                float halfHeight = tan(fovRad / 2.0);
                float halfWidth = aspect * halfHeight;

                vec3 direction = normalize(
                    forward +
                    right * ndc.x * halfWidth +
                    up * ndc.y * halfHeight
                );

                Ray ray;
                ray.origin = u_camera_position;
                ray.direction = direction;
                ray.tmin = 0.001;
                ray.tmax = 1000.0;
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
            uniform: 'u_camera_target',
            parameters: ['camera.target'],
            type: 'vec3',
            compute: (params) => params['camera.target']
        },
        {
            uniform: 'u_camera_fov',
            parameters: ['camera.fov'],
            type: 'float',
            compute: (params) => params['camera.fov'] * (Math.PI / 180)
        }
    ],

    parameters: {
        'camera.position': {
            type: 'vec3',
            default: [0, 1, 5],
            name: 'Position',
            group: 'Camera',
            triggersReset: true
        },
        'camera.target': {
            type: 'vec3',
            default: [0, 0, 0],
            name: 'Target',
            group: 'Camera',
            triggersReset: true
        },
        'camera.fov': {
            type: 'float',
            default: 60,
            range: [10, 120],
            step: 1,
            name: 'Field of View',
            unit: '°',
            group: 'Camera',
            triggersReset: true
        }
    }
};
```

---

## Next Steps

- [Rendering Pipeline](rendering-pipeline.md) - Detailed pass documentation
- [Resource Management](resource-management.md) - Buffers and textures
- [API Reference](api-reference.md) - Method signatures
- [Writing Modules Guide](../guides/writing-modules.md) - Create your own modules
