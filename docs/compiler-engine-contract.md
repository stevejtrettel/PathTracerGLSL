# Compiler-Engine Architecture

## Status: LOCKED IN ✅

This document defines the core architecture for the new Compiler-Engine system, replacing the module-based approach. These decisions are locked and should guide all implementation work.

**Date:** January 2025  
**Context:** Major refactor from module-based (9 modules) to Compiler-based system

---

## 1. Core Terminology

### SceneDescription
A **SceneDescription** defines the world being rendered (geometry, materials, lights).

```typescript
interface SceneDescription {
  objects: ObjectDescription[];
  materials: MaterialDescription[];
  lights: LightDescription[];
}
```

**Deferred:** The exact structure of ObjectDescription, MaterialDescription, etc. will be designed during Compiler implementation. For now, we just need to know "a scene has these three categories of things."

**Key insight:** The scene is what you're rendering. Different rendering strategies produce different views/outputs of the same scene.

---

### RenderStrategy
A **RenderStrategy** specifies one complete rendering approach (debug, preview, production, etc.).

```typescript
interface RenderStrategy {
  id: string;                    // 'debug' | 'preview' | 'production'
  name?: string;                 // Display name
  
  // Which algorithms to use (details TBD during implementation)
  algorithms: {
    transport: string;           // 'pathtracer-nee', 'one-shot', 'debug-visualizer'
    sampling?: string;           // 'cosine', 'mis', 'importance'
    accumulation?: string;       // 'average', 'weighted', 'variance-based'
    // ... other algorithm slots
  };
  
  // Algorithm-specific settings
  settings?: {
    maxBounces?: number;
    samplesPerFrame?: number;
    debugOutput?: 'albedo' | 'normal' | 'depth';
    // ... other settings
  };
}
```

**Note:** We're NOT designing the exact structure of `algorithms` or `settings` now. These will evolve during implementation. The important part is that RenderStrategy specifies "which algorithms" and "their parameters."

---

### CompiledRenderer
A **CompiledRenderer** is everything Engine needs to execute one rendering strategy.

```typescript
interface CompiledRenderer {
  id: string;
  
  // All shader programs needed
  shaders: Map<string, ShaderProgram>;
  
  // How to execute them
  pipeline: RenderPipeline;
  
  // For parameter system
  uniforms: UniformBinding[];
  
  // For error reporting
  sourceMap: SourceMap;
}

interface ShaderProgram {
  vertex: string;
  fragment: string;
}
```

**Key points:**
- Variable number of shaders (debug might have 1, production might have 5)
- RenderPipeline describes how Engine should execute them
- UniformBinding[] connects parameter system to shader uniforms

---

## 2. The RenderPipeline Contract

The **RenderPipeline** is the contract between Compiler and Engine. Compiler generates it, Engine executes it.

```typescript
interface RenderPipeline {
  framebuffers: FramebufferConfig[];
  passes: RenderPass[];
  postFrame?: {
    swaps?: SwapInstruction[];
  };
}

interface SwapInstruction {
  type: 'swap' | 'rotate';
  buffers: string[];
}
```

**Pipeline Execution Flow:**

1. **Setup:** Create framebuffers (once at load time)
2. **Each frame:**
   - Execute all passes in order
   - Execute postFrame operations (if specified)
     - Swap double buffers
     - Rotate buffer queues

**Key Design Principles:**

- **Passes describe rendering:** What to draw and where
- **PostFrame describes buffer management:** What to swap/rotate
- **Fully declarative:** Engine just follows instructions, no hidden behavior
- **Separation of concerns:** Rendering logic separate from buffer management

---

### SwapInstruction

Controls buffer management after all passes complete.

```typescript
interface SwapInstruction {
  type: 'swap' | 'rotate';
  buffers: string[];
}
```

**`type: 'swap'`** - Ping-pong swap for double buffers
- Takes one buffer ID (must be `type: 'double_buffer'`)
- Swaps `current` ↔ `previous`
- Use for: Progressive accumulation

Example:
```typescript
{ type: 'swap', buffers: ['accumulation'] }
// After: accumulation_current and accumulation_previous swap roles
```

**`type: 'rotate'`** - Queue rotation for temporal history
- Takes multiple buffer IDs (all must be `type: 'texture'`)
- Rotates: buffers[0] → buffers[1] → buffers[2] → ... → buffers[n] (discarded)
- Use for: Temporal anti-aliasing, temporal denoising

Example:
```typescript
{ type: 'rotate', buffers: ['current', 'history1', 'history2', 'history3'] }
// After: current → history1, history1 → history2, history2 → history3, history3 discarded
```

---

### Design Rationale: Explicit vs Implicit Swapping

**Why use explicit swap instructions instead of automatic behavior?**

We considered three approaches:

**Option A: Implicit swapping (rejected)**
```typescript
{ id: 'accumulation', type: 'double_buffer', swapAfterFrame: true }
```
Problems:
- Temporal history requires manual code (breaks declarative model)
- Swap behavior hidden in framebuffer config (less obvious)
- Can't handle multiple swap types in one frame
- Harder to debug (where does swap happen?)

**Option B: Execution-type swapping (rejected)**
```typescript
execution: { type: 'accumulate' }  // Pass type implies swap
```
Problems:
- Conflates rendering behavior with buffer management
- "Accumulate" isn't an execution type, it's a buffer operation
- Not flexible enough for complex patterns

**Option C: Explicit swaps (chosen)** ✅
```typescript
postFrame: {
  swaps: [{ type: 'swap', buffers: ['accumulation'] }]
}
```
Benefits:
- **Clean separation:** Passes describe rendering, postFrame describes buffer management
- **Fully declarative:** Everything the Engine needs to do is explicit in the pipeline
- **Handles all patterns:** Ping-pong, temporal queues, multiple independent buffers
- **Easy to debug:** Clear where and when swaps happen
- **Compiler-generated:** Users don't write this by hand, so verbosity doesn't matter

**Key insight:** The complexity is in the Compiler (which must generate the right swaps), not in the user-facing API. The Engine just follows instructions.

---

### FramebufferConfig

Declares what GPU resources are needed.

```typescript
interface FramebufferConfig {
  id: string;              // 'accumulation', 'intermediate', 'screen'
  type: FramebufferType;   // 'double_buffer' | 'texture' | 'screen'
  format: TextureFormat;   // 'rgba32f' | 'rgba8' | 'rgba16f' | 'r32f' | 'depth'
  multisampled?: boolean;  // Optional: enable MSAA
}

type FramebufferType = 
  | 'double_buffer'  // Creates ping/pong pair for progressive accumulation
  | 'texture'        // Single buffer, no automatic management
  | 'screen';        // null framebuffer (canvas output)

type TextureFormat =
  | 'rgba32f'  // High precision (path tracing accumulation)
  | 'rgba16f'  // Medium precision (normals, HDR intermediate)
  | 'rgba8'    // Low precision (LDR display)
  | 'r32f'     // Single channel float (depth, variance)
  | 'depth';   // Depth buffer
```

**Framebuffer Type Semantics:**

**`type: 'double_buffer'`**
- Engine creates TWO buffers (ping and pong)
- Provides `{id}_current` and `{id}_previous` textures
- Swapping is controlled explicitly via `postFrame.swaps` (see below)
- Use for: Progressive accumulation, temporal filtering

**`type: 'texture'`**
- Engine creates ONE buffer
- No automatic management
- Use for: Intermediate results, auxiliary buffers (albedo, normals), history queues

**`type: 'screen'`**
- Maps to null framebuffer (canvas)
- Only one screen framebuffer should exist per pipeline
- Always the final output target

---

### RenderPass

Describes one rendering operation.

```typescript
interface RenderPass {
  id: string;              // 'pathtracer', 'display', 'denoise', etc.
  shader: string;          // Which shader program to use
  
  // What this pass reads
  inputs: {
    textures?: Record<string, string>;   // { 'u_accumulated': 'accumulation_previous' }
    uniforms?: string[];                  // Additional uniforms needed (optional)
  };
  
  // What this pass writes
  output: string;          // Framebuffer ID to render to
  
  // Execution behavior
  execution: {
    type: ExecutionType;
    iterations?: number;             // For 'loop' type
    clearBeforeRender?: boolean;     // Clear framebuffer before drawing
  };
}

type ExecutionType =
  | 'once'        // Execute once per frame
  | 'loop';       // Execute N times per frame (for multi-sample rendering)
```

**Execution Type Semantics:**

**`type: 'once'`**
- Execute this pass once per frame
- Use for: Most rendering passes (pathtracer, display, tone mapping, etc.)

**`type: 'loop'`**
- Execute this pass `iterations` times per frame
- Use for: Multiple samples per frame (future feature)

**Note:** Buffer swapping is NOT controlled by execution type. See `postFrame.swaps` below.

---

## 3. Example RenderPipelines

### Example 1: Debug Renderer (Single Pass)

**RenderStrategy:**
```typescript
{
  id: 'debug',
  algorithms: {
    transport: 'debug-visualizer'
  },
  settings: {
    debugOutput: 'albedo'
  }
}
```

**Generated RenderPipeline:**
```typescript
{
  framebuffers: [
    { id: 'screen', type: 'screen', format: 'rgba8' }
  ],
  
  passes: [
    {
      id: 'debug',
      shader: 'debug-visualizer',
      inputs: {},
      output: 'screen',
      execution: { type: 'once' }
    }
  ]
  
  // No postFrame - no buffers to swap
}
```

**What happens:**
1. Single shader renders directly to screen
2. No accumulation, no intermediate buffers
3. Instant feedback, no progressive refinement

**Shaders generated:**
- `'debug-visualizer'` - Shows albedo/normal/depth based on settings

---

### Example 2: Preview Renderer (Simple Accumulation)

**RenderStrategy:**
```typescript
{
  id: 'preview',
  algorithms: {
    transport: 'pathtracer-basic',
    accumulation: 'average'
  },
  settings: {
    maxBounces: 3,
    samplesPerFrame: 1
  }
}
```

**Generated RenderPipeline:**
```typescript
{
  framebuffers: [
    { id: 'accumulation', type: 'double_buffer', format: 'rgba32f' },
    { id: 'screen', type: 'screen', format: 'rgba8' }
  ],
  
  passes: [
    {
      id: 'pathtracer',
      shader: 'pathtracer',
      inputs: {
        textures: {
          'u_accumulator_radiance_previous': 'accumulation_previous'
        }
      },
      output: 'accumulation_current',
      execution: { type: 'once' }
    },
    {
      id: 'display',
      shader: 'display',
      inputs: {
        textures: {
          'u_radiance_texture': 'accumulation_current'
        }
      },
      output: 'screen',
      execution: { type: 'once' }
    }
  ],
  
  postFrame: {
    swaps: [
      { type: 'swap', buffers: ['accumulation'] }
    ]
  }
}
```

**What happens:**
1. Path tracer renders one sample to accumulation_current, reading from accumulation_previous
2. Display pass tone maps accumulation_current and renders to screen
3. **After both passes:** Swap accumulation_current ↔ accumulation_previous
4. Next frame: Repeat with updated accumulation

**Shaders generated:**
- `'pathtracer'` - Full path tracing with average accumulation
- `'display'` - Tone mapping + gamma correction

---

### Example 3: Production Renderer (Current 3-Pass Setup)

**RenderStrategy:**
```typescript
{
  id: 'production',
  algorithms: {
    transport: 'pathtracer-nee',
    accumulation: 'average'
  },
  settings: {
    maxBounces: 12,
    useNEE: true,
    samplesPerFrame: 1
  }
}
```

**Generated RenderPipeline:**
```typescript
{
  framebuffers: [
    { id: 'accumulation', type: 'double_buffer', format: 'rgba32f' },
    { id: 'intermediate', type: 'texture', format: 'rgba32f' },
    { id: 'screen', type: 'screen', format: 'rgba8' }
  ],
  
  passes: [
    {
      id: 'pathtracer',
      shader: 'pathtracer',
      inputs: {
        textures: {
          'u_accumulator_radiance_previous': 'accumulation_previous'
        }
      },
      output: 'accumulation_current',
      execution: { type: 'once' }
    },
    {
      id: 'composite',
      shader: 'composite',
      inputs: {
        textures: {
          'u_accumulated': 'accumulation_current'
        }
      },
      output: 'intermediate',
      execution: { type: 'once' }
    },
    {
      id: 'display',
      shader: 'display',
      inputs: {
        textures: {
          'u_color': 'intermediate'
        }
      },
      output: 'screen',
      execution: { type: 'once' }
    }
  ],
  
  postFrame: {
    swaps: [
      { type: 'swap', buffers: ['accumulation'] }
    ]
  }
}
```

**What happens:**
1. Path tracer accumulates
2. Composite pass (could do post-processing here)
3. Display pass renders to screen
4. **After all passes:** Swap accumulation buffers

**Note:** This matches current Engine behavior. We might optimize this to skip intermediate buffer later.

**Shaders generated:**
- `'pathtracer'` - NEE path tracing with average accumulation
- `'composite'` - Passthrough or post-processing
- `'display'` - Tone mapping + gamma correction

---

### Example 4: Variance-Based Adaptive Accumulation

**RenderStrategy:**
```typescript
{
  id: 'adaptive',
  algorithms: {
    transport: 'pathtracer-nee',
    accumulation: 'variance-adaptive'
  },
  settings: {
    maxBounces: 12
  }
}
```

**Generated RenderPipeline:**
```typescript
{
  framebuffers: [
    { id: 'radiance', type: 'double_buffer', format: 'rgba32f' },
    { id: 'variance', type: 'double_buffer', format: 'rgba32f' },
    { id: 'screen', type: 'screen', format: 'rgba8' }
  ],
  
  passes: [
    {
      id: 'pathtracer',
      shader: 'pathtracer-variance',
      inputs: {
        textures: {
          'u_radiance_previous': 'radiance_previous',
          'u_variance_previous': 'variance_previous'
        }
      },
      output: 'radiance_current',  // Renders to radiance buffer (primary)
      execution: { type: 'once' }
    },
    {
      id: 'display',
      shader: 'display',
      inputs: {
        textures: {
          'u_radiance_texture': 'radiance_current'
        }
      },
      output: 'screen',
      execution: { type: 'once' }
    }
  ],
  
  postFrame: {
    swaps: [
      { type: 'swap', buffers: ['radiance'] },
      { type: 'swap', buffers: ['variance'] }
    ]
  }
}
```

**What happens:**
1. Path tracer updates both radiance AND variance buffers (via MRT or separate draws)
2. Display renders to screen
3. **After all passes:** Both buffer pairs swap independently

**Note on Multiple Render Targets (MRT):** The `output` field specifies which framebuffer to bind. That framebuffer may have multiple color attachments. The shader decides which attachments to write to using `layout(location = N) out vec4` qualifiers (WebGL2 / GLSL 300 es). Engine's job is just to bind the framebuffer - the shader handles the rest.

**Shaders generated:**
- `'pathtracer-variance'` - Tracks radiance + variance, adapts weights
- `'display'` - Standard tone mapping

---

### Example 5: Temporal History Queue

**RenderStrategy:**
```typescript
{
  id: 'temporal',
  algorithms: {
    transport: 'pathtracer-basic',
    accumulation: 'temporal-filter'
  },
  settings: {
    historyFrames: 4
  }
}
```

**Generated RenderPipeline:**
```typescript
{
  framebuffers: [
    { id: 'current', type: 'texture', format: 'rgba32f' },
    { id: 'history1', type: 'texture', format: 'rgba32f' },
    { id: 'history2', type: 'texture', format: 'rgba32f' },
    { id: 'history3', type: 'texture', format: 'rgba32f' },
    { id: 'screen', type: 'screen', format: 'rgba8' }
  ],
  
  passes: [
    {
      id: 'pathtracer',
      shader: 'pathtracer',
      inputs: {},
      output: 'current',
      execution: { type: 'once' }
    },
    {
      id: 'temporal-filter',
      shader: 'temporal-filter',
      inputs: {
        textures: {
          'u_current': 'current',
          'u_history1': 'history1',
          'u_history2': 'history2',
          'u_history3': 'history3'
        }
      },
      output: 'screen',
      execution: { type: 'once' }
    }
  ],
  
  postFrame: {
    swaps: [
      { type: 'rotate', buffers: ['current', 'history1', 'history2', 'history3'] }
    ]
  }
}
```

**What happens:**
1. Path tracer renders current frame to 'current' buffer
2. Temporal filter combines current + 3 history frames, renders to screen
3. **After all passes:** Rotate queue:
   - Content of 'current' → 'history1'
   - Content of 'history1' → 'history2'
   - Content of 'history2' → 'history3'
   - Content of 'history3' → discarded
4. Next frame: 'current' buffer is ready for new frame

**Shaders generated:**
- `'pathtracer'` - Standard path tracing
- `'temporal-filter'` - Weighted combination of temporal samples

---

## 4. Accumulation Strategies are Algorithmic

**Important:** The accumulation strategy is NOT a property of the framebuffer config. It's part of the rendering algorithm (shader code).

### All use the SAME infrastructure:

```typescript
framebuffers: [
  { id: 'accumulation', type: 'accumulation', format: 'rgba32f' }
]
```

### But different GLSL code:

**Average accumulation:**
```glsl
void main() {
  vec3 newSample = transport_trace(ray);
  vec4 previous = texture(u_previous, uv);
  
  float n = float(u_sampleCount + 1);
  vec3 accumulated = (previous.rgb * float(u_sampleCount) + newSample) / n;
  
  gl_FragColor = vec4(accumulated, 1.0);
}
```

**Weighted accumulation:**
```glsl
void main() {
  vec3 newSample = transport_trace(ray);
  vec4 previous = texture(u_previous, uv);
  
  float alpha = 0.05;  // Exponential moving average
  vec3 accumulated = mix(previous.rgb, newSample, alpha);
  
  gl_FragColor = vec4(accumulated, 1.0);
}
```

**Variance-adaptive accumulation:**
```glsl
void main() {
  vec3 newSample = transport_trace(ray);
  vec4 previous = texture(u_previous, uv);
  
  float variance = computeVariance(previous.rgb, newSample);
  float weight = adaptiveWeight(variance, u_sampleCount);
  vec3 accumulated = mix(previous.rgb, newSample, weight);
  
  gl_FragColor = vec4(accumulated, 1.0);
}
```

**The infrastructure (double-buffered RGBA32F framebuffer) is identical. Only the shader code differs.**

---

## 5. Compiler Responsibilities

The Compiler's job is to transform a scene + strategy into a CompiledRenderer:

```typescript
class Compiler {
  compile(
    scene: SceneDescription, 
    strategy: RenderStrategy
  ): CompiledRenderer | CompilationError[]
}
```

### Compilation Process

Each compilation consists of three phases:

#### Phase 1: Scene Analysis

```typescript
interface SceneAnalysis {
  // What objects exist?
  objects: ObjectInfo[];
  
  // What materials exist?
  materials: MaterialInfo[];
  
  // What lights exist?
  lights: {
    explicit: LightInfo[];
    emissive: EmissiveMaterialInfo[];
  };
  
  // Global features
  features: {
    hasVolumes: boolean;
    hasEmissiveMaterials: boolean;
    needsMIS: boolean;
    maxGeometryComplexity: string;
  };
  
  // Errors found during analysis
  errors: CompilationError[];
}
```

**Note:** When compiling multiple strategies for the same scene, the analysis can be cached and reused. The Compiler API is designed to support this optimization internally or via helper functions.

#### Phase 2: Pipeline Determination

Based on the strategy's algorithms:
- Determine what framebuffers are needed
- Determine what rendering passes are needed
- Build RenderPipeline structure

Different strategies → different pipelines.

#### Phase 3: Code Generation

For each pass in the pipeline:
1. Load algorithm implementations from research code
2. Assemble complete GLSL programs
3. Extract uniforms for parameter system
4. Build source maps for error reporting

**Output:** CompiledRenderer (shaders + pipeline + uniforms + sourceMap)

---

## 6. Engine Responsibilities

The Engine's job is to execute CompiledRenderers:

```typescript
class Engine {
  loadRenderer(id: string, renderer: CompiledRenderer): void;
  selectRenderer(id: string): void;
  renderFrame(): void;
}
```

### Loading Renderers

```typescript
loadRenderer(id: string, renderer: CompiledRenderer): void {
  // Setup GPU resources
  this.resources.setupFramebuffers(id, renderer.pipeline);
  
  // Compile GLSL → WebGL programs
  this.executor.setPrograms(id, renderer.shaders);
  
  // Setup parameter bindings
  this.parameters.initialize(id, renderer.uniforms);
}
```

**Multiple renderers can be loaded simultaneously.** Each maintains independent accumulation state and GPU resources.

### Rendering

```typescript
renderFrame(): void {
  const renderer = this.renderers.get(this.activeRendererId);
  
  // Prepare for rendering
  this.resources.prepareFrame();
  this.parameters.updateUniforms();
  
  // Execute pipeline
  this.executor.executePipeline(renderer.pipeline, this.resources);
  
  // Finalize
  this.resources.finalizeFrame();
}
```

### Strategy Switching

```typescript
selectRenderer(id: string): void {
  this.activeRendererId = id;
  // Resources already exist, just switch active
  // No recompilation needed!
}
```

**Each renderer maintains its own accumulation state.** Switching between renderers is instant.

---

## 7. Project: User-Level Organization

While the Compiler has a simple API (`compile(scene, strategy) → renderer`), users often want to organize scenes with multiple rendering strategies together.

### Project Type (User-Level Concept)

```typescript
// Not part of Compiler/Engine API - just organizational sugar
type Project = {
  id: string;
  scene: SceneDescription;
  strategies: RenderStrategy[];
};
```

### Helper Functions

```typescript
// Helper to compile all strategies in a project
function compileProject(
  compiler: Compiler, 
  project: Project
): Map<string, CompiledRenderer> {
  const compiled = new Map();
  
  for (const strategy of project.strategies) {
    const renderer = compiler.compile(project.scene, strategy);
    compiled.set(strategy.id, renderer);
  }
  
  return compiled;
}

// Convenience method for Engine (optional)
class Engine {
  loadRenderers(renderers: Map<string, CompiledRenderer>): void {
    for (const [id, renderer] of renderers) {
      this.loadRenderer(id, renderer);
    }
  }
}
```

### Usage Pattern

```typescript
// Define a project (scene + strategies)
const project = {
  id: 'cornell-box',
  scene: defineScene(),
  strategies: [
    { id: 'debug', algorithms: { transport: 'debug-visualizer' } },
    { id: 'preview', algorithms: { transport: 'pathtracer-basic' } },
    { id: 'production', algorithms: { transport: 'pathtracer-nee' } }
  ]
};

// Compile all strategies
const compiled = compileProject(compiler, project);

// Load into engine
engine.loadRenderers(compiled);

// Switch between strategies
engine.selectRenderer('debug');
engine.selectRenderer('preview');
```

**Key insight:** Project is just organizational convenience, not a core compiler feature. The Compiler API remains simple: compile one strategy at a time.

---

## 8. Parameter System Integration

### How Parameters Flow

```
Scene Definition
  ↓
Compiler extracts parameter references
  ↓
UniformBinding[]
  ↓
Engine's ParameterManager
  ↓
GPU uniforms
```

### Example

**Scene definition:**
```typescript
materials: [
  {
    id: 'glass',
    roughness: { param: 'glass.roughness', default: 0.0, min: 0, max: 1 }
  }
]
```

**Compiler generates:**
```glsl
uniform float u_material_glass_roughness;
```

**Compiler outputs:**
```typescript
uniforms: [
  {
    uniform: 'u_material_glass_roughness',
    parameters: ['glass.roughness'],
    type: 'float',
    compute: (params) => params['glass.roughness']
  }
]
```

**Engine receives:**
```typescript
parameterManager.initialize(renderer.uniforms);
```

**User changes slider:**
```typescript
parameterStore.set('glass.roughness', 0.5);
  ↓
parameterManager.updateUniforms({ 'glass.roughness': 0.5 });
  ↓
gl.uniform1f(location, 0.5);
```

**This system already exists** in the current Engine. We're just generating the UniformBinding[] differently (via Compiler instead of modules).

**Note on UI metadata:** While scene definitions may include parameter metadata (min, max, UI hints), the Compiler does NOT currently extract or forward this metadata. UI controls are managed separately in the App layer. This decision keeps the Compiler focused on code generation and can be revisited in later phases if auto-generating UIs becomes important.

**Note on parameter scoping:** Scene parameters (e.g., `sphere.position`, `camera.fov`) are global and affect all loaded renderers. Renderer-specific parameters (e.g., `debug.outputMode`, `production.maxBounces`) are scoped to renderer ID. The ParameterManager updates all renderers that reference a changed parameter. This is handled automatically through UniformBinding[] - no special coordination needed in MVP. Details deferred to Phase 7 (Real Compiler).

---

## 9. Implementation Details

### Pipeline Validation

Engine validates RenderPipeline when loading a renderer to catch errors early:

```typescript
loadRenderer(id: string, renderer: CompiledRenderer): void {
  // Validate BEFORE creating GPU resources
  this.validatePipeline(renderer.pipeline, renderer.shaders);
  
  // Then setup resources
  // ...
}
```

**Validation rules:**

1. **Exactly one screen framebuffer** - Multiple screen outputs make no sense
2. **All pass outputs exist** - Every pass must render to a valid framebuffer
3. **All pass inputs exist** - Every texture reference must resolve
4. **Swap targets have correct types:**
   - `swap` requires exactly 1 buffer of `type: 'double_buffer'`
   - `rotate` requires all buffers to be `type: 'texture'`
5. **All shader references valid** - Every pass must reference an existing shader

**Purpose:** Catch Compiler bugs during development. Once Compiler is proven, validation is safety net.

### Shader Naming

**Pass ID** vs **Shader name** are independent:

- **Pass ID:** Conceptual description (what this pass does) - for debugging/logging
- **Shader name:** Lookup key in shaders Map - for execution

**They often match** (`id: 'pathtracer', shader: 'pathtracer'`) but don't have to:

```typescript
shaders: new Map([
  ['gaussian-blur-optimized-v2', { vertex: '...', fragment: '...' }]
]),

passes: [
  { id: 'blur-horizontal', shader: 'gaussian-blur-optimized-v2', ... },
  { id: 'blur-vertical', shader: 'gaussian-blur-optimized-v2', ... }
]
```

Same shader used for different conceptual passes.

### Uniform Scope

UniformBinding[] is at CompiledRenderer level, shared across all shaders in that renderer:

- Engine caches uniform locations for all shaders when renderer loads
- Updates uniforms once per frame
- When switching programs during passes, uniforms are already set

**Example:** If both `pathtracer` and `display` shaders use `u_camera_position`, Engine sets it once and both see the same value.

### Framebuffer Creation Timing

Framebuffers created at current canvas size when `loadRenderer()` is called (not lazy):

```typescript
// Canvas is 800×600
engine.loadRenderer('debug', renderer);  
// Framebuffers created at 800×600 immediately

// Later, canvas resizes
canvas.width = 1920;
canvas.height = 1080;
engine.resize(1920, 1080);  
// Framebuffers recreated at 1920×1080
```

### Swap Semantics

**Swap (ping-pong):**
```typescript
{ type: 'swap', buffers: ['accumulation'] }
```
- Swaps `accumulation_current` ↔ `accumulation_previous`
- Target must be `type: 'double_buffer'`

**Rotate (queue):**
```typescript
{ type: 'rotate', buffers: ['current', 'history1', 'history2', 'history3'] }
```
- Content of `current` → `history1`
- Content of `history1` → `history2`
- Content of `history2` → `history3`
- Content of `history3` → **discarded** (not circular)
- All targets must be `type: 'texture'`

### Multiple Passes to Same Buffer

Standard WebGL behavior - later pass overwrites earlier:

```typescript
passes: [
  { id: 'pass1', output: 'intermediate' },  // Writes
  { id: 'pass2', output: 'intermediate' }   // Overwrites
]
```

If you need to preserve pass1's output, use a different buffer.

### Empty postFrame

These are equivalent:
```typescript
postFrame: { swaps: [] }
postFrame: { }
// (no postFrame at all)
```

Engine does nothing after passes if postFrame is missing or swaps is empty. No validation needed.

---

## 10. What We're NOT Deciding Yet

These will be determined during implementation:

### Scene Description Format
- How to specify objects (SDF? Mesh? Analytic?)
- How to specify materials (parameters, procedural properties)
- How to specify lights (types, sampling strategies)

**Deferred because:** Complex, many options, needs experimentation.

### Algorithm Selection Mechanism
- How does RenderStrategy reference algorithms?
- String-based? Import-based? Registry-based?

**Deferred because:** Depends on how research code is organized.

### Research Code Organization
- Where do path tracing algorithms live?
- How are they loaded/referenced?
- What's the structure?

**Deferred because:** Will evolve organically as we build.

### Code Generation Strategy
- GLSL template files vs TypeScript strings
- We decided: Start with placeholder templates
- But exact implementation details deferred

**Deferred because:** Implementation detail, can change later.

### Multi-Region SDF Compilation
- How to compile complex multi-material SDFs
- Material/region identity tracking

**Deferred because:** Complex problem, deserves separate focus.

### Error Handling Details
- Source map granularity (line vs column)
- Error message formatting
- Suggestion system sophistication

**Deferred because:** Start simple (MVP), iterate based on usage.

---

## 11. Development vs Production Split

### Development Mode (Research)

```typescript
// main.ts - runs in browser
import { Compiler } from './compiler/Compiler';
import { defineProject } from './scenes/cornell-box';

const compiler = new Compiler();
const compiled = compiler.compile(defineProject());

engine.loadProject(compiled);
```

**Compilation happens in browser.** Hot reload enabled. Fast iteration.

### Production Mode (Archival)

**Build step (Node.js):**
```bash
npm run compile-shaders
```

```typescript
// scripts/compile-shaders.ts
const compiled = compiler.compile(defineProject());

fs.writeFileSync('./src/shaders/compiled.ts', `
  export const COMPILED_PROJECT = ${JSON.stringify(compiled)};
`);
```

**Runtime (Browser):**
```typescript
// main.ts
import { COMPILED_PROJECT } from './shaders/compiled';

engine.loadProject(COMPILED_PROJECT);
```

**No compilation in browser.** Instant load. Tiny bundle (no Compiler code).

---

## 12. Summary: Locked Decisions

### Core Types ✅
```typescript
SceneDescription = objects + materials + lights
RenderStrategy = algorithms + settings
CompiledRenderer = shaders + RenderPipeline + uniforms
RenderPipeline = framebuffers + passes + postFrame
Project = user-level organization (scene + strategies)
```

### Framebuffer Types ✅
- `double_buffer`: Creates ping/pong pair, provides `_current` and `_previous`
- `texture`: Single buffer
- `screen`: Canvas output

### Pass Execution Types ✅
- `once`: Execute once per frame
- `loop`: Execute N times per frame

### Buffer Management ✅
- **Explicit swaps:** Controlled via `postFrame.swaps`
- **Swap types:** `swap` (ping-pong) and `rotate` (queue)
- **Separation of concerns:** Passes render, postFrame manages buffers

### Responsibilities ✅
- **Compiler**: `compile(scene, strategy) → renderer` (simple API)
- **Engine**: `loadRenderer(id, renderer)` (simple API)
- **Project**: User-level organizational convenience

### Parameter System ✅
- UniformBinding[] generated by Compiler
- Existing ParameterManager unchanged
- ParameterStore unchanged

### Dev/Prod Split ✅
- Dev: Compile in browser
- Prod: Pre-compile, load static data

---

## 13. Next Steps

Now that architecture is locked:

1. **Design Compiler internals**
   - Phase 1: Analysis
   - Phase 2: Organization  
   - Phase 3: Generation
   - CodeGenerator interface

2. **Build new Engine classes**
   - FlexibleResourceManager
   - FlexibleRenderExecutor
   - Integration with existing ParameterManager

3. **Build end-to-end example**
   - Simple scene (sphere in box)
   - Debug + Preview strategies
   - Verify full pipeline

4. **Iterate and refine**
   - Based on what we learn building

---

This architecture provides the flexibility to support many rendering strategies while maintaining clean separation between Compiler (code generation) and Engine (execution).
