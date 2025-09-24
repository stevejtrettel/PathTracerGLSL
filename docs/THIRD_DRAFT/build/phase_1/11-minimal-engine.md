# Phase 1.1: Minimal Engine - Detailed Plan

## Purpose & Scope

Phase 1.1 creates the absolute minimum infrastructure to compile GLSL modules into a working shader program and render a full-screen triangle. This is the "Hello Triangle" of our architecture - proving we can go from module strings to pixels.

**Core Goal**: Take registered GLSL text modules, concatenate them into a valid fragment shader, compile it, and render frames.

## File Structure & Responsibilities

### `src/engine/ModuleRegistry.ts` - Module Storage

**Purpose**: Dead-simple storage for GLSL module text. No validation, no processing, just a typed Map.

**Core Structure**:
```typescript
class ModuleRegistry {
  private modules: Map<string, ModuleDescriptor>
  
  register(module: ModuleDescriptor): void
  get(kind: ModuleKind, name: string): ModuleDescriptor | null
  has(kind: ModuleKind, name: string): boolean
}

interface ModuleDescriptor {
  kind: ModuleKind      // 'geometry' | 'camera' | etc
  name: string          // 'euclidean' | 'pinhole' | etc  
  source: string        // The actual GLSL code
}
```

**What it Does**:
- Stores modules by composite key "kind:name"
- Returns module source for compilation
- No validation of GLSL syntax
- No checking for required functions
- No dependency resolution

**Key Design Decisions**:
- Use "kind:name" as key (e.g., "camera:pinhole")
- Store raw GLSL strings unchanged
- Module authors responsible for correct prefixing
- No module inheritance or composition

### `src/engine/SimpleCompiler.ts` - Shader Assembly

**Purpose**: Concatenate modules in correct order to create valid GLSL programs.

**Core Structure**:
```typescript
class SimpleCompiler {
  constructor(
    private gl: WebGL2RenderingContext,
    private registry: ModuleRegistry
  )
  
  compile(recipe: Recipe): CompiledProgram
  private assembleFragmentShader(modules: ModuleCollection): string
  private compileGLSL(vertexSource: string, fragmentSource: string): WebGLProgram
}

interface Recipe {
  geometry: string      // Just the name, e.g., "euclidean"
  scene: string        // "hardcoded_sphere"
  lighting: string     // "white"
  camera: string       // "pinhole"
  transport: string    // "simple"
  interaction: string  // "debug_normal"
  film: string        // "simple"
  developer: string    // "linear"
}

interface CompiledProgram {
  program: WebGLProgram
  recipe: Recipe
}
```

**Shader Assembly Strategy**:

The fragment shader structure will be:
```glsl
#version 300 es
precision highp float;

// 1. Common types
struct Ray { vec3 origin; vec3 direction; float tmin; float tmax; }
struct Hit { vec3 p; vec3 n; float t; int id; }

// 2. Module functions (in dependency order)
[geometry module source]
[scene module source]
[lighting module source]
[camera module source]
[interaction module source]
[transport module source]
[film module source]
[developer module source]

// 3. Engine uniforms
uniform vec2 u_resolution;
out vec4 fragColor;

// 4. Main orchestration
void main() {
  vec2 pixel = gl_FragCoord.xy;
  
  Ray ray = camera_generateRay(pixel, u_resolution);
  vec3 radiance = transport_trace(ray);
  vec3 accumulated = film_accumulate(radiance, pixel);
  vec3 color = developer_develop(accumulated);
  
  fragColor = vec4(color, 1.0);
}
```

**Compilation Process**:
1. Fetch all modules from registry using recipe names
2. Concatenate in fixed order (geometry → developer)
3. Add common types before modules
4. Add uniforms after modules
5. Add hardcoded main() that calls module functions
6. Compile vertex + fragment shaders
7. Link program

**Error Handling**:
- If module missing: throw with clear message
- If GLSL compilation fails: throw with shader info log
- If linking fails: throw with program info log

### `src/engine/Engine.ts` - Orchestration

**Purpose**: Manage the rendering pipeline at highest level.

**Core Structure**:
```typescript
class Engine {
  private gl: WebGL2RenderingContext
  private compiler: SimpleCompiler
  private registry: ModuleRegistry
  private program: CompiledProgram | null
  private triangleVAO: WebGLVertexArrayObject
  
  constructor(canvas: HTMLCanvasElement)
  registerModule(module: ModuleDescriptor): void
  compile(recipe: Recipe): void
  renderFrame(): void
  
  private setupGeometry(): void
  private createFullScreenTriangle(): WebGLVertexArrayObject
}
```

**Initialization**:
1. Get WebGL2 context from canvas
2. Create ModuleRegistry and SimpleCompiler
3. Setup full-screen triangle VAO
4. Set default GL state (no depth test, no blend)

**Full-Screen Triangle**:
```typescript
// Single triangle that covers viewport
const vertices = new Float32Array([
  -1, -1,  // Bottom-left
   3, -1,  // Bottom-right (extends past viewport)  
  -1,  3   // Top-left (extends past viewport)
])
// Only need 3 vertices, not 6!
```

**Render Loop**:
```typescript
renderFrame():
  1. Bind program
  2. Set u_resolution uniform
  3. Bind triangle VAO
  4. Draw 3 vertices
  5. Check for GL errors in debug mode
```

**Key Design Decisions**:
- No uniform system yet (just u_resolution)
- No multi-pass rendering
- No framebuffers or textures
- Single active program only
- Fixed viewport (canvas size)

## Vertex Shader

Since all rendering is full-screen, vertex shader is trivial:

```glsl
#version 300 es
in vec2 a_position;

void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
}
```

This will be hardcoded in SimpleCompiler.

## Module Interface Contract

All modules must follow KIND prefixing:

```glsl
// Camera module exports:
Ray camera_generateRay(vec2 pixel, vec2 resolution)

// Transport module exports:
vec3 transport_trace(Ray ray)

// Interaction module exports:
vec3 interaction_surface_shade(Hit hit, vec3 wo)

// Scene module exports:
bool scene_intersect(Ray ray, out Hit hit)

// Film module exports:
vec3 film_accumulate(vec3 radiance, vec2 pixel)

// Developer module exports:
vec3 developer_develop(vec3 accumulated)
```

## Testing Strategy

### Unit Tests
```typescript
// ModuleRegistry
test('can register and retrieve module')
test('composite key works correctly')

// SimpleCompiler  
test('assembles modules in correct order')
test('throws on missing module')
test('includes all required sections')

// Engine
test('creates WebGL2 context')
test('triangle covers viewport')
test('render doesn't throw errors')
```

### Integration Test
```typescript
test('end-to-end: modules to pixels', async () => {
  // Register minimal modules
  // Compile recipe
  // Render frame
  // Read pixels
  // Verify non-black output
})
```

## Success Criteria

Phase 1.1 is complete when:
1. Can register GLSL modules by kind:name
2. Can concatenate modules into valid shader
3. Shader compiles without errors
4. Full-screen triangle renders
5. No WebGL errors in console
6. Ready to receive actual module implementations

## What We're NOT Doing in Phase 1.1

- Parsing or validating GLSL
- Checking for required functions
- Managing uniforms beyond u_resolution
- Accumulating frames
- Multiple recipes or hot swapping
- Any parameter system
- Resource management (textures, framebuffers)
- Error recovery (fail fast)

## Connection to Phase 1.2

This minimal engine provides:
- A way to register the hardcoded modules
- Compilation that concatenates them correctly
- A render loop that calls the orchestration
- The scaffold for testing our module convention

Phase 1.2 will provide the actual GLSL modules that this engine will compile and run.
