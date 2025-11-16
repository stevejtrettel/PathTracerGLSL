# Creating Recipes

How to compose modules into complete rendering pipelines.

## Overview

**Recipes** are the heart of PathTracerGLSL. They define a complete rendering pipeline by selecting one module for each slot.

Think of recipes as:
- **Blueprints** for the renderer
- **Compositions** of independent modules
- **Configurations** that can be switched at runtime

---

## Recipe Structure

```typescript
interface Recipe {
    id: string;              // Unique identifier
    name: string;            // Display name

    world: {
        ambient: ModuleDescriptor;      // Mathematical space
        environment: ModuleDescriptor;  // Environment lighting
        scene: ModuleDescriptor;        // Geometry
        lighting: ModuleDescriptor;     // Light sources
    };

    optics: {
        camera: ModuleDescriptor;       // Ray generation
        interaction: ModuleDescriptor;  // Surface shading (BRDF)
        transport: ModuleDescriptor;    // Light transport algorithm
        accumulator: ModuleDescriptor;  // Sample accumulation
        developer: ModuleDescriptor;    // Tone mapping
    };

    parameters?: Record<string, any>;   // Initial parameter values
    config?: RecipeConfig;              // Rendering configuration
}
```

---

## Basic Recipe

Here's a minimal path tracer recipe:

```typescript
import { euclideanAmbient } from './world/ambient/euclidean-ambient';
import { constEnvironment } from './world/environment/const-environment';
import { raymarchScene } from './world/scene/raymarch-scene';
import { noLight } from './world/lighting/no-light';
import { pinholeCamera } from './optics/camera/pinhole-camera';
import { lambertInteraction } from './optics/interaction/lambert-interaction';
import { pathTracerDirect } from './optics/transport/path-tracer-direct-light';
import { averageAccumulator } from './optics/accumulator/average-accumulator';
import { gammaDeveloper } from './optics/developer/gamma-developer';

const basicPathTracer: Recipe = {
    id: 'basic-pathtracer',
    name: 'Basic Path Tracer',

    world: {
        ambient: euclideanAmbient,
        environment: constEnvironment,
        scene: raymarchScene,
        lighting: noLight
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

---

## Setting Initial Parameters

Recipes can define initial parameter values:

```typescript
const customScene: Recipe = {
    id: 'custom-scene',
    name: 'Custom Scene',

    world: {
        ambient: euclideanAmbient,
        environment: hdriEnvironment,
        scene: raymarchScene,
        lighting: quadLight
    },

    optics: {
        camera: pinholeCamera,
        interaction: lambertInteraction,
        transport: pathTracerDirect,
        accumulator: averageAccumulator,
        developer: gammaDeveloper
    },

    // Initial parameter values
    parameters: {
        'camera.fov': 60,
        'camera.position': [3, 2, 5],
        'camera.target': [0, 0, 0],

        'quad.position': [0, 3, 0],
        'quad.intensity': 50.0,
        'quad.size': 2.0,

        'developer.exposureEV': -1.0,
        'developer.gamma': 2.2
    }
};
```

**Notes**:
- Parameters use dot notation: `module.parameter`
- Values must match parameter types defined in modules
- Unspecified parameters use module defaults

---

## Rendering Configuration

Configure rendering behavior:

```typescript
const productionRecipe: Recipe = {
    id: 'production',
    name: 'High Quality Render',

    world: { /* ... */ },
    optics: { /* ... */ },

    config: {
        targetSamples: 1000,     // Stop after 1000 samples
        renderMode: 'accumulate'  // 'accumulate' | 'realtime'
    }
};
```

**Config Options**:
- `targetSamples` - Number of samples before pausing (default: Infinity)
- `renderMode` - Rendering mode (future use)

---

## Recipe Variations

### Path Tracer with HDR Environment

```typescript
const hdriPathTracer: Recipe = {
    id: 'hdri-pathtracer',
    name: 'HDRI Path Tracer',

    world: {
        ambient: euclideanAmbient,
        environment: hdriEnvironmentImportance,  // HDR with importance sampling
        scene: raymarchScene,
        lighting: noLight  // Environment provides lighting
    },

    optics: {
        camera: pinholeCamera,
        interaction: lambertInteraction,
        transport: pathTracerDirect,
        accumulator: averageAccumulator,
        developer: gammaDeveloper
    },

    parameters: {
        'hdri.path': './hdri/studio.hdr',
        'hdri.intensity': 1.0,
        'hdri.rotation': 0
    }
};
```

### Direct Lighting Only

```typescript
const directLighting: Recipe = {
    id: 'direct-lighting',
    name: 'Direct Lighting',

    world: {
        ambient: euclideanAmbient,
        environment: constEnvironment,
        scene: raymarchScene,
        lighting: quadLight
    },

    optics: {
        camera: pinholeCamera,
        interaction: lambertInteraction,
        transport: directLightOnly,  // Only direct lighting
        accumulator: averageAccumulator,
        developer: gammaDeveloper
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
        interaction: aoInteraction,  // AO-specific interaction
        transport: aoTransport,      // AO integrator
        accumulator: averageAccumulator,
        developer: gammaDeveloper
    },

    parameters: {
        'ao.radius': 0.5,
        'ao.samples': 16
    }
};
```

### Non-Euclidean Geometry

```typescript
const hyperbolicScene: Recipe = {
    id: 'hyperbolic',
    name: 'Hyperbolic Space',

    world: {
        ambient: hyperbolicAmbient,  // Hyperbolic geometry!
        environment: constEnvironment,
        scene: hyperbolicScene,
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

---

## Multi-Recipe Applications

Load multiple recipes for runtime switching:

```typescript
const recipes: Recipe[] = [
    basicPathTracer,
    hdriPathTracer,
    directLighting,
    ambientOcclusion
];

const app = new App(canvas);
await app.initialize(recipes);

// Start with first recipe
app.selectRecipe('basic-pathtracer');
app.start();

// Switch recipes at runtime
setTimeout(() => {
    app.selectRecipe('hdri-pathtracer');
}, 5000);
```

**Benefits**:
- Compare rendering techniques
- A/B test parameters
- Educational demonstrations
- User-selectable modes

---

## Recipe Templates

### Template: Production Render

```typescript
export function createProductionRecipe(
    scene: ModuleDescriptor,
    environment: ModuleDescriptor,
    targetSamples: number = 1000
): Recipe {
    return {
        id: `production-${Date.now()}`,
        name: 'Production Render',

        world: {
            ambient: euclideanAmbient,
            environment,
            scene,
            lighting: noLight
        },

        optics: {
            camera: pinholeCamera,
            interaction: lambertInteraction,
            transport: pathTracerDirect,
            accumulator: averageAccumulator,
            developer: acesDeveloper  // High-quality tone mapping
        },

        config: {
            targetSamples
        }
    };
}

// Usage
const render = createProductionRecipe(
    myCustomScene,
    hdriEnvironmentImportance,
    2000
);
```

### Template: Interactive Preview

```typescript
export function createPreviewRecipe(
    scene: ModuleDescriptor
): Recipe {
    return {
        id: `preview-${Date.now()}`,
        name: 'Interactive Preview',

        world: {
            ambient: euclideanAmbient,
            environment: constEnvironment,
            scene,
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
            'quad.intensity': 20.0
        }
    };
}
```

### Template: Material Preview

```typescript
export function createMaterialPreview(
    interaction: ModuleDescriptor,
    initialParams?: Record<string, any>
): Recipe {
    return {
        id: `material-${interaction.id.name}`,
        name: `Material: ${interaction.id.name}`,

        world: {
            ambient: euclideanAmbient,
            environment: hdriEnvironmentImportance,
            scene: sphereScene,  // Simple sphere
            lighting: noLight
        },

        optics: {
            camera: pinholeCamera,
            interaction,  // The material to preview
            transport: pathTracerDirect,
            accumulator: averageAccumulator,
            developer: gammaDeveloper
        },

        parameters: {
            'camera.position': [0, 0, 3],
            'camera.target': [0, 0, 0],
            'hdri.path': './hdri/studio.hdr',
            ...initialParams
        }
    };
}

// Usage
const glassPreview = createMaterialPreview(
    glassInteraction,
    { 'glass.ior': 1.5 }
);
```

---

## Validation

Recipes are validated on initialization. Common errors:

### Wrong Module Kind

```typescript
// ❌ Wrong
const recipe: Recipe = {
    id: 'invalid',
    name: 'Invalid Recipe',
    world: {
        ambient: euclideanAmbient,
        environment: constEnvironment,
        scene: pinholeCamera,  // Camera in scene slot!
        lighting: quadLight
    },
    // ...
};
```

**Error**:
```
❌ Recipe validation failed for 'invalid':
  • scene slot requires 'scene' module, got 'camera' (pinhole-camera)
```

### Missing Required Function

```typescript
// Module missing required function
const brokenModule: ModuleDescriptor = {
    id: {
        kind: 'interaction',
        name: 'broken',
        version: '1.0.0'
    },
    fragment: {
        functions: `
            // Missing interaction_surface_shade!
            vec3 customFunction() { return vec3(1.0); }
        `
    }
};
```

**Error**:
```
❌ Shader compilation failed:
  • Function 'interaction_surface_shade' not found
```

### Uniform Binding Missing

```typescript
// Uniform declared but not bound
const unboundUniform: ModuleDescriptor = {
    id: { kind: 'interaction', name: 'unbound', version: '1.0.0' },
    fragment: {
        uniforms: `uniform float u_roughness;`,
        functions: `
            Surface interaction_surface_shade(Point p, Ray ray, Hit hit) {
                Surface s;
                s.roughness = u_roughness;  // Used but never bound!
                return s;
            }
        `
    }
    // Missing uniformBindings!
};
```

**Error**:
```
❌ Uniform validation failed:
  • Uniform 'u_roughness' has no binding in module 'unbound'
```

---

## Best Practices

### 1. Start Simple

```typescript
// ✅ Good: Start with basic modules
const recipe1: Recipe = {
    id: 'simple',
    name: 'Simple Scene',
    world: {
        ambient: euclideanAmbient,
        environment: constEnvironment,
        scene: raymarchScene,
        lighting: quadLight
    },
    optics: {
        camera: pinholeCamera,
        interaction: lambertInteraction,
        transport: directLightOnly,
        accumulator: averageAccumulator,
        developer: gammaDeveloper
    }
};

// Then add complexity
const recipe2: Recipe = {
    ...recipe1,
    world: {
        ...recipe1.world,
        environment: hdriEnvironmentImportance  // Upgrade to HDRI
    }
};
```

### 2. Use Descriptive IDs

```typescript
// ❌ Bad
id: 'r1'

// ✅ Good
id: 'pathtracer-studio-hdri'
```

### 3. Document Parameters

```typescript
const recipe: Recipe = {
    id: 'documented',
    name: 'Well Documented',
    // ...
    parameters: {
        // Camera setup for 16:9 viewport
        'camera.fov': 60,
        'camera.position': [3, 2, 5],

        // Warm studio lighting
        'quad.intensity': 50.0,
        'quad.color': [1.0, 0.95, 0.9],

        // Neutral exposure
        'developer.exposureEV': 0
    }
};
```

### 4. Group Related Recipes

```typescript
export const recipes = {
    preview: {
        fast: createPreviewRecipe(myScene),
        quality: createProductionRecipe(myScene, hdriEnv, 100)
    },
    materials: {
        diffuse: createMaterialPreview(lambertInteraction),
        glass: createMaterialPreview(glassInteraction),
        metal: createMaterialPreview(metalInteraction)
    }
};
```

### 5. Test Incrementally

```typescript
// Test world setup first
const worldTest: Recipe = {
    id: 'world-test',
    name: 'World Test',
    world: {
        ambient: euclideanAmbient,
        environment: constEnvironment,
        scene: raymarchScene,
        lighting: quadLight
    },
    optics: {
        camera: pinholeCamera,
        interaction: flatInteraction,  // Simple white surface
        transport: directLightOnly,
        accumulator: averageAccumulator,
        developer: gammaDeveloper
    }
};

// Then test materials
const materialTest: Recipe = {
    ...worldTest,
    optics: {
        ...worldTest.optics,
        interaction: myNewInteraction  // Test your new material
    }
};

// Finally test full transport
const fullTest: Recipe = {
    ...materialTest,
    optics: {
        ...materialTest.optics,
        transport: pathTracerDirect  // Full path tracing
    }
};
```

---

## Common Patterns

### Pattern: Sky + Ground Plane

```typescript
const skyScene: Recipe = {
    id: 'sky-scene',
    name: 'Sky Scene',
    world: {
        ambient: euclideanAmbient,
        environment: skyEnvironment,  // Procedural sky
        scene: groundPlaneScene,
        lighting: noLight
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

### Pattern: Studio Lighting

```typescript
const studioSetup: Recipe = {
    id: 'studio',
    name: 'Studio Setup',
    world: {
        ambient: euclideanAmbient,
        environment: hdriEnvironmentImportance,
        scene: productScene,
        lighting: threePointLighting  // Key, fill, rim
    },
    optics: {
        camera: pinholeCamera,
        interaction: pbrInteraction,
        transport: pathTracerDirect,
        accumulator: averageAccumulator,
        developer: acesDeveloper
    },
    parameters: {
        'hdri.path': './hdri/studio_soft.hdr',
        'hdri.intensity': 0.5,  // Subtle environment
        'lighting.key.intensity': 100,
        'lighting.fill.intensity': 30,
        'lighting.rim.intensity': 50
    }
};
```

### Pattern: Comparison Recipes

```typescript
// Create variations for comparison
const baseConfig = {
    world: {
        ambient: euclideanAmbient,
        environment: hdriEnvironmentImportance,
        scene: testScene,
        lighting: noLight
    },
    optics: {
        camera: pinholeCamera,
        accumulator: averageAccumulator,
        developer: gammaDeveloper
    }
};

const recipes = {
    lambert: {
        ...baseConfig,
        id: 'compare-lambert',
        name: 'Lambert',
        optics: {
            ...baseConfig.optics,
            interaction: lambertInteraction,
            transport: pathTracerDirect
        }
    },
    ggx: {
        ...baseConfig,
        id: 'compare-ggx',
        name: 'GGX',
        optics: {
            ...baseConfig.optics,
            interaction: ggxInteraction,
            transport: pathTracerDirect
        }
    }
};
```

---

## Troubleshooting

### Recipe Won't Initialize

**Check**:
1. All modules have correct `kind`
2. All required functions are present
3. All uniforms have bindings
4. Parameter names match uniform bindings

### Render is Black

**Possible causes**:
1. No light sources (check `lighting` and `environment`)
2. Camera inside geometry
3. Environment intensity too low
4. Exposure too low (increase `developer.exposureEV`)

### Accumulation Not Working

**Check**:
1. Accumulator module is included
2. Parameters with `triggersReset: true` aren't changing every frame
3. Canvas isn't being resized

### Performance Issues

**Optimize**:
1. Use simpler transport (e.g., direct lighting instead of path tracing)
2. Reduce geometry complexity in scene
3. Lower resolution
4. Disable expensive features (e.g., importance sampling)

---

## Next Steps

- [Writing Modules](writing-modules.md) - Create custom modules
- [Adding Parameters](adding-parameters.md) - Advanced parameter patterns
- [Recipe Format Reference](../reference/recipe-format.md) - Complete specification
- [App Documentation](../app/README.md) - Runtime recipe management
