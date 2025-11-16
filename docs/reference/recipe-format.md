# Recipe Format Reference

Complete type reference for recipe definitions.

## Overview

`Recipe` defines a complete rendering pipeline by selecting one module for each slot.

---

## Type Definition

```typescript
interface Recipe {
    id: string;
    name: string;
    world: WorldModules;
    optics: OpticsModules;
    parameters?: Record<string, any>;
    config?: RecipeConfig;
}
```

---

## Fields

### id

**Type**: `string`

**Description**: Unique identifier for the recipe.

**Constraints**:
- Must be unique across all recipes in an app
- Use kebab-case
- Descriptive of rendering configuration

**Examples**:
```typescript
id: 'pathtracer-studio'
id: 'direct-lighting-outdoor'
id: 'ambient-occlusion'
```

### name

**Type**: `string`

**Description**: Human-readable display name.

**Examples**:
```typescript
name: 'Path Tracer (Studio)'
name: 'Direct Lighting (Outdoor)'
name: 'Ambient Occlusion'
```

### world

**Type**: `WorldModules`

**Description**: World-space modules (geometry, lighting, environment).

```typescript
interface WorldModules {
    ambient: ModuleDescriptor;      // Mathematical space
    environment: ModuleDescriptor;  // Environment lighting
    scene: ModuleDescriptor;        // Scene geometry
    lighting: ModuleDescriptor;     // Light sources
}
```

**Example**:
```typescript
world: {
    ambient: euclideanAmbient,
    environment: hdriEnvironmentImportance,
    scene: raymarchScene,
    lighting: quadLight
}
```

### optics

**Type**: `OpticsModules`

**Description**: Optical pipeline modules (camera, shading, transport).

```typescript
interface OpticsModules {
    camera: ModuleDescriptor;       // Ray generation
    interaction: ModuleDescriptor;  // Surface shading (BRDF)
    transport: ModuleDescriptor;    // Light transport algorithm
    accumulator: ModuleDescriptor;  // Sample accumulation
    developer: ModuleDescriptor;    // Tone mapping
}
```

**Example**:
```typescript
optics: {
    camera: pinholeCamera,
    interaction: lambertInteraction,
    transport: pathTracerDirect,
    accumulator: averageAccumulator,
    developer: gammaDeveloper
}
```

### parameters

**Type**: `Record<string, any>` (optional)

**Description**: Initial parameter values for the recipe.

**Example**:
```typescript
parameters: {
    // Camera
    'camera.fov': 60,
    'camera.position': [3, 2, 5],
    'camera.target': [0, 0, 0],

    // Lighting
    'quad.intensity': 50.0,
    'quad.position': [0, 3, 0],

    // Material
    'material.roughness': 0.5,

    // Tone mapping
    'developer.exposureEV': 0,
    'developer.gamma': 2.2
}
```

**Rules**:
- Keys are parameter paths (dot notation)
- Values must match parameter types defined in modules
- Unspecified parameters use module defaults
- Invalid paths are ignored with warnings

### config

**Type**: `RecipeConfig` (optional)

**Description**: Rendering configuration.

```typescript
interface RecipeConfig {
    targetSamples?: number;
    renderMode?: string;
}
```

**Example**:
```typescript
config: {
    targetSamples: 1000,     // Stop after 1000 samples
    renderMode: 'accumulate' // Accumulation mode
}
```

---

## WorldModules

World-space module configuration.

```typescript
interface WorldModules {
    ambient: ModuleDescriptor;
    environment: ModuleDescriptor;
    scene: ModuleDescriptor;
    lighting: ModuleDescriptor;
}
```

### ambient

**Kind**: `'ambient'`

**Purpose**: Define mathematical space and coordinate transformations.

**Required Function**: `Point ambient_transform(vec3 position)`

**Available Modules**:
- `euclideanAmbient` - Flat Euclidean space (standard)
- `hyperbolicAmbient` - Hyperbolic geometry (Poincaré model)
- `sphericalAmbient` - Spherical geometry

**Example**:
```typescript
ambient: euclideanAmbient
```

### environment

**Kind**: `'environment'`

**Purpose**: Sample environment lighting (skybox, HDRI).

**Required Function**: `vec3 environment_sample(vec3 direction)`

**Available Modules**:
- `constEnvironment` - Constant color
- `skyEnvironment` - Procedural sky
- `hdriEnvironment` - HDR image (uniform sampling)
- `hdriEnvironmentImportance` - HDR image (importance sampling)

**Example**:
```typescript
environment: hdriEnvironmentImportance
```

### scene

**Kind**: `'scene'`

**Purpose**: Define scene geometry.

**Required Function**: `Hit scene_raymarch(Ray ray)`

**Available Modules**:
- `raymarchScene` - SDF-based raymarching
- `emptyScene` - No geometry
- Custom scene modules

**Example**:
```typescript
scene: raymarchScene
```

### lighting

**Kind**: `'lighting'`

**Purpose**: Sample light sources.

**Required Function**: `LightSample lighting_sample(vec3 position, inout uint seed)`

**Available Modules**:
- `noLight` - No explicit lights
- `quadLight` - Rectangular area light
- `pointLight` - Point light source
- `threePointLighting` - Multi-light setup

**Example**:
```typescript
lighting: quadLight
```

---

## OpticsModules

Optical pipeline configuration.

```typescript
interface OpticsModules {
    camera: ModuleDescriptor;
    interaction: ModuleDescriptor;
    transport: ModuleDescriptor;
    accumulator: ModuleDescriptor;
    developer: ModuleDescriptor;
}
```

### camera

**Kind**: `'camera'`

**Purpose**: Generate camera rays.

**Required Function**: `Ray camera_generateRay(vec2 uv, vec2 resolution)`

**Available Modules**:
- `pinholeCamera` - Standard perspective
- `thinLensCamera` - Depth of field
- `orthographicCamera` - Orthographic projection

**Example**:
```typescript
camera: pinholeCamera
```

### interaction

**Kind**: `'interaction'`

**Purpose**: Compute surface shading (BRDF).

**Required Function**: `Surface interaction_surface_shade(Point p, Ray ray, Hit hit)`

**Available Modules**:
- `lambertInteraction` - Lambertian diffuse
- `mirrorInteraction` - Perfect mirror
- `glassInteraction` - Dielectric (glass)
- `pbrInteraction` - Physically-based (GGX)

**Example**:
```typescript
interaction: lambertInteraction
```

### transport

**Kind**: `'transport'`

**Purpose**: Integrate light transport equation.

**Required Function**: `vec3 transport_trace(Ray ray)`

**Available Modules**:
- `directLightOnly` - Direct lighting only (fast)
- `pathTracerDirect` - Path tracing with direct light sampling
- `pathTracerNEE` - Path tracing with NEE
- `ambientOcclusion` - Ambient occlusion

**Example**:
```typescript
transport: pathTracerDirect
```

### accumulator

**Kind**: `'accumulator'`

**Purpose**: Accumulate samples over time.

**Required Function**: `vec3 accumulator_accumulate(vec3 newSample, vec3 accumulated, float sampleCount)`

**Available Modules**:
- `averageAccumulator` - Simple averaging
- `exponentialAccumulator` - Exponential moving average

**Example**:
```typescript
accumulator: averageAccumulator
```

### developer

**Kind**: `'developer'`

**Purpose**: Tone map HDR to display.

**Required Function**: `vec3 developer_tonemap(vec3 hdrColor)`

**Available Modules**:
- `gammaDeveloper` - Simple gamma correction
- `reinhardDeveloper` - Reinhard tone mapping
- `acesDeveloper` - ACES filmic
- `exposureDeveloper` - Exposure + gamma

**Example**:
```typescript
developer: gammaDeveloper
```

---

## RecipeConfig

Optional rendering configuration.

```typescript
interface RecipeConfig {
    targetSamples?: number;
    renderMode?: string;
}
```

### targetSamples

**Type**: `number` (optional, default: `Infinity`)

**Description**: Number of samples before pausing accumulation.

**Use Cases**:
- Production rendering (fixed sample count)
- Convergence testing
- Automatic stopping

**Examples**:
```typescript
config: {
    targetSamples: 1000  // Stop after 1000 samples
}

config: {
    targetSamples: Infinity  // Never stop (default)
}
```

### renderMode

**Type**: `string` (optional, default: `'accumulate'`)

**Description**: Rendering mode (future extension point).

**Values**:
- `'accumulate'` - Progressive accumulation (default)
- `'realtime'` - Real-time mode (future)

**Example**:
```typescript
config: {
    renderMode: 'accumulate'
}
```

---

## Complete Examples

### Basic Path Tracer

```typescript
const basicPathTracer: Recipe = {
    id: 'basic-pathtracer',
    name: 'Basic Path Tracer',

    world: {
        ambient: euclideanAmbient,
        environment: constEnvironment,
        scene: raymarchScene,
        lighting: quadLight
    },

    optics: {
        camera: pinholeCamera,
        interaction: lambertInteraction,
        transport: pathTracerDirect,
        accumulator: averageAccumulator,
        developer: gammaDeveloper
    }
};
```

### HDRI Production Render

```typescript
const productionRender: Recipe = {
    id: 'production-hdri',
    name: 'Production HDRI Render',

    world: {
        ambient: euclideanAmbient,
        environment: hdriEnvironmentImportance,
        scene: raymarchScene,
        lighting: noLight  // Environment provides lighting
    },

    optics: {
        camera: pinholeCamera,
        interaction: pbrInteraction,
        transport: pathTracerDirect,
        accumulator: averageAccumulator,
        developer: acesDeveloper
    },

    parameters: {
        // Camera
        'camera.position': [0, 1, 3],
        'camera.target': [0, 0, 0],
        'camera.fov': 60,

        // Environment
        'hdri.path': './hdri/studio.hdr',
        'hdri.intensity': 1.0,
        'hdri.rotation': 0,

        // Material
        'material.roughness': 0.3,
        'material.metallic': 0.0,

        // Tone mapping
        'developer.exposureEV': 0
    },

    config: {
        targetSamples: 2000
    }
};
```

### Direct Lighting Preview

```typescript
const preview: Recipe = {
    id: 'direct-preview',
    name: 'Direct Lighting Preview',

    world: {
        ambient: euclideanAmbient,
        environment: constEnvironment,
        scene: raymarchScene,
        lighting: quadLight
    },

    optics: {
        camera: pinholeCamera,
        interaction: lambertInteraction,
        transport: directLightOnly,  // Fast
        accumulator: averageAccumulator,
        developer: gammaDeveloper
    },

    parameters: {
        'quad.intensity': 30.0,
        'quad.position': [0, 2, 0]
    },

    config: {
        targetSamples: 100  // Lower for preview
    }
};
```

### Ambient Occlusion

```typescript
const ambientOcclusion: Recipe = {
    id: 'ambient-occlusion',
    name: 'Ambient Occlusion',

    world: {
        ambient: euclideanAmbient,
        environment: constEnvironment,
        scene: raymarchScene,
        lighting: noLight
    },

    optics: {
        camera: pinholeCamera,
        interaction: aoInteraction,
        transport: ambientOcclusionTransport,
        accumulator: averageAccumulator,
        developer: gammaDeveloper
    },

    parameters: {
        'ao.radius': 0.5,
        'ao.samples': 16,
        'ao.falloff': 1.0
    },

    config: {
        targetSamples: 500
    }
};
```

### Material Comparison

```typescript
// Base configuration
const baseConfig = {
    world: {
        ambient: euclideanAmbient,
        environment: hdriEnvironmentImportance,
        scene: sphereScene,
        lighting: noLight
    },
    optics: {
        camera: pinholeCamera,
        transport: pathTracerDirect,
        accumulator: averageAccumulator,
        developer: gammaDeveloper
    },
    parameters: {
        'camera.position': [0, 0, 3],
        'camera.target': [0, 0, 0],
        'hdri.path': './hdri/studio.hdr'
    }
};

// Lambert
const lambertRecipe: Recipe = {
    ...baseConfig,
    id: 'material-lambert',
    name: 'Lambert',
    optics: {
        ...baseConfig.optics,
        interaction: lambertInteraction
    }
};

// Mirror
const mirrorRecipe: Recipe = {
    ...baseConfig,
    id: 'material-mirror',
    name: 'Mirror',
    optics: {
        ...baseConfig.optics,
        interaction: mirrorInteraction
    }
};

// Glass
const glassRecipe: Recipe = {
    ...baseConfig,
    id: 'material-glass',
    name: 'Glass',
    optics: {
        ...baseConfig.optics,
        interaction: glassInteraction
    },
    parameters: {
        ...baseConfig.parameters,
        'glass.ior': 1.5
    }
};
```

---

## Validation

Recipes are validated on initialization.

### Required Fields

All recipes must have:
- `id` (string)
- `name` (string)
- `world` (object with all 4 module slots)
- `optics` (object with all 5 module slots)

**Error**:
```
❌ Recipe missing required field: 'world'
```

### Module Kind Validation

Each slot must contain the correct module kind:

**Error**:
```
❌ Recipe validation failed for 'my-recipe':
  • scene slot requires 'scene' module, got 'camera' (pinhole-camera)
```

### Parameter Path Validation

Parameter paths in recipe must correspond to parameters defined in modules:

**Warning**:
```
⚠️  Recipe 'my-recipe' references unknown parameter: 'foo.bar'
```

### Type Validation

Parameter values must match types:

**Error**:
```
❌ Parameter 'camera.position' expects vec3, got number
```

---

## Multi-Recipe Applications

Load and switch between multiple recipes:

```typescript
const recipes: Recipe[] = [
    basicPathTracer,
    productionRender,
    preview,
    ambientOcclusion
];

const app = new App(canvas);
await app.initialize(recipes);

// Start with first recipe
app.selectRecipe('basic-pathtracer');
app.start();

// Switch at runtime
app.selectRecipe('production-hdri');

// List all recipes
const availableRecipes = app.getRecipes();
console.log(availableRecipes.map(r => r.id));
```

**Benefits**:
- Compare rendering techniques
- A/B test configurations
- User-selectable modes
- Educational demonstrations

---

## Best Practices

1. **Use descriptive IDs** - `pathtracer-studio` not `r1`
2. **Provide sensible defaults** - Match common usage
3. **Document parameters** - Comment intent
4. **Group related recipes** - Organize by purpose
5. **Test incrementally** - Start simple, add complexity
6. **Set appropriate targetSamples** - Match quality needs
7. **Match modules logically** - HDRI with no explicit lights
8. **Version recipes** - Track configuration changes
9. **Share base configs** - Reuse common setups
10. **Validate thoroughly** - Test before deployment

---

## Type Exports

```typescript
// Recipe
export interface Recipe { /* ... */ }

// Module groups
export interface WorldModules { /* ... */ }
export interface OpticsModules { /* ... */ }

// Configuration
export interface RecipeConfig { /* ... */ }
```

---

## Next Steps

- [Module Descriptor Reference](module-descriptor.md) - Module type details
- [Creating Recipes Guide](../guides/creating-recipes.md) - Practical tutorial
- [App Documentation](../app/README.md) - Runtime recipe management
- [Validation Documentation](../errors/validation.md) - Recipe validation details
