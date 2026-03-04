# Architecture Decisions Summary

Quick reference for all locked architectural decisions made during planning phase.

**Date:** January 2025  
**Status:** LOCKED ✅

---

## Core API Design

### Compiler API
```typescript
compile(scene: SceneDescription, strategy: RenderStrategy) → CompiledRenderer
```

**Simple, one-at-a-time compilation.** Project is user-level organizational convenience.

### Engine API
```typescript
loadRenderer(id: string, renderer: CompiledRenderer)
selectRenderer(id: string)
renderFrame()
```

**Load renderers individually.** Optional `loadRenderers()` convenience method for batch loading.

---

## ShaderProgram Structure

**Decision: Just strings (Option A)** ✅

```typescript
interface ShaderProgram {
  vertex: string;
  fragment: string;
}
```

**Rationale:**
- Keeps it simple
- Metadata (source maps, stats) lives at CompiledRenderer level where it's more useful
- Can add fields later without breaking anything

**Not this:**
```typescript
interface ShaderProgram {
  vertex: string;
  fragment: string;
  sourceMap?: SourceMap;  // ❌ Put this on CompiledRenderer instead
  stats?: { lines: number };
}
```

---

## Dev/Prod Mode

**Decision: Mode handling ONLY in main.ts (Option A)** ✅

```typescript
// main.ts - ONLY place that knows about deployment mode
const compiled = import.meta.env.MODE === 'development'
  ? compileProject(compiler, project)
  : await import('./compiled.js').then(m => m.COMPILED);

engine.loadRenderers(compiled);
```

**Rationale:**
- Compiler/Engine are pure - don't know about deployment
- Separation of concerns: main.ts = "how to get compiled code", Compiler = "how to compile"
- Simpler testing (no mode flags to mock)

**Not this:**
```typescript
// ❌ Don't put mode logic in Compiler
const compiler = new Compiler({ mode: 'development' });
```

---

## Parameters

### Parameter Paths: Scene-Specific (Option A) ✅

```typescript
parameterStore.set('camera.position', [0, 1, 0]);
parameterStore.set('material.glass.roughness', 0.1);
```

Paths naturally describe scene structure.

**Not this:**
```typescript
// ❌ Don't use global uniform names
parameterStore.set('u_camera_position', [0, 1, 0]);
```

### UI Metadata: Deferred ⏸️

**Decision: Compiler does NOT generate UI metadata (for now)**

**Why defer:**
- Adds complexity: Compiler must parse and preserve metadata through entire pipeline
- Tight coupling: Compiler knows about UI concerns
- Duplicates work: Metadata must be defined in scene AND in Compiler output
- Not needed for MVP

**Future (Phase 7+):** If auto-generating UIs becomes important, Compiler can extract and forward metadata from scene definitions.

**Current approach:**
- Scene definitions include parameter values
- Compiler generates UniformBindings
- UI metadata lives separately (if needed, can be in scene file but not compiled)
- App layer connects parameters to UI controls

---

## Buffer Swapping

**Decision: Explicit swap instructions (Option A)** ✅

### RenderPipeline Structure

```typescript
interface RenderPipeline {
  framebuffers: FramebufferConfig[];
  passes: RenderPass[];
  postFrame?: {
    swaps?: SwapInstruction[];  // Execute after all passes
  };
}

interface SwapInstruction {
  type: 'swap' | 'rotate';
  buffers: string[];
}
```

### Framebuffer Types

```typescript
interface FramebufferConfig {
  id: string;
  type: 'double_buffer' | 'texture' | 'screen';
  format: 'rgba32f' | 'rgba16f' | 'rgba8' | 'r32f';
}
```

- `double_buffer`: Creates ping/pong pair, provides `_current` and `_previous`
- `texture`: Single buffer
- `screen`: Canvas output

### Pass Execution Types

```typescript
type ExecutionType = 'once' | 'loop';
```

**No `accumulate` type!** That conflated rendering with buffer management.

### Examples

**Ping-pong accumulation:**
```typescript
postFrame: {
  swaps: [{ type: 'swap', buffers: ['accumulation'] }]
}
```

**Temporal history queue:**
```typescript
postFrame: {
  swaps: [{ type: 'rotate', buffers: ['current', 'history1', 'history2', 'history3'] }]
}
```

**Multiple independent accumulators:**
```typescript
postFrame: {
  swaps: [
    { type: 'swap', buffers: ['radiance'] },
    { type: 'swap', buffers: ['variance'] }
  ]
}
```

### Rationale

**Why explicit swaps?**

1. **Clean separation of concerns:** Passes describe rendering, postFrame describes buffer management
2. **Fully declarative:** Everything Engine needs to do is explicit in pipeline
3. **Handles all patterns:** Ping-pong, temporal queues, multiple independent buffers
4. **Easy to debug:** Clear where and when swaps happen
5. **Compiler-generated:** Users don't write this by hand, so verbosity doesn't matter

**Why not implicit?**
- ❌ Temporal history requires manual code (breaks declarative model)
- ❌ Swap behavior hidden (less obvious)
- ❌ Can't handle multiple swap types in one frame
- ❌ Harder to debug

**Why not execution-type swapping?**
- ❌ Conflates rendering behavior with buffer management
- ❌ "Accumulate" isn't an execution type, it's a buffer operation
- ❌ Not flexible enough

---

## Implementation Order

### For MVP (Phases 1-5):

**Include:**
- ✅ Simple Compiler API: `compile(scene, strategy)`
- ✅ Simple Engine API: `loadRenderer(id, renderer)`
- ✅ Double-buffer framebuffers with explicit swaps
- ✅ Scene-specific parameter paths
- ✅ Mode handling in main.ts only
- ✅ Just strings in ShaderProgram

**Defer:**
- ⏸️ UI metadata generation
- ⏸️ Temporal history/rotate swaps (unless needed)
- ⏸️ Multiple samples per frame (loop execution type)

### For Later (Phase 7+):

**Can add:**
- Temporal history support (rotate swaps)
- UI metadata extraction and forwarding
- Multiple execution modes
- Source map enhancements
- Additional framebuffer formats

---

## Key Principles

1. **Start simple, add complexity when needed** - Don't future-proof prematurely
2. **Compiler generates, users don't write** - Verbosity in RenderPipeline is fine since Compiler creates it
3. **Declarative over implicit** - Make everything explicit in the pipeline
4. **Separation of concerns** - Rendering ≠ buffer management ≠ deployment mode
5. **User-level vs core** - Project is organizational convenience, not compiler feature

---

## What Changed From Initial Design

### Removed from Core:
- ❌ `Project` type from Compiler API (now user-level)
- ❌ `CompiledProject` type (just use `Map<string, CompiledRenderer>`)
- ❌ `execution: { type: 'accumulate' }` (use explicit swaps instead)
- ❌ `type: 'accumulation'` framebuffer (renamed to `double_buffer`)

### Added to Core:
- ✅ `postFrame.swaps` in RenderPipeline
- ✅ `SwapInstruction` type with 'swap' and 'rotate'
- ✅ Design rationale documentation
- ✅ Clear deferred decisions list

---

## Implementation Details (Clarified)

### Multiple Render Targets (MRT)
- `output` field specifies which framebuffer to bind
- Framebuffer may have multiple color attachments
- Shader decides which to write using `layout(location = 0) out vec4`, `layout(location = 1) out vec4`, etc. (WebGL2 / GLSL 300 es)

### Swap Semantics
- **Swap:** Ping-pong between current ↔ previous
- **Rotate:** Queue rotation, last buffer **discarded** (not circular)

### Validation Rules (Engine.loadRenderer)
1. Exactly one screen framebuffer
2. All pass outputs exist
3. All pass inputs exist
4. Swap targets have correct types
5. All shader references valid

### Shader Naming
- Pass ID = conceptual (for debugging)
- Shader name = implementation (lookup key)
- Independent but often match

### Uniform Scope
- UniformBinding[] shared across all shaders in renderer
- Engine sets uniforms once per frame
- All shaders in renderer see same values

### Framebuffer Creation
- Created immediately when `loadRenderer()` called
- At current canvas size
- Not lazy

### Parameter Scoping
- Scene parameters (e.g., `sphere.position`) → global, affect all renderers
- Renderer parameters (e.g., `debug.outputMode`) → scoped to renderer ID
- ParameterManager automatically updates all renderers referencing a changed parameter
- Details deferred to Phase 7

---

## Summary Table

| Decision | Choice | Status | Phase |
|----------|--------|--------|-------|
| Compiler API | Individual compilation | ✅ Locked | Now |
| Engine API | Individual renderer loading | ✅ Locked | Now |
| ShaderProgram | Just strings | ✅ Locked | Now |
| Dev/Prod modes | Only in main.ts | ✅ Locked | Now |
| Parameter paths | Scene-specific | ✅ Locked | Now |
| Parameter UI metadata | Defer | ⏸️ Deferred | Phase 7+ |
| Buffer swapping | Explicit instructions | ✅ Locked | Now |
| Temporal history | Supported, defer usage | ✅ Locked, ⏸️ Usage later | Now / Later |

---

This architecture provides:
- Clear, simple core APIs
- Flexibility for future expansion
- Separation of concerns
- Fully declarative pipeline execution
- No hidden behavior or magic

Ready to build!
