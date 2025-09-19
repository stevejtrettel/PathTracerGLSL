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
  
  // State management
  private state: EngineState;            // Explicit state machine
  private uniformMap: UniformMap;        // Explicit parameter mappings
  
  // Runtime state
  private programCache: Map<string, CompiledProgram>;  // Lazy-compiled programs
  private activeProgram: CompiledProgram | null;       // Currently bound
  private pendingCompile: Map<string, Promise<CompiledProgram>>; // Dedup concurrent compiles
  private gl: WebGL2RenderingContext;                  // WebGL context
}
```

## Engine State Machine

The Engine maintains explicit state to prevent invalid operations and improve debugging:

```typescript
type EngineState = 
  | { type: "uninitialized" }
  | { type: "ready" }
  | { type: "compiling"; recipe: Recipe }
  | { type: "running"; program: CompiledProgram; frame: number }
  | { type: "error"; error: Error; recoverable: boolean };

class Engine {
  private state: EngineState = { type: "uninitialized" };
  
  // Query state
  isReady(): boolean { return this.state.type === "ready"; }
  isRunning(): boolean { return this.state.type === "running"; }
  getFrame(): number | null {
    return this.state.type === "running" ? this.state.frame : null;
  }
  
  // State transitions with validation
  private transition(newState: EngineState): void {
    if (!this.canTransition(this.state, newState)) {
      throw new Error(`Invalid transition: ${this.state.type} → ${newState.type}`);
    }
    console.log(`Engine: ${this.state.type} → ${newState.type}`);
    this.state = newState;
  }
  
  private canTransition(from: EngineState, to: EngineState): boolean {
    const transitions: Record<string, string[]> = {
      "uninitialized": ["ready", "error"],
      "ready": ["compiling", "error"],
      "compiling": ["ready", "error"],
      "running": ["ready", "error"],
      "error": ["ready"] // If recoverable
    };
    return transitions[from.type]?.includes(to.type) ?? false;
  }
}
```

## Core Subsystems

### 1. Shader Compiler

**Responsibility**: Transform modules into complete GLSL programs using a pipeline architecture.

**Lazy Compilation**:
```typescript
class ShaderCompiler {
  private pipeline: CompilationPipeline;
  private cache = new Map<string, CompiledProgram>();
  private pending = new Map<string, Promise<CompiledProgram>>();
  
  async getOrCompile(recipe: Recipe): Promise<CompiledProgram> {
    const key = this.getRecipeKey(recipe);
    
    // Check cache
    if (this.cache.has(key)) {
      return this.cache.get(key)!;
    }
    
    // Check if already compiling (dedup concurrent requests)
    if (this.pending.has(key)) {
      return this.pending.get(key)!;
    }
    
    // Start compilation
    const compilePromise = this.doCompile(recipe)
      .then(program => {
        this.cache.set(key, program);
        this.pending.delete(key);
        return program;
      })
      .catch(error => {
        this.pending.delete(key);
        throw error;
      });
    
    this.pending.set(key, compilePromise);
    return compilePromise;
  }
  
  private async doCompile(recipe: Recipe): Promise<CompiledProgram> {
    // Use existing pipeline
    return this.pipeline.compile(recipe);
  }
  
  private getRecipeKey(recipe: Recipe): string {
    // Simple key based on module names
    return `${recipe.world.geometry.name}_${recipe.world.material.name}_${recipe.photography.camera.name}_${recipe.photography.estimator.name}`;
  }
}
```

**Pipeline Stages**:
```typescript
interface CompilationStage<TIn, TOut> {
  name: string;
  transform(input: TIn): TOut;
  validate(output: TOut): ValidationResult;
}

class CompilationPipeline {
  private stages: CompilationStage<any, any>[] = [
    new CollectModulesStage(),      // Gather from recipe
    new ValidateDependenciesStage(), // Ensure requires/provides match
    new SortModulesStage(),          // Topological sort, Geometry first
    new ApplyPrefixesStage(),        // Add prefixes to names
    new ResolveCallsStage(),         // Map cross-module function calls
    new GenerateMainStage(),         // Create orchestration main()
    new ExtractUniformsStage(),      // Build uniform mappings
    new CompileGLSLStage()           // WebGL compilation
  ];
  
  compile(recipe: Recipe): CompiledProgram {
    let data: any = recipe;
    
    for (const stage of this.stages) {
      try {
        const output = stage.transform(data);
        const validation = stage.validate(output);
        
        if (!validation.isValid) {
          throw new CompilationError(stage.name, validation);
        }
        
        data = output;
      } catch (error) {
        throw new CompilationError(
          `Failed at stage: ${stage.name}`,
          error
        );
      }
    }
    
    return data as CompiledProgram;
  }
}
```

**Stage Implementations**:

```typescript
class ValidateDependenciesStage implements CompilationStage<Module[], Module[]> {
  transform(modules: Module[]): Module[] {
    return modules; // Pass through
  }
  
  validate(modules: Module[]): ValidationResult {
    const provides = new Map<string, Module>();
    const requires = new Map<string, Module[]>();
    
    // Build dependency graph
    for (const module of modules) {
      module.provides?.forEach(fn => provides.set(fn, module));
      module.requires?.forEach(fn => {
        if (!requires.has(fn)) requires.set(fn, []);
        requires.get(fn)!.push(module);
      });
    }
    
    // Check all requirements satisfied
    const missing: string[] = [];
    for (const [fn, requesters] of requires) {
      if (!provides.has(fn)) {
        missing.push(`Function '${fn}' required by ${requesters.map(m => m.id.name).join(', ')} but not provided`);
      }
    }
    
    return {
      isValid: missing.length === 0,
      errors: missing
    };
  }
}

class SortModulesStage implements CompilationStage<Module[], Module[]> {
  transform(modules: Module[]): Module[] {
    const geometry = modules.find(m => m.id.kind === 'Geometry');
    if (!geometry) throw new Error('No Geometry module found');
    
    const others = modules.filter(m => m !== geometry);
    const sorted = this.topologicalSort(others);
    
    return [geometry, ...sorted];
  }
  
  validate(output: Module[]): ValidationResult {
    if (output[0].id.kind !== 'Geometry') {
      return { 
        isValid: false, 
        errors: ['Geometry must be first module'] 
      };
    }
    return { isValid: true };
  }
  
  private topologicalSort(modules: Module[]): Module[] {
    // Implementation of Kahn's algorithm
    // Returns modules in dependency order
  }
}
```

### 2. Uniform Mapping System

**Explicit mapping between parameters and GPU uniforms**:

```typescript
interface UniformMapping {
  paramPath: string;              // "camera.position"
  glslName: string;               // "u_camera_pinhole_position"
  location: WebGLUniformLocation | null;
  type: "float" | "vec2" | "vec3" | "vec4" | "int" | "mat4";
  moduleSource: ModuleDescriptor;
}

class UniformMap {
  private mappings = new Map<string, UniformMapping>();
  
  static build(modules: ModuleDescriptor[], program: WebGLProgram, gl: WebGL2RenderingContext): UniformMap {
    const map = new UniformMap();
    
    for (const module of modules) {
      const prefix = getModulePrefix(module);
      
      for (const param of module.parameters || []) {
        // Build parameter path
        const paramPath = `${module.id.kind.toLowerCase()}.${param.name}`;
        
        // Build GLSL uniform name
        const glslName = `u_${prefix}${module.id.name.toLowerCase()}_${param.name}`;
        
        // Get location from compiled program
        const location = gl.getUniformLocation(program, glslName);
        
        map.mappings.set(paramPath, {
          paramPath,
          glslName,
          location,
          type: param.type,
          moduleSource: module
        });
      }
    }
    
    return map;
  }
  
  // Get uniform location for parameter update
  getBinding(paramPath: string): UniformMapping | undefined {
    return this.mappings.get(paramPath);
  }
  
  // Debug helper - shows all mappings
  debugPrint(): void {
    console.table(Array.from(this.mappings.values()).map(m => ({
      param: m.paramPath,
      glsl: m.glslName,
      type: m.type,
      hasLocation: m.location !== null
    })));
  }
}
```

### 3. Resource Manager

**Responsibility**: Manage GPU memory with validation and fallbacks.

**Capability Checking**:
```typescript
class CapabilityChecker {
  static check(gl: WebGL2RenderingContext): CapabilityReport {
    return {
      floatRenderTargets: !!gl.getExtension('EXT_color_buffer_float'),
      floatLinearFiltering: !!gl.getExtension('OES_texture_float_linear'),
      maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE),
      maxTextureUnits: gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS),
      maxColorAttachments: gl.getParameter(gl.MAX_COLOR_ATTACHMENTS),
      maxUniformBufferBindings: gl.getParameter(gl.MAX_UNIFORM_BUFFER_BINDINGS)
    };
  }
  
  static validate(capabilities: CapabilityReport): ValidationResult {
    const errors: string[] = [];
    
    // HDR rendering requires float render targets
    if (!capabilities.floatRenderTargets) {
      errors.push('Float render targets not supported - HDR rendering unavailable');
    }
    
    if (capabilities.maxTextureUnits < 8) {
      errors.push(`Only ${capabilities.maxTextureUnits} texture units available (minimum 8 recommended)`);
    }
    
    return { 
      isValid: errors.length === 0, 
      errors,
      fallbackSuggestion: !capabilities.floatRenderTargets ? 'Use LDR film module' : undefined
    };
  }
}
```

**Film Manifest for Resource Reuse**:
```typescript
interface FilmManifest {
  textures: Array<{
    name: string;
    format: TextureFormat;
  }>;
}

class ResourceManager {
  private currentManifest: FilmManifest | null = null;
  private filmResources: FilmResources | null = null;
  
  setupFilmBuffers(film: ModuleDescriptor): FilmResources {
    const manifest = this.extractManifest(film);
    
    // Reuse existing resources if manifest matches
    if (this.currentManifest && this.manifestsEqual(this.currentManifest, manifest)) {
      // Just clear buffers, don't reallocate
      this.clearFilmBuffers();
      return this.filmResources!;
    }
    
    // Need new resources
    if (this.filmResources) {
      this.cleanup();
    }
    
    this.filmResources = this.createFilmResources(manifest);
    this.currentManifest = manifest;
    return this.filmResources;
  }
  
  private manifestsEqual(a: FilmManifest, b: FilmManifest): boolean {
    if (a.textures.length !== b.textures.length) return false;
    
    for (let i = 0; i < a.textures.length; i++) {
      if (a.textures[i].name !== b.textures[i].name ||
          a.textures[i].format !== b.textures[i].format) {
        return false;
      }
    }
    return true;
  }
  
  private extractManifest(film: ModuleDescriptor): FilmManifest {
    return {
      textures: film.resources?.textures?.map(t => ({
        name: t.name,
        format: this.mapFormat(t.type, t.format)
      })) || []
    };
  }
}
```

### 4. Uniform Binder

**Responsibility**: Efficiently update GPU uniforms using the UniformMap with batched updates.

```typescript
class UniformBinder {
  private uniformMap: UniformMap;
  private pendingChanges = new Map<string, any>();  // Batch updates
  
  constructor(private gl: WebGL2RenderingContext) {}
  
  buildBindings(program: CompiledProgram, modules: ModuleDescriptor[]): void {
    this.uniformMap = UniformMap.build(modules, program.glProgram, this.gl);
  }
  
  // Queue changes for batching (called from ParameterStore)
  updateUniforms(changes: ParameterChanges): void {
    for (const change of changes.changes) {
      this.pendingChanges.set(change.path, change.value);
    }
  }
  
  // Flush all pending updates at once (called once per frame)
  frameUpdate(engineState: EngineState): void {
    // Update engine uniforms
    const binding = this.uniformMap.getBinding('engine.resolution');
    if (binding?.location) {
      this.gl.uniform2fv(binding.location, [engineState.width, engineState.height]);
    }
    
    const frameBinding = this.uniformMap.getBinding('engine.frame_index');
    if (frameBinding?.location) {
      this.gl.uniform1i(frameBinding.location, engineState.frameIndex);
    }
    
    // Flush all pending parameter changes
    for (const [path, value] of this.pendingChanges) {
      const binding = this.uniformMap.getBinding(path);
      
      if (!binding) {
        console.warn(`No uniform binding for parameter: ${path}`);
        continue;
      }
      
      if (!binding.location) {
        continue; // Uniform not used in this shader variant
      }
      
      // Update uniform based on type
      switch (binding.type) {
        case 'float':
          this.gl.uniform1f(binding.location, value);
          break;
        case 'vec3':
          this.gl.uniform3fv(binding.location, value);
          break;
        case 'int':
          this.gl.uniform1i(binding.location, value);
          break;
        // ... other types
      }
    }
    
    this.pendingChanges.clear();
  }
  
  // Debug helper
  getMappingInfo(): UniformMap {
    return this.uniformMap;
  }
}
```

### 5. Render Executor

**Responsibility**: Execute WebGL draw calls with state validation.

**Full-Screen Triangle**:
```typescript
class RenderExecutor {
  private triangleVAO: WebGLVertexArrayObject;
  
  setupGeometry() {
    // Use full-screen triangle instead of quad (3 vertices, better coverage)
    this.triangleVAO = this.gl.createVertexArray();
    this.gl.bindVertexArray(this.triangleVAO);
    
    // Positions that create a triangle covering the full screen
    const vertices = new Float32Array([
      -1, -1,
       3, -1,
      -1,  3
    ]);
    
    const vbo = this.gl.createBuffer();
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, vbo);
    this.gl.bufferData(this.gl.ARRAY_BUFFER, vertices, this.gl.STATIC_DRAW);
    
    const positionLoc = 0;
    this.gl.enableVertexAttribArray(positionLoc);
    this.gl.vertexAttribPointer(positionLoc, 2, this.gl.FLOAT, false, 0, 0);
    
    this.gl.bindVertexArray(null);
  }
  
  renderFrame(mode: RenderMode): void {
    // Validate state
    const state = this.getState();
    if (state.type !== 'running') {
      throw new Error(`Cannot render in state: ${state.type}`);
    }
    
    // Set viewport
    this.gl.viewport(mode.viewport.x, mode.viewport.y, 
                     mode.viewport.width, mode.viewport.height);
    
    // Bind framebuffer
    this.gl.bindFramebuffer(
      this.gl.FRAMEBUFFER,
      mode.target === "screen" ? null : this.resources.getFramebuffer()
    );
    
    // Clear if first frame
    if (mode.clear) {
      this.gl.clear(this.gl.COLOR_BUFFER_BIT);
    }
    
    // Draw full-screen triangle (only 3 vertices!)
    this.gl.bindVertexArray(this.triangleVAO);
    this.gl.drawArrays(this.gl.TRIANGLES, 0, 3);
    this.gl.bindVertexArray(null);
    
    // Swap accumulation buffers if needed
    if (mode.swapBuffers) {
      this.resources.swapFilmBuffers();
    }
  }
  
  // Non-blocking readback with fence
  async readPixelsAsync(rect?: Rectangle): Promise<Float32Array> {
    const r = rect || this.getFullViewport();
    const pixels = new Float32Array(r.width * r.height * 4);
    
    // Start readback
    this.gl.readPixels(r.x, r.y, r.width, r.height,
                       this.gl.RGBA, this.gl.FLOAT, pixels);
    
    // Insert fence and wait
    const sync = this.gl.fenceSync(this.gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    this.gl.flush();
    
    // Poll for completion
    await new Promise<void>((resolve) => {
      const check = () => {
        const status = this.gl.clientWaitSync(sync, 0, 0);
        if (status === this.gl.ALREADY_SIGNALED || 
            status === this.gl.CONDITION_SATISFIED) {
          this.gl.deleteSync(sync);
          resolve();
        } else {
          requestAnimationFrame(check);
        }
      };
      check();
    });
    
    return pixels;
  }
}
```

### 6. Module Registry

**Responsibility**: Track available modules and validate dependencies.

```typescript
class ModuleRegistry {
  private modules: Map<string, ModuleDescriptor> = new Map();
  private providesIndex: Map<string, ModuleDescriptor> = new Map();
  private requiresIndex: Map<string, Set<ModuleDescriptor>> = new Map();
  
  register(module: ModuleDescriptor): void {
    const key = `${module.id.kind}:${module.id.name}`;
    this.modules.set(key, module);
    
    // Index capabilities for fast lookup
    module.provides?.forEach(fn => {
      this.providesIndex.set(fn, module);
    });
    
    module.requires?.forEach(fn => {
      if (!this.requiresIndex.has(fn)) {
        this.requiresIndex.set(fn, new Set());
      }
      this.requiresIndex.get(fn)!.add(module);
    });
  }
  
  findProvider(functionName: string): ModuleDescriptor | undefined {
    return this.providesIndex.get(functionName);
  }
  
  validateDependencies(): string[] {
    const errors: string[] = [];
    
    for (const [fn, requirers] of this.requiresIndex) {
      if (!this.providesIndex.has(fn)) {
        const names = Array.from(requirers).map(m => m.id.name);
        errors.push(`Function '${fn}' required by [${names.join(', ')}] but not provided`);
      }
    }
    
    return errors;
  }
}
```

## Compilation Process

### Detailed Pipeline

```typescript
class ShaderCompiler {
  private pipeline: CompilationPipeline;
  
  compile(recipe: Recipe): CompiledProgram {
    // Run through pipeline stages
    return this.pipeline.compile(recipe);
  }
}

// Stage 1: Collect modules
const modules = [
  recipe.world.geometry,
  recipe.world.material,  // Single material now
  recipe.world.scene,
  recipe.world.lights,
  recipe.photography.camera,
  recipe.photography.estimator,
  recipe.photography.film,
  recipe.photography.developer
];

// Stage 2: Validate dependencies
// (Handled by ValidateDependenciesStage)

// Stage 3: Sort modules (Geometry first)
// (Handled by SortModulesStage)

// Stage 4: Apply prefixes
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

// Stage 5: Resolve cross-module calls
// Transform "intersect" → "sc_intersect" based on provider

// Stage 6: Generate main
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

// Stage 7: Extract uniforms and build map
// (Handled by ExtractUniformsStage)

// Stage 8: Compile GLSL
// (Handled by CompileGLSLStage)
```

## Data Flow

### Parameter Update Flow (with UniformMap)
```
1. App.parameterStore.set("camera.position", [0, 5, 10])
         ↓
2. Engine.uniforms.updateUniforms(changes)
         ↓
3. UniformMap.getBinding("camera.position")
         ↓
4. Returns: { glslName: "u_camera_pinhole_position", location: WebGLUniformLocation }
         ↓
5. gl.uniform3fv(location, [0, 5, 10])
         ↓
6. GPU uniform updated
```

### State-Aware Render Flow
```
1. App calls engine.renderFrame()
         ↓
2. Engine checks state === 'running'
         ↓
3. RenderExecutor validates state
         ↓
4. WebGL draws full-screen quad
         ↓
5. Shaders execute pipeline
         ↓
6. State.frame increments
```

## Error Handling

### Compilation Errors (Enhanced)
```typescript
class CompilationError {
  constructor(
    public stage: string,
    public validation: ValidationResult,
    public module?: ModuleDescriptor,
    public sourceContext?: string
  ) {}
  
  toString() {
    return `
      Compilation failed at stage: ${this.stage}
      ${this.validation.errors?.join('\n')}
      ${this.module ? `In module: ${this.module.id.name}` : ''}
      ${this.sourceContext || ''}
    `;
  }
}
```

### State-Based Error Recovery
```typescript
class Engine {
  private handleError(error: Error, recoverable: boolean = false): void {
    this.transition({ 
      type: 'error', 
      error,
      recoverable 
    });
    
    if (recoverable) {
      console.warn('Engine error (recoverable):', error);
      // Can transition back to 'ready'
    } else {
      console.error('Engine error (fatal):', error);
      // Must reinitialize
    }
  }
}
```

## Platform Considerations

### WebGL2 Requirements (with Validation)
```typescript
class PlatformValidator {
  static validate(gl: WebGL2RenderingContext): ValidationResult {
    const required = [
      'EXT_color_buffer_float',    // HDR rendering
      'OES_texture_float_linear',  // Texture filtering
      'WEBGL_lose_context'         // Context loss handling
    ];
    
    const missing = required.filter(ext => !gl.getExtension(ext));
    
    return {
      isValid: missing.length === 0,
      errors: missing.map(ext => `Required extension not available: ${ext}`)
    };
  }
}
```

## Interface with App

### Commands from App (State-Aware)
```typescript
interface EngineCommands {
  // State queries
  getState(): EngineState;
  isReady(): boolean;

// Compilation (eager at startup)
    initializeShaders(recipes: Recipe[]): void;
    selectRecipe(recipe: Recipe): void;  // Instead of async compileRecipe
  
  // Rendering (validates state)
  renderFrame(): void;
  clearAccumulation(): void;
  setViewport(x, y, width, height): void;
  
  // Parameters (with batching)
  updateUniforms(changes: ParameterChanges): void;  // Queues changes
  getUniformMappings(): UniformMapping[];  // For debugging
  
  // Output
  readPixelsAsync(rect?: Rectangle): Promise<Float32Array>;  // Non-blocking
  getResolution(): { width, height };
  
  // Capabilities
  getCapabilities(): CapabilityReport;
}
```

### Usage Pattern
```typescript
// App initializes Engine
const engine = new Engine(gl);

// Check capabilities first
const caps = engine.getCapabilities();
if (!caps.floatRenderTargets) {
  console.warn('HDR not supported, using LDR fallback');
  recipe.photography.film = getLDRFilm();
}

// Lazy compilation when needed
const program = await engine.compileRecipe(recipe);
engine.selectProgram(program);

// During render loop
parameterStore.set('camera.position', [0, 5, 10]);  // Queues change
engine.renderFrame();  // Flushes all uniforms, draws

// Non-blocking readback
const pixels = await engine.readPixelsAsync();
```

## Key Design Decisions Summary

1. **Explicit State Machine**: Engine state is always known and queryable
2. **Pipeline Compilation**: Modular stages that can be tested independently
3. **Uniform Mapping**: Explicit, debuggable parameter→GPU mappings
4. **Dependency Validation**: Catches missing functions before compilation
5. **Resource Validation**: Ensures GPU can handle requirements upfront
6. **Single Material**: Simplified architecture, no dispatch complexity
7. **Name Prefixing**: Consistent, automatic prefixing
8. **Boring and Explicit**: Everything is traceable and debuggable

## Testing Strategy

Each component can be tested independently:

```typescript
// Test compilation stages
describe('CompilationPipeline', () => {
  test('ValidateDependenciesStage catches missing functions', () => {
    const modules = [/* module requiring undefined function */];
    const stage = new ValidateDependenciesStage();
    const result = stage.validate(modules);
    expect(result.isValid).toBe(false);
  });
});

// Test state transitions
describe('EngineState', () => {
  test('Cannot render while compiling', () => {
    engine.setState({ type: 'compiling', recipe });
    expect(() => engine.renderFrame()).toThrow();
  });
});

// Test uniform mapping
describe('UniformMap', () => {
  test('Maps parameters to GPU uniforms correctly', () => {
    const map = UniformMap.build(modules, program, gl);
    const binding = map.getBinding('camera.position');
    expect(binding.glslName).toBe('u_camera_pinhole_position');
  });
});
```

## Summary

The Engine remains intentionally boring infrastructure, but now with explicit state management, 
clear compilation stages, validated dependencies, and debuggable 
uniform mappings. Every decision point is visible, every mapping is 
queryable, and every state transition is validated. Researchers still 
never need to think about it, but when debugging is needed, everything 
is transparent.
