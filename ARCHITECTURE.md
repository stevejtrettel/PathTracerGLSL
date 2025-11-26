# PathTracerGLSL Architecture

**Version**: 2.0 (Post-Refactor)
**Last Updated**: 2025-01-26

This document provides a comprehensive technical overview of the PathTracerGLSL architecture, data flow, design decisions, and implementation details.

---

## Table of Contents

1. [Overview](#overview)
2. [Design Philosophy](#design-philosophy)
3. [Three-Layer Architecture](#three-layer-architecture)
4. [Compiler Layer](#compiler-layer)
5. [Engine Layer](#engine-layer)
6. [App Layer](#app-layer)
7. [Data Flow](#data-flow)
8. [Key Technical Concepts](#key-technical-concepts)
9. [Design Decisions](#design-decisions)
10. [Future Work](#future-work)

---

## Overview

PathTracerGLSL is a data-driven WebGL2 path tracer with a three-layer architecture:

```
┌─────────────────────────────────────────────────────────┐
│                        APP LAYER                        │
│         High-level orchestration & interaction          │
│  FlexibleApp, RenderCoordinator, ParameterStore,       │
│  EventBus, TiledRenderer, Extensions                    │
└─────────────────────────────────────────────────────────┘
                           │
                           │ CompiledRenderer[]
                           │ Parameter changes
                           │ Renderer selection
                           ▼
┌─────────────────────────────────────────────────────────┐
│                      ENGINE LAYER                       │
│          GPU execution & resource management            │
│  FlexibleEngine, ResourceManager, RenderExecutor,      │
│  ParameterManager, GPUProfiler, TextureRegistry        │
└─────────────────────────────────────────────────────────┘
                           │
                           │ Scene + Strategy
                           ▼
┌─────────────────────────────────────────────────────────┐
│                    COMPILER LAYER                       │
│         Code generation & pipeline specification        │
│  SimpleCompiler: SceneDescription + RenderStrategy     │
│  → CompiledRenderer (shaders + pipeline + uniforms)    │
└─────────────────────────────────────────────────────────┘
```

**Key Insight**: The engine is completely blind to scenes and strategies. It only executes `CompiledRenderer` objects, which are complete, self-contained specifications of what GPU work to perform.

---

## Design Philosophy

### 1. Separation of Concerns

Each layer has a single, well-defined responsibility:

- **Compiler**: Transform intent into execution plans
- **Engine**: Execute plans on GPU
- **App**: Orchestrate user interactions and modes

No layer knows about the internals of other layers. Communication happens through well-defined interfaces (`CompiledRenderer`, parameter changes, render commands).

### 2. Data-Driven Execution

The engine is a generic GPU executor. It doesn't know:
- What a "path tracer" is
- What a "scene" contains
- What parameters mean

It only knows how to:
- Compile GLSL shaders
- Bind framebuffers and textures
- Execute render passes
- Swap buffers

All rendering logic is encoded in the `CompiledRenderer` data structure.

### 3. Flexibility Through Compilation

Want to add a new rendering algorithm? Don't change the engine. Write a compiler function that generates the appropriate `CompiledRenderer`.

```typescript
// Engine never changes - it just executes whatever you compile
const debugRenderer = compiler.compile(scene, { id: 'debug' });
const pathtracerRenderer = compiler.compile(scene, { id: 'pathtracer' });
const aovsRenderer = compiler.compile(scene, { id: 'pathtracer-aovs' });

// Engine loads them all, switches between them instantly
engine.loadRenderers([debugRenderer, pathtracerRenderer, aovsRenderer]);
engine.selectRenderer('pathtracer-scene1');
```

### 4. Progressive Enhancement

The current architecture is production-ready. Future enhancements (real compiler, world system, optics system) are additive - they don't require changes to engine or app layers.

---

## Three-Layer Architecture

### Dependency Direction

```
App → Engine → Compiler
```

- **App** depends on Engine (calls render methods, sets parameters)
- **Engine** depends on Compiler output (CompiledRenderer)
- **Compiler** is standalone (pure transformation, no dependencies)

No circular dependencies. Clean, testable architecture.

### Communication Patterns

**Downward (Control Flow)**:
- App → Engine: "Load this renderer", "Render a frame", "Set this parameter"
- Engine → Compiler: "Compile this scene+strategy"

**Upward (Events)**:
- Engine → App: Progress updates, profiling data
- App → User: EventBus events, callback functions

**Horizontal (Data)**:
- Compiler → Engine: `CompiledRenderer` objects
- App → App: Parameters flow through ParameterStore

---

## Compiler Layer

### Purpose

Transform high-level rendering intent (`SceneDescription` + `RenderStrategy`) into low-level GPU execution plans (`CompiledRenderer`).

### Interface

```typescript
interface ICompiler {
  compile(scene: SceneDescription, strategy: RenderStrategy): CompiledRenderer;
}
```

### Input Types

**SceneDescription**: What to render
```typescript
interface SceneDescription {
  id: string;
  name?: string;
  // Future: geometry, materials, lights, cameras, etc.
}
```

**RenderStrategy**: How to render
```typescript
interface RenderStrategy {
  id: string;  // 'debug', 'pathtracer', 'pathtracer-aovs', etc.
  algorithms?: {
    transport?: string;
    sampling?: string;
    accumulation?: string;
  };
  settings?: {
    maxBounces?: number;
    samplesPerFrame?: number;
    debugOutput?: string;
  };
}
```

### Output Type

**CompiledRenderer**: Complete GPU execution specification
```typescript
interface CompiledRenderer {
  id: string;                                    // Unique identifier
  shaders: Map<string, ShaderProgram>;           // Compiled GLSL
  pipeline: RenderPipeline;                      // Framebuffers, passes, swaps
  uniforms: UniformBinding[];                    // Parameter mappings
  sourceMaps?: Map<string, SourceMap>;           // Error reporting
  parameters?: Record<string, ParameterMetadata>; // UI generation
  exportTargets?: Record<string, ExportTarget>;  // Named outputs
}
```

### Current Implementation: SimpleCompiler

The current compiler is a temporary validation tool that generates hardcoded GLSL for three strategies:
- `debug`: UV visualization
- `pathtracer`: Progressive accumulation with ping-pong buffers
- `pathtracer-aovs`: Path tracing with Multiple Render Targets (MRT)

**Key Implementation Details**:

1. **Shader Generation**: Hardcoded GLSL strings with placeholders
2. **Pipeline Specification**: Manually constructed framebuffer and pass configurations
3. **Uniform Bindings**: Hardcoded parameter→uniform mappings

Example debug renderer generation:
```typescript
private _generateDebugRenderer(scene: SceneDescription, strategy: RenderStrategy): CompiledRenderer {
  const shaders = new Map<string, ShaderProgram>();

  // Debug shader: UV visualization
  shaders.set('debug', {
    vertex: this._getFullscreenVertex(),
    fragment: `#version 300 es
      precision highp float;
      out vec4 fragColor;
      uniform vec2 u_resolution;
      void main() {
        vec2 uv = gl_FragCoord.xy / u_resolution;
        fragColor = vec4(uv, 0.5, 1.0);
      }`
  });

  // Pipeline: debug → RGB → composite → screen
  const pipeline: RenderPipeline = {
    framebuffers: [
      { id: 'rgb', type: 'texture', format: 'rgba8' },
      { id: 'screen', type: 'screen' }
    ],
    passes: [
      {
        id: 'debug-pass',
        shader: 'debug',
        output: 'rgb',
        execution: { type: 'once', clearBeforeRender: true }
      },
      {
        id: 'composite-pass',
        shader: 'composite',
        inputs: { textures: { 'u_rgb': 'rgb' } },
        output: 'screen',
        execution: { type: 'once' }
      }
    ]
  };

  return {
    id: `${strategy.id}-${scene.id}`,
    shaders,
    pipeline,
    uniforms: [...],
    exportTargets: { 'ldr': { bufferId: 'rgb', format: 'byte' } }
  };
}
```

### Future: Real Compiler

The real compiler will:
1. Parse `SceneDescription` to extract geometry, materials, lights
2. Generate GLSL modules for each component
3. Compose modules into complete shaders based on `RenderStrategy`
4. Build source maps for error reporting
5. Optimize uniform bindings
6. Validate completeness before returning

Will be built in Phase 7 after architecture validation is complete.

---

## Engine Layer

### Purpose

Execute `CompiledRenderer` objects on the GPU without knowing what they represent. Manages GPU resources, shader compilation, and rendering execution.

### Architecture

```
┌─────────────────────────────────────────────────────────┐
│                   FlexibleEngine                        │
│  - Load/select renderers                                │
│  - Track state (sample counts, time)                    │
│  - Coordinate subsystems                                │
│  - Handle parameters, exports, tiled rendering          │
└─────────────────────────────────────────────────────────┘
           │              │              │
           ▼              ▼              ▼
┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│   Resource   │ │   Render     │ │  Parameter   │
│   Manager    │ │   Executor   │ │   Manager    │
│              │ │              │ │              │
│ Framebuffers │ │ Compile GLSL │ │ Update       │
│ Textures     │ │ Execute      │ │ Uniforms     │
│ Swaps        │ │ Passes       │ │              │
└──────────────┘ └──────────────┘ └──────────────┘
```

### Component: FlexibleEngine

**Responsibilities**:
- Load multiple `CompiledRenderer` objects
- Switch active renderer
- Track per-renderer state (sample counts)
- Manage engine uniforms (resolution, time, frameIndex, etc.)
- Support tiled rendering (pixelOffset, imageSize)
- Load HDR environment maps with importance sampling
- Export rendered data (HDR, LDR, AOVs)

**Key Methods**:
```typescript
// Loading
loadRenderer(id: string, renderer: CompiledRenderer): void
selectRenderer(id: string): void

// Rendering
renderFrame(): void

// Parameters
setParameter(name: string, value: any): void
updateParameters(changes: ParameterChanges): void

// Export
readExport(name: string): Float32Array | Uint8Array
readBuffer(bufferId: string, format: 'float' | 'byte'): ...

// Tiled Rendering
setPixelOffset(x: number, y: number): void
setImageSize(width: number, height: number): void

// Environment
loadEnvironmentHDR(path: string): Promise<void>

// Utilities
clearAccumulation(): void
resize(width: number, height: number): void
```

**Engine Uniforms**:

The engine provides these uniforms to all shaders automatically:
- `u_resolution`: Canvas dimensions `[width, height]`
- `u_imageSize`: Full image size for tiled rendering `[width, height]`
- `u_frameIndex`: Current sample index (0, 1, 2, ...)
- `u_time`: Time since engine creation (seconds)
- `u_sampleCount`: Alias for frameIndex
- `u_pixelOffset`: Tile offset for tiled rendering `[x, y]`

**Per-Renderer State**:
```typescript
// Stored per renderer
private renderers = new Map<string, CompiledRenderer>();
private sampleCounts = new Map<string, number>();
private uniformLocations = new Map<string, Map<string, Map<string, WebGLUniformLocation>>>();
```

When switching renderers, sample count resets to 0 for the new renderer.

### Component: FlexibleResourceManager

**Responsibilities**:
- Parse `RenderPipeline` to create GPU resources
- Manage three framebuffer types:
  - `screen`: Default framebuffer (null)
  - `texture`: Single framebuffer with texture
  - `double_buffer`: Ping-pong pair for accumulation
- Support MRT (Multiple Render Targets)
- Resolve `_current` / `_previous` qualifiers dynamically
- Execute swap instructions (flip ping-pong buffers)

**Framebuffer Types**:

1. **Screen**: No GPU resources, just reference to default framebuffer
```typescript
{ id: 'screen', type: 'screen' }
→ framebuffer: null (default)
```

2. **Texture**: Single framebuffer with one or more attachments
```typescript
{ id: 'rgb', type: 'texture', format: 'rgba8' }
→ framebuffer: WebGLFramebuffer
→ texture: WebGLTexture (COLOR_ATTACHMENT0)

// MRT (Multiple attachments)
{ id: 'aovs', type: 'texture', format: ['rgba32f', 'rgba8', 'rgba16f'] }
→ framebuffer: WebGLFramebuffer
→ textures: [tex0, tex1, tex2] (COLOR_ATTACHMENT0-2)
```

3. **Double Buffer**: Ping-pong pair for accumulation
```typescript
{ id: 'accumulation', type: 'double_buffer', format: 'rgba32f' }
→ framebuffers: [fb0, fb1]
→ textures: [tex0, tex1]
→ currentIndex: 0 (or 1)
```

**ID Resolution**:

The resource manager parses IDs with qualifiers and attachment indices:

```typescript
// Base ID
'accumulation' → current buffer (whatever currentIndex points to)

// Qualifiers
'accumulation_current' → textures[currentIndex]
'accumulation_previous' → textures[1 - currentIndex]

// Attachment suffix (for MRT)
'aovs:0' → attachment 0 (radiance)
'aovs:1' → attachment 1 (albedo)
'aovs:2' → attachment 2 (normal)

// Combined
'accumulation_previous:1' → previous buffer, attachment 1
```

**Swap Instructions**:

After rendering, execute swaps to flip ping-pong buffers:
```typescript
{
  type: 'swap',
  buffers: ['accumulation']
}
```

This flips `currentIndex` from 0→1 or 1→0, so next frame reads from what was just written.

**Key Methods**:
```typescript
loadRenderer(rendererId: string, pipeline: RenderPipeline): void
selectRenderer(rendererId: string): void
getFramebuffer(id: string): WebGLFramebuffer | null
getTexture(id: string): WebGLTexture
executeSwap(instruction: SwapInstruction): void
resize(width: number, height: number): void
clearBuffer(bufferId: string): void
clearAllBuffers(): void
```

### Component: FlexibleRenderExecutor

**Responsibilities**:
- Compile GLSL shaders into WebGL programs
- Execute render passes according to `RenderPipeline`
- Bind framebuffers, textures, and uniforms
- Draw fullscreen triangles
- Support GPU profiling

**Fullscreen Triangle Technique**:

Uses `gl_VertexID` trick to generate vertices without VAO:
```glsl
// Vertex shader
void main() {
  vec2 vertices[3] = vec2[3](
    vec2(-1, -1),
    vec2( 3, -1),
    vec2(-1,  3)
  );
  gl_Position = vec4(vertices[gl_VertexID], 0, 1);
}
```

Then `gl.drawArrays(gl.TRIANGLES, 0, 3)` renders a fullscreen triangle.

**Pass Execution**:

For each pass in the pipeline:
1. Bind output framebuffer
2. Set viewport
3. Set draw buffers (if MRT)
4. Clear if requested
5. Use shader program
6. Bind input textures to texture units
7. Draw fullscreen triangle

**MRT Setup**:

When rendering to multiple outputs:
```typescript
output: ['aovs:0', 'aovs:1', 'aovs:2']
→ gl.drawBuffers([
     gl.COLOR_ATTACHMENT0,
     gl.COLOR_ATTACHMENT1,
     gl.COLOR_ATTACHMENT2
   ])
```

Fragment shader declares multiple outputs:
```glsl
layout(location = 0) out vec4 o_radiance;
layout(location = 1) out vec4 o_albedo;
layout(location = 2) out vec4 o_normal;
```

**Key Methods**:
```typescript
loadShaders(shaders: Map<string, ShaderProgram>): void
setActivePipeline(pipeline: RenderPipeline): void
executePass(pass: RenderPass): void
executePipeline(pipeline: RenderPipeline): void
getProgram(shaderId: string): WebGLProgram | undefined
```

### Component: ParameterManager

**Responsibilities**:
- Update shader uniforms when parameters change
- Cache uniform locations for fast updates
- Support batched parameter updates

**Note**: This component is partially deprecated. The new architecture handles parameters directly in FlexibleEngine using cached uniform locations.

### Component: GPUProfiler

**Responsibilities**:
- Measure GPU time for each render pass
- Use `EXT_disjoint_timer_query_webgl2` extension
- Provide per-pass timing data

**Usage**:
```typescript
app.enableProfiling(); // Returns false if extension not supported

const stats = app.getStats();
console.log(stats.gpuTimings);
// { 'main-pass': 2.3, 'display-pass': 0.1 } (milliseconds)
```

---

## App Layer

### Purpose

High-level orchestration of rendering modes, parameter management, session persistence, and user interactions.

### Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    FlexibleApp                          │
│  - Own Compiler, Engine, Coordinator                    │
│  - Initialize with scene + strategies                   │
│  - Manage renderer switching                            │
│  - Parameter API                                        │
│  - Export API                                           │
│  - Extensions system                                    │
└─────────────────────────────────────────────────────────┘
           │              │              │
           ▼              ▼              ▼
┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│   Render     │ │  Parameter   │ │   EventBus   │
│ Coordinator  │ │    Store     │ │              │
│              │ │              │ │              │
│ Interactive  │ │ Centralized  │ │ Pub/Sub      │
│ Production   │ │ State        │ │ Events       │
│ Progress     │ │ Lock/Unlock  │ │              │
└──────────────┘ └──────────────┘ └──────────────┘
```

### Component: FlexibleApp

**Responsibilities**:
- Own and coordinate Compiler, Engine, RenderCoordinator
- Initialize with scene and multiple strategies
- Compile all renderers upfront for fast switching
- Manage renderer selection with parameter persistence
- Provide interactive and production render modes
- Session save/restore
- Export API (PNG, HDR, AOVs)
- Extensions system
- Keyboard controls

**Initialization Flow**:
```typescript
const app = new FlexibleApp(canvas);

await app.initialize({
  scene: { id: 'cornell-box' },
  strategies: [
    { id: 'debug', settings: {} },
    { id: 'pathtracer', settings: { maxBounces: 8 } }
  ],
  initialParameters: { 'camera.fov': 60 },
  environmentHDR: './assets/studio.hdr'
});

app.start();
```

**What happens**:
1. Compile all strategies → `CompiledRenderer[]`
2. Load all renderers into engine
3. Select first renderer as active
4. Apply initial parameters via ParameterStore
5. Load environment HDR if provided
6. Ready to render

**Renderer Switching**:
```typescript
app.selectRenderer('pathtracer-cornell-box');
```

**What happens**:
1. Engine switches active renderer
2. ParameterStore resends all parameters (parameter persistence)
3. Engine clears accumulation for new renderer
4. EventBus emits `renderer.switched`

**Key Methods**:
```typescript
// Initialization
initialize(config: FlexibleAppConfig): Promise<void>
loadEnvironmentHDR(path: string): Promise<void>

// Rendering
start(): void
stop(): void
pause(): void
resume(): void
renderProduction(targetSamples: number, options?: ...): Promise<void>

// Parameters
setParameter(path: string, value: any): void
setParameters(params: Record<string, any>): void
getParameter(path: string): any

// Export
exportPNG(filename?: string): void
exportHDR(filename?: string): void
exportAOV(aovName: string, filename?: string): void

// Session
saveSession(): SessionData
restoreSession(session: SessionData): void
quickSave(): void
loadSessionFromFile(): void

// Extensions
use(extension: Extension): void
unuse(extensionName: string): void
```

### Component: FlexibleRenderCoordinator

**Responsibilities**:
- Manage render loop (interactive mode)
- Execute production renders (goal-driven mode)
- Track progress (samples, FPS, elapsed time)
- Reset accumulation when parameters change
- Report progress via EventBus and callbacks

**Two Modes**:

**Interactive Mode**:
```typescript
app.start();
// → Continuous rendering loop
// → Parameters unlocked
// → Runs until stop() or pause()
```

**Production Mode**:
```typescript
await app.renderProduction(1000);
// → Renders until 1000 samples reached
// → Parameters locked
// → Returns Promise that resolves on completion
// → Can be stopped with stop() → Promise rejects
```

**Accumulation Reset Logic**:

Some parameter changes trigger accumulation reset:
```typescript
private shouldResetForParameter(path: string): boolean {
  // Reset for camera parameters
  if (path.startsWith('camera.')) return true;

  // Reset for material parameters
  if (path.startsWith('material.')) return true;

  // Don't reset for display parameters
  if (path.startsWith('display.')) return false;
  if (path === 'renderer.displayMode') return false;
  if (path === 'developer.exposure') return false;

  // Default: reset
  return true;
}
```

**Progress Reporting**:
```typescript
interface ProgressInfo {
  samples: number;
  targetSamples?: number;
  elapsedTime: number;
  fps: number;
  mode: 'interactive' | 'production';
  state: 'rendering' | 'paused' | 'complete' | 'stopped';
  percentComplete?: number;
}
```

Emitted every frame to:
- `coordinator.onProgress` callback
- `EventBus` event `render.progress`
- `app.onProgress` callback

**Key Methods**:
```typescript
startInteractive(): void
startProduction(options: { targetSamples: number }): Promise<void>
stop(): void
pause(): void
resume(): void
resetAccumulation(reason: string): void
getSampleCount(): number
getFPS(): number
```

### Component: ParameterStore

**Responsibilities**:
- Single source of truth for all parameter values
- Change notification with batching
- Lock/unlock for production mode
- Session serialization/restore
- Parameter persistence on renderer switch

**Change Flow**:
```typescript
parameterStore.set('camera.fov', 60);
```

**What happens**:
1. Check if locked (production mode) → warn and return
2. Check if value changed → skip if same
3. Store new value
4. Trigger `onChange` callback with changes:
   ```typescript
   onChange({
     changes: [{
       path: 'camera.fov',
       oldValue: 45,
       newValue: 60
     }]
   })
   ```
5. App receives callback and:
   - Forwards to engine
   - Checks if should reset accumulation
   - Emits EventBus event

**Batch Updates**:
```typescript
parameterStore.batch({
  'camera.fov': 60,
  'camera.position': [0, 1, 5],
  'material.roughness': 0.5
});
// → Single onChange callback with 3 changes
```

**Parameter Persistence**:

When switching renderers:
```typescript
parameterStore.resendAll();
// → Calls onChange with all parameters
// → oldValue === newValue (special "resend" case)
// → App detects resend and skips accumulation reset
```

**Lock/Unlock**:
```typescript
// Production mode
parameterStore.lock();
parameterStore.set('camera.fov', 60); // ⚠️ Ignored, logs warning

parameterStore.unlock();
parameterStore.set('camera.fov', 60); // ✅ Works
```

**Key Methods**:
```typescript
set(path: string, value: any): void
batch(updates: Record<string, any>): void
get(path: string): any
resendAll(): void
lock(): void
unlock(): void
isLocked(): boolean
serialize(): Record<string, any>
restore(params: Record<string, any>): void
```

### Component: EventBus

**Responsibilities**:
- Loose coupling between components
- Pub/sub event system
- Error isolation (handler errors don't affect other handlers)

**Common Events**:
```typescript
'render.started'
'render.stopped'
'render.complete'
'render.progress' → ProgressInfo
'parameter.changed' → { path, oldValue, newValue }
'accumulation.reset' → { reason: string }
'renderer.switched' → { rendererId: string }
'session.saved' → SessionData
'session.loaded' → SessionData
'extension.installed' → { name, version }
```

**Usage**:
```typescript
const eventBus = app.getEventBus();

eventBus.on('render.progress', (info) => {
  console.log(`${info.samples} samples, ${info.fps} FPS`);
});

eventBus.once('render.complete', () => {
  console.log('Render finished!');
});
```

**Key Methods**:
```typescript
on(event: string, handler: EventHandler): void
off(event: string, handler: EventHandler): void
once(event: string, handler: EventHandler): void
emit(event: string, data?: any): void
removeAllListeners(event?: string): void
```

---

## Data Flow

### Frame Rendering Flow

```
User: app.start()
  ↓
FlexibleApp: coordinator.startInteractive()
  ↓
RenderCoordinator: Start requestAnimationFrame loop
  ↓
  ┌─────────────────────────────────────────┐
  │         Per-Frame Execution             │
  └─────────────────────────────────────────┘
  ↓
FlexibleApp: engine.renderFrame()
  ↓
FlexibleEngine:
  1. Get active renderer
  2. Build engine uniforms (resolution, time, frameIndex, etc.)
  3. Set engine uniforms for all shaders in pipeline
  4. Set custom uniforms from UniformBinding.compute()
  5. renderExecutor.executePipeline(pipeline)
  ↓
FlexibleRenderExecutor:
  For each pass in pipeline:
    1. profiler.beginPass(passId)
    2. Bind output framebuffer
    3. Set viewport
    4. Set draw buffers (if MRT)
    5. Clear if requested
    6. Use shader program
    7. Bind input textures
    8. gl.drawArrays(gl.TRIANGLES, 0, 3)
    9. profiler.endPass(passId)
  After all passes:
    Execute post-frame swaps
  ↓
FlexibleResourceManager: executeSwap()
  - Flip currentIndex for double_buffer
  ↓
FlexibleEngine: Increment sample count
  ↓
RenderCoordinator:
  - Update FPS, elapsed time
  - Emit progress event
  - Check if production target reached
  ↓
  Loop to next frame (or stop if target reached)
```

### Parameter Change Flow

```
User: app.setParameter('camera.fov', 60)
  ↓
ParameterStore:
  1. Check if locked → return if locked
  2. Check if value changed → skip if same
  3. Store value
  4. Trigger onChange callback
  ↓
FlexibleApp.onChange:
  For each change:
    1. Forward to engine.setParameter()
    2. Check if should reset accumulation
    3. If not a resend: emit EventBus event
    4. Call onParameterChanged callback
  ↓
FlexibleEngine.setParameter():
  - Store in customParameters map
  - Will be used in next renderFrame()
  ↓
RenderCoordinator (if rendering):
  - Reset accumulation if needed
  - Clear GPU buffers
  - Reset sample count to 0
  ↓
Next frame uses new parameter value
```

### Renderer Switch Flow

```
User: app.selectRenderer('pathtracer-cornell-box')
  ↓
FlexibleApp:
  1. engine.selectRenderer(id)
  2. parameterStore.resendAll()
  3. engine.clearAccumulation()
  4. Emit renderer.switched event
  ↓
FlexibleEngine.selectRenderer():
  1. resourceManager.selectRenderer(id)
  2. renderExecutor.setActivePipeline(renderer.pipeline)
  3. Initialize parameter manager with first shader
  4. Set activeRendererId
  5. Reset profiler
  ↓
ParameterStore.resendAll():
  - Emit onChange with all parameters
  - oldValue === newValue (special resend case)
  ↓
FlexibleApp.onChange:
  - Detects resend (oldValue === newValue)
  - Skips accumulation reset
  - Forwards parameters to new renderer
  ↓
FlexibleEngine.clearAccumulation():
  - Reset sample count to 0
  - resourceManager.clearAllBuffers()
  ↓
Next frame renders with new renderer
```

### Production Render Flow

```
User: await app.renderProduction(1000)
  ↓
FlexibleApp:
  1. parameterStore.lock()
  2. coordinator.resetAccumulation('production_start')
  3. await coordinator.startProduction({ targetSamples: 1000 })
  4. [On complete] Auto-export if requested
  5. parameterStore.unlock()
  ↓
RenderCoordinator.startProduction():
  1. Set mode = 'production'
  2. Set locked = true
  3. Set targetSamples = 1000
  4. Create Promise (productionPromise)
  5. Start render loop
  ↓
  Per frame:
    1. Render frame
    2. Update progress with percentComplete
    3. Emit progress event
    4. Check if samples >= targetSamples
      → If yes: resolve productionPromise
      → If no: continue
  ↓
Promise resolves → FlexibleApp continues
  ↓
Auto-export (if requested):
  - exportPNG()
  - exportHDR()
  ↓
Unlock parameters
  ↓
Return to user
```

---

## Key Technical Concepts

### Ping-Pong Buffers

Progressive accumulation requires reading the previous frame's result while writing the current frame:

```
Frame N:
  Read:  accumulation_previous (buffer 0)
  Write: accumulation_current  (buffer 1)

Post-frame swap:
  currentIndex: 0 → 1

Frame N+1:
  Read:  accumulation_previous (buffer 1)  ← was "current" last frame
  Write: accumulation_current  (buffer 0)  ← was "previous" last frame
```

**GLSL Usage**:
```glsl
uniform sampler2D u_previous;  // Reads accumulation_previous
layout(location = 0) out vec4 o_radiance;  // Writes to accumulation_current

void main() {
  vec4 prev = texture(u_previous, uv);
  vec4 current = pathTrace();

  // Average with previous samples
  float n = float(u_sampleCount);
  o_radiance = (prev * n + current) / (n + 1.0);
}
```

**Pipeline Specification**:
```typescript
{
  framebuffers: [
    { id: 'accumulation', type: 'double_buffer', format: 'rgba32f' }
  ],
  passes: [{
    inputs: { textures: { 'u_previous': 'accumulation_previous' } },
    output: 'accumulation_current',
    // ...
  }],
  postFrame: {
    swaps: [{ type: 'swap', buffers: ['accumulation'] }]
  }
}
```

### Multiple Render Targets (MRT)

Render to multiple textures simultaneously:

**Framebuffer Config**:
```typescript
{
  id: 'aovs',
  type: 'texture',
  format: ['rgba32f', 'rgba8', 'rgba16f']  // 3 attachments
}
```

**Pass Config**:
```typescript
{
  output: ['aovs:0', 'aovs:1', 'aovs:2'],  // Write to all 3
  // ...
}
```

**Fragment Shader**:
```glsl
layout(location = 0) out vec4 o_radiance;
layout(location = 1) out vec4 o_albedo;
layout(location = 2) out vec4 o_normal;

void main() {
  o_radiance = pathTrace();
  o_albedo = getSurfaceAlbedo();
  o_normal = getSurfaceNormal();
}
```

**Export**:
```typescript
exportTargets: {
  'hdr': { bufferId: 'aovs', format: 'float', attachment: 0 },
  'albedo': { bufferId: 'aovs', format: 'float', attachment: 1 },
  'normal': { bufferId: 'aovs', format: 'float', attachment: 2 }
}
```

### Tiled Rendering

Render large images by breaking into tiles:

```typescript
// Setup
app.setImageSize(8192, 8192);  // Full image size

// Render tiles
for (let ty = 0; ty < numTilesY; ty++) {
  for (let tx = 0; tx < numTilesX; tx++) {
    app.setPixelOffset(tx * tileWidth, ty * tileHeight);

    // Render N samples for this tile
    await app.renderProduction(samples);

    // Read tile data
    const pixels = app.readExport('hdr');

    // Stitch into final image...
  }
}

// Cleanup
app.clearPixelOffset();
app.clearImageSize();
```

**How it works**:
- `u_imageSize` uniform: Full output resolution
- `u_pixelOffset` uniform: Current tile offset
- Shader computes correct pixel coordinates:
  ```glsl
  vec2 pixelPos = gl_FragCoord.xy + u_pixelOffset;
  vec2 uv = pixelPos / u_imageSize;
  ```

### Uniform Bindings

Map application parameters to shader uniforms with compute functions:

```typescript
{
  uniform: 'u_fov',
  parameters: ['camera.fov'],
  type: 'float',
  compute: (params) => params['camera.fov'] * Math.PI / 180
}
```

**Multi-parameter bindings**:
```typescript
{
  uniform: 'u_viewMatrix',
  parameters: ['camera.position', 'camera.target', 'camera.up'],
  type: 'mat4',
  compute: (params) => {
    return lookAt(
      params['camera.position'],
      params['camera.target'],
      params['camera.up']
    );
  }
}
```

**Execution**:
1. User changes parameter via ParameterStore
2. ParameterStore notifies engine
3. Engine stores parameter value
4. On next renderFrame():
   - Collect all parameter values
   - For each UniformBinding:
     - Call compute() with parameter values
     - Set uniform in shader

### Session Management

Complete state capture for save/restore:

```typescript
interface SessionData {
  version: string;
  timestamp: number;

  // Core state
  activeRecipe: string;
  parameters: Record<string, any>;

  // Render state
  renderMode: 'interactive' | 'production';
  sampleCount: number;

  // Camera state
  camera: { position, target, frame, fov };

  // Extension states
  extensions: Record<string, any>;

  // Tiled rendering state
  tileJob?: TileJob;
}
```

**Save**:
```typescript
const session = app.saveSession();
// → Serializes ParameterStore, active renderer, extension states
// → Returns JSON-serializable object
```

**Restore**:
```typescript
app.restoreSession(session);
// → Restores parameters via ParameterStore.restore()
// → Switches to saved renderer
// → Restores extension states
```

---

## Design Decisions

### Why Three Layers?

**Separation of Concerns**: Each layer has a single responsibility:
- Compiler: Code generation
- Engine: GPU execution
- App: User interaction

**Testability**: Each layer can be tested independently. Mock a `CompiledRenderer` to test engine without compiler.

**Flexibility**: Replace SimpleCompiler with real compiler without changing engine or app.

### Why Data-Driven Pipelines?

**No Hardcoded Rendering Logic**: The engine doesn't know what "path tracing" means. It just executes pipelines.

**Compiler Has Full Control**: Want a 10-pass deferred renderer? Compiler generates that pipeline. Want a single-pass forward renderer? Compiler generates that pipeline. Engine doesn't care.

**Runtime Validation**: Can validate pipeline correctness before execution (all shaders exist, all framebuffer refs valid, etc.)

### Why Compile All Strategies Upfront?

**Instant Switching**: Pre-compile all renderers → switch instantly with no hitches.

**Parameter Persistence**: ParameterStore maintains values across switches. Camera position doesn't reset when switching from debug to pathtracer.

**User Experience**: Smooth, responsive UI. No loading screens when exploring render modes.

### Why ParameterStore?

**Single Source of Truth**: All parameter values in one place. No scattered state.

**Change Notification**: Components subscribe to changes without tight coupling.

**Lock/Unlock**: Production mode safety - prevents accidental parameter changes during long renders.

**Batching**: Set multiple parameters with single notification → reduces overhead.

### Why EventBus?

**Loose Coupling**: Components communicate without direct dependencies.

**Extensibility**: Extensions can subscribe to events without modifying core code.

**Error Isolation**: Handler errors don't break other handlers.

### Why Two Render Modes?

**Interactive**: For exploration. Continuous rendering, live parameters, instant feedback.

**Production**: For final output. Goal-driven (target samples), locked parameters, progress tracking, auto-export.

Different use cases require different behaviors. Clean separation makes both cases simple.

### Naming Conventions

**Buffer IDs**: Use underscore (`accumulation_current`, `accumulation_previous`)
- **Rationale**: GLSL doesn't allow hyphens in identifiers. Consistency with shader ecosystem.

**Uniforms**: Use u_camelCase (`u_resolution`, `u_sampleCount`, `u_envMap`)
- **Rationale**: Standard WebGL convention. Distinguishes uniforms from local variables.

**Type vs Interface**: Use `type` for unions/primitives, `interface` for objects
- **Rationale**: Semantic clarity. Types for value types, interfaces for structured data.

---

## Future Work

The current architecture is production-ready. Future enhancements are additive:

### Phase 7: Real Compiler

Replace `SimpleCompiler` with actual code generation:

**Input**: ModuleDescriptor system (world/ and optics/)
```typescript
const scene = {
  ambient: euclideanAmbient,
  environment: hdriEnvironmentImportance,
  scene: raymarchScene,
  lighting: quadLight
};

const optics = {
  camera: pinholeCamera,
  interaction: lambertInteraction,
  transport: pathTracerDirectLight,
  accumulator: averageAccumulator,
  developer: gammaDeveloper
};

const renderer = compiler.compile({ scene, optics }, strategy);
```

**What compiler does**:
1. Extract GLSL fragments from each module
2. Concatenate in dependency order (ambient → scene → camera → ...)
3. Generate fullscreen fragment shader
4. Build uniform bindings from module declarations
5. Generate pipeline specification based on strategy
6. Create source maps for error reporting
7. Return `CompiledRenderer`

**Engine and App**: No changes needed!

### Phase 8: World System

Build world/ modules:
- **Ambient**: Euclidean, hyperbolic, spherical spaces
- **Scene**: SDF scenes, mesh scenes, procedural
- **Environment**: Constant, gradient, HDRI with importance sampling
- **Lighting**: Point, quad, mesh, environment

Each module is a `ModuleDescriptor` with GLSL code and metadata.

### Phase 9: Optics System

Build optics/ modules:
- **Camera**: Pinhole, thin lens, orthographic, fisheye
- **Interaction**: Lambert, mirror, glass, Disney BRDF
- **Transport**: Direct lighting, path tracing, bidirectional, photon mapping
- **Accumulator**: Average, weighted, temporal
- **Developer**: Gamma, filmic, ACES, false color

Each module is a `ModuleDescriptor` with GLSL code and metadata.

**Result**: Fully composable rendering system where users can mix-and-match any module combination without writing GLSL.

---

## Conclusion

PathTracerGLSL's three-layer architecture provides:

✅ **Clean separation of concerns**
✅ **Data-driven execution**
✅ **Flexibility through compilation**
✅ **Type safety with TypeScript**
✅ **Production-ready infrastructure**
✅ **Extensible without modification**

The architecture is complete and validated. Building the real compiler and module system is now straightforward additive work that requires no changes to the engine or app layers.
