# Engine Architecture: Research Path Tracer

## Purpose and Philosophy

The Engine is the **boring, deterministic GPU orchestration layer** that transforms mathematical modules into running WebGL programs. It handles all the tedious plumbing: shader compilation, resource management, uniform binding, and render execution. Once built, the Engine should be so stable and predictable that researchers never think about it.

**Core Principles:**
- **Invisible Infrastructure**: Researchers write mathematics, not WebGL
- **Deterministic Execution**: Same inputs always produce same outputs
- **Zero Cleverness**: Straightforward, debuggable, maintainable code
- **Set and Forget**: Write once, never modify during research

## System Architecture

```typescript
class Engine {
  // Core subsystems - each handles one responsibility
  private compiler: ShaderCompiler;      // Module assembly → GLSL
  private resources: ResourceManager;    // GPU buffers and textures
  private uniforms: UniformBinder;       // Parameter → GPU mapping
  private executor: RenderExecutor;      // Draw calls and readback
  private registry: ModuleRegistry;      // Available modules database
  
  // Runtime state
  private programs: Map<string, CompiledProgram>;  // Compiled shaders
  private activeProgram: CompiledProgram | null;   // Currently bound
  private gl: WebGL2RenderingContext;              // WebGL context
}
```

## Core Subsystems

### 1. Shader Compiler

**Responsibility**: Transform modules into complete GLSL programs.

**Process**:
1. **Dependency Resolution**: Topologically sort modules (Geometry first)
2. **Type Extraction**: Pull Point/Direction definitions from Geometry
3. **Prefix Application**: Add module-specific prefixes to functions/uniforms

5. **Cross-Module Resolution**: Map `requires` to `provides`
6. **Main Generation**: Create appropriate orchestration main()
7. **WebGL Compilation**: Compile and link vertex/fragment shaders
8. **Location Extraction**: Cache all uniform/attribute locations

**Key Decisions**:
- All shaders compile at startup (no runtime compilation)
- Keep both prefixed and unprefixed source for debugging
- Generate line number mappings for error reporting

### 2. Resource Manager

**Responsibility**: Manage GPU memory for textures, buffers, and framebuffers.

**Film Buffer Management**:
```typescript
// Films declare their needs in ModuleDescriptor:
resources: {
  textures: [
    { name: "radiance", type: "vec4", format: "32bit", persistent: true },
    { name: "variance", type: "vec3", format: "32bit", persistent: true },
    { name: "samples", type: "int", format: "32bit", persistent: true }
  ]
}

// ResourceManager creates matching framebuffers
class ResourceManager {
  setupFilmBuffers(film: ModuleDescriptor) {
    for (const tex of film.resources.textures) {
      this.createTexture(tex);
      this.bindToFramebuffer(tex);
    }
  }
}
```

**Texture Management**:
- Track texture unit usage (WebGL2 limit: 16-32 units)
- Pool commonly-used configurations
- Lazy allocation for memory efficiency
- Automatic format selection based on platform capabilities

**Memory Strategies**:
- Monitor GPU memory usage via WebGL extensions
- Provide fallback formats for mobile devices
- Report memory pressure to App for tiling decisions

### 3. Uniform Binder

**Responsibility**: Efficiently map ParameterStore paths to GPU uniforms.

**Mapping Strategy**:
```typescript
// ParameterStore path → GPU uniform location
"camera.position"        → u_camera_pinhole_position
"material.glass.ior"     → u_material_glass_ior
"estimator.max_bounces"  → u_estimator_pathtracer_max_bounces
```

**Implementation**:
```typescript
class UniformBinder {
  private bindings: Map<string, UniformBinding>;
  
  buildBindings(program: CompiledProgram, recipe: Recipe) {
    // For each parameter in recipe
    // Find corresponding uniform location
    // Cache the mapping
  }
  
  updateUniforms(changes: ParameterChanges) {
    for (const change of changes) {
      const binding = this.bindings.get(change.path);
      if (binding) {
        this.gl.uniform[binding.type](binding.location, change.value);
      }
    }
  }
}
```

**Optimization**:
- Cache uniform locations per program
- Batch uniform updates per frame
- Skip uniforms that haven't changed
- Handle missing uniforms gracefully (some variants may not use all parameters)

### 4. Render Executor

**Responsibility**: Execute WebGL draw calls and manage render targets.

**Render Modes**:
```typescript
interface RenderMode {
  target: "screen" | "texture";
  viewport: { x, y, width, height };
  clear: boolean;
  swapBuffers: boolean;
}

class RenderExecutor {
  renderFrame(mode: RenderMode) {
    // Set viewport
    this.gl.viewport(mode.viewport.x, mode.viewport.y, 
                     mode.viewport.width, mode.viewport.height);
    
    // Bind framebuffer (null for screen)
    this.gl.bindFramebuffer(GL.FRAMEBUFFER, 
                            mode.target === "screen" ? null : this.fbo);
    
    // Clear if requested (first sample)
    if (mode.clear) {
      this.gl.clear(GL.COLOR_BUFFER_BIT);
    }
    
    // Draw full-screen quad
    this.gl.drawArrays(GL.TRIANGLE_STRIP, 0, 4);
    
    // Swap if accumulating
    if (mode.swapBuffers) {
      this.resources.swapFilmBuffers();
    }
  }
  
  async readPixels(rect?: Rectangle): Promise<Float32Array> {
    // Read back from current framebuffer
    const pixels = new Float32Array(rect.width * rect.height * 4);
    this.gl.readPixels(rect.x, rect.y, rect.width, rect.height,
                       GL.RGBA, GL.FLOAT, pixels);
    return pixels;
  }
}
```

### 5. Module Registry

**Responsibility**: Track available modules and their capabilities.

**Module Database**:
```typescript
class ModuleRegistry {
  private modules: Map<string, ModuleDescriptor> = new Map();
  
  register(module: ModuleDescriptor) {
    const key = `${module.id.kind}:${module.id.name}`;
    this.modules.set(key, module);
    
    // Index provides/requires for dependency resolution
    this.indexCapabilities(module);
  }
  
  resolve(kind: string, name: string): ModuleDescriptor {
    return this.modules.get(`${kind}:${name}`);
  }
  
  findProvider(functionName: string): ModuleDescriptor {
    // Find module that provides this function
    return this.providesIndex.get(functionName);
  }
}
```

## Compilation Pipeline

### Phase 1: Module Collection
```typescript
// Gather all modules from Recipe
const modules = [
  recipe.world.geometry,
  ...recipe.world.materials,  // Multiple materials
  recipe.world.scene,
  recipe.world.lights,
  recipe.photography.camera,
  recipe.photography.estimator,
  recipe.photography.film,
  recipe.photography.developer
];
```

### Phase 2: Dependency Sorting
```typescript
// Topological sort with Geometry first
const sorted = topologicalSort(modules, {
  priority: ["Geometry"],  // Always first
  edges: extractDependencies(modules)
});
```

### Phase 3: Prefix Application
```typescript
// Apply prefixes based on module kind
const prefixMap = {
  "Geometry": "g_",
  "Material": "m_",  
  "Scene": "sc_",
  "Light": "l_",
  "Camera": "c_",
  "Estimator": "e_",
  "Film": "f_",
  "Developer": "d_"
};
```



### Phase 5: Cross-Module Resolution
```typescript
// Resolve requires → provides
function resolveFunction(call: string, context: Module): string {
  // Example: "intersect" in Estimator
  // 1. Estimator requires ["intersect"]
  // 2. Scene provides ["intersect"]
  // 3. Transform to "sc_intersect"
  
  const provider = registry.findProvider(call);
  const prefix = getPrefixForModule(provider);
  return prefix + call;
}
```

### Phase 6: Main Generation
```typescript
// Select appropriate main() template
function generateMain(modules: ProcessedModules): string {
  if (modules.film.isDebug) {
    return DEBUG_MAIN_TEMPLATE;
  } else if (modules.film.isPassthrough) {
    return REALTIME_MAIN_TEMPLATE;
  } else {
    return STANDARD_MAIN_TEMPLATE;
  }
}

const STANDARD_MAIN_TEMPLATE = `
void main() {
  vec2 pixel = gl_FragCoord.xy;
  
  // Random offset for antialiasing
  vec2 xi = sample_2d(ivec2(pixel), u_frame_index, 0);
  
  // Camera generates ray
  Ray ray = c_generate_ray(pixel, xi);
  
  // Estimator computes radiance
  vec3 radiance = e_estimate(ray);
  
  // Film accumulates
  vec3 accumulated = f_accumulate(radiance, pixel);
  
  // Developer tonemaps
  vec3 color = d_develop(accumulated);
  
  gl_FragColor = vec4(color, 1.0);
}
`;
```

### Phase 7: WebGL Compilation
```typescript
class ShaderCompiler {
  compile(source: string): WebGLProgram {
    // Create shaders
    const vs = this.compileShader(VERTEX_SOURCE, GL.VERTEX_SHADER);
    const fs = this.compileShader(source, GL.FRAGMENT_SHADER);
    
    // Link program
    const program = this.gl.createProgram();
    this.gl.attachShader(program, vs);
    this.gl.attachShader(program, fs);
    this.gl.linkProgram(program);
    
    // Check for errors with line mapping
    if (!this.gl.getProgramParameter(program, GL.LINK_STATUS)) {
      const error = this.gl.getProgramInfoLog(program);
      throw new CompilationError(this.mapErrorToModules(error));
    }
    
    return program;
  }
}
```

## Data Flow

### Render Frame Flow
```
1. App.parameterStore.set("camera.position", [0, 5, 10])
         ↓
2. Engine.uniforms.updateUniforms(changes)
         ↓
3. Engine.executor.renderFrame({ target: "texture" })
         ↓
4. WebGL draws full-screen quad
         ↓
5. Shaders execute (Camera → Estimator → Film → Developer)
         ↓
6. Result in framebuffer
         ↓
7. Engine.resources.swapBuffers() for next frame
```

### Module Communication Flow
```
Estimator.glsl: intersect(ray, hit)
         ↓
Compiler: Resolves to sc_intersect
         ↓
Runtime: Calls Scene's intersection function
         ↓
Scene.glsl: Returns Hit with material IDs
         ↓
Estimator.glsl: dispatch_material_eval(hit.material_id, ...)
         ↓
Material dispatcher: Routes to correct material
```

## Memory Management

### Texture Allocation
- Films declare texture requirements upfront
- ResourceManager allocates on first use
- Ping-pong buffers for accumulation
- Reuse buffers when switching recipes (if compatible)

### Mobile Fallbacks
```typescript
if (isMobile || memoryPressure) {
  // Use lower precision formats
  format = "16bit" instead of "32bit"
  
  // Reduce resolution
  resolution = resolution / 2
  
  // Simpler Film that needs fewer buffers
  recipe.photography.film = "MobileFilm"
}
```

## Error Handling

### Compilation Errors
```typescript
class CompilationError {
  constructor(
    public glError: string,
    public module?: ModuleDescriptor,
    public line?: number,
    public sourceSnippet?: string
  ) {}
  
  toString() {
    return `
      Shader compilation failed in ${this.module?.id.name}:
      Line ${this.line}: ${this.glError}
      
      ${this.sourceSnippet}
    `;
  }
}
```

### Runtime Errors
- Missing uniforms: Warn but continue (variant might not use it)
- Texture allocation failure: Report to App for fallback
- Draw call failure: Clear state and retry

## Platform Considerations

### WebGL2 Requirements
- Floating point textures (OES_texture_float)
- Multiple render targets (WEBGL_draw_buffers)
- Texture arrays (for material properties)
- Instanced rendering (future: for many objects)

### Future WebGPU Migration
The architecture is designed to allow future WebGPU migration:
- Resource management abstracted from GL specifics
- Shader compilation could target WGSL
- Compute shaders for parallel operations
- Better memory management APIs

## Interface with App

### Commands from App
```typescript
interface EngineCommands {
  // Compilation
  compileRecipe(recipe: Recipe): string;  // Returns program ID
  selectProgram(id: string): void;
  
  // Rendering
  renderFrame(): void;
  clearAccumulation(): void;
  setViewport(x, y, width, height): void;
  
  // Parameters
  updateUniforms(changes: ParameterChanges): void;
  
  // Output
  readPixels(rect?: Rectangle): Promise<Float32Array>;
  getResolution(): { width, height };
}
```

### Events to App
```typescript
interface EngineEvents {
  onCompilationComplete: (programId: string) => void;
  onCompilationError: (error: CompilationError) => void;
  onRenderComplete: (frameNumber: number) => void;
  onMemoryPressure: (available: number) => void;
}
```

## Key Design Decisions Summary

1. **Startup Compilation**: All variants compile at startup, no runtime compilation
2. **Material Dispatching**: Engine generates dispatch functions for multiple materials
3. **Name Prefixing**: Consistent prefixing with special handling for materials (m_NAME_func)
4. **Film Buffer Declaration**: Films explicitly declare their texture requirements
5. **Type Ordering**: Geometry always compiles first to define Point/Direction
6. **Main Templates**: 3-4 template main() functions selected based on mode
7. **Boring and Explicit**: No clever optimizations, everything explicit and debuggable
8. **Mobile Fallbacks**: Graceful degradation with lower precision/resolution

## Testing Strategy

The Engine's deterministic nature enables thorough testing:
- **Module compilation tests**: Each module type compiles correctly
- **Dependency resolution tests**: Cross-module calls resolve properly
- **Uniform binding tests**: Parameters map to correct GPU locations
- **Render output tests**: Pixel-perfect comparison with reference images
- **Memory stress tests**: Handle allocation failures gracefully
- **Performance benchmarks**: Track frame time regressions

## Summary

The Engine is intentionally boring infrastructure that never changes once built. It transforms the beautiful mathematical modules from World and Photography into efficient GPU code, handling all the WebGL complexity so researchers can focus on algorithms rather than API calls. Its deterministic, explicit design ensures that debugging is straightforward and behavior is predictable.

```ts
class Engine {
// Initialize once
constructor(gl: WebGL2RenderingContext) {
this.compiler = new ShaderCompiler(gl);
this.resources = new ResourceManager(gl);
this.uniforms = new UniformBinder(gl);
this.executor = new RenderExecutor(gl);
this.registry = new ModuleRegistry();

    // Register built-in modules
    this.registry.registerDefaults();
}

// Compile recipes at startup
compileRecipe(recipe: Recipe): string {
const modules = this.registry.resolveModules(recipe);
const program = this.compiler.compile(recipe);
this.resources.setupForProgram(program);
this.uniforms.buildBindings(program);
return program.id;
}

// Render frames (called by App)
renderFrame() {
this.uniforms.frameUpdate();
this.executor.renderFrame();
this.resources.finalizeFrame();
}
}
````
