# Engine Pillar Overview

## Purpose

The Engine is the **invisible GPU orchestration layer** that transforms modular mathematics into running WebGL programs. It handles all the tedious infrastructure - shader compilation, resource management, uniform binding, and render execution - with such reliability that researchers never think about it. The Engine makes GPU programming disappear.

## Core Philosophy

The Engine is intentionally **boring, deterministic, and invisible**. While other pillars embody mathematical concepts or algorithmic choices, the Engine embodies pure infrastructure. It has no opinions about rendering, no clever optimizations, no dynamic behavior. Every decision is explicit, every mapping is queryable, every operation is deterministic.

This boringness is its strength - researchers write mathematics, not WebGL.

## The Engine Architecture

The Engine consists of five subsystems, each with a single, clear responsibility:

```
ModuleRegistry (tracks modules)
    ↓
ShaderCompiler (transforms to GLSL)
    ↓
ResourceManager (allocates GPU memory)
    ↓
UniformBinder (maps parameters)
    ↓
RenderExecutor (executes frames)
```

### Understanding the Subsystems

Each subsystem owns a specific piece of the infrastructure puzzle, designed to be as independent as possible while maintaining clear interfaces with its neighbors.

**ModuleRegistry** acts as the central library of all available modules. Before any compilation can happen, modules must be registered, validated, and indexed. The registry ensures that every module fulfills its contract - a Geometry module must provide `geodesic`, `dot`, `parallel_transport`, and `frame` functions; a Material must provide `evaluate`, `sample`, and `pdf`. It builds dependency graphs, detects circular dependencies, and can suggest alternatives when modules are missing. Think of it as a strict librarian who won't let you check out a book (compile a recipe) unless all the referenced materials exist and cross-references are valid.

**ShaderCompiler** is the heart of the transformation process. It takes a recipe - which is just a list of module names - and produces a complete WebGL program ready to run on the GPU. The compiler's 8-stage pipeline methodically transforms high-level module code into GPU-executable GLSL, applying prefixes, resolving dependencies, and generating the orchestration code that ties everything together. Importantly, with eager compilation, this entire process happens once at startup for all known recipes, eliminating any compilation during research interaction.

**ResourceManager** owns all GPU memory allocation and capability detection. At initialization, it interrogates the GPU to understand its limits - can it handle HDR rendering? How many texture units are available? How large can textures be? Based on these capabilities, it manages the allocation of framebuffers and textures needed by Film modules, using a manifest comparison system to avoid unnecessary reallocation when switching between recipes. If the GPU can't handle certain requirements, the ResourceManager provides specific, actionable fallback suggestions.

**UniformBinder** creates the bridge between the App's parameter system and GPU uniforms. It builds an explicit, queryable map showing exactly how each parameter path (like "camera.position") maps to a GLSL uniform name (like "u_camera_pinhole_position") and ultimately to a WebGLUniformLocation. During each frame, it batches all parameter updates and flushes them to the GPU in a single efficient operation. When debugging, you can query this map to see exactly what's bound where, or discover why a parameter change isn't affecting the render.

**RenderExecutor** handles the actual WebGL draw calls and frame execution. It manages the full-screen triangle geometry (just 3 vertices that cover the viewport), coordinates render target binding, viewport configuration, and the actual draw call that triggers shader execution. It also handles pixel readback for output, using fence synchronization for non-blocking reads. Despite being called the "executor," it's remarkably simple - its job is to reliably trigger the GPU work that everything else has prepared.

---

These subsystems work in sequence during initialization (Registry → Compiler → Resources) and in parallel during frame execution (Uniforms + Resources + Executor), but each maintains its own clear scope of responsibility.




### The Compilation Pipeline

The Engine's most sophisticated component is its 8-stage compilation pipeline that transforms recipes into GPU programs:

```
Recipe (from App)
    ↓
1. CollectModules     → Extract 8 modules from recipe
    ↓
2. ValidateDependencies → Check all requires have provides
    ↓
3. SortModules        → Geometry first, topological sort
    ↓
4. ApplyPrefixes      → Add g_, m_, sc_, etc.
    ↓
5. ResolveCalls       → Map cross-module function calls
    ↓
6. GenerateMain       → Create orchestration function
    ↓
7. ExtractUniforms    → Build parameter mappings
    ↓
8. CompileGLSL        → WebGL compilation and linking
    ↓
CompiledProgram (ready to run)
```

Each stage validates its output, making errors precise and actionable.

## Key Design Decisions

### 1. Automatic Prefixing - The Invisible Namespace

The Engine's signature feature is **automatic function prefixing**. Module authors write clean, unprefixed functions:

```glsl
// User writes in geometry module:
Point geodesic(Point origin, Direction dir, float t) { 
    return origin + t * dir;  // Simplified
}

// Engine automatically produces:
Point g_geodesic(Point origin, Direction dir, float t) { 
    return origin + t * dir;
}

// Other modules call with prefix:
Point p = g_geodesic(ray.origin, ray.direction, hit.t);
```

This happens transparently during compilation. Authors never see or write prefixes, but the GPU gets properly namespaced code.

### 2. Eager Compilation - Zero Runtime Latency

With only 2-3 recipes in a research system, the Engine compiles everything at startup:

```typescript
// At initialization (once, ~1 second total)
engine.initialize([
    pathTracerRecipe,
    debugRecipe,
    productionRecipe
]);

// During interaction (instant)
engine.selectRecipe('pathtracer');  // No compilation!
engine.selectRecipe('debug');       // Instant switch!
```

This eliminates shader compilation stutter during research.

### 3. Explicit UniformMap - Debugging Made Easy

Every parameter-to-GPU mapping is explicit and queryable:

```typescript
// The UniformMap shows exactly how parameters map to uniforms
"camera.position" → "u_camera_pinhole_position" → WebGLUniformLocation

// Query any mapping
const binding = uniformBinder.getBinding("camera.position");
console.log(`Maps to uniform: ${binding.glslName}`);

// Debug all mappings
uniformMap.debugPrint();
// Output:
// camera.position → u_camera_pinhole_position ✓
// camera.fov → u_camera_pinhole_fov ✓
// material.roughness → u_material_disney_roughness ✓
```

No hidden magic - every mapping is visible.

### 4. Manifest-Based Resource Reuse

Film buffers are expensive. The Engine uses a manifest system to avoid reallocation:

```typescript
// Film provides manifest
manifest = {
    textures: [
        { name: "radiance", format: RGBA32F, persistent: true },
        { name: "variance", format: RGBA32F, persistent: true }
    ]
}

// When switching programs:
if (manifestsEqual(oldManifest, newManifest)) {
    clearBuffers();      // Just clear, don't reallocate
} else {
    allocateNewBuffers(); // Only when truly needed
}
```

### 5. State Machine - Always Know Where You Are

The Engine maintains explicit state with validated transitions:

```typescript
type EngineState = 
    | "uninitialized"
    | "ready"
    | "running"
    | "error";

// State is always known
if (engine.getState() !== "running") {
    throw new Error("Cannot render - not running");
}

// Transitions are validated
"ready" → "running" ✓
"running" → "uninitialized" ✗  // Invalid transition
```

### 6. Full-Screen Triangle - Subtle Optimization

Instead of the traditional quad (6 vertices), the Engine uses a single triangle (3 vertices):

```glsl
// Three vertices that cover the entire screen
vertices = [
    -1, -1,  // Bottom-left
     3, -1,  // Bottom-right (extends beyond)
    -1,  3   // Top-left (extends beyond)
];
```

This improves GPU utilization by avoiding the diagonal seam of a quad.

## Subsystem Responsibilities

### ModuleRegistry: The Librarian
- Stores all available modules
- Validates contracts (provides/requires)
- Resolves dependencies
- Suggests alternatives when modules are missing

### ShaderCompiler: The Translator
- Runs the 8-stage pipeline
- Applies automatic prefixing
- Validates at each stage
- Provides line mapping for errors

### ResourceManager: The Memory Guardian
- Checks GPU capabilities at startup
- Manages textures and framebuffers
- Implements manifest-based reuse
- Provides fallbacks for limited devices

### UniformBinder: The Parameter Bridge
- Builds explicit UniformMap
- Batches updates for efficiency
- Tracks missing bindings
- Provides debugging visibility

### RenderExecutor: The Draw Master
- Manages the full-screen triangle
- Executes WebGL draw calls
- Handles pixel readback
- Tracks frame statistics

## Capability Negotiation

The Engine detects GPU limitations and suggests fallbacks:

```typescript
// At startup
capabilities = {
    floatRenderTargets: false,  // No HDR support
    maxTextureUnits: 4          // Limited textures
}

// Engine suggests alternatives
if (!capabilities.floatRenderTargets) {
    suggestion: "Use 'simple_ldr' film module instead of 'variance_hdr'"
}

// App adjusts recipe
recipe.photography.film = getLDRFilmModule();
```

This happens automatically, with clear messages about what's not supported and what to use instead.

## Integration with Other Pillars

The Engine is purely infrastructural - it knows nothing about the mathematics or algorithms in other pillars:

### From World/Photography Modules
- Receives module descriptors with GLSL code
- Doesn't understand the mathematics, just compiles it
- Applies prefixes without knowing what functions do

### To GPU
- All WebGL operations flow through Engine
- Modules never touch WebGL directly
- Engine handles all GPU state

### With App
- Provides simple, high-level interface
- Hides all GPU complexity
- Makes state and mappings queryable

## Error Handling Philosophy

Errors are precise and actionable:

```
Compilation failed at stage: ResolveCalls
Module 'pathtracer' requires 'intersect' but no module provides it
In module: pathtracer
Line 42: if (intersect(ray, hit)) {  // <-- Missing function
Suggestion: Add a Scene module that provides 'intersect'
```

The Engine tells you exactly what went wrong, where, and how to fix it.

## Performance Architecture

### Compilation Performance
- **Eager compilation**: All shaders compiled at startup (~1-2 seconds total)
- **Program caching**: Instant recipe switching via pre-compiled programs
- **No runtime compilation**: Zero stalls during interaction

### Runtime Performance
- **Batched uniforms**: All parameter updates flushed once per frame
- **Manifest comparison**: O(1) buffer reuse decision
- **Single draw call**: One triangle, no state changes
- **Async readback**: Non-blocking pixel reads with fence sync

## The Boring Beauty

The Engine's boringness is deliberate and beautiful. By being utterly predictable, completely explicit, and absolutely deterministic, it becomes invisible. Researchers write:

```glsl
// In material module - clean mathematics
vec3 evaluate(vec3 wi, vec3 wo, Hit hit) {
    return albedo / PI;  // Lambert BRDF
}
```

They never write:
- WebGL setup code
- Shader compilation
- Uniform binding
- Resource management
- Draw calls

The Engine handles all of this so reliably that it disappears from consciousness. That's the goal: **infrastructure so boring it becomes invisible**.

## Summary

The Engine transforms modular mathematics into GPU execution through a deterministic pipeline of boring, explicit operations. Its automatic prefixing system keeps module code clean while avoiding naming collisions. Its eager compilation strategy eliminates runtime latency. Its explicit UniformMap makes debugging trivial. Its manifest-based resource system avoids unnecessary allocation. Every design decision prioritizes predictability and visibility over cleverness.

The Engine is the foundational layer that makes the entire path tracer possible, yet researchers never need to think about it. It's infrastructure that achieves invisibility through absolute reliability. Write mathematics, get GPU execution, never touch WebGL - that's the Engine's promise.
