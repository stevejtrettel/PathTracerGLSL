# Engine Layer

The **Engine Layer** manages all GPU resources and rendering execution. It is responsible for compiling shaders, managing WebGL state, executing render passes, and updating uniforms.

## Overview

The engine layer sits between the App layer and WebGL2. It provides a clean, high-level API for rendering while handling all low-level GPU details.

**Key Principle**: The engine knows nothing about UI, user input, or application state. It only knows how to render.

---

## Core Components

### Engine (`Engine.ts`)

The main orchestrator that ties everything together.

**Responsibilities**:
- Initialize and manage recipes
- Load HDR environment maps
- Coordinate between ShaderCompiler, RenderExecutor, ResourceManager, ParameterManager
- Handle recipe switching
- Provide external API

**Key Methods**:
```typescript
initialize(recipes: Recipe[]): void
selectRecipe(recipeId: string): void
loadEnvironmentHDR(path: string): Promise<void>
updateParameters(changes: ParameterChanges): void
renderFrame(): void
resize(width: number, height: number): void
clearAccumulation(): void
```

### ShaderCompiler (`ShaderCompiler.ts`)

Compiles modules into complete shader programs.

**Responsibilities**:
- Concatenate module GLSL code in dependency order
- Compile and link WebGL programs
- Handle compilation errors
- Manage three programs: main, display, composite

**Process**:
1. Extract module code (constants, uniforms, functions)
2. Concatenate in MODULE_ORDER
3. Inject module boundary comments
4. Compile vertex and fragment shaders
5. Link into program
6. Validate and translate errors

### RenderExecutor (`RenderExecutor.ts`)

Executes the multi-pass rendering pipeline.

**Responsibilities**:
- Execute main pass (path tracing accumulation)
- Execute display pass (tone mapping to RGB)
- Execute composite pass (RGB to screen)
- Manage viewport state
- Provide pixel readback (HDR and LDR)

**Rendering Pipeline**:
```
Main Pass:     Accumulation → RGBA32F buffer
Display Pass:  RGBA32F → Tone map → RGBA8 buffer
Composite Pass: RGBA8 buffer → Screen
```

### ResourceManager (`ResourceManager.ts`)

Manages framebuffers, accumulation buffers, and per-recipe resources.

**Responsibilities**:
- Create and manage accumulation buffers (per-recipe)
- Create RGB framebuffer (shared)
- Double buffering (ping-pong)
- Sample count tracking
- Buffer clearing

**Per-Recipe Resources**:
- Ping accumulation buffer (RGBA32F)
- Pong accumulation buffer (RGBA32F)
- Sample count

### ParameterManager (`ParameterManager.ts`)

Updates shader uniforms from parameter changes.

**Responsibilities**:
- Initialize uniforms from module bindings
- Update uniforms when parameters change
- Cache uniform locations
- Track skipped updates (performance)
- Update engine-provided uniforms (resolution, time, etc.)

**Uniform Flow**:
```
Parameter Change
  → Compute function (from UniformBinding)
  → WebGL uniform update
  → Cached for next frame
```

### TextureRegistry (`TextureRegistry.ts`)

Global texture management for shared resources.

**Responsibilities**:
- Register textures with string keys
- Bind textures to shader uniforms
- Manage texture units
- Clean up on dispose

**Primary Use**: Environment maps and CDFs shared across all recipes.

---

## Engine Lifecycle

### 1. Initialization

```typescript
const engine = new Engine(gl);

// Validate recipes
engine.initialize(recipes);
// - Validates recipe structure
// - Validates uniform bindings
// - Compiles shaders
// - Creates accumulation buffers
// - Sets up first recipe
```

### 2. Rendering Loop

```typescript
function loop() {
    engine.renderFrame();
    // - Prepare frame (swap buffers)
    // - Update engine uniforms
    // - Execute main pass
    // - Execute display pass
    // - Execute composite pass
    // - Finalize frame (increment sample count)

    requestAnimationFrame(loop);
}
```

### 3. Parameter Updates

```typescript
// App layer notifies engine of changes
engine.updateParameters({
    'camera.fov': { prev: 60, next: 45 },
    'light.intensity': { prev: 10, next: 15 }
});
// - Computes new uniform values
// - Updates only changed uniforms
// - Clears accumulation if needed
```

### 4. Resource Loading

```typescript
await engine.loadEnvironmentHDR('/path/to/env.hdr');
// - Validates fetch response
// - Validates buffer
// - Parses HDR
// - Validates dimensions
// - Creates texture
// - Builds importance sampling CDFs
// - Binds to all recipes
```

### 5. Recipe Switching

```typescript
engine.selectRecipe('albedo');
// - Switches shader programs
// - Switches accumulation buffers
// - Rebinds parameters
// - Preserves accumulated samples for that recipe
```

---

## Shader Compilation Pipeline

```
Recipe
  ↓
Extract Modules
  ↓
For each module:
  ├─ constants section
  ├─ uniforms section
  └─ functions section
  ↓
Concatenate (in MODULE_ORDER)
  ↓
Add module boundary comments
  ↓
Compile vertex shader
Compile fragment shader
  ↓
Link program
  ↓
Validate
  ↓
Translate errors (if any)
  ↓
Return CompilationResult
```

---

## Multi-Pass Rendering

### Pass 1: Main (Accumulation)

**Target**: Ping accumulation buffer (RGBA32F)
**Input**: Pong accumulation buffer (previous frame)
**Output**: New radiance sample added to average

**GLSL Flow**:
```glsl
// Generate ray
Ray ray = camera_generateRay(uv);

// Trace scene
vec3 radiance = transport_trace(ray);

// Accumulate
vec4 prev = texture(u_accumulator_radiance_previous, uv);
vec4 accumulated = accumulator_accumulate(radiance, prev, sampleCount);

gl_FragColor = accumulated;
```

### Pass 2: Display (Tone Mapping)

**Target**: RGB framebuffer (RGBA8)
**Input**: Current accumulation buffer
**Output**: Tone-mapped LDR image

**GLSL Flow**:
```glsl
vec3 hdr = texture(u_radiance_texture, uv).rgb;
vec3 ldr = developer_tonemap(hdr);
gl_FragColor = vec4(ldr, 1.0);
```

### Pass 3: Composite (Screen)

**Target**: Canvas (screen)
**Input**: RGB buffer
**Output**: Final displayed image

Simple passthrough with optional post-effects.

---

## Double Buffering

Accumulation uses ping-pong buffers to avoid read/write conflicts:

```
Frame N:
  Read:  Pong buffer (previous samples)
  Write: Ping buffer (new sample + average)

Frame N+1:
  Read:  Ping buffer (previous samples)
  Write: Pong buffer (new sample + average)
```

`ResourceManager` handles the swap automatically.

---

## Uniform Management

### Engine-Provided Uniforms

These are set automatically by the engine:

```glsl
uniform vec2 u_resolution;       // Canvas size
uniform vec2 u_imageSize;        // Full image size (for tiled rendering)
uniform int  u_frameIndex;       // Current frame number
uniform float u_time;            // Elapsed time (seconds)
uniform int  u_sampleCount;      // Accumulated samples
uniform vec2 u_pixelOffset;      // Offset for tiled rendering
```

### Module Uniforms

These come from module `uniformBindings`:

```glsl
uniform vec3 u_camera_position;
uniform float u_camera_fov;
uniform vec3 u_light_position;
// ... etc
```

ParameterManager updates these when parameters change.

---

## Error Handling

The engine integrates with the error system at multiple stages:

**Pre-compilation**:
- `validateRecipe()` - Checks module kinds match slots
- `validateRecipeModules()` - Checks uniform bindings

**Compilation**:
- `ShaderCompiler.compile()` - Returns `CompilationResult`
- `translateShaderErrors()` - Converts GLSL errors to helpful diagnostics

**Runtime**:
- `loadEnvironmentHDR()` - Validates fetch, buffer, data, texture

All errors include detailed messages and console output.

---

## Performance Optimizations

### Uniform Caching

ParameterManager caches uniform values and locations:
- Only update changed uniforms
- Skip duplicate updates
- Track cache hit rate

### Shader Reuse

Programs compiled once, reused across frames:
- No recompilation unless recipe changes
- Same program used for thousands of frames

### Float Precision

Uses RGBA32F for accumulation:
- Accurate averaging over many samples
- No precision loss from fixed-point arithmetic

### Buffer Management

ResourceManager minimizes allocations:
- Reuse buffers when resizing (if same size)
- Only create buffers once per recipe

---

## WebGL State Management

The engine maintains clean WebGL state:

**Responsibilities**:
- Bind correct framebuffer for each pass
- Set viewport for each pass
- Activate correct program for each pass
- Clear buffers as needed
- Handle context loss gracefully

**State Flow**:
```
Main Pass:
  gl.bindFramebuffer(accumulatorPingFB)
  gl.viewport(0, 0, width, height)
  gl.useProgram(mainProgram)
  gl.drawArrays()

Display Pass:
  gl.bindFramebuffer(rgbFB)
  gl.viewport(0, 0, width, height)
  gl.useProgram(displayProgram)
  gl.drawArrays()

Composite Pass:
  gl.bindFramebuffer(null)  // Screen
  gl.viewport(0, 0, width, height)
  gl.useProgram(compositeProgram)
  gl.drawArrays()
```

---

## API Reference

See [API Reference](api-reference.md) for detailed method signatures.

---

## Further Reading

- [Core Concepts](core-concepts.md) - Modules, recipes, shader structure
- [Rendering Pipeline](rendering-pipeline.md) - Detailed pass documentation
- [Resource Management](resource-management.md) - Buffers, textures, uniforms
- [Error System](../errors/) - Validation and error translation
