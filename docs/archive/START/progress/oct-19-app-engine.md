# App/Engine Architecture Documentation

**Last Updated:** October 19, 2025  
**Status:** Post-cleanup, production-ready for tiled rendering

---

## Table of Contents

1. [Overview](#overview)
2. [Architecture Principles](#architecture-principles)
3. [Engine Pillar](#engine-pillar)
4. [App Pillar](#app-pillar)
5. [Extension System](#extension-system)
6. [Data Flow](#data-flow)
7. [Key Patterns](#key-patterns)
8. [Utilities](#utilities)
9. [Type System](#type-system)

---

## Overview

The renderer is built on a **two-pillar architecture**:

- **Engine Pillar** - GPU resource management and WebGL rendering
- **App Pillar** - Orchestration, parameters, UI, and extensions

This separation ensures clean boundaries: Engine handles "how to render," App handles "what to render and when."

### Design Goals

- **Modular rendering** - Compose shaders from independent modules
- **Recipe-based** - Multiple rendering configurations switchable at runtime
- **Extensible** - Add features without modifying core code
- **Production-ready** - Support multi-day tiled renders with session management

---

## Architecture Principles

### 1. Clear Ownership
- **Engine owns**: GPU resources, shader compilation, render execution
- **App owns**: Parameters, coordination, user input, file I/O
- **Extensions own**: Optional features (camera controls, stats, etc.)

### 2. Unidirectional Data Flow
```
User Input → ParameterStore → Engine → GPU
                ↓
          EventBus (notifications)
```

### 3. Composition Over Inheritance
- Modules compose into recipes
- Extensions add capabilities without modifying core
- Services registered in a flat registry

### 4. Session Persistence
- All state serializable to JSON
- Sessions include parameters, camera, and tile job progress
- Resume multi-day renders from disk

---

## Engine Pillar

**Location:** `engine/`  
**Responsibility:** Manage GPU resources and execute rendering

### Core Components

#### Engine (`Engine.ts`)
Central coordinator for GPU resources.

**Responsibilities:**
- Initialize recipes (compile shaders, create buffers)
- Switch between recipes at runtime
- Manage per-recipe accumulation buffers
- Load HDR environment maps
- Execute render frames
- Handle tiled rendering (pixel offset, image size)

**Key Methods:**
```typescript
initialize(recipes: Recipe[]): void
selectRecipe(recipeId: string): void
renderFrame(): void
setPixelOffset(x: number, y: number): void
setImageSize(width: number, height: number): void
```

**State:**
- `ready` - Initialized, not rendering
- `running` - Actively rendering

---

#### ShaderCompiler (`ShaderCompiler.ts`)
Compiles GLSL from module descriptors.

**Responsibilities:**
- Build main shader (accumulation pass)
- Build display shader (tone mapping pass)
- Cache uniform locations
- Update engine uniforms (time, resolution, etc.)

**Pipeline:**
```
Modules → buildMainShaderSource() → Compile → Link → WebGLProgram
```

**Engine Uniforms:**
- `u_resolution` - Framebuffer dimensions
- `u_image_size` - Full image size (for tiled rendering)
- `u_frame_index` - Current sample number
- `u_time` - Elapsed time in seconds
- `u_sample_count` - Total accumulated samples
- `u_pixel_offset` - Tile offset for tiled rendering

---

#### ParameterManager (`ParameterManager.ts`)
Maps parameters to shader uniforms.

**Responsibilities:**
- Initialize from module uniformBindings
- Update GPU uniforms when parameters change
- Cache uniform values to skip redundant GPU calls
- Track performance statistics

**Example Binding:**
```typescript
{
  uniform: 'u_camera_position',
  parameters: ['camera.position'],
  type: 'vec3',
  compute: (params) => params['camera.position']
}
```

**Caching:**
- Tracks last value sent to GPU
- Skips update if value unchanged
- Logs cache hit rate every 60 frames

---

#### ResourceManager (`ResourceManager.ts`)
Manages framebuffers and accumulation state per recipe.

**Responsibilities:**
- Create RGBA32F ping-pong buffers per recipe
- Track sample counts independently per recipe
- Handle buffer swapping (current ↔ previous)
- Resize all buffers on canvas resize
- Clean up GPU resources

**Per-Recipe Resources:**
```typescript
{
  textures: { current, previous },
  framebuffers: { current, previous },
  accumulator: { sampleCount, startTime, lastResetTime }
}
```

**Why Per-Recipe:**
Allows instant recipe switching without losing accumulation progress.

---

#### RenderExecutor (`RenderExecutor.ts`)
Executes WebGL rendering commands.

**Responsibilities:**
- Execute main pass (accumulation)
- Execute display pass (tone mapping)
- Manage viewport state
- Provide pixel readback (HDR and LDR)

**Passes:**
1. **Main Pass** - Render to accumulator framebuffer (RGBA32F)
2. **Display Pass** - Tone map to screen (RGBA8)

**Pixel Readback:**
- `readRadiance()` - HDR data (Float32Array) for export
- `readDisplay()` - LDR data (Uint8Array) for screenshots

---

#### TextureRegistry (`TextureRegistry.ts`)
Global texture unit management.

**Responsibilities:**
- Assign texture units to named textures
- Bind textures to shader uniforms
- Reserve unit 0 for accumulator

**Example:**
```typescript
registry.register('env_map', texture);
registry.bind('env_map', uniformLocation);
```

---

### Utilities

#### Shader Builder (`utils/shader-builder-utils.ts`)
Constructs GLSL source from modules.

**Functions:**
- `buildMainShaderSource()` - Compose main shader
- `buildDisplayShaderSource()` - Compose display shader
- `buildVertexShaderSource()` - Fullscreen triangle vertex shader
- `orderModules()` - Sort by MODULE_ORDER
- `addLineNumbers()` - Add line numbers for debugging

**Module Order:**
```
ambient → scene → environment → lighting →
camera → interaction → transport → accumulator → developer
```

#### Shader Uniform Utils (`utils/shader-uniform-utils.ts`)
WebGL uniform manipulation.

**Functions:**
- `setUniformValue()` - Set any uniform type
- `uniformValuesEqual()` - Compare values with epsilon
- `cacheUniformLocations()` - Extract all uniform locations from program

**Supported Types:**
`float`, `int`, `bool`, `vec2`, `vec3`, `vec4`, `mat3`, `mat4`, `sampler2D`, `samplerCube`

#### Texture Factory (`utils/TextureFactory.ts`)
Create floating-point textures.

**Methods:**
- `createR32F()` - Single-channel float (CDFs, PDFs)
- `createRGB32F()` - RGB float (HDR images, environment maps)

**Features:**
- Validates data size matches dimensions
- Falls back to NEAREST if LINEAR not supported
- Proper wrapping modes for environment maps

---

## App Pillar

**Location:** `app/`  
**Responsibility:** Orchestrate rendering and manage application state

### Core Components

#### App (`App.ts`)
Main application controller.

**Responsibilities:**
- Initialize engine with recipes
- Coordinate between components
- Handle recipe switching
- Manage extension lifecycle
- Provide service registry
- Handle keyboard shortcuts

**Lifecycle:**
```typescript
new App(canvas)
  .use(extension1)
  .use(extension2)
  .initialize(recipes, environmentHDR)
  .setupKeyboardControls()
```

**Default Keyboard Controls:**
- `1-9` - Switch recipes
- `R` - Reset accumulation
- `Space` - Pause/resume rendering
- `J` - Quick save session
- `O` - Load session
- `T` - Start tile job

**Service Registry:**
Core services available to extensions:
- `app` - App instance
- `engine` - Engine instance
- `parameters` - ParameterStore
- `coordinator` - RenderCoordinator
- `session` - SessionManager
- `tiler` - TiledRenderer

---

#### ParameterStore (`ParameterStore.ts`)
Central parameter storage and change notification.

**Responsibilities:**
- Store parameter values
- Notify listeners on changes
- Batch updates to reduce notifications
- Serialize/restore for sessions
- Force resend on recipe switch

**Usage:**
```typescript
store.set('camera.position', [0, 0, 5]);
store.batch({ 'camera.fov': 60, 'camera.position': [1, 1, 5] });
store.get('camera.position'); // [1, 1, 5]
```

**Change Notification:**
```typescript
store.onChange = (changes) => {
  // changes.changes = [{ path, oldValue, newValue }, ...]
};
```

**Session Support:**
```typescript
const snapshot = store.serialize();
store.restore(snapshot);
```

---

#### RenderCoordinator (`RenderCoordinator.ts`)
Manages rendering modes and execution flow.

**Responsibilities:**
- Control render loop (start/stop)
- Switch between render modes
- Determine when to reset accumulation
- Report progress via callbacks

**Render Modes:**

1. **Interactive** - Real-time preview
    - Continuous rendering
    - Reports FPS
    - For live interaction

2. **Progressive** - Continuous accumulation
    - Renders until manually stopped
    - Reports samples/sec
    - Default mode

3. **Production** - Target sample count
    - Stops at configured sample count
    - Reports progress percentage
    - For automated renders

**Reset Logic:**
```typescript
// Reset on:
camera.*     // Camera moved
scene.*      // Scene changed
material.*   // Material edited

// Don't reset on:
developer.*  // Tone mapping only
resolution   // Just viewport change
```

---

#### SessionManager (`SessionManager.ts`)
Save and restore complete application state.

**Responsibilities:**
- Capture all state (parameters, camera, render mode, tile jobs)
- Serialize to JSON
- Download session files
- Load and restore sessions
- Handle extension state

**Session Contents:**
```typescript
{
  version: '1.0.0',
  timestamp: Date.now(),
  activeRecipe: 'pathtracer',
  parameters: { /* all params */ },
  renderMode: 'progressive',
  sampleCount: 1247,
  camera: { position, frame, target, fov },
  extensions: { /* extension states */ },
  tileJob: { /* tile job state */ }
}
```

**Usage:**
```typescript
// Save
await sessionManager.save('my_render.json');

// Quick save (auto-generated name)
await sessionManager.quickSave();

// Load
await sessionManager.loadFromFile(file);
```

**Special Handling:**
- Excludes `resolution` parameter during tile jobs (let tile job control it)
- Validates recipe exists before restoring
- Extensions can save/restore custom state

---

#### TiledRenderer (`TiledRenderer.ts`)
Production rendering with tiled output for arbitrarily large images.

**Responsibilities:**
- Calculate tile grid from target dimensions
- Render tiles sequentially (memory efficient)
- Save each tile as HDR/PNG
- Track progress (which tiles completed)
- Support pause/resume via sessions

**Workflow:**
```typescript
// 1. Start job
tiledRenderer.startJob({
  targetWidth: 7680,
  targetHeight: 4320,
  targetTileSize: 512,
  samplesPerTile: 1000,
  format: 'hdr'
});

// Auto-downloads session at start

// 2. Renders tiles automatically
// tile_00_00.hdr, tile_01_00.hdr, ...

// 3. Can pause anytime
tiledRenderer.stopJob();

// 4. Save session (J key)

// 5. Resume later by loading session
```

**Tile Job State:**
```typescript
{
  config: { targetWidth, targetHeight, targetTileSize, samplesPerTile, format },
  grid: { tilesX, tilesY, tileWidth, tileHeight },
  currentTile: [3, 2],           // Grid coordinates
  currentTileNumber: 19,          // Linear index (easier to edit)
  completedTiles: [[0,0], [1,0], ...],
  completedTileCount: 18,
  jobId: 'job_2025_1019_2102',
  startTime: 1760932921571,
  state: 'running' | 'paused' | 'complete'
}
```

**How Tiling Works:**
1. Resize framebuffer to tile size
2. Set `imageSize` to full target dimensions (camera needs this for FOV)
3. Set `pixelOffset` to tile position
4. Render tile with target samples
5. Read pixels and save tile
6. Advance to next tile

**Resume Support:**
Session contains tile job state → load session → automatically resumes from `currentTileNumber`

---

#### EventBus (`EventBus.ts`)
Simple pub/sub for decoupled communication.

**Responsibilities:**
- Emit events from core components
- Allow extensions to listen without coupling

**Common Events:**
- `render.started` / `render.stopped` / `render.complete`
- `render.progress` - ProgressInfo
- `parameter.changed` - ParameterChanges
- `accumulation.reset` - { reason }
- `recipe.switched` - { recipeId }
- `session.saved` / `session.loaded`
- `camera.moved` - { position, target/frame }

**Usage:**
```typescript
// Emit
bus.emit('render.progress', { samples: 100, fps: 45 });

// Listen
bus.on('render.progress', (info) => {
  console.log(`${info.samples} samples`);
});

// Cleanup
bus.off('render.progress', handler);
```

---

### Utilities

#### AnimationLoop (`utils/AnimationLoop.ts`)
Manages requestAnimationFrame loop with delta time.

**Responsibilities:**
- Handle RAF boilerplate
- Calculate delta time automatically
- Provide clean start/stop interface

**Usage:**
```typescript
const loop = new AnimationLoop();

loop.start((dt) => {
  // dt is in seconds
  update(dt);
});

loop.stop();
```

**Used By:**
- KeyboardControls (polls keyboard state every frame)

---

#### EventManager (`utils/EventManager.ts`)
Automatic cleanup of event listeners.

**Responsibilities:**
- Track DOM event listeners
- Track EventBus subscriptions
- Remove all on cleanup (prevents memory leaks)

**Usage:**
```typescript
const events = new EventManager();

// DOM events
events.add(window, 'keydown', handler);
events.add(canvas, 'mousedown', handler);

// EventBus events
events.onBus(bus, 'render.progress', handler);

// Cleanup all at once
events.removeAll();
```

**Used By:**
- All extensions (KeyboardControls, OrbitControls, StatsPanelExtension)

---

## Extension System

**Location:** `app/extensions/`  
**Purpose:** Add optional features without modifying core

### Extension Interface

```typescript
interface Extension {
  name: string;
  version?: string;
  description?: string;
  dependencies?: string[];  // Other extensions required
  
  install(app: any, bus: any): void;
  uninstall?(): void;
  
  saveState?(): any;         // For session persistence
  restoreState?(state: any): void;
}
```

### Built-in Extensions

#### KeyboardControls
6DOF camera controls via keyboard.

**Controls:**
- Arrows + `'` `/` - Translate (forward/back, strafe, up/down)
- WASD + QE - Rotate (pitch, yaw, roll)
- Shift - Boost (3x speed)
- Ctrl - Slow (0.3x speed)
- R - Stabilize (align up with world up)

**Registers Service:** `camera`

**Methods:**
- `getPosition()` - Current camera position
- `getFrame()` - Current camera frame (Float32Array)

---

#### OrbitControls
Mouse-based orbit camera around target.

**Controls:**
- Left drag - Orbit around target
- Mouse wheel - Zoom in/out

**Registers Service:** `camera`

**Methods:**
- `getPosition()` - Current camera position
- `getTarget()` - Current target point
- `setDistance(d)` - Set orbit distance
- `setTarget(t)` - Set orbit target

**Note:** Both KeyboardControls and OrbitControls register as `'camera'` - only use one at a time.

---

#### StatsPanelExtension
Displays rendering statistics overlay.

**Shows:**
- Samples/sec (rolling 1-second average)
- Total sample count
- Resolution
- Time since last reset

**Registers Service:** `stats`

**Position:** Top-left corner (fixed overlay)

**Features:**
- Rolling window prevents stale SPS after tab background
- Auto-updates on render progress events
- Resets on accumulation reset

---

### Writing Extensions

**Template:**
```typescript
import type { Extension } from '../types';
import { EventManager } from '../utils/EventManager';

class MyExtension implements Extension {
  name = 'my-extension';
  version = '1.0.0';
  
  private app: any;
  private bus: any;
  private events = new EventManager();
  
  install(app: any, bus: any): void {
    this.app = app;
    this.bus = bus;
    
    // Register service (optional)
    app.registerService('myext', this);
    
    // Setup listeners
    this.events.add(window, 'keydown', this.onKeyDown);
    this.events.onBus(bus, 'render.progress', this.onProgress);
    
    // Initialize
  }
  
  uninstall(): void {
    this.events.removeAll();
    // Cleanup other resources
  }
  
  private onKeyDown = (e: KeyboardEvent): void => {
    // ...
  };
  
  private onProgress = (info: any): void => {
    // ...
  };
}

export { MyExtension };
```

**Best Practices:**
- Use EventManager for all listeners
- Register as service if other extensions need access
- Clean up all resources in uninstall()
- Use arrow functions for handlers (preserves `this`)

---

## Data Flow

### Normal Rendering Flow

```
1. User Input (keyboard/mouse)
   ↓
2. Extension (camera controls)
   ↓
3. ParameterStore.set('camera.position', newPos)
   ↓
4. ParameterStore.onChange → Engine.updateParameters()
   ↓
5. ParameterManager → GPU uniforms updated
   ↓
6. RenderCoordinator.resetAccumulation() (if needed)
   ↓
7. Engine.renderFrame()
   ↓
8. RenderExecutor executes main + display passes
   ↓
9. GPU renders → screen
   ↓
10. EventBus.emit('render.progress')
    ↓
11. Extensions (stats panel) update
```

### Tiled Rendering Flow

```
1. TiledRenderer.startJob(config)
   ↓
2. Calculate tile grid
   ↓
3. Save session with tile job state
   ↓
4. For each tile:
   a. Resize framebuffer to tile size
   b. Set imageSize to full target
   c. Set pixelOffset to tile position
   d. Reset accumulation
   e. Render to target samples
   f. Read pixels (readRadiance/readDisplay)
   g. Save tile file
   h. Mark tile complete
   i. Advance to next tile
   ↓
5. Complete (or pause and save session)
```

### Session Load Flow

```
1. User loads session file
   ↓
2. SessionManager.loadFromFile()
   ↓
3. Validate session (check recipe exists)
   ↓
4. Stop current rendering
   ↓
5. Switch to saved recipe
   ↓
6. ParameterStore.restore() (silent, batch update)
   ↓
7. Set render mode
   ↓
8. Restore camera
   ↓
9. Restore extension states
   ↓
10. If tileJob exists:
    TiledRenderer.resumeJob()
    Else:
    RenderCoordinator.start()
```

---

## Key Patterns

### 1. Recipe System

Recipes compose modules into complete rendering configurations.

**Structure:**
```typescript
{
  id: 'pathtracer',
  name: 'Path Tracer',
  world: {
    ambient: euclideanModule,
    environment: envMapModule,
    scene: cornellBoxModule,
    lighting: quadLightModule
  },
  optics: {
    camera: pinholeModule,
    interaction: diffuseBRDFModule,
    transport: pathTracingModule,
    accumulator: progressiveModule,
    developer: reinhardModule
  }
}
```

**Module Descriptor:**
```typescript
{
  id: { kind: 'camera', name: 'pinhole', version: '1.0.0' },
  fragment: {
    functions: '...',  // GLSL code
    uniforms: '...',   // uniform declarations
    constants: '...'   // #defines
  },
  uniformBindings: [
    {
      uniform: 'u_camera_position',
      parameters: ['camera.position'],
      type: 'vec3',
      compute: (params) => params['camera.position']
    }
  ],
  exports: ['camera_generateRay']
}
```

**Benefits:**
- Hot-swap modules at runtime
- Independent accumulation per recipe
- Easy A/B testing of algorithms

---

### 2. Parameter System

Parameters flow from App → Engine with caching.

**Naming Convention:**
```
<moduleKind>.<property>
camera.position
scene.material.roughness
developer.exposure
```

**Parameter → Uniform Binding:**
```typescript
// Parameters (high-level)
'camera.position' = [0, 0, 5]
'camera.target' = [0, 0, 0]

// Compute function
(params) => buildFrame(params['camera.position'], params['camera.target'])

// Uniform (low-level)
u_camera_frame = Float32Array(9)  // mat3
```

**Caching:**
- ParameterManager caches last value sent to GPU
- Skips `gl.uniform*()` call if value unchanged
- Typical 70-90% cache hit rate

---

### 3. Ping-Pong Accumulation

**Why:**
Progressive rendering accumulates samples over time. Each frame needs the previous frame's result.

**Implementation:**
```
Frame N:
  Read from: previousTexture
  Write to: currentFramebuffer
  
Frame N+1:
  Swap buffers
  Read from: currentTexture (was previousTexture)
  Write to: previousFramebuffer (was currentFramebuffer)
```

**In Shader:**
```glsl
vec3 previousRadiance = texture(u_accumulator_radiance_previous, uv).rgb;
vec3 newSample = trace(ray);
vec3 accumulatedRadiance = mix(previousRadiance, newSample, 1.0 / float(u_sample_count));
```

---

### 4. Tiled Rendering

**Problem:** Rendering 8K image (7680×4320) requires 127MB of VRAM just for accumulator. Many GPUs can't handle this.

**Solution:** Render one tile at a time.

**Key Insight:** Camera needs to know the **full image size** to calculate correct field of view, even when rendering a small tile.

```
Full image: 7680×4320
Tile size: 512×512
Framebuffer: 512×512 (VRAM efficient)

Camera uniforms:
u_resolution = [512, 512]      // Current tile size
u_image_size = [7680, 4320]    // Full target image
u_pixel_offset = [1024, 512]   // This tile's position

Camera computes ray:
uv = (gl_FragCoord.xy + u_pixel_offset) / u_image_size
// uv is relative to full image, not tile!
```

**Benefits:**
- Unlimited resolution (16K, 32K+)
- Memory efficient (one tile at a time)
- Pausable/resumable
- Parallelizable (render different tiles on different machines)

---

## Type System

### Engine Types (`engine/types.ts`)

**Core Types:**
- `ModuleKind` - Valid module categories
- `ModuleDescriptor` - Module metadata + GLSL code
- `UniformBinding` - Parameter → uniform mapping
- `Recipe` - Complete rendering configuration
- `EngineUniforms` - Engine-provided uniforms
- `UniformType` - Supported GLSL uniform types

**Constants:**
- `MODULE_ORDER` - Dependency order for shader compilation

---

### App Types (`app/types.ts`)

**Core Types:**
- `ParameterChange` - Single parameter modification
- `ParameterChanges` - Batch of changes
- `Extension` - Extension interface
- `EventHandler` - EventBus callback type
- `SessionData` - Complete session state

---

### Shared Patterns

**Type-Safe Tuples:**
```typescript
type Vec2 = [number, number];
type Vec3 = [number, number, number];
type Vec4 = [number, number, number, number];
```

**Const Assertions:**
```typescript
const MODULE_ORDER = [...] as const;
// Type is readonly tuple, not string[]
```

---

## Future Improvements

### Considered but Deferred

1. **Parameter Constants** - Centralized parameter path registry
    - **Reason to defer:** Parameters are module-defined, dynamic schema doesn't benefit from constants
    - **When to revisit:** If cross-cutting parameters cause frequent typos in practice

2. **Type-Safe Extension Context** - Replace `app: any` with typed interfaces
    - **Reason to defer:** Adds complexity without immediate benefit during early development
    - **When to revisit:** When extension API stabilizes and multiple developers work on extensions

3. **Vec3/Frame Math Library** - Shared vector/matrix utilities
    - **Reason to defer:** Will be rebuilt during ambient space implementation
    - **When to revisit:** When building non-Euclidean spaces (hyperbolic, spherical, etc.)

4. **Module Validation** - Runtime checks for module correctness
    - **Reason to defer:** Modules are hand-crafted by experts, not user-generated
    - **When to revisit:** If building a module marketplace or allowing user modules

---

## Development Workflow

### Adding a New Module

1. Create module descriptor with GLSL code
2. Define uniformBindings for parameters
3. Export required functions
4. Add to recipe
5. Test with simple scene

### Adding a New Extension

1. Implement Extension interface
2. Use EventManager for listeners
3. Use AnimationLoop if continuous updates needed
4. Register as service if other extensions need access
5. Add keyboard shortcut to App if needed

### Debugging Rendering Issues

1. Check Engine state (ready vs running)
2. Verify recipe is active (`engine.getActiveRecipeId()`)
3. Check parameter values (`parameterStore.get(...)`)
4. Examine shader compilation errors
5. Use `ShaderCompiler.getDebugInfo()` for source with line numbers
6. Check accumulation hasn't been reset unexpectedly

### Performance Optimization

1. Check ParameterManager cache hit rate (should be >70%)
2. Verify modules aren't recomputing expensive values
3. Use production mode for benchmarking
4. Profile with browser DevTools
5. Consider tiled rendering for memory-bound scenes

---

## Appendix: File Structure

```
src/
├── engine/              # GPU and rendering
│   ├── Engine.ts
│   ├── ShaderCompiler.ts
│   ├── ParameterManager.ts
│   ├── ResourceManager.ts
│   ├── RenderExecutor.ts
│   ├── TextureRegistry.ts
│   ├── types.ts
│   ├── loaders/
│   │   ├── hdr-loader.ts
│   │   └── build-environment-sampler.ts
│   └── utils/
│       ├── shader-builder-utils.ts
│       ├── shader-uniform-utils.ts
│       └── TextureFactory.ts
│
├── app/                 # Orchestration and UI
│   ├── App.ts
│   ├── ParameterStore.ts
│   ├── RenderCoordinator.ts
│   ├── SessionManager.ts
│   ├── TiledRenderer.ts
│   ├── EventBus.ts
│   ├── types.ts
│   ├── extensions/
│   │   ├── KeyboardControls.ts
│   │   ├── OrbitControls.ts
│   │   └── StatsPanelExtension.ts
│   └── utils/
│       ├── AnimationLoop.ts
│       ├── EventManager.ts
│       └── file-export.ts
│
├── math/                # Mathematical utilities
│   └── random/
│       └── rng-system.glsl
│
```

---
