# Engine Pillar Overview

## Purpose

The Engine is the **boring, deterministic GPU orchestration layer** that transforms mathematical modules into running WebGL programs. It handles all the tedious plumbing - shader compilation, resource management, uniform binding, and render execution - so researchers can focus on mathematics and algorithms.

Once built, the Engine should be so stable and predictable that researchers never think about it. It's infrastructure that becomes invisible through reliability.

## Core Philosophy

The Engine embodies four principles that make it trustworthy infrastructure:

- **Invisible Infrastructure**: Researchers write mathematics, not WebGL. GPU details are completely hidden.
- **Deterministic Execution**: Same inputs always produce same outputs. No surprises, no heisenbugs.
- **Zero Cleverness**: Straightforward, debuggable, maintainable code. Boring is good.
- **Explicit Over Implicit**: Every mapping is queryable, every state transition is visible.

## Architecture

The Engine consists of five subsystems, each with a single, clear responsibility:

```typescript
class Engine {
  private registry: ModuleRegistry;      // Available modules database
  private compiler: ShaderCompiler;      // Module assembly → GLSL
  private resources: ResourceManager;    // GPU buffers and textures
  private uniforms: UniformBinder;       // Parameter → GPU mapping
  private executor: RenderExecutor;      // Draw calls and readback
  
  private state: EngineState;           // Explicit state machine
}
```

## Core Subsystems

### 1. Module Registry

**Purpose**: Track all available modules and validate their contracts.

The registry stores module descriptors, validates dependencies, and resolves module references from recipes. It provides built-in modules (Euclidean geometry, Lambert material, pinhole camera) and allows registration of custom modules.

Key responsibilities:
- Validate module contracts (required functions provided)
- Check dependency satisfaction (all `requires` have `provides`)
- Index modules for fast lookup
- Suggest alternatives when modules are missing

### 2. Shader Compiler

**Purpose**: Transform module collections into complete GLSL programs.

The compiler uses **eager compilation** - all shader variants are compiled at startup. With only 2-3 typical recipes, compilation happens once and switching is instant.

**Critical Design**: Users write unprefixed functions. The engine automatically adds prefixes:

```glsl
// User writes in geometry module:
Point geodesic(Point origin, Direction dir, float t) { ... }

// Engine produces:
Point g_geodesic(Point origin, Direction dir, float t) { ... }

// Other modules call with prefix:
Point p = g_geodesic(ray.origin, ray.direction, t);
```

The compilation pipeline has eight stages:

1. **Collect**: Gather modules from recipe
2. **Validate**: Ensure all dependencies satisfied
3. **Sort**: Topological sort with Geometry first (defines types)
4. **Prefix**: Add module prefixes (`g_`, `m_`, `sc_`, etc.)
5. **Resolve**: Map cross-module function calls to prefixed versions
6. **Generate Main**: Create orchestration code
7. **Extract Uniforms**: Build parameter → GPU mappings
8. **Compile GLSL**: WebGL compilation and linking

### 3. Resource Manager

**Purpose**: Manage GPU memory with capability checking and resource reuse.

The resource manager validates GPU capabilities at startup and provides fallbacks for limited devices. It uses a manifest system to reuse film buffers when possible - if the manifest hasn't changed, buffers are cleared rather than reallocated.

Key features:
- Capability validation (HDR support, texture limits)
- Film manifest comparison for resource reuse
- Automatic fallbacks for mobile/limited GPUs
- Memory usage tracking

Fallback example:
```typescript
// No HDR support detected
if (!capabilities.floatRenderTargets) {
  return {
    suggestion: 'Use LDR film module with 8-bit textures',
    textureFormat: { from: 'RGBA32F', to: 'RGBA8' }
  };
}
```

### 4. Uniform Binder

**Purpose**: Map parameter paths to GPU uniform locations with complete visibility.

The UniformBinder creates an explicit `UniformMap` showing exactly how parameters map to GPU uniforms. This makes debugging straightforward - you can query any mapping:

```typescript
// Parameter path → GLSL uniform name → GPU location
"camera.position" → "u_camera_pinhole_position" → WebGLUniformLocation

// Query the mapping
const binding = uniformBinder.getBinding("camera.position");
console.log(`Maps to: ${binding.glslName}`);
```

Updates are batched for efficiency:
1. Parameter changes are queued during the frame
2. All uniforms are updated once before rendering
3. Engine uniforms (resolution, frame count) are always updated

### 5. Render Executor

**Purpose**: Execute WebGL draw calls efficiently and reliably.

The executor uses a **full-screen triangle** (3 vertices) instead of a quad for better GPU utilization:

```glsl
// Triangle vertices that cover the screen
const vertices = [
  -1, -1,  // Bottom-left
   3, -1,  // Bottom-right (extends beyond)
  -1,  3   // Top-left (extends beyond)
];
```

Features:
- Async pixel readback with fence synchronization
- Frame statistics tracking
- State preservation and restoration
- Viewport management

## The Compilation Pipeline

### How Modules Become Shaders

The pipeline transforms a recipe through eight stages:

```
Recipe
  ↓ [Collect]      → ModuleCollection
  ↓ [Validate]     → Verified dependencies
  ↓ [Sort]         → Ordered modules (Geometry first)
  ↓ [Prefix]       → Functions prefixed (g_, m_, sc_, etc.)
  ↓ [Resolve]      → Cross-module calls connected
  ↓ [Generate]     → Main function created
  ↓ [Extract]      → UniformMap built
  ↓ [Compile]      → WebGL program
CompiledProgram
```

### Eager Compilation Strategy

At startup, the Engine compiles all known recipes:

```typescript
// App defines 2-3 recipes upfront
const recipes = [
  pathTracerRecipe,    // Standard rendering
  debugRecipe          // Visualization modes
];

// Compile all at startup (takes <1 second)
engine.initialize(recipes);

// Instant switching during interaction
engine.selectRecipe('pathtracer');  // No compilation!
```

### Automatic Prefixing

The prefixing system prevents naming collisions while keeping module code clean:

| Module Kind | Prefix | User Writes | Engine Produces |
|------------|--------|-------------|-----------------|
| Geometry | `g_` | `dot()` | `g_dot()` |
| Material | `m_` | `evaluate()` | `m_evaluate()` |
| Scene | `sc_` | `intersect()` | `sc_intersect()` |
| Lights | `l_` | `sample_light()` | `l_sample_light()` |
| Camera | `c_` | `generate_ray()` | `c_generate_ray()` |
| Estimator | `e_` | `estimate()` | `e_estimate()` |
| Film | `f_` | `accumulate()` | `f_accumulate()` |
| Developer | `d_` | `develop()` | `d_develop()` |

## State Management

### Engine State Machine

The Engine maintains explicit state with validated transitions:

```
uninitialized → ready → running → ready
                  ↓        ↓
                error ← ← ← 
```

State is always queryable:
```typescript
if (engine.isReady()) {
  engine.renderFrame();
}
```

### Parameter Update Flow

Parameters flow through explicit mappings:

```
1. App: parameterStore.set("camera.position", [0, 5, 10])
           ↓
2. Engine: uniformBinder.updateUniforms(changes)  // Queued
           ↓
3. Frame: uniformBinder.frameUpdate()  // Batched flush
           ↓
4. UniformMap: "camera.position" → "u_camera_pinhole_position"
           ↓
5. WebGL: gl.uniform3fv(location, [0, 5, 10])
```

## Error Handling

### Compilation Errors

Each pipeline stage provides clear error context:

```
Compilation failed at stage: Validate
Module 'pathtracer' requires 'intersect' but no module provides it
In module: pathtracer
Line 42: Hit hit = intersect(ray);  // <-- Missing function
```

### Runtime Fallbacks

The Engine detects limitations and suggests alternatives:

```typescript
// GPU doesn't support HDR
Capability Check Failed:
- Float render targets not supported
Suggestion: Use 'simple_ldr' film module instead of 'variance_hdr'

// Automatic fallback
if (!capabilities.floatRenderTargets) {
  recipe.photography.film = getLDRFilmModule();
}
```

### Missing Uniform Handling

When parameters don't map to uniforms, the Engine helps debug:

```
No uniform binding for parameter: camera.aperature
Did you mean: camera.aperture?
Available camera parameters: position, target, fov, aperture
```

## Integration with App

### Initialization

```typescript
// 1. Create engine
const engine = new Engine(gl);

// 2. Check capabilities
const caps = engine.getCapabilities();
if (!caps.floatRenderTargets) {
  console.warn('Using LDR fallback');
}

// 3. Compile all recipes at startup
engine.initialize([pathtracer, debug]);  // Eager compilation

// 4. Select initial recipe
engine.selectRecipe(pathtracer);
```

### Render Loop

```typescript
function render() {
  // Update parameters (batched internally)
  parameterStore.set('camera.position', position);
  
  // Single render call (handles everything)
  engine.renderFrame();
  
  requestAnimationFrame(render);
}
```

### Debugging

```typescript
// Query uniform mappings
const map = engine.getUniformMap();
map.debugPrint();  // Shows all parameter → uniform mappings

// Check state
console.log(engine.getState());  // 'ready' | 'running' | 'error'

// Get performance stats
const stats = engine.getFrameStats();
console.log(`FPS: ${stats.fps}`);
```

## Performance Architecture

### Compilation Performance
- **Eager compilation**: All shaders compiled at startup (~1 second for 2-3 recipes)
- **Instant switching**: Pre-compiled programs selected by key
- **No runtime compilation**: Zero stalls during interaction

### Rendering Performance
- **Batched uniforms**: All updates flushed once per frame
- **Full-screen triangle**: 3 vertices instead of 4 (quad)
- **Resource reuse**: Film buffers cleared, not reallocated
- **Async readback**: Fence synchronization prevents stalls

### Memory Management
- **Manifest comparison**: Reuse buffers when configuration unchanged
- **Capability-based allocation**: Only allocate what GPU supports
- **Clear tracking**: Know exactly what's allocated

## Platform Support

### Required Capabilities
- WebGL2 context
- For HDR: `EXT_color_buffer_float` extension

### Optional Enhancements
- `OES_texture_float_linear` for filtered HDR textures
- Multiple color attachments for variance tracking

### Automatic Fallbacks

| Limitation | Detection | Fallback |
|-----------|-----------|----------|
| No HDR | Missing `EXT_color_buffer_float` | Use 8-bit LDR film |
| Mobile GPU | User agent detection | Half-precision floats |
| Low memory | Allocation failure | Reduced resolution |
| Few texture units | `MAX_TEXTURE_UNITS < 8` | Simpler materials |

## Key Design Decisions

1. **Eager Compilation**: With only 2-3 recipes, compile everything upfront for instant switching
2. **Automatic Prefixing**: Users write clean functions, engine handles namespacing
3. **Explicit UniformMap**: Every parameter mapping is visible and queryable
4. **Manifest-Based Reuse**: Compare film requirements to avoid reallocation
5. **State Machine**: Engine state is always known and valid
6. **Boring Code**: Straightforward implementation over clever optimizations

## Summary

The Engine is intentionally boring infrastructure that makes GPU programming invisible. Through eager compilation, explicit mappings, and careful validation, it provides a rock-solid foundation for the research-focused layers above. Researchers write mathematical modules with unprefixed functions, and the Engine handles all the tedious details of making them run on the GPU.

The key insight is that with only 2-3 recipes in a research system, we can compile everything upfront and make the Engine so reliable it disappears from conscious thought. Parameters map to uniforms through an explicit, debuggable system. Resources are managed intelligently with capability checking and reuse. Everything is validated, everything is visible, and everything just works.
