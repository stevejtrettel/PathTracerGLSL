# Compiler-Engine Refactor: Build Strategy

## Status: Planning Phase

This document outlines the complete build strategy for migrating from the module-based system to the new Compiler-Engine architecture.

**Goal:** Minimize risk, maintain working code throughout, validate architecture incrementally.

**Approach:** Build SimpleCompiler first to validate Engine changes, then build real Compiler piece by piece.

---

## Overall Strategy: Two-Track Development

### Track 1: Engine Refactor (Using SimpleCompiler)

**Purpose:** Build and validate new Engine architecture with known-good GLSL

**Key insight:** We already have working modules and working GLSL. Use them to test the new Engine without the complexity of building the Compiler first.

**Components:**
- SimpleCompiler (adapter: modules → CompiledRenderer)
- FlexibleResourceManager
- FlexibleRenderExecutor
- Integration layer

**Success criteria:** Can render existing scenes with new Engine + SimpleCompiler

**Note on architecture:** The Compiler's core API is simple: `compile(scene, strategy) → renderer`. SimpleCompiler will provide a convenience method `compileProject(project)` for testing that internally just loops over strategies, but the architecture is based on individual compilation.

---

### Track 2: Real Compiler (After Engine Works)

**Purpose:** Build actual Compiler that generates code from scene descriptions

**Key insight:** Once Engine works with SimpleCompiler, we have a working target. Can build Compiler piece by piece and validate against it.

**Components:**
- Scene analysis
- Code generation infrastructure
- Algorithm library
- Full Compiler (with simple API: compile one strategy at a time)

**Success criteria:** Can replace SimpleCompiler with Compiler, same output

---

## Phase Breakdown

### Phase 0: Preparation (1-2 days)

**Goal:** Setup infrastructure for two-track development

**Tasks:**

1. **Create new folder structure**
   ```
   src/
   ├── compiler-new/           # New Compiler (empty initially)
   │   ├── SimpleCompiler.ts   # Phase 1 implementation
   │   └── types.ts            # Shared types
   ├── engine/             # New Engine classes
   │   ├── FlexibleResourceManager.ts
   │   ├── FlexibleRenderExecutor.ts
   │   └── types.ts
   ├── engine/                 # OLD Engine (keep working)
   ├── modules/                # OLD modules (keep for SimpleCompiler)
   └── compiler/               # OLD compiler (if exists)
   ```

2. **Define core types**
   - SceneDescription, RenderStrategy, CompiledRenderer
   - RenderPipeline, FramebufferConfig, RenderPass
   - Project (user-level type, not part of core Compiler API)
   - Copy from COMPILER-ENGINE-ARCHITECTURE.md

3. **Setup testing infrastructure**
   - Test scene (cornell box or simpler)
   - Visual regression tests
   - Performance benchmarks

**Deliverable:** Empty structure ready for development

**Risk mitigation:** No code changes yet, just organization

---

### Phase 1: SimpleCompiler (2-3 days)

**Goal:** Create hardcoded adapter that converts existing modules to CompiledRenderer format

**Components:**

#### 1.1: SimpleCompiler Core

**Purpose:** Minimal compiler that packages existing modules

```typescript
class SimpleCompiler {
  // Core API (matches real Compiler)
  compile(scene: SceneDescription, strategy: RenderStrategy): CompiledRenderer {
    // Hardcoded logic for debug/pathtracer strategies
  }
  
  // Convenience method for testing (compiles multiple strategies)
  compileProject(project: Project): Map<string, CompiledRenderer> {
    const compiled = new Map();
    for (const strategy of project.strategies) {
      const renderer = this.compile(project.scene, strategy);
      compiled.set(strategy.id, renderer);
    }
    return compiled;
  }
}
```

**Note:** The core API `compile(scene, strategy)` matches the real Compiler's API. The `compileProject()` method is just a convenience wrapper for testing multiple strategies at once.

**Tasks:**
- Create class skeleton
- Implement module concatenation (copy from old code)
- Generate simple RenderPipeline structures
- Extract UniformBindings (copy from old code)

**Testing:**
- Can instantiate
- Can call compile() with single strategy
- Can call compileProject() with multiple strategies
- Output has correct structure

**Estimated time:** 1 day

---

#### 1.2: Debug Strategy Implementation

**Purpose:** Simplest possible pipeline to test Engine

**What it does:**
- Single shader (no accumulation)
- Direct to screen
- Show albedo or normals

**Pipeline:**
```typescript
{
  framebuffers: [
    { id: 'screen', type: 'screen', format: 'rgba8' }
  ],
  passes: [
    { shader: 'debug', output: 'screen', execution: { type: 'once' } }
  ]
}
```

**Tasks:**
- Concatenate minimal modules (camera, scene, maybe interaction)
- Generate debug main() function
- Package as CompiledRenderer

**Testing:**
- Output is valid CompiledRenderer
- Shader has correct structure
- UniformBindings extracted

**Estimated time:** 0.5 days

---

#### 1.3: Pathtracer Strategy Implementation

**Purpose:** Full accumulation pipeline (matches current behavior)

**What it does:**
- Path tracing with accumulation
- Display pass (tone mapping)
- Two-pass pipeline

**Pipeline:**
```typescript
{
  framebuffers: [
    { id: 'accumulation', type: 'double_buffer', format: 'rgba32f' },
    { id: 'screen', type: 'screen', format: 'rgba8' }
  ],
  passes: [
    { 
      shader: 'pathtracer', 
      output: 'accumulation_current', 
      inputs: { textures: { 'u_previous': 'accumulation_previous' } },
      execution: { type: 'once' } 
    },
    { shader: 'display', output: 'screen', execution: { type: 'once' } }
  ],
  postFrame: {
    swaps: [{ type: 'swap', buffers: ['accumulation'] }]
  }
}
```

**Tasks:**
- Concatenate all 9 modules
- Generate pathtracer main() function
- Generate display shader (just developer module)
- Package as CompiledRenderer

**Testing:**
- Output is valid CompiledRenderer
- Both shaders have correct structure
- UniformBindings extracted from all modules

**Estimated time:** 1 day

---

#### 1.4: Hardcoded Project Definition

**Purpose:** Test scene for Engine development

**What it is:**
```typescript
export function defineTestProject(): Project {
  return {
    id: 'test-cornell-box',
    scene: { /* hardcoded */ },
    strategies: [
      { id: 'debug', algorithms: { transport: 'debug' } },
      { id: 'pathtracer', algorithms: { transport: 'pathtracer' } }
    ]
  };
}
```

**Tasks:**
- Define minimal scene (doesn't matter, SimpleCompiler ignores it)
- Define two strategies
- SimpleCompiler just checks strategy IDs

**Testing:**
- Can compile
- Produces two CompiledRenderers

**Estimated time:** 0.5 days

---

**Phase 1 Deliverable:** Working SimpleCompiler that produces valid CompiledRenderers

**Validation:**
- Run SimpleCompiler on test project
- Inspect output structure
- Verify shaders look correct (don't execute yet)

**Risk mitigation:** Not touching Engine yet, just packaging existing code

---

### Phase 2: FlexibleResourceManager (3-4 days)

**Goal:** Build new ResourceManager that creates framebuffers from RenderPipeline

**Current system:**
- Fixed structure (ping/pong + RGB buffer)
- All recipes get same buffers

**New system:**
- Dynamic structure (based on pipeline.framebuffers)
- Different strategies get different buffers

---

#### 2.1: Core Structure

**Purpose:** Basic class with framebuffer creation

**What it manages:**
```typescript
class FlexibleResourceManager {
  // Per-strategy framebuffers
  private framebuffers = new Map<string, Map<string, WebGLFramebuffer>>();
  // framebuffers[strategyId][fbId] = framebuffer
  
  private textures = new Map<string, Map<string, WebGLTexture>>();
  // textures[strategyId][texId] = texture
  
  private activeStrategyId: string | null;
}
```

**Tasks:**
- Create class skeleton
- Add strategy tracking (active strategy)
- Add basic get/set methods

**Testing:**
- Can instantiate
- Can set active strategy
- Basic state management works

**Estimated time:** 0.5 days

---

#### 2.2: Framebuffer Creation

**Purpose:** Create framebuffers based on FramebufferConfig

**Three framebuffer types to support:**

**Type: `'double_buffer'`**
- Create ping + pong pair
- Both RGBA32F (or specified format)
- Store as `{id}_current`, `{id}_previous`
- Track which is which for swapping

```typescript
createDoubleBuffer(config: FramebufferConfig): {
  current: WebGLFramebuffer,
  previous: WebGLFramebuffer,
  currentTexture: WebGLTexture,
  previousTexture: WebGLTexture
}
```

**Type: `'texture'`**
- Single buffer
- Specified format

```typescript
createTextureBuffer(config: FramebufferConfig): WebGLFramebuffer
```

**Type: `'screen'`**
- null framebuffer (canvas)
- No creation needed

**Tasks:**
- Implement each creation method
- Add texture creation (separate from framebuffer)
- Add validation (check completeness)
- Handle formats (rgba32f, rgba8, rgba16f, r32f)

**Testing:**
- Can create each type
- Framebuffers are valid
- Textures have correct format
- No WebGL errors

**Estimated time:** 1 day

---

#### 2.3: Pipeline Setup

**Purpose:** Setup all buffers for a strategy from its RenderPipeline

```typescript
setupStrategy(strategyId: string, pipeline: RenderPipeline): void {
  for (const fbConfig of pipeline.framebuffers) {
    // Create based on type
    // Store in maps
  }
}
```

**Tasks:**
- Iterate over pipeline.framebuffers
- Call appropriate creation method for each
- Store results in maps
- Handle cleanup of old resources

**Testing:**
- Can setup debug pipeline (just screen)
- Can setup pathtracer pipeline (double_buffer + screen)
- Resources are tracked correctly
- No leaks

**Estimated time:** 0.5 days

---

#### 2.4: Accessor Methods

**Purpose:** Retrieve resources during rendering

```typescript
// Get framebuffer by ID
getFramebuffer(fbId: string): WebGLFramebuffer | null

// Get texture by ID
getTexture(texId: string): WebGLTexture

// For accumulation buffers
getCurrentTexture(accId: string): WebGLTexture
getPreviousTexture(accId: string): WebGLTexture
```

**Special handling for accumulation buffers:**
- `getCurrentTexture('accumulation')` → current ping or pong
- `getPreviousTexture('accumulation')` → opposite of current
- Automatically track which is which

**Tasks:**
- Implement getters
- Handle accumulation special case
- Add error handling (missing resource)
- Add validation

**Testing:**
- Can retrieve all resources
- Accumulation current/previous work correctly
- Errors for missing resources
- Type safety

**Estimated time:** 0.5 days

---

#### 2.5: Buffer Swapping and Rotation

**Purpose:** Execute swap instructions from RenderPipeline

```typescript
executeSwap(swap: SwapInstruction): void {
  if (swap.type === 'swap') {
    // Swap ping/pong for double_buffer
    // buffers[0] is the double_buffer id
    const db = this.doubleBuffers.get(swap.buffers[0]);
    [db.current, db.previous] = [db.previous, db.current];
    [db.currentTexture, db.previousTexture] = [db.previousTexture, db.currentTexture];
  } else if (swap.type === 'rotate') {
    // Rotate queue of texture buffers
    // Last buffer content is discarded, others shift down
    this.rotateBuffers(swap.buffers);
  }
}

executePostFrame(postFrame?: { swaps?: SwapInstruction[] }): void {
  if (!postFrame?.swaps) return;
  
  for (const swap of postFrame.swaps) {
    this.executeSwap(swap);
  }
}
```

**Tasks:**
- Implement swap logic (ping/pong)
- Implement rotate logic (queue rotation)
- Called by RenderExecutor after all passes
- Support multiple independent swaps

**Testing:**
- Can swap double buffers
- Can rotate texture queues
- Multiple swaps execute correctly
- State is correct after swapping

**Estimated time:** 0.5 days

---

#### 2.6: Cleanup and Resize

**Purpose:** Handle resource lifecycle

```typescript
resize(width: number, height: number): void {
  // Recreate all buffers
  // Reset accumulation
}

dispose(strategyId?: string): void {
  // Clean up WebGL resources
}
```

**Tasks:**
- Implement resize (recreate all resources)
- Implement dispose (delete resources)
- Handle partial dispose (one strategy)
- Reset accumulation counts

**Testing:**
- Resize works
- No leaks
- Accumulation resets
- Can dispose individual strategies

**Estimated time:** 0.5 days

---

**Phase 2 Deliverable:** Working FlexibleResourceManager

**Validation:**
- Can setup debug pipeline
- Can setup pathtracer pipeline
- Can retrieve all resources
- Can resize
- Can dispose
- No WebGL errors

**Risk mitigation:** Test each method independently, build incrementally

---

### Phase 3: FlexibleRenderExecutor (2-3 days)

**Goal:** Build new RenderExecutor that executes RenderPipeline

**Current system:**
- Three hardcoded methods (main, display, composite)
- Fixed pipeline flow

**New system:**
- Generic pass execution
- Driven by RenderPipeline

---

#### 3.1: Core Structure

**Purpose:** Basic class with program management

```typescript
class FlexibleRenderExecutor {
  private gl: WebGL2RenderingContext;
  private programs = new Map<string, WebGLProgram>();
  // programs[shaderId] = compiled WebGL program
  
  private resources: FlexibleResourceManager;
}
```

**Tasks:**
- Create class skeleton
- Add program tracking
- Add resource manager reference

**Testing:**
- Can instantiate
- Can store programs

**Estimated time:** 0.5 days

---

#### 3.2: Program Compilation

**Purpose:** Compile GLSL strings to WebGL programs

```typescript
setPrograms(shaders: Map<string, ShaderProgram>): void {
  for (const [id, shader] of shaders) {
    const program = this.compileProgram(shader.vertex, shader.fragment);
    this.programs.set(id, program);
  }
}

private compileProgram(vertex: string, fragment: string): WebGLProgram {
  // Compile vertex shader
  // Compile fragment shader
  // Link program
  // Validate
}
```

**Tasks:**
- Implement shader compilation
- Implement program linking
- Add error handling (compilation errors)
- Add validation

**Testing:**
- Can compile simple shader
- Errors reported correctly
- Programs are valid

**Estimated time:** 0.5 days

---

#### 3.3: Single Pass Execution

**Purpose:** Execute one RenderPass

```typescript
private executePass(pass: RenderPass): void {
  const program = this.programs.get(pass.shader);
  
  // 1. Bind output framebuffer
  const outputFB = this.resources.getFramebuffer(pass.output);
  this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, outputFB);
  
  // 2. Set viewport
  this.gl.viewport(0, 0, this.width, this.height);
  
  // 3. Use program
  this.gl.useProgram(program);
  
  // 4. Bind input textures
  this.bindTextures(pass.inputs.textures);
  
  // 5. Clear if requested
  if (pass.execution.clearBeforeRender) {
    this.gl.clear(this.gl.COLOR_BUFFER_BIT);
  }
  
  // 6. Draw
  this.gl.drawArrays(this.gl.TRIANGLES, 0, 3);
  
  // Note: No swapping here - that happens in postFrame
}
```

**Tasks:**
- Implement framebuffer binding
- Implement texture binding
- Implement draw call
- Handle execution types (once, loop)
- Add error handling

**Testing:**
- Can execute simple pass (debug)
- Framebuffer binds correctly
- Textures bind correctly
- Draw happens
- No WebGL errors

**Estimated time:** 1 day

---

#### 3.4: Pipeline Execution

**Purpose:** Execute complete RenderPipeline

```typescript
executePipeline(pipeline: RenderPipeline): void {
  // Execute all passes
  for (const pass of pipeline.passes) {
    this.executePass(pass);
  }
  
  // Execute postFrame operations (buffer swapping/rotation)
  if (pipeline.postFrame?.swaps) {
    this.resources.executePostFrame(pipeline.postFrame);
  }
}
```

**Tasks:**
- Iterate over passes
- Execute each
- Execute postFrame swaps after all passes
- Handle state between passes
- Track timing (optional)

**Testing:**
- Can execute single-pass pipeline (debug)
- Can execute two-pass pipeline (pathtracer)
- State transitions work
- Swaps execute after passes
- Accumulation swaps at right time

**Estimated time:** 0.5 days

---

#### 3.5: Texture Binding Helper

**Purpose:** Bind input textures to texture units

```typescript
private bindTextures(textureInputs?: Record<string, string>): void {
  if (!textureInputs) return;
  
  let textureUnit = 0;
  for (const [uniformName, textureId] of Object.entries(textureInputs)) {
    const texture = this.resources.getTexture(textureId);
    
    this.gl.activeTexture(this.gl.TEXTURE0 + textureUnit);
    this.gl.bindTexture(this.gl.TEXTURE_2D, texture);
    
    const loc = this.gl.getUniformLocation(this.currentProgram, uniformName);
    if (loc) {
      this.gl.uniform1i(loc, textureUnit);
    }
    
    textureUnit++;
  }
}
```

**Tasks:**
- Implement texture unit allocation
- Implement binding
- Handle uniform location lookup
- Add error handling (missing texture)

**Testing:**
- Can bind single texture
- Can bind multiple textures
- Texture units allocated correctly
- Uniforms set correctly

**Estimated time:** 0.5 days

---

**Phase 3 Deliverable:** Working FlexibleRenderExecutor

**Validation:**
- Can compile shaders
- Can execute single-pass pipeline
- Can execute multi-pass pipeline
- Textures bind correctly
- PostFrame swaps execute correctly

**Risk mitigation:** Test each method with mock data before integrating

---

### Phase 4: Integration (2-3 days)

**Goal:** Wire together SimpleCompiler + FlexibleResourceManager + FlexibleRenderExecutor

---

#### 4.1: New Engine Class

**Purpose:** High-level API matching new architecture

```typescript
class FlexibleEngine {
  private gl: WebGL2RenderingContext;
  private resources: FlexibleResourceManager;
  private executor: FlexibleRenderExecutor;
  private parameterManager: ParameterManager; // Reuse existing!
  
  private renderers = new Map<string, CompiledRenderer>();
  private activeRendererId: string | null;
  
  // Core API
  loadRenderer(id: string, renderer: CompiledRenderer): void { }
  selectRenderer(id: string): void { }
  renderFrame(): void { }
  resize(width: number, height: number): void { }
  
  // Convenience method for loading multiple
  loadRenderers(renderers: Map<string, CompiledRenderer>): void {
    for (const [id, renderer] of renderers) {
      this.loadRenderer(id, renderer);
    }
  }
}
```

**Tasks:**
- Create class skeleton
- Wire up components
- Implement high-level methods

**Testing:**
- Can instantiate
- Components communicate
- Basic flow works

**Estimated time:** 0.5 days

---

#### 4.2: Renderer Loading

**Purpose:** Setup resources for renderers

```typescript
loadRenderer(id: string, renderer: CompiledRenderer): void {
  // Setup resources for this renderer
  this.resources.setupStrategy(id, renderer.pipeline);
  this.executor.setPrograms(renderer.shaders);
  
  // Setup parameters (reuse existing ParameterManager)
  this.parameterManager.initialize(id, renderer.uniforms);
  
  // Store renderer
  this.renderers.set(id, renderer);
}

// Convenience for testing (load multiple at once)
loadRenderers(renderers: Map<string, CompiledRenderer>): void {
  for (const [id, renderer] of renderers) {
    this.loadRenderer(id, renderer);
  }
  
  // Select first by default
  if (this.activeRendererId === null && renderers.size > 0) {
    this.selectRenderer(Array.from(renderers.keys())[0]);
  }
}
```

**Usage in tests:**
```typescript
const project = defineTestProject();
const compiled = simpleCompiler.compileProject(project);
engine.loadRenderers(compiled);  // Load all at once for testing
```

**Tasks:**
- Implement individual renderer loading
- Call resource setup
- Compile shaders
- Setup parameter bindings

**Testing:**
- Can load compiled project
- Resources created for all strategies
- Shaders compiled
- Active strategy set

**Estimated time:** 0.5 days

---

#### 4.3: Renderer Selection

**Purpose:** Switch between renderers instantly

```typescript
selectRenderer(id: string): void {
  if (!this.renderers.has(id)) {
    throw new Error(`Unknown renderer: ${id}`);
  }
  
  this.activeRendererId = id;
  this.resources.setActiveStrategy(id);
  
  // Resources already exist, just switch active
  // Each renderer maintains its own accumulation
}
```

**Tasks:**
- Validate renderer exists
- Switch active renderer
- Preserve accumulation state

**Testing:**
- Can switch renderers
- Accumulation preserved per-renderer
- No recompilation needed

**Estimated time:** 0.5 days

---

#### 4.4: Render Loop

**Purpose:** Execute active renderer's pipeline

```typescript
renderFrame(): void {
  if (!this.activeRendererId) return;
  
  const renderer = this.renderers.get(this.activeRendererId)!;
  
  // Prepare frame
  this.resources.prepareFrame();
  this.updateEngineUniforms(); // resolution, frameIndex, sampleCount, etc.
  
  // Execute pipeline
  this.executor.executePipeline(renderer.pipeline);
  
  // Finalize
  this.resources.finalizeFrame();
  this.incrementSampleCount();
}
```

**Tasks:**
- Prepare resources
- Update uniforms
- Execute pipeline
- Finalize frame
- Track state

**Testing:**
- Can render frame
- Accumulation increments
- Display updates

**Estimated time:** 0.5 days

---

#### 4.5: Parameter System Integration

**Purpose:** Reuse existing ParameterManager unchanged

```typescript
private setupParameters(renderer: CompiledRenderer): void {
  // Existing ParameterManager just works!
  this.parameterManager.initialize(
    this.executor.getProgram('pathtracer'),
    renderer.uniforms
  );
}
```

**Tasks:**
- Extract program from executor
- Pass to ParameterManager
- Verify bindings work

**Testing:**
- Parameters update uniforms
- Changes trigger re-render
- Accumulation resets when needed

**Estimated time:** 0.5 days

---

**Phase 4 Deliverable:** Working FlexibleEngine + SimpleCompiler rendering test scene

**Validation:**
- Can load compiled project
- Can render debug strategy
- Can render pathtracer strategy
- Can switch strategies
- Parameters work
- Accumulation works
- Visually identical to old Engine

**This is the BIG milestone - new Engine architecture fully working!**

---

### Phase 5: Testing & Refinement (2-3 days)

**Goal:** Validate new Engine thoroughly before building real Compiler

---

#### 5.1: Visual Regression Tests

**Purpose:** Ensure new Engine produces identical output to old Engine

**Setup:**
- Render same scene with old Engine
- Render same scene with new Engine (via SimpleCompiler)
- Compare pixel-by-pixel

**Tests:**
- Debug view matches
- Pathtracer after N samples matches
- Tone mapping matches
- Strategy switching doesn't break accumulation

**Success criteria:** <1% pixel difference (accounting for float precision)

**Estimated time:** 1 day

---

#### 5.2: Performance Benchmarks

**Purpose:** Ensure new Engine is not slower

**Metrics:**
- Frame time (ms/frame)
- Samples per second
- Memory usage
- Strategy switch time

**Tests:**
- Render 1000 frames, measure average
- Switch strategies 100 times, measure average
- Monitor memory over time

**Success criteria:** Within 5% of old Engine performance

**Estimated time:** 0.5 days

---

#### 5.3: Edge Cases

**Purpose:** Test unusual configurations

**Tests:**
- Very small canvas (1x1)
- Very large canvas (4096x4096)
- Rapid strategy switching
- Resize during accumulation
- Parameter changes during accumulation
- Multiple projects loaded sequentially

**Success criteria:** No crashes, no WebGL errors, accumulation behaves correctly

**Estimated time:** 0.5 days

---

#### 5.4: Documentation

**Purpose:** Document new Engine API

**Documents:**
- FlexibleEngine API reference
- Migration guide (old Engine → new Engine)
- RenderPipeline specification
- Examples

**Success criteria:** Another developer could use new Engine

**Estimated time:** 0.5 days

---

**Phase 5 Deliverable:** Validated, documented new Engine

**Decision point:** Are we confident the architecture works? If yes, proceed to building real Compiler. If no, identify issues and fix.

---

### Phase 6: Real Compiler - Planning (1-2 days)

**Goal:** Design detailed plan for building real Compiler now that Engine is proven

**At this point:**
- Engine architecture validated
- RenderPipeline structure proven
- CompiledRenderer format proven
- We know exactly what Compiler needs to output

**Tasks:**
- Review all problem description docs
- Design scene description format
- Design algorithm library structure
- Design code generation strategy
- Plan compilation phases in detail

**Deliverable:** Detailed Compiler build plan (similar to this doc)

**Estimated time:** 1-2 days

---

### Phase 7: Real Compiler - Implementation (3-4 weeks)

**Goal:** Build actual Compiler piece by piece

**This is broken down in a separate document** (to be written after Phase 6)

**High-level phases:**
- Scene analysis infrastructure
- Code generation infrastructure (templates)
- Algorithm library (research code)
- Scene description format
- Full integration

**Validation strategy:**
- Each piece validated independently
- Output compared to SimpleCompiler
- Gradually replace SimpleCompiler functionality

**Success criteria:** Can replace SimpleCompiler with Compiler, same results

---

### Phase 8: Cutover (1 day)

**Goal:** Remove old code, finalize new system

**Tasks:**
- Delete old Engine classes
- Delete old module system
- Delete SimpleCompiler
- Update all examples
- Update documentation
- Celebrate!

**Success criteria:** System works end-to-end with only new code

---

## Timeline Summary

| Phase | Component | Duration | Cumulative |
|-------|-----------|----------|------------|
| 0 | Preparation | 1-2 days | 2 days |
| 1 | SimpleCompiler | 2-3 days | 5 days |
| 2 | FlexibleResourceManager | 3-4 days | 9 days |
| 3 | FlexibleRenderExecutor | 2-3 days | 12 days |
| 4 | Integration | 2-3 days | 15 days |
| 5 | Testing & Refinement | 2-3 days | 18 days |
| **Milestone** | **New Engine Working** | | **~3-4 weeks** |
| 6 | Compiler Planning | 1-2 days | 20 days |
| 7 | Real Compiler | 3-4 weeks | 6-8 weeks |
| 8 | Cutover | 1 day | 6-8 weeks |
| **Total** | | | **6-8 weeks** |

**With part-time work (50%):** 12-16 weeks (3-4 months)

---

## Parallel Work Opportunities

Some tasks can be done in parallel:

**During Engine development (Phases 2-4):**
- Write problem description docs for Compiler
- Design scene description format
- Organize research code (algorithms)
- Write GLSL template files

**During Compiler development (Phase 7):**
- Write examples using new system
- Write documentation
- Create tutorials
- Build tooling (shader inspector, etc.)

---

## Risk Mitigation

### Risk 1: RenderPipeline structure doesn't work

**Mitigation:** Phase 2-4 validates this with real rendering  
**Fallback:** Adjust structure based on learnings, update architecture doc

### Risk 2: Performance regression

**Mitigation:** Phase 5 benchmarks catch this early  
**Fallback:** Optimize hot paths, profile and fix

### Risk 3: SimpleCompiler too limiting

**Mitigation:** Only used for Engine validation, not permanent  
**Fallback:** If needed, enhance SimpleCompiler, but don't over-engineer

### Risk 4: Real Compiler too complex

**Mitigation:** Build piece by piece, validate each piece  
**Fallback:** Simplify scope, defer advanced features

### Risk 5: Integration bugs

**Mitigation:** Extensive testing in Phase 5  
**Fallback:** Incremental debugging, fall back to SimpleCompiler if needed

### Risk 6: Scope creep

**Mitigation:** Clear phase boundaries, explicit decision points  
**Fallback:** Defer nice-to-have features to later

---

## Decision Points

### After Phase 1: SimpleCompiler Done

**Question:** Does SimpleCompiler produce valid CompiledRenderers?

**If NO:** Fix SimpleCompiler, don't proceed  
**If YES:** Proceed to Phase 2

### After Phase 4: Integration Done

**Question:** Can we render with new Engine + SimpleCompiler?

**If NO:** Debug integration, fix issues  
**If YES:** Proceed to Phase 5

### After Phase 5: Testing Done

**Question:** Is new Engine as good as old Engine?

**If NO:** Identify and fix issues  
**If YES:** Proceed to Phase 6 (Compiler planning)

### After Phase 6: Compiler Planning Done

**Question:** Is Compiler plan feasible?

**If NO:** Revisit architecture, simplify scope  
**If YES:** Proceed to Phase 7 (Compiler implementation)

---

## Success Metrics

### Phase 1-5 Success (New Engine)

- ✅ Can render same scenes as old Engine
- ✅ Visual output identical
- ✅ Performance within 5%
- ✅ Strategy switching works
- ✅ Parameters work
- ✅ No WebGL errors
- ✅ No memory leaks

### Phase 6-8 Success (Real Compiler)

- ✅ Can compile scene descriptions to shaders
- ✅ Output matches SimpleCompiler
- ✅ Errors are helpful
- ✅ Performance acceptable
- ✅ Code is maintainable
- ✅ Can add new algorithms easily

---

## What NOT to Do

### Don't:
- ❌ Build Compiler before validating Engine
- ❌ Try to do everything at once
- ❌ Over-engineer SimpleCompiler
- ❌ Skip testing phases
- ❌ Change architecture mid-build (except at decision points)
- ❌ Add features not in plan (scope creep)

### Do:
- ✅ Build incrementally
- ✅ Test each piece independently
- ✅ Validate architecture early (Phase 1-5)
- ✅ Keep old code working until cutover
- ✅ Document learnings
- ✅ Adjust plan at decision points if needed

---

## Next Steps

1. **Review this build strategy** - Any concerns? Adjustments needed?

2. **Lock in the plan** - Once approved, this guides all implementation

3. **Start Phase 0** - Setup folder structure, define types

4. **Build Phase 1** - SimpleCompiler first

---

This strategy minimizes risk by validating the architecture with working code before building the complex parts. Each phase has clear deliverables and success criteria.
