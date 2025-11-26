# PathTracerGLSL

A **data-driven WebGL2 path tracer** with a clean three-layer architecture designed for flexibility, composability, and real-time experimentation.

## Overview

PathTracerGLSL separates rendering concerns into three distinct layers:
- **Compiler**: Transforms scene descriptions and rendering strategies into executable GPU pipelines
- **Engine**: Manages GPU resources and executes rendering pipelines
- **App**: Orchestrates rendering modes, parameters, and user interactions

This architecture enables hot-swapping rendering strategies, progressive accumulation, production rendering, and extensible functionality without touching engine code.

## Features

- **🏗️ Data-Driven Architecture** - Compiler generates complete render pipelines that the engine executes blindly
- **🔄 Multiple Strategies** - Compile once, switch instantly between debug, path tracing, and AOV renderers
- **⚡ Progressive Rendering** - Interactive mode with live preview, production mode for high-quality output
- **🎛️ Live Parameters** - Real-time control with automatic accumulation reset on changes
- **📊 Multiple Render Targets** - MRT support for AOVs (albedo, normals, depth, etc.)
- **🖼️ Tiled Rendering** - Render high-resolution images in tiles for memory efficiency
- **🔌 Extensions System** - Modular features via clean extension interface
- **💾 Session Management** - Save/restore complete render state
- **📈 GPU Profiling** - Per-pass timing with EXT_disjoint_timer_query_webgl2

## Quick Start

```bash
# Install dependencies
npm install

# Run development server
npm run dev

# Build for production
npm run build
```

Open your browser to the dev server URL and you'll see the path tracer running with keyboard controls.

## Architecture

### Three-Layer Design

```
┌─────────────────────────────────────────────────────────┐
│                        APP LAYER                        │
│  FlexibleApp, RenderCoordinator, ParameterStore,       │
│  EventBus, Extensions                                   │
└─────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│                      ENGINE LAYER                       │
│  FlexibleEngine, ResourceManager, RenderExecutor,      │
│  ParameterManager, GPUProfiler                         │
└─────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│                    COMPILER LAYER                       │
│  SimpleCompiler (SceneDescription + RenderStrategy     │
│  → CompiledRenderer)                                    │
└─────────────────────────────────────────────────────────┘
```

**Key insight**: The engine is completely decoupled from scenes and strategies. It only knows how to execute `CompiledRenderer` objects containing shaders, pipelines, and uniform bindings.

### Compiler Layer

**Purpose**: Transform high-level rendering intent into executable GPU pipelines

**Key Types**:
- `SceneDescription`: What to render (geometry, materials, lights)
- `RenderStrategy`: How to render (algorithms, settings)
- `CompiledRenderer`: Complete executable specification (shaders + pipeline + uniforms)

**Current Implementation**: `SimpleCompiler` generates hardcoded GLSL for validation. Will be replaced with real code generation system.

**Output Structure**:
```typescript
{
  id: 'pathtracer-scene1',
  shaders: Map<string, ShaderProgram>,      // Compiled GLSL
  pipeline: RenderPipeline,                  // Framebuffers + passes + swaps
  uniforms: UniformBinding[],                // Parameter → uniform mappings
  exportTargets: { 'hdr': ..., 'ldr': ... } // Named outputs for export
}
```

### Engine Layer

**Purpose**: Execute compiled renderers on the GPU without knowing about scenes or strategies

**Components**:

- **FlexibleEngine**: Core orchestrator
  - Loads multiple `CompiledRenderer` objects
  - Switches between renderers instantly
  - Tracks per-renderer sample counts
  - Manages engine uniforms (resolution, time, sampleCount, etc.)
  - Supports tiled rendering (pixelOffset, imageSize)
  - Exports rendered data (HDR, LDR, AOVs)

- **FlexibleResourceManager**: GPU resource management
  - Creates framebuffers and textures from pipeline specs
  - Three framebuffer types:
    - `screen`: Default framebuffer (canvas)
    - `texture`: Single framebuffer
    - `double_buffer`: Ping-pong pair for accumulation
  - Resolves `_current` / `_previous` qualifiers for double buffers
  - Executes swap instructions (flip ping-pong buffers)
  - Supports MRT (Multiple Render Targets)

- **FlexibleRenderExecutor**: Pipeline execution
  - Compiles GLSL shaders into WebGL programs
  - Executes render passes (bind framebuffer, bind textures, draw)
  - Fullscreen triangle rendering (no VAO needed)
  - GPU profiling support

**Naming Conventions**:
- Buffer IDs use underscore: `accumulation_current`, `accumulation_previous`
- Uniforms use u_camelCase: `u_resolution`, `u_sampleCount`, `u_envMap`
- Consistent with GLSL identifier rules (no hyphens allowed)

### App Layer

**Purpose**: High-level orchestration, user interaction, and feature composition

**Components**:

- **FlexibleApp**: Main API
  - Owns Compiler, Engine, RenderCoordinator
  - Compiles scene with multiple strategies at initialization
  - Manages renderer switching with parameter persistence
  - Provides interactive and production render modes
  - Session save/restore (parameters, renderer selection, extension states)
  - Export API (PNG, HDR, AOVs)
  - Keyboard controls
  - Extensions system

- **FlexibleRenderCoordinator**: Render loop management
  - Interactive mode: continuous, parameters unlocked
  - Production mode: goal-driven (target samples), parameters locked
  - Progress reporting (samples, FPS, elapsed time, percentage)
  - Automatic accumulation reset on parameter changes

- **ParameterStore**: Centralized parameter state
  - Single source of truth for all parameter values
  - Change notification with batch support
  - Lock/unlock for production mode
  - Session serialization/restore
  - Resends all parameters on renderer switch

- **EventBus**: Pub/sub event system
  - Loose coupling between components
  - Events: `render.progress`, `parameter.changed`, `renderer.switched`, etc.

## Project Structure

```
src/
├── compiler/          # Scene + Strategy → CompiledRenderer
│   ├── SimpleCompiler.ts
│   └── types.ts       # CompiledRenderer, RenderPipeline, etc.
│
├── engine/            # Execute CompiledRenderers on GPU
│   ├── FlexibleEngine.ts
│   ├── FlexibleResourceManager.ts
│   ├── FlexibleRenderExecutor.ts
│   ├── ParameterManager.ts
│   ├── GPUProfiler.ts
│   └── types.ts       # Engine types
│
├── app/               # Orchestration, parameters, modes, extensions
│   ├── FlexibleApp.ts
│   ├── FlexibleRenderCoordinator.ts
│   ├── ParameterStore.ts
│   ├── EventBus.ts
│   ├── TiledRenderer.ts
│   └── types.ts       # App types
│
├── world/             # [Future] Geometry, materials, lighting
├── optics/            # [Future] Cameras, BRDFs, integrators
└── examples/          # Example scenes and usage
```

## Core Concepts

### Renderer Compilation

The compiler takes abstract inputs and produces a complete executable specification:

```typescript
const compiler = new SimpleCompiler();
const scene: SceneDescription = { id: 'cornell-box' };
const strategy: RenderStrategy = { id: 'pathtracer', settings: { maxBounces: 8 } };

// Compile → produces CompiledRenderer with shaders, pipeline, uniforms
const renderer = compiler.compile(scene, strategy);
```

The `CompiledRenderer` contains everything the engine needs:
- **Shaders**: Compiled GLSL programs (vertex + fragment)
- **Pipeline**: Framebuffer specs, render passes, execution order
- **Uniforms**: How to map parameters to shader uniforms
- **Export targets**: Named outputs for reading pixels (hdr, ldr, aovs)

### Render Pipeline

A pipeline is a data-driven execution plan:

```typescript
{
  framebuffers: [
    { id: 'accumulation', type: 'double_buffer', format: 'rgba32f' },
    { id: 'screen', type: 'screen' }
  ],
  passes: [
    {
      id: 'main-pass',
      shader: 'pathtracer',
      inputs: { textures: { 'u_previous': 'accumulation_previous' } },
      output: 'accumulation_current',
      execution: { type: 'once', clearBeforeRender: false }
    },
    {
      id: 'display-pass',
      shader: 'display',
      inputs: { textures: { 'u_radiance': 'accumulation_current' } },
      output: 'screen',
      execution: { type: 'once', clearBeforeRender: false }
    }
  ],
  postFrame: {
    swaps: [{ type: 'swap', buffers: ['accumulation'] }]
  }
}
```

The engine executes this blindly: bind framebuffers, bind textures, draw, swap.

### Ping-Pong Buffers

Progressive accumulation uses double buffering:

1. **Pass 1**: Read from `accumulation_previous`, write to `accumulation_current`
2. **After frame**: Swap buffers (current becomes previous)
3. **Next frame**: Repeat

The `FlexibleResourceManager` resolves `_current` and `_previous` qualifiers dynamically based on the current swap state.

### Multiple Render Targets (MRT)

Render to multiple outputs simultaneously:

```typescript
framebuffer: { id: 'aovs', type: 'texture', format: ['rgba32f', 'rgba8', 'rgba16f'] }

pass: {
  output: ['aovs:0', 'aovs:1', 'aovs:2'], // Radiance, albedo, normal
  ...
}

// Fragment shader:
layout(location = 0) out vec4 o_radiance;
layout(location = 1) out vec4 o_albedo;
layout(location = 2) out vec4 o_normal;
```

Export targets can reference specific attachments: `{ bufferId: 'aovs', attachment: 1 }`

### Parameter System

Parameters flow through multiple layers:

1. **User sets parameter**: `app.setParameter('camera.fov', 60)`
2. **ParameterStore**: Validates, stores, notifies
3. **Engine**: Updates via `UniformBinding.compute()`
4. **Shader**: Receives via uniform

```typescript
{
  uniform: 'u_fov',
  parameters: ['camera.fov'],
  type: 'float',
  compute: (params) => params['camera.fov'] * Math.PI / 180
}
```

Some parameters trigger accumulation reset (camera changes, material changes), while others don't (exposure, display mode).

### Render Modes

**Interactive Mode**:
- Continuous rendering loop
- Parameters unlocked (live editing)
- Resets accumulation on parameter changes
- Use case: Scene exploration, parameter tuning

**Production Mode**:
- Goal-driven (render until target samples reached)
- Parameters locked (prevents accidental changes)
- Progress reporting (percentage, ETA)
- Use case: Final high-quality renders

```typescript
// Interactive
app.start();
app.setParameter('camera.fov', 60); // ✅ Works, resets accumulation

// Production
await app.renderProduction(1000); // Locks parameters
app.setParameter('camera.fov', 60); // ⚠️ Blocked, logs warning
```

## Example Usage

### Basic Setup

```typescript
import { FlexibleApp } from './src/app/FlexibleApp.js';

const canvas = document.getElementById('canvas') as HTMLCanvasElement;
const app = new FlexibleApp(canvas);

// Initialize with scene and strategies
await app.initialize({
  scene: { id: 'cornell-box' },
  strategies: [
    { id: 'debug', settings: {} },
    { id: 'pathtracer', settings: { maxBounces: 8, samplesPerFrame: 1 } },
    { id: 'pathtracer-aovs', settings: { maxBounces: 8 } }
  ],
  environmentHDR: './assets/studio.hdr'
});

// Set initial parameters
app.setParameters({
  'camera.fov': 60,
  'camera.position': [0, 1, 5],
  'material.roughness': 0.5
});

// Start interactive rendering
app.start();

// Setup keyboard controls
app.setupKeyboardControls();
```

### Switching Renderers

```typescript
// Switch to debug mode
app.selectRenderer('debug-cornell-box');

// Switch to path tracer
app.selectRenderer('pathtracer-cornell-box');

// Or switch by strategy ID
app.selectRendererByStrategy('pathtracer-aovs');
```

Parameters are preserved across renderer switches automatically.

### Production Rendering

```typescript
// High-quality render with 10,000 samples
await app.renderProduction(10000, {
  autoExportPNG: true,  // Save PNG when done
  autoExportHDR: true   // Save HDR when done
});

console.log('Production render complete!');
```

### Export

```typescript
// Export LDR screenshot
app.exportPNG('screenshot.png');

// Export HDR radiance
app.exportHDR('radiance.hdr');

// Export specific AOV
app.exportAOV('albedo', 'albedo.hdr');

// Export all AOVs
app.exportAllAOVs();
```

### Session Management

```typescript
// Save session to file
app.quickSave(); // Downloads session_YYYYMMDD_HHMMSS.json

// Load session from file
app.loadSessionFromFile(); // Opens file picker

// Programmatic save/restore
const session = app.saveSession();
// ... later ...
app.restoreSession(session);
```

### Extensions

```typescript
const myExtension = {
  name: 'my-feature',
  version: '1.0.0',

  install(app, eventBus) {
    // Add UI, subscribe to events, etc.
    eventBus.on('render.progress', (info) => {
      console.log(`${info.samples} samples, ${info.fps} FPS`);
    });
  },

  uninstall() {
    // Clean up
  },

  saveState() {
    return { myData: 42 };
  },

  restoreState(state) {
    console.log('Restored:', state.myData);
  }
};

app.use(myExtension);
```

## Keyboard Controls

- **1-9**: Switch between renderers
- **R**: Reset accumulation
- **Space**: Toggle rendering (start/stop)
- **\\**: Pause/resume
- **P**: Start production render (prompts for sample count)
- **Escape**: Stop rendering
- **X**: Export PNG screenshot
- **Shift+X**: Export HDR
- **A**: Export all AOVs
- **M**: Cycle display mode (for AOV renderers)
- **J**: Save session
- **O**: Load session from file

## Technical Details

- **WebGL2**: Modern graphics API with compute-like features
- **GLSL 300 es**: Shader language
- **TypeScript**: Type-safe development
- **Vite**: Fast build tooling
- **No frameworks**: Pure WebGL2, no three.js or other dependencies

## Next Steps

The current architecture is complete and validated. Future work:

1. **Build Real Compiler** (Phase 7)
   - Replace SimpleCompiler with code generation system
   - Modular GLSL composition from world/ and optics/ modules
   - Source maps for error reporting

2. **Build World System** (Phase 8)
   - Geometry: SDFs, meshes, procedural
   - Materials: PBR, custom BRDFs
   - Lighting: point, area, environment

3. **Build Optics System** (Phase 9)
   - Cameras: pinhole, thin lens, orthographic
   - Integrators: path tracing, direct lighting, bidirectional
   - Sampling strategies: importance, multiple importance

All three layers (Compiler, Engine, App) are production-ready and require no changes for these future phases.

## Documentation

See `ARCHITECTURE.md` for detailed technical documentation of the three-layer architecture, data flow, and design decisions.

## License

[Add your license here]

## Credits

Developed as a flexible rendering laboratory for exploring path tracing techniques in WebGL2.
