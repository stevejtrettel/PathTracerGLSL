# Architecture: Compiler-Engine Paradigm

## Core Concept

The new architecture separates shader **generation** (what code to write) from **execution** (how to run it):

```
┌──────────────────────────────────────────────────────────────┐
│  COMPILER: "What code should I generate?"                    │
│  - Takes scene description + rendering strategy              │
│  - Generates GLSL shaders                                    │
│  - Produces execution pipeline specification                 │
│  - Creates uniform bindings for parameters                   │
└──────────────────────────────────────────────────────────────┘
                              │
                              │ CompiledRenderer
                              ↓
┌──────────────────────────────────────────────────────────────┐
│  ENGINE: "How do I execute this?"                            │
│  - Creates GPU resources from pipeline spec                  │
│  - Compiles and links shaders                                │
│  - Executes render passes blindly                            │
│  - Manages state, timing, parameters                         │
└──────────────────────────────────────────────────────────────┘
```

## The Contract: CompiledRenderer

The `CompiledRenderer` interface is the complete contract between Compiler and Engine:

```typescript
interface CompiledRenderer {
    id: string;                              // Unique identifier
    shaders: Map<string, ShaderProgram>;     // GLSL vertex + fragment
    pipeline: RenderPipeline;                // Execution specification
    uniforms: UniformBinding[];              // Parameter system bindings
    sourceMaps?: Map<string, SourceMap>;     // Error reporting
    parameters?: Record<string, ParameterMetadata>;  // UI metadata
    exportTargets?: Record<string, ExportTarget>;    // Read operations
}
```

## Pipeline Specification

The `RenderPipeline` tells Engine **exactly** what GPU work to execute:

```typescript
interface RenderPipeline {
    framebuffers: FramebufferConfig[];    // GPU buffers to create
    passes: RenderPass[];                 // Render passes in order
    postFrame?: {
        swaps?: SwapInstruction[];        // Buffer swapping (ping-pong)
    };
}
```

### Example: Pathtracer Pipeline

```typescript
{
    framebuffers: [
        { id: 'accumulation', type: 'double_buffer', format: 'rgba32f' },
        { id: 'screen', type: 'screen' }
    ],
    passes: [
        {
            id: 'main-pass',
            shader: 'pathtracer-main',
            inputs: { textures: { 'u_previous': 'accumulation_previous' } },
            output: 'accumulation_current',
            execution: { type: 'once', clearBeforeRender: false }
        },
        {
            id: 'display-pass',
            shader: 'pathtracer-display',
            inputs: { textures: { 'u_radiance': 'accumulation_current' } },
            output: 'screen',
            execution: { type: 'once', clearBeforeRender: true }
        }
    ],
    postFrame: {
        swaps: [{ type: 'swap', buffers: ['accumulation'] }]
    }
}
```

## Engine Components

### FlexibleEngine (Orchestration)
- **Purpose**: High-level coordination
- **Owns**: ResourceManager, RenderExecutor, ParameterManager
- **Responsibilities**:
  - Load/select renderers
  - Manage frame state (time, samples, frameIndex)
  - Set engine uniforms (`u_resolution`, `u_sample_count`, etc.)
  - Export/read operations
  - Context loss handling
  - Resize handling

### FlexibleResourceManager (GPU Resources)
- **Purpose**: Dynamic framebuffer creation
- **Responsibilities**:
  - Create framebuffers from `FramebufferConfig`
  - Handle screen/texture/double_buffer types
  - Support rgba32f/rgba16f/rgba8/r32f formats
  - Execute swap instructions (ping-pong buffers)
  - Smart ID parsing (`accumulation_current`, `accumulation_previous`)

### FlexibleRenderExecutor (Execution)
- **Purpose**: Execute render passes
- **Responsibilities**:
  - Compile and link shaders
  - Execute individual `RenderPass`
  - Bind framebuffers, textures, uniforms
  - Draw fullscreen triangle (no VAO needed)
  - Execute complete `RenderPipeline`

## Data Flow

```
┌─────────────────────────────────────────────────────────────────┐
│  1. COMPILE TIME                                                │
├─────────────────────────────────────────────────────────────────┤
│  Scene + Strategy  →  Compiler  →  CompiledRenderer            │
│                                                                  │
│  - Compiler analyzes scene (geometry, materials, lights)        │
│  - Compiler analyzes strategy (algorithms, settings)            │
│  - Compiler generates GLSL shaders                              │
│  - Compiler produces pipeline specification                     │
│  - Compiler creates uniform bindings                            │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  2. LOAD TIME                                                   │
├─────────────────────────────────────────────────────────────────┤
│  CompiledRenderer  →  Engine.loadRenderer()                    │
│                                                                  │
│  - ResourceManager creates framebuffers from pipeline spec      │
│  - RenderExecutor compiles shaders                              │
│  - ParameterManager registers uniform bindings                  │
│  - Renderer stored in Engine's renderer map                     │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  3. RENDER TIME (every frame)                                   │
├─────────────────────────────────────────────────────────────────┤
│  Engine.renderFrame()                                           │
│                                                                  │
│  1. Engine updates state (time, frameIndex, samples)            │
│  2. Engine evaluates parameters (ParameterManager)              │
│  3. RenderExecutor executes pipeline:                           │
│     - For each pass in pipeline.passes:                         │
│       a. Bind output framebuffer                                │
│       b. Use shader program                                     │
│       c. Bind input textures                                    │
│       d. Set uniforms                                           │
│       e. Draw fullscreen triangle                               │
│  4. ResourceManager executes swaps (ping-pong buffers)          │
│  5. Engine increments sample count, frame index                 │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  4. READ TIME (on demand)                                       │
├─────────────────────────────────────────────────────────────────┤
│  Engine.readExport('hdr')  →  Float32Array/Uint8Array          │
│                                                                  │
│  - Engine looks up export target in renderer.exportTargets      │
│  - Engine reads from specified framebuffer                      │
│  - Returns pixel data for file export, screenshots, etc.        │
└─────────────────────────────────────────────────────────────────┘
```

## Uniform Management

Engine sets **four core uniforms** directly (not via parameter system):

1. `u_resolution: vec2` - Canvas resolution
2. `u_frame_index: int` - Frame counter (monotonic)
3. `u_sample_count: int` - Sample counter (resets on accumulation clear)
4. `u_time: float` - Elapsed time in seconds

All other uniforms come from the **parameter system** via `UniformBinding[]`.

## Export System

Compilers define named **export targets** for reading rendered outputs:

```typescript
exportTargets: {
    'hdr': { bufferId: 'accumulation_current', format: 'float' },
    'ldr': { bufferId: 'screen', format: 'byte' },
    'albedo': { bufferId: 'aov-albedo', format: 'byte' },
    'normal': { bufferId: 'aov-normal', format: 'byte' },
    'depth': { bufferId: 'aov-depth', format: 'float', channels: 1 }
}
```

Users can then read outputs by name:

```typescript
const hdrData = engine.readExport('hdr');        // Float32Array
const ldrData = engine.readExport('ldr');        // Uint8Array
const albedo = engine.readExport('albedo');      // Uint8Array
```

## Why This Design?

### Problem with Old System
The old system concatenated GLSL modules as strings:
- Modules couldn't communicate during "compilation"
- All decisions frozen when strings were concatenated
- Hard to optimize across module boundaries
- Difficult to implement AOVs, multi-pass algorithms

### Solution: Compiler-Engine Separation
- **Compiler has full context**: Sees entire scene + strategy
- **Compiler can make smart decisions**: Code generation, optimizations, passes
- **Engine is simple and fast**: No scene knowledge, just executes pipeline
- **Clean contract**: `CompiledRenderer` interface
- **Multiple renderers**: Engine can load many renderers, switch instantly
- **Flexible exports**: Compiler defines what outputs are available

## Future: Real Compiler

`SimpleCompiler` is hardcoded for validation. The **real Compiler** will:

1. **Analyze scene**: Parse geometry, materials, lights, cameras
2. **Analyze strategy**: Understand algorithm requirements
3. **Generate GLSL**: Use templates, code generation, AST manipulation
4. **Optimize**: Dead code elimination, constant folding, inlining
5. **Create pipeline**: Determine passes, buffers, dependencies
6. **Bind parameters**: Map parameters to shader uniforms

This enables:
- Multiple importance sampling
- Denoising passes
- AOVs (albedo, normal, depth)
- Adaptive sampling
- Temporal accumulation
- And more...

All without changing the Engine!
