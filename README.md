# PathTracerGLSL

A **modular, composable path tracer** built on WebGL2, designed for clarity, flexibility, and real-time experimentation.

## Features

- **📦 Modular Architecture** - Swap cameras, BRDFs, integrators, and scenes independently
- **🎛️ Live Parameters** - Real-time control of scene and rendering parameters
- **🌅 HDR Environment Maps** - Importance-sampled environment lighting
- **🔄 Progressive Rendering** - Accumulation-based path tracing with live preview
- **🎨 Multiple Recipes** - Hot-swap between different rendering configurations
- **⚡ Comprehensive Error System** - Helpful validation and shader error translation
- **🧩 TypeScript** - Full type safety with detailed interfaces

## Quick Start

```bash
# Install dependencies
npm install

# Run development server
npm run dev

# Build for production
npm run build
```

Open your browser to the dev server URL. You'll see the path tracer running with interactive orbit controls.

## Project Structure

```
src/
├── engine/          # Rendering engine (GPU resources, shader compilation)
├── app/             # Application layer (parameters, extensions)
├── errors/          # Validation and error reporting
├── world/           # World modules (geometry, lighting, environment)
├── optics/          # Optics modules (camera, BRDFs, integrators)
└── examples/        # Example scenes and configurations

docs/                # Comprehensive documentation
tests/               # Test suites
```

## Core Concepts

### Modules

**Modules** are reusable GLSL building blocks. Each module provides:
- Fragment shader code (uniforms, constants, functions)
- Uniform bindings (connecting shader uniforms to parameters)
- Parameter metadata (types, ranges, defaults)

Example modules:
- `pinhole-camera` - Standard perspective camera
- `lambert-interaction` - Lambertian diffuse BRDF
- `path-tracer-direct-light` - Path tracer with direct light sampling
- `hdri-environment-importance` - HDR environment map with importance sampling

### Recipes

**Recipes** compose modules into complete rendering pipelines:

```typescript
const recipe: Recipe = {
    id: 'pathtracer',
    name: 'Path Tracer',

    world: {
        ambient: euclideanAmbient,      // Mathematical space
        environment: hdriEnvironment,   // Environment map
        scene: raymarchScene,           // Scene geometry
        lighting: quadLight             // Light sources
    },

    optics: {
        camera: pinholeCamera,          // Ray generation
        interaction: lambertInteraction, // BRDF
        transport: pathTracerDirect,    // Integration algorithm
        accumulator: averageAccumulator, // Sample accumulation
        developer: gammaDeveloper       // Tone mapping
    }
};
```

The engine compiles modules into shaders, validates the configuration, and executes the rendering pipeline.

## Architecture

PathTracerGLSL has three layers:

### 1. Engine Layer (`src/engine/`)

Manages GPU resources and rendering:
- **ShaderCompiler** - Concatenates modules into complete shaders
- **RenderExecutor** - Executes rendering passes (main → display → composite)
- **ResourceManager** - Manages accumulation buffers and textures
- **ParameterManager** - Updates shader uniforms from parameter changes

### 2. App Layer (`src/app/`)

Handles application state and UI:
- **ParameterStore** - Centralized parameter state
- **EventBus** - Event-driven communication
- **Extensions** - Modular features (controls, screenshots, HDR export)

### 3. Error System (`src/errors/`)

Comprehensive validation and diagnostics:
- **Engine validation** - Recipe structure, uniform bindings (pre-compilation)
- **Shader error translation** - GLSL compiler errors → helpful diagnostics
- **Resource validation** - HDR loading, texture creation

## Example Usage

```typescript
import { App } from './src/app/App';
import { pinholeCamera } from './src/optics/camera/pinhole-camera';
import { lambertInteraction } from './src/optics/interaction/lambert-interaction';
import { pathTracerDirectLight } from './src/optics/transport/path-tracer-direct-light';
// ... other imports

const recipe: Recipe = {
    id: 'my-scene',
    name: 'My Scene',
    world: {
        ambient: euclideanAmbient,
        environment: constEnvironment,
        scene: myCustomScene,
        lighting: quadLight
    },
    optics: {
        camera: pinholeCamera,
        interaction: lambertInteraction,
        transport: pathTracerDirectLight,
        accumulator: averagingAccumulator,
        developer: gammaDeveloper
    }
};

const app = new App(canvas);
await app.initialize([recipe]);

// Add extensions
app.addExtension(new OrbitControls(canvas));
app.addExtension(new ParameterPanelExtension());

app.start();
```

## Documentation

Comprehensive documentation is available in the `docs/` directory:

- **[Architecture Overview](docs/architecture.md)** - System design and data flow
- **[Engine Documentation](docs/engine/)** - Rendering engine internals
- **[App Documentation](docs/app/)** - Application layer and extensions
- **[Error System](docs/errors/)** - Validation and error handling
- **[Guides](docs/guides/)** - How to write modules, create recipes, add parameters
- **[Reference](docs/reference/)** - Type definitions and API reference

## Key Features in Detail

### Modular Design

Every aspect of the renderer is modular:
- **Swap cameras**: Pinhole, thin lens, orthographic
- **Swap BRDFs**: Lambert, mirror, glass, custom materials
- **Swap integrators**: Direct lighting, path tracing, ambient occlusion
- **Swap scenes**: Procedural SDFs, mesh rendering, custom geometries

All without touching engine code.

### Real-Time Parameters

Parameters update live without recompilation:
```typescript
parameters: {
    'camera.fov': 60,
    'camera.position': [1.5, 1, 5],
    'quad.intensity': 30.0,
    'developer.exposureEV': 0
}
```

Changes propagate through uniform bindings to shaders instantly.

### Progressive Rendering

The accumulator system enables progressive path tracing:
- Renders samples over time
- Averages results for noise reduction
- Resets on parameter or camera changes
- Supports production rendering (high sample counts)

### Error Handling

Comprehensive error detection catches issues early:

**Recipe Validation:**
```
❌ Recipe validation failed for 'pathtracer':
  • transport slot requires 'transport' module, got 'camera' (pinhole-camera)
```

**Shader Errors:**
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚠️  Missing Function

Function 'interaction_surface_shaed' not found
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

💡 Did you mean 'interaction_surface_shade'?

Module: optics/interaction/lambert-interaction
  41 | vec3 radiance = interaction_surface_shaed(
```

**Resource Errors:**
```
❌ HDR loading failed:
  • HDR file not found: /hdri/missing.hdr
```

## Development

### Writing a Custom Module

See [Writing Modules Guide](docs/guides/writing-modules.md) for a complete tutorial.

Basic module structure:
```typescript
export const myModule: ModuleDescriptor = {
    id: {
        kind: 'interaction',
        name: 'my-brdf',
        version: '1.0.0'
    },

    fragment: {
        uniforms: `
            uniform vec3 u_albedo;
        `,
        functions: `
            Surface interaction_surface_shade(Point p, Ray ray, Hit hit) {
                Surface s;
                s.albedo = u_albedo;
                s.emission = vec3(0.0);
                return s;
            }
        `
    },

    uniformBindings: [{
        uniform: 'u_albedo',
        parameters: ['material.albedo'],
        type: 'vec3',
        compute: (params) => params['material.albedo']
    }]
};
```

### Running Tests

```bash
# Run validation tests
npm test tests/validation.test.ts

# Run error reporting tests
node tests/error-reporting/test-error-reporting.js
npm run dev  # Check browser console

# Revert test changes
node tests/error-reporting/revert-test.js
```

## Technical Details

- **WebGL2** - Modern graphics API with compute-like features
- **GLSL 300 es** - Shader language
- **TypeScript** - Type-safe development
- **Vite** - Fast build tooling
- **No dependencies** - Pure WebGL2, no three.js or other frameworks

## Contributing

This is a research/educational project. Contributions welcome:
- New modules (BRDFs, integrators, cameras)
- Performance improvements
- Documentation improvements
- Bug fixes

## License

[Add your license here]

## Credits

Developed as a modular rendering laboratory for exploring path tracing techniques.
