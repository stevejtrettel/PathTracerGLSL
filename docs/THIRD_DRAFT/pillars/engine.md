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

**ModuleRegistry** acts as the central library of all available modules. Before any compilation can happen, modules must be registered, validated, and indexed. The registry ensures that every module fulfills its contract with properly prefixed functions - a Geometry module must provide `geometry_geodesic`, `geometry_dot`, `geometry_parallel_transport`, and `geometry_frame` functions; an Interaction module must provide `interaction_surface_shade`, `interaction_surface_scatter`, and `interaction_surface_pdf`. The prefixing convention uses the module KIND, not the specific module name, so a "disney" interaction module still uses `interaction_` prefix, not `disney_`. Think of it as a strict librarian who ensures every module follows the universal naming rules.

**SimpleCompiler** transforms collections of modules into complete GPU programs through direct concatenation. It takes a recipe - which includes both hand-written modules and compiled modules from WorldCompiler - and produces a complete WebGL program ready to run on the GPU. The compiler concatenates modules in a fixed order (geometry, scene, lighting, camera, transport, interaction, film, developer) without any code transformation. It also manages uniform mapping, building an explicit map from parameter paths to GPU locations. Importantly, with eager compilation, this entire process happens once at startup for all known recipes, eliminating any compilation during research interaction.

**ResourceManager** owns all GPU memory allocation and capability detection. At initialization, it interrogates the GPU to understand its limits - can it handle HDR rendering? How many texture units are available? How large can textures be? Based on these capabilities, it manages per-recipe film buffers, ensuring each recipe has its own accumulation buffers that persist when switching between recipes. This is key for preserving accumulated samples when quickly checking debug views. If the GPU can't handle certain requirements, the ResourceManager provides specific, actionable fallback suggestions.

**RenderExecutor** handles the actual WebGL draw calls and frame execution. It manages the full-screen quad geometry (6 vertices forming 2 triangles that cover the viewport), coordinates render target binding, viewport configuration, and the actual draw call that triggers shader execution. It also handles pixel readback for output, using fence synchronization for non-blocking reads. Despite being called the "executor," it's remarkably simple - its job is to reliably trigger the GPU work that everything else has prepared.

## The Simplified Compilation Process

The Engine's compilation is remarkably simple - just direct concatenation:

```
Recipe (from App with compiled World modules)
    ↓
1. ValidateModules    → Check all modules exist and have proper functions
    ↓
2. CollectModules     → Get modules from registry (including compiled ones)
    ↓
3. Concatenate        → Join modules in fixed order
    ↓
4. CompileGLSL        → WebGL compilation and linking
    ↓
CompiledProgram (ready to run)
```

No transformation, no dependency resolution, no automatic prefixing - modules are used exactly as written or as compiled by WorldCompiler.

## Key Design Decisions

### 1. Module KIND Prefixing

The Engine enforces a universal prefixing convention based on module KIND, not specific module names:

```glsl
// Hand-written geometry module (whether euclidean, hyperbolic, or spherical):
Point geometry_geodesic(Point origin, Direction dir, float t) { 
    return origin + t * dir;  // Euclidean implementation
}

// Compiled scene module (from WorldCompiler):
bool scene_intersect(Ray ray, out Hit hit) {
    // Generated code for ray marching
}
MaterialProperties scene_material_properties(int mat_id, Point p) {
    // Generated material lookups
}

// Hand-written interaction module (whether disney, lambert, or glass):
vec3 interaction_surface_shade(vec3 wi, vec3 wo, Hit hit) {
    MaterialProperties props = scene_material_properties(hit.material_to, hit.p);
    // Disney BRDF using material data
}

// Hand-written transport module (whether pathtracer or volumetric):
Spectrum transport_trace(Ray ray) {
    // Path tracing using all modules
}
```

This convention means swapping implementations requires no code changes - just recipe changes.

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

### 4. Explicit UniformMap - Debugging Made Easy

Every parameter-to-GPU mapping is explicit and queryable:

```typescript
// The UniformMap shows exactly how parameters map to uniforms
"camera.position" → "u_camera_position" → WebGLUniformLocation
"transport.max_bounces" → "u_transport_max_bounces" → WebGLUniformLocation

// Query any mapping
const mapping = program.uniformMap.getMapping("camera.position");
console.log(`Maps to uniform: ${mapping.glslName}`);

// Debug all mappings
program.uniformMap.debugPrint();
```

### 5. Module Order for Dependencies

Modules are concatenated in a specific order to satisfy dependencies:

```typescript
const moduleOrder = [
    'geometry',      // Mathematical foundation (hand-written)
    'scene',         // Objects and materials (compiled)
    'lighting',      // Light sources (compiled)
    'camera',        // Ray generation (hand-written)
    'transport',     // Integration strategy (hand-written)
    'interaction',   // Light-matter physics (hand-written)
    'film',          // Accumulation (hand-written)
    'developer'      // Tone mapping (hand-written)
];
```

This ensures each module can call functions from modules loaded before it.

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
```

### 7. Full-Screen Quad - Simple and Clear

The Engine uses a traditional quad (6 vertices, 2 triangles) to cover the viewport:

```glsl
// Six vertices forming two triangles that cover the screen
vertices = [
    -1, -1,  // Bottom-left
     1, -1,  // Bottom-right
    -1,  1,  // Top-left
     1, -1,  // Bottom-right (repeated)
     1,  1,  // Top-right
    -1,  1   // Top-left (repeated)
];
```

## Subsystem Responsibilities

### ModuleRegistry: The Strict Librarian
- Stores all available modules (hand-written and compiled)
- Validates KIND-based prefixing strictly
- Ensures contract compliance
- Recognizes compiled modules from WorldCompiler
- Provides helpful error messages when prefixing is wrong

### SimpleCompiler: The Concatenator
- Concatenates modules in fixed order
- No code transformation whatsoever
- Manages integrated uniform mapping
- Handles both hand-written and compiled modules
- Compiles all recipes eagerly at startup

### ResourceManager: The Memory Guardian
- Checks GPU capabilities at startup
- Manages per-recipe film buffers
- Preserves accumulation when switching
- Provides fallbacks for limited devices
- Warns about accumulation loss on context loss

### RenderExecutor: The Draw Master
- Manages the full-screen quad
- Executes WebGL draw calls
- Handles pixel readback
- Tracks frame statistics

## Module Function Convention

All modules use their KIND as prefix, regardless of specific implementation:

### Hand-Written Modules (Photography)

```glsl
// Module kind: camera (implementation: pinhole, perspective, fisheye, etc.)
Ray camera_generateRay(vec2 pixel, vec2 xi) { ... }
mat4 camera_getProjectionMatrix() { ... }

// Module kind: transport (implementation: pathtracer, volumetric, debug, etc.)
Spectrum transport_trace(Ray ray) { ... }
bool transport_occluded(vec3 p, vec3 dir, float dist) { ... }

// Module kind: interaction (implementation: disney, lambert, glass, etc.)
vec3 interaction_surface_shade(vec3 wi, vec3 wo, Hit hit) { ... }
vec3 interaction_surface_scatter(vec3 wi, Hit hit, vec2 xi, out float pdf) { ... }
float interaction_surface_pdf(vec3 wi, vec3 wo, Hit hit) { ... }
vec3 interaction_surface_emit(Hit hit) { ... }

// Volume interaction functions
vec3 interaction_volume_shade(vec3 wi, vec3 wo, vec3 p, int mat_id, float distance) { ... }
vec3 interaction_volume_scatter(vec3 wi, vec3 p, int mat_id, vec2 xi, out float pdf) { ... }

// Module kind: film (implementation: variance, simple_ldr, etc.)
Radiance film_accumulate(Spectrum radiance, vec2 pixel) { ... }
void film_clear() { ... }

// Module kind: developer (implementation: aces, reinhard, linear, etc.)
RGB developer_develop(Radiance accumulated) { ... }
```

### Compiled Modules (World)

```glsl
// Module kind: geometry (implementation: euclidean, hyperbolic, spherical)
Point geometry_geodesic(Point origin, Direction dir, float t) { ... }
float geometry_distance(Point a, Point b) { ... }
float geometry_dot(Direction u, Direction v, Point p) { ... }
Frame geometry_frame(Point p, Normal n) { ... }

// Module kind: scene (always compiled by WorldCompiler)
bool scene_intersect(Ray ray, out Hit hit) { ... }
bool scene_intersect_any(Ray ray, float max_t) { ... }
MaterialProperties scene_material_properties(int mat_id, Point p) { ... }
int scene_material_at(Point p) { ... }
float scene_bounding_radius() { ... }

// Module kind: lighting (always compiled by WorldCompiler)
LightSample lighting_sample(Point p, vec2 xi) { ... }
float lighting_pdf(Point p, Direction wi) { ... }
LightData lighting_get_light(int light_id) { ... }
bool lighting_can_sample(int light_id) { ... }
int lighting_count() { ... }
Spectrum lighting_environment(Direction dir) { ... }
bool lighting_has_environment() { ... }
```

### Main Function

The main() orchestrator uses module KIND prefixes consistently:

```glsl
void main() {
  vec2 pixel = gl_FragCoord.xy;
  vec2 xi = next_2d();
  
  // All calls use module KIND as prefix
  Ray ray = camera_generateRay(pixel, xi);
  Spectrum radiance = transport_trace(ray);
  Radiance accumulated = film_accumulate(radiance, pixel);
  RGB color = developer_develop(accumulated);
  
  fragColor = vec4(color, 1.0);
}
```

## Module Dependencies

The fixed concatenation order ensures dependencies are satisfied:

### Transport Dependencies
```glsl
// Transport can call earlier modules:
scene_intersect(ray, hit)                     // From Scene
scene_material_properties(mat_id, p)          // From Scene
lighting_sample(p, xi)                         // From Lighting
lighting_get_light(light_id)                  // From Lighting
interaction_surface_shade(wi, wo, hit)        // From Interaction
interaction_surface_scatter(wi, hit, xi, pdf) // From Interaction
geometry_geodesic(origin, dir, t)             // From Geometry
```

### Interaction Dependencies
```glsl
// Interaction can call earlier modules:
scene_material_properties(mat_id, p)          // Get material data
geometry_dot(u, v, p)                          // For geometric calculations
// Materials are pure data - no functions to call
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

## Integration with Other Pillars

The Engine is purely infrastructural:

### From World Modules
- Receives compiled Scene and Lighting modules from WorldCompiler
- Hand-written Geometry module
- Uses them exactly as provided with their KIND prefixes

### From Photography Modules
- Receives hand-written modules for camera, transport, interaction, film, developer
- Each uses its KIND as prefix

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
Module 'disney' (interaction) missing required function: interaction_surface_shade
Found 'disney_evaluate' - incorrect prefix for interaction module.

Interaction modules must use 'interaction_' prefix for all functions:
  Required: interaction_surface_shade, interaction_surface_scatter, interaction_surface_pdf

Context around line 42:
     40: uniform vec3 u_albedo;
     41: 
 >>> 42: vec3 disney_evaluate(vec3 wi, vec3 wo, Hit hit) {
     43:   MaterialProperties props = scene_material_properties(hit.material_to, hit.p);
     44: }

Suggestion: Rename to interaction_surface_shade

Note: Module KIND determines prefix, not module name.
A 'disney' interaction module still uses 'interaction_' prefix.
```

## Performance Architecture

### Compilation Performance
- **Eager compilation**: All shaders compiled at startup (~500ms total for 3 recipes)
- **Program caching**: Instant recipe switching via pre-compiled programs
- **No runtime compilation**: Zero stalls during interaction
- **Direct concatenation**: No transformation overhead

### Runtime Performance
- **Per-recipe resources**: No reallocation when switching
- **Batched uniforms**: All parameter updates flushed once per frame
- **Single draw call**: One quad, no state changes
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

## Recipe Structure

A complete recipe combining World and Photography:

```typescript
interface Recipe {
  world: {
    geometry: { kind: 'geometry', name: string };        // Hand-written module
    scene: { kind: 'scene', name: string };              // Compiled by WorldCompiler
    lighting: { kind: 'lighting', name: string };        // Compiled by WorldCompiler
  };
  photography: {
    camera: { kind: 'camera', name: string };            // Hand-written module
    transport: { kind: 'transport', name: string };      // Path tracing strategy
    interaction: { kind: 'interaction', name: string };  // BRDF/BSDF physics
    film: { kind: 'film', name: string };                // Accumulation strategy
    developer: { kind: 'developer', name: string };      // Tone mapping
  };
}

// Example recipe
const pathTracerRecipe: Recipe = {
  world: {
    geometry: { kind: 'geometry', name: 'euclidean' },
    scene: { kind: 'scene', name: 'compiled_12345' },     // From WorldCompiler
    lighting: { kind: 'lighting', name: 'compiled_12345' } // From WorldCompiler
  },
  photography: {
    camera: { kind: 'camera', name: 'pinhole' },
    transport: { kind: 'transport', name: 'pathtracer' },
    interaction: { kind: 'interaction', name: 'disney' },
    film: { kind: 'film', name: 'variance' },
    developer: { kind: 'developer', name: 'aces' }
  }
};
```

## The Boring Beauty

The Engine's boringness is deliberate and beautiful. By being utterly predictable, completely explicit, and absolutely deterministic, it becomes invisible. Researchers write:

```glsl
// In interaction module - clean physics with KIND prefix
vec3 interaction_surface_shade(vec3 wi, vec3 wo, Hit hit) {
    MaterialProperties props = scene_material_properties(hit.material_to, hit.p);
    // Disney BRDF using material data
    return brdf_result;
}

// In transport module - integration strategy with KIND prefix
Spectrum transport_trace(Ray ray) {
    // Path tracing algorithm
}
```

They never write:
- WebGL setup code
- Shader compilation
- Uniform binding
- Resource management
- Draw calls
- Module-specific prefixes

The universal KIND-based prefixing means you can swap implementations freely - change from `pinhole` to `perspective` camera, from `pathtracer` to `volumetric` transport, from `disney` to `lambert` interaction - all without changing any calling code.

## Summary

The Engine transforms modular mathematics into GPU execution through direct concatenation of both hand-written and compiled modules. Its KIND-based prefixing convention creates a universal interface - every camera module provides `camera_generateRay`, every transport provides `transport_trace`, every interaction provides `interaction_surface_shade`. This makes modules truly swappable without code changes.

It handles the integration between WorldCompiler's output (compiled Scene and Lighting modules) and hand-written Photography modules. Materials are pure data accessed through the Scene module, while all light-matter physics lives in the Interaction module using the universal `interaction_` prefix. The Transport module orchestrates the rendering algorithm, calling into Scene for geometry, Lighting for illumination, and Interaction for BRDFs - all using consistent KIND prefixes.

Every design decision prioritizes simplicity, predictability, and visibility over cleverness. The Engine is the foundational layer that makes the entire path tracer possible, yet researchers never need to think about it. It's infrastructure that achieves invisibility through absolute reliability. Write mathematics with universal prefixes, get GPU execution, never touch WebGL - that's the Engine's promise.
