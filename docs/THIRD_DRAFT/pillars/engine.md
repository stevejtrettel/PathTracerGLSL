# Engine Pillar Overview

## Purpose

The Engine is the **invisible GPU orchestration layer** that transforms modular mathematics into running WebGL programs. It handles all the tedious infrastructure - shader compilation, resource management, uniform binding, and render execution - with such reliability that researchers never think about it. The Engine makes GPU programming disappear.

## Core Philosophy

The Engine is intentionally **boring, deterministic, and invisible**. While other pillars embody mathematical concepts or algorithmic choices, the Engine embodies pure infrastructure. It has no opinions about rendering, no clever optimizations, no dynamic behavior. Every decision is explicit, every mapping is queryable, every operation is deterministic.

This boringness is its strength - researchers write mathematics, not WebGL.

## The Simplified Engine Architecture

The Engine consists of four subsystems, each with a single, clear responsibility:

```
ModuleRegistry (validates and stores modules)
    ↓
SimpleCompiler (concatenates and compiles)
    ↓
ResourceManager (manages GPU memory)
    ↓
RenderExecutor (executes frames)
```

### Understanding the Subsystems

Each subsystem owns a specific piece of the infrastructure puzzle, designed to be as independent as possible while maintaining clear interfaces with its neighbors.

**ModuleRegistry** acts as the central library of all available modules. Before any compilation can happen, modules must be registered, validated, and indexed. The registry ensures that every module fulfills its contract with properly prefixed functions - a Geometry module named "euclidean" must provide `euclidean_geodesic`, `euclidean_dot`, `euclidean_parallel_transport`, and `euclidean_frame` functions; a Material named "disney" must provide `disney_evaluate`, `disney_sample`, and `disney_pdf`. It enforces the manual prefixing convention strictly. Think of it as a strict librarian who ensures every module follows the naming rules before it can be used.

**SimpleCompiler** transforms collections of modules into complete GPU programs through direct concatenation. It takes a recipe - which is just a list of module names - and produces a complete WebGL program ready to run on the GPU. The compiler concatenates modules in a fixed order (geometry, material, lights, scene, camera, estimator, film, developer) without any code transformation. It also manages uniform mapping, building an explicit map from parameter paths to GPU locations. Importantly, with eager compilation, this entire process happens once at startup for all known recipes, eliminating any compilation during research interaction.

**ResourceManager** owns all GPU memory allocation and capability detection. At initialization, it interrogates the GPU to understand its limits - can it handle HDR rendering? How many texture units are available? How large can textures be? Based on these capabilities, it manages per-recipe film buffers, ensuring each recipe has its own accumulation buffers that persist when switching between recipes. This is key for preserving accumulated samples when quickly checking debug views. If the GPU can't handle certain requirements, the ResourceManager provides specific, actionable fallback suggestions.

**RenderExecutor** handles the actual WebGL draw calls and frame execution. It manages the full-screen triangle geometry (just 3 vertices that cover the viewport), coordinates render target binding, viewport configuration, and the actual draw call that triggers shader execution. It also handles pixel readback for output, using fence synchronization for non-blocking reads. Despite being called the "executor," it's remarkably simple - its job is to reliably trigger the GPU work that everything else has prepared.

---

These subsystems work in sequence during initialization (Registry → Compiler → Resources → Executor) and in parallel during frame execution, but each maintains its own clear scope of responsibility.

## The Simplified Compilation Process

The Engine's compilation is now remarkably simple - just direct concatenation:

```
Recipe (from App)
    ↓
1. ValidateModules    → Check all modules exist and have prefixed functions
    ↓
2. CollectModules     → Get modules from registry
    ↓
3. Concatenate        → Join modules in fixed order
    ↓
4. CompileGLSL        → WebGL compilation and linking
    ↓
CompiledProgram (ready to run)
```

No transformation, no dependency resolution, no automatic prefixing - modules are used exactly as written.

## Key Design Decisions

### 1. Manual Prefixing - Clear and Explicit

The Engine's signature simplification is **manual function prefixing**. Module authors write functions with explicit prefixes based on their module name:

```glsl
// Author writes in geometry module named "euclidean":
Point euclidean_geodesic(Point origin, Direction dir, float t) { 
    return origin + t * dir;  // Simplified
}

// Used directly in other modules:
Point p = euclidean_geodesic(ray.origin, ray.direction, hit.t);

// In material module named "disney":
vec3 disney_evaluate(vec3 wi, vec3 wo, Hit hit) {
    return albedo / PI;  // Simplified
}

// Called from estimator:
vec3 f = disney_evaluate(wi, wo, hit);
```

No magic, no transformation - what you write is what runs on the GPU.

### 2. Per-Recipe Accumulation - Never Lose Progress

Each recipe maintains its own film buffers that persist across switches:

```typescript
// Rendering path tracer (100 samples accumulated)
engine.selectRecipe('pathtracer');

// Quick check of debug view
engine.selectRecipe('debug');  // Different buffers

// Return to path tracer
engine.selectRecipe('pathtracer');  // Still has 100 samples!
```

This enables rapid iteration without losing accumulated samples.

### 3. Eager Compilation - Zero Runtime Latency

With only 2-3 recipes in a research system, the Engine compiles everything at startup:

```typescript
// At initialization (once, ~500ms total for 3 recipes)
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

### 4. Explicit UniformMap - Debugging Made Easy

Every parameter-to-GPU mapping is explicit and queryable:

```typescript
// The UniformMap shows exactly how parameters map to uniforms
"camera.position" → "u_camera_position" → WebGLUniformLocation

// Query any mapping
const mapping = program.uniformMap.getMapping("camera.position");
console.log(`Maps to uniform: ${mapping.glslName}`);

// Debug all mappings
program.uniformMap.debugPrint();
// Output:
// camera.position → u_camera_position ✓
// camera.fov → u_camera_fov ✓
// material.roughness → u_material_roughness ✓
```

No hidden magic - every mapping is visible.

### 5. Robust Manifest Comparison

Film buffers are only reallocated when truly needed:

```typescript
// Compare manifests property-by-property (not JSON)
private manifestsEqual(a: FilmManifest, b: FilmManifest): boolean {
  // Check each texture specification
  for (let i = 0; i < a.textures.length; i++) {
    const at = a.textures[i];
    const bt = b.textures[i];
    if (at.name !== bt.name || 
        at.format !== bt.format || 
        at.persistent !== bt.persistent) {
      return false;
    }
  }
  return true;
}
```

### 6. State Machine - Always Know Where You Are

The Engine maintains explicit state with validated transitions:

```typescript
type EngineState = 
    | { type: "uninitialized" }
    | { type: "ready" }
    | { type: "running"; program: CompiledProgram; frame: number; recipeId: string }
    | { type: "error"; error: Error; recoverable: boolean };

// State is always queryable
if (!engine.isRunning()) {
    throw new Error("Cannot render - not running");
}

// Transitions are validated
"ready" → "running" ✓
"running" → "uninitialized" ✗  // Invalid transition
```

### 7. Full-Screen Triangle - Subtle Optimization

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

### ModuleRegistry: The Strict Librarian
- Stores all available modules
- Validates manual prefixing strictly
- Ensures contract compliance
- Provides helpful error messages when prefixing is wrong

### SimpleCompiler: The Concatenator
- Concatenates modules in fixed order
- No code transformation whatsoever
- Manages integrated uniform mapping
- Provides error context with line numbers
- Compiles all recipes eagerly at startup

### ResourceManager: The Memory Guardian
- Checks GPU capabilities at startup
- Manages per-recipe film buffers
- Preserves accumulation when switching
- Provides fallbacks for limited devices
- Warns about accumulation loss on context loss

### RenderExecutor: The Draw Master
- Manages the full-screen triangle
- Executes WebGL draw calls
- Handles pixel readback
- Tracks frame statistics

## Module Function Convention

Every module must manually prefix its functions with its name:

```glsl
// Module: camera/pinhole
Ray pinhole_generateRay(vec2 pixel) { ... }

// Module: material/disney  
vec3 disney_evaluate(vec3 wi, vec3 wo, Hit hit) { ... }
vec3 disney_sample(vec3 wi, Hit hit, vec2 xi, out float pdf) { ... }
float disney_pdf(vec3 wi, vec3 wo, Hit hit) { ... }

// Module: estimator/pathtracer
Spectrum pathtracer_estimate(Ray ray) { ... }

// Module: scene/sdf
bool sdf_intersect(Ray ray, out Hit hit) { ... }
```

The main() orchestrator uses actual module names from the recipe:

```glsl
void main() {
  vec2 pixel = gl_FragCoord.xy;
  
  // These calls use actual module names as prefixes
  Ray ray = pinhole_generateRay(pixel);         // NOT camera_generateRay
  Spectrum radiance = pathtracer_estimate(ray); // NOT estimator_estimate
  Radiance accumulated = variance_accumulate(radiance, pixel);
  RGB color = aces_develop(accumulated);
  
  fragColor = vec4(color, 1.0);
}
```

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
    suggestion: "Use 'simple_ldr' film module instead of 'variance'"
}

// App adjusts recipe
recipe.photography.film = { kind: 'film', name: 'simple_ldr' };
```

This happens automatically, with clear messages about what's not supported and what to use instead.

## Integration with Other Pillars

The Engine is purely infrastructural - it knows nothing about the mathematics or algorithms in other pillars:

### From World/Photography Modules
- Receives module descriptors with manually prefixed GLSL code
- Doesn't understand the mathematics, just concatenates it
- Uses modules exactly as written

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
Module validation failed:
Module 'disney' (material) missing required function: disney_evaluate()
Found 'evaluate' without prefix. All functions must be manually prefixed: disney_evaluate

Context around line 42:
     40: uniform vec3 u_material_albedo;
     41: 
 >>> 42: vec3 evaluate(vec3 wi, vec3 wo, Hit hit) {
     43:   return u_material_albedo / PI;
     44: }

Suggestion: Rename function to disney_evaluate
```

The Engine tells you exactly what went wrong, where, and how to fix it.

## Performance Architecture

### Compilation Performance
- **Eager compilation**: All shaders compiled at startup (~500ms total for 3 recipes)
- **Program caching**: Instant recipe switching via pre-compiled programs
- **No runtime compilation**: Zero stalls during interaction
- **Direct concatenation**: No transformation overhead

### Runtime Performance
- **Per-recipe resources**: No reallocation when switching
- **Batched uniforms**: All parameter updates flushed once per frame
- **Robust manifest comparison**: Property-by-property, not JSON
- **Single draw call**: One triangle, no state changes
- **Async readback**: Non-blocking pixel reads with fence sync

## Context Loss Reality

WebGL context can be lost at any time. When it happens:

```typescript
handleContextLoss(): void {
  // All GPU resources are gone
  // All accumulated samples are lost
  // Recovery is possible but starts from scratch
  console.warn('Context lost - all recipe accumulation will be lost');
}
```

The Engine handles this gracefully but cannot recover accumulated samples.

## The Boring Beauty

The Engine's boringness is deliberate and beautiful. By being utterly predictable, completely explicit, and absolutely deterministic, it becomes invisible. Researchers write:

```glsl
// In material module named 'lambert' - clean mathematics with clear prefix
vec3 lambert_evaluate(vec3 wi, vec3 wo, Hit hit) {
    return albedo / PI;  // Lambert BRDF
}
```

They never write:
- WebGL setup code
- Shader compilation
- Uniform binding
- Resource management
- Draw calls
- Automatic prefixing

The Engine handles all infrastructure so reliably that it disappears from consciousness. That's the goal: **infrastructure so boring it becomes invisible**.

## Summary

The simplified Engine transforms modular mathematics into GPU execution through direct concatenation of manually prefixed modules. Its manual prefixing system makes function calls explicit and debuggable. Its per-recipe accumulation preserves progress when switching between recipes. Its eager compilation strategy eliminates runtime latency. Its integrated uniform management reduces complexity. Its robust manifest comparison prevents unnecessary reallocation. Every design decision prioritizes simplicity, predictability, and visibility over cleverness.

The Engine is the foundational layer that makes the entire path tracer possible, yet researchers never need to think about it. It's infrastructure that achieves invisibility through absolute reliability. Write mathematics with clear prefixes, get GPU execution, never touch WebGL - that's the Engine's promise.
