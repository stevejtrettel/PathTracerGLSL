# Compiler-Engine Architecture

## Status: LOCKED IN ✅

This document defines the core architecture for the new Compiler-Engine system, replacing the module-based approach. These decisions are locked and should guide all implementation work.

**Date:** January 2025  
**Context:** Major refactor from module-based (9 modules) to Compiler-based system

---

## 1. Core Terminology

### Project
A **Project** is the top-level container combining scene geometry with multiple rendering strategies.

```typescript
interface Project {
  id: string;                          // 'cornell-box'
  scene: SceneDescription;             // Geometry, materials, lights (same for all strategies)
  strategies: RenderStrategy[];        // Different ways to render this scene
}
```

**Key insight:** The scene (what you're rendering) is defined once. Different rendering strategies produce different views/outputs of the same scene.

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

### SceneDescription
The **SceneDescription** defines the world being rendered (geometry, materials, lights).

```typescript
interface SceneDescription {
  objects: ObjectDescription[];
  materials: MaterialDescription[];
  lights: LightDescription[];
}
```

**Deferred:** The exact structure of ObjectDescription, MaterialDescription, etc. will be designed during Compiler implementation. For now, we just need to know "a scene has these three categories of things."

---

### CompiledProject
The **output** of compilation: one compiled renderer per strategy.

```typescript
interface CompiledProject {
  id: string;
  
  // One compiled renderer per strategy
  renderers: Map<string, CompiledRenderer>;
  
  // Scene analysis (for debugging/inspection)
  analysis: SceneAnalysis;
  
  // Compilation stats
  stats: CompilationStats;
}
```

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
}
```

---

### FramebufferConfig

Declares what GPU resources are needed.

```typescript
interface FramebufferConfig {
  id: string;              // 'accumulation', 'intermediate', 'screen'
  type: FramebufferType;   // 'accumulation' | 'texture' | 'screen'
  format: TextureFormat;   // 'rgba32f' | 'rgba8' | 'rgba16f' | 'r32f' | 'depth'
  multisampled?: boolean;  // Optional: enable MSAA
}

type FramebufferType = 
  | 'accumulation'  // Needs ping/pong double-buffering, swaps each frame
  | 'texture'       // Single buffer, no automatic swapping
  | 'screen';       // null framebuffer (canvas output)

type TextureFormat =
  | 'rgba32f'  // High precision (path tracing accumulation)
  | 'rgba16f'  // Medium precision (normals, HDR intermediate)
  | 'rgba8'    // Low precision (LDR display)
  | 'r32f'     // Single channel float (depth, variance)
  | 'depth';   // Depth buffer
```

**Framebuffer Type Semantics:**

**`type: 'accumulation'`**
- Engine creates TWO buffers (ping and pong)
- Provides `{id}_current` and `{id}_previous` textures
- Automatically swaps after passes with `execution.type === 'accumulate'`
- Use for: Progressive accumulation, temporal filtering

**`type: 'texture'`**
- Engine creates ONE buffer
- No automatic swapping
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
  | 'accumulate'  // Execute once, then swap accumulation buffers
  | 'loop';       // Execute N times (for multi-sample per frame)
```

**Execution Type Semantics:**

**`type: 'once'`**
- Execute this pass once per frame
- No buffer swapping
- Use for: Display pass, tone mapping, compositing

**`type: 'accumulate'`**
- Execute this pass once per frame
- Trigger automatic buffer swap (if output is accumulation-type)
- Use for: Path tracing accumulation pass

**`type: 'loop'`**
- Execute this pass `iterations` times per frame
- Use for: Multiple samples per frame (future feature)

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
    { id: 'accumulation', type: 'accumulation', format: 'rgba32f' },
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
      output: 'accumulation',
      execution: { type: 'accumulate' }
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
  ]
}
```

**What happens:**
1. Path tracer renders one sample to accumulation buffer
2. Buffers swap (accumulation_current ↔ accumulation_previous)
3. Display pass tone maps and renders to screen
4. Next frame: repeat with updated accumulation

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
    { id: 'accumulation', type: 'accumulation', format: 'rgba32f' },
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
      output: 'accumulation',
      execution: { type: 'accumulate' }
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
  ]
}
```

**What happens:**
1. Path tracer accumulates
2. Composite pass (could do post-processing here)
3. Display pass renders to screen

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
    { id: 'radiance', type: 'accumulation', format: 'rgba32f' },
    { id: 'variance', type: 'accumulation', format: 'rgba32f' },
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
      output: 'radiance',  // Renders to radiance buffer
      execution: { type: 'accumulate' }
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
  ]
}
```

**What happens:**
1. Path tracer updates both radiance AND variance buffers
2. Both pairs swap
3. Display renders to screen

**Note:** Shader writes to multiple render targets (MRT). The `output` field specifies primary target, but shader can write to multiple via `gl_FragData` or layout qualifiers.

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
  ]
}
```

**What happens:**
1. Path tracer renders current frame
2. Temporal filter combines current + 3 history frames
3. After frame, Engine manually rotates history (current → history1 → history2 → history3)

**Note:** This requires Engine to handle history rotation (not automatic like accumulation).

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

The Compiler's job is to transform a Project into CompiledRenderers:

```typescript
class Compiler {
  compile(project: Project): CompiledProject | CompilationError[]
}
```

### Phase 1: Scene Analysis (Once)

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

This analysis is **shared across all RenderStrategies** because they all render the same scene.

### Phase 2: Per-Strategy Compilation

For each RenderStrategy:

1. **Determine pipeline structure**
   - Based on algorithms specified
   - Different strategies → different pipelines
   
2. **Generate shader code**
   - Load algorithm implementations from research code
   - Assemble complete GLSL programs
   - One program per pass in pipeline
   
3. **Extract uniforms**
   - Parse generated shaders
   - Build UniformBinding[] for parameter system
   
4. **Build source maps**
   - Track user code → generated GLSL
   - For error reporting

**Output:** CompiledRenderer (shaders + pipeline + uniforms + sourceMap)

---

## 6. Engine Responsibilities

The Engine's job is to execute CompiledRenderers:

```typescript
class Engine {
  loadProject(compiled: CompiledProject): void;
  selectStrategy(strategyId: string): void;
  renderFrame(): void;
}
```

### On Load

```typescript
loadProject(compiled: CompiledProject): void {
  for (const [strategyId, renderer] of compiled.renderers) {
    // Setup GPU resources
    this.resources.setupFramebuffers(strategyId, renderer.pipeline);
    
    // Compile GLSL → WebGL programs
    this.executor.setPrograms(strategyId, renderer.shaders);
    
    // Setup parameter bindings
    this.parameters.initialize(renderer.uniforms);
  }
}
```

### On Render

```typescript
renderFrame(): void {
  const renderer = this.renderers.get(this.activeStrategyId);
  
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
selectStrategy(strategyId: string): void {
  this.activeStrategyId = strategyId;
  // Resources already exist, just switch active
  // No recompilation needed!
}
```

**Each strategy maintains its own accumulation state.** Switching between strategies is instant.

---

## 7. Parameter System Integration

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

---

## 8. What We're NOT Deciding Yet

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

## 9. Development vs Production Split

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

## 10. Summary: Locked Decisions

### Core Types ✅
```typescript
Project = scene + RenderStrategy[]
RenderStrategy = algorithms + settings
CompiledRenderer = shaders + RenderPipeline + uniforms
RenderPipeline = framebuffers + passes
```

### Framebuffer Types ✅
- `accumulation`: Double-buffered, auto-swapping
- `texture`: Single buffer
- `screen`: Canvas output

### Pass Execution Types ✅
- `once`: Execute once
- `accumulate`: Execute + swap buffers
- `loop`: Execute N times

### Responsibilities ✅
- **Compiler**: Project → CompiledProject
- **Engine**: Execute CompiledProject

### Parameter System ✅
- UniformBinding[] generated by Compiler
- Existing ParameterManager unchanged
- ParameterStore unchanged

### Dev/Prod Split ✅
- Dev: Compile in browser
- Prod: Pre-compile, load static data

---

## 11. Next Steps

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
