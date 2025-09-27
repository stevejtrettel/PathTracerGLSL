                                  # Engine Contract

## Purpose

The Engine is the top-level orchestration class that coordinates five subsystems to transform recipes into rendered frames. It maintains explicit state, provides eager compilation, and exposes a simple interface to the App layer while hiding all WebGL complexity.

## Required Interface

```typescript
interface Engine {
  // Initialization
  constructor(gl: WebGL2RenderingContext, config?: EngineConfig);
  initialize(recipes: Recipe[]): void;
  
  // State management
  getState(): EngineState;
  isReady(): boolean;
  isRunning(): boolean;
  getFrame(): number | null;
  
  // Recipe management (pre-compiled)
  selectRecipe(recipeName: string): void;
  getCurrentRecipe(): Recipe | null;
  getAvailableRecipes(): string[];
  
  // Rendering
  renderFrame(): void;
  clearAccumulation(): void;
  setViewport(x: number, y: number, width: number, height: number): void;
  
  // Parameter updates
  updateUniforms(changes: ParameterChanges): void;
  getUniformMap(): UniformMap | null;
  
  // Output
  readPixelsAsync(rect?: Rectangle): Promise<Float32Array>;
  readPixelsSync(rect?: Rectangle): Float32Array;
  getResolution(): { width: number; height: number };
  
  // Capabilities
  getCapabilities(): CapabilityReport;
  validateCapabilities(): ValidationResult;
  
  // Performance
  getPerformanceReport(): PerformanceReport;
  resetStatistics(): void;
  
  // Cleanup
  dispose(): void;
}
```

## Configuration

```typescript
interface EngineConfig {
  viewport?: Viewport;
  clearColor?: [number, number, number, number];
  enableStatistics?: boolean;
  fallbackBehavior?: 'error' | 'suggest' | 'auto';
  maxCompileTime?: number;            // Timeout for compilation
}
```

## State Machine

The Engine MUST maintain explicit state with validated transitions:

```typescript
// State transitions
uninitialized → ready         // After initialize()
ready → running               // After selectRecipe()
running → ready               // After clearProgram()
any → error                   // On fatal error
error → ready                 // Only if recoverable

// Invalid transitions
running → uninitialized       // Cannot uninitialize while running
error → running              // Must go through ready first
```

## Subsystem Architecture

```typescript
class Engine {
  // Subsystems - initialized in specific order
  private registry: ModuleRegistry;      // 1st: Module storage
  private resources: ResourceManager;    // 2nd: GPU capabilities
  private executor: RenderExecutor;      // 3rd: Draw infrastructure
  private compiler: ShaderCompiler;      // 4th: Program compilation
  private uniforms: UniformBinder;       // 5th: Parameter binding
  
  // State
  private state: EngineState = { type: "uninitialized" };
  private compiledPrograms: Map<string, CompiledProgram>;
  private activeProgram: CompiledProgram | null = null;
  
  // Configuration
  private config: EngineConfig;
  private gl: WebGL2RenderingContext;
  private viewport: Viewport;
}
```

## Initialization Contract

The Engine MUST initialize subsystems in this exact order:

```typescript
constructor(gl: WebGL2RenderingContext, config?: EngineConfig) {
  this.gl = gl;
  this.config = { ...DEFAULT_CONFIG, ...config };
  
  // Order is CRITICAL - each depends on previous
  
  // 1. Registry first - holds module definitions
  this.registry = new ModuleRegistry();
  this.registry.registerDefaults();
  
  // 2. Resources second - checks GPU capabilities
  this.resources = new ResourceManager(gl);
  const capabilities = this.resources.getCapabilities();
  const validation = this.resources.validateCapabilities();
  
  if (!validation.valid) {
    this.handleCapabilityFailure(validation);
  }
  
  // 3. Executor third - needs resources for framebuffers
  this.executor = new RenderExecutor(gl, this.resources);
  this.executor.setupGeometry();
  
  // 4. Compiler fourth - needs registry for modules
  this.compiler = new ShaderCompiler(gl, this.registry);
  
  // 5. UniformBinder last - operates on compiled programs
  this.uniforms = new UniformBinder(gl);
  
  this.state = { type: "ready" };
}
```

## Eager Compilation Contract

The `initialize` method MUST compile all recipes at startup:

```typescript
initialize(recipes: Recipe[]): void {
  if (this.state.type !== "ready") {
    throw new Error(`Cannot initialize in state: ${this.state.type}`);
  }
  
  if (recipes.length > LIMITS.MAX_RECIPES) {
    throw new Error(`Too many recipes: ${recipes.length} (max: ${LIMITS.MAX_RECIPES})`);
  }
  
  const startTime = performance.now();
  this.compiledPrograms = new Map();
  
  for (const recipe of recipes) {
    const key = this.getRecipeKey(recipe);
    
    try {
      // Check recipe compatibility
      const compatibility = this.registry.checkCompatibility(recipe);
      if (!compatibility.compatible) {
        throw new Error(`Recipe ${key} incompatible: ${compatibility.issues.join(', ')}`);
      }
      
      // Compile and cache
      const program = this.compiler.compile(recipe);
      this.compiledPrograms.set(key, program);
      
    } catch (error) {
      // Fail fast - all recipes must compile
      throw new Error(`Failed to compile ${key}: ${error.message}`);
    }
  }
  
  const elapsed = performance.now() - startTime;
  if (elapsed > this.config.maxCompileTime) {
    console.warn(`Compilation took ${elapsed}ms (expected < ${this.config.maxCompileTime}ms)`);
  }
}
```

## Recipe Selection Contract

```typescript
selectRecipe(recipeName: string): void {
  if (this.state.type !== "ready" && this.state.type !== "running") {
    throw new Error(`Cannot select recipe in state: ${this.state.type}`);
  }
  
  const program = this.compiledPrograms.get(recipeName);
  if (!program) {
    throw new Error(`Recipe not pre-compiled: ${recipeName}`);
  }
  
  // Deactivate current program
  if (this.activeProgram) {
    this.deactivateProgram();
  }
  
  // Activate new program
  this.activeProgram = program;
  this.gl.useProgram(program.program);
  
  // Update subsystems
  this.uniforms.buildBindings(program, program.modules);
  this.resources.setupFilmBuffers(this.getFilmModule(program));
  
  // Transition to running
  this.state = { 
    type: "running", 
    program, 
    frame: 0 
  };
}

private getRecipeKey(recipe: Recipe): string {
  return [
    recipe.world.geometry.name,
    recipe.world.material.name,
    recipe.world.scene.name,
    recipe.world.lights.name,
    recipe.photography.camera.name,
    recipe.photography.estimator.name,
    recipe.photography.film.name,
    recipe.photography.developer.name
  ].join('_');
}
```

## Frame Rendering Contract

```typescript
renderFrame(): void {
  if (this.state.type !== "running") {
    throw new Error(`Cannot render in state: ${this.state.type}`);
  }
  
  // 1. Prepare resources (bind textures, set target)
  this.resources.prepareFrame();
  
  // 2. Update engine uniforms
  const engineState: EngineStateInfo = {
    width: this.viewport.width,
    height: this.viewport.height,
    frameIndex: this.state.frame,
    sampleCount: this.state.frame,  // For now, same as frame
    time: performance.now() / 1000
  };
  
  // 3. Flush all uniform updates (batched)
  this.uniforms.frameUpdate(engineState);
  
  // 4. Execute render
  this.executor.renderFrame({
    clear: this.state.frame === 0,
    viewport: this.viewport,
    swapBuffers: true,
    target: { type: "screen" }
  });
  
  // 5. Finalize resources (swap buffers)
  this.resources.finalizeFrame();
  
  // 6. Update state
  this.state = {
    ...this.state,
    frame: this.state.frame + 1
  };
}
```

## Parameter Update Contract

```typescript
updateUniforms(changes: ParameterChanges): void {
  if (this.state.type !== "running") {
    return;  // Ignore updates when not running
  }
  
  // Queue changes in UniformBinder (batched)
  this.uniforms.queueUpdates(changes);
  
  // Check if reset needed
  if (this.shouldResetAccumulation(changes)) {
    this.clearAccumulation();
  }
}

private shouldResetAccumulation(changes: ParameterChanges): boolean {
  // Parameters that require reset
  const resetTriggers = ['camera.', 'material.', 'lights.', 'scene.'];
  
  // Parameters that don't reset
  const noReset = ['developer.', 'film.alpha'];
  
  return changes.triggersReset || 
         changes.changes.some(c => 
           resetTriggers.some(t => c.path.startsWith(t)) &&
           !noReset.some(n => c.path.startsWith(n))
         );
}

clearAccumulation(): void {
  if (this.state.type === "running") {
    this.resources.clearFilmBuffers();
    this.state = {
      ...this.state,
      frame: 0
    };
  }
}
```

## Capability Handling Contract

```typescript
getCapabilities(): CapabilityReport {
  return this.resources.getCapabilities();
}

validateCapabilities(): ValidationResult {
  const capabilities = this.getCapabilities();
  const validation = this.resources.validateCapabilities();
  
  if (!validation.valid && this.config.fallbackBehavior === 'auto') {
    // Apply automatic fallbacks
    const suggestions = validation.suggestions || [];
    for (const suggestion of suggestions) {
      console.warn(`Applying fallback: ${suggestion}`);
      // Would need to modify recipes here
    }
  }
  
  return validation;
}

private handleCapabilityFailure(validation: ValidationResult): void {
  switch (this.config.fallbackBehavior) {
    case 'error':
      throw new Error(`GPU capabilities insufficient: ${validation.errors.join(', ')}`);
      
    case 'suggest':
      console.error('GPU limitations:', validation.errors);
      console.log('Suggestions:', validation.suggestions);
      break;
      
    case 'auto':
      // Handled in validateCapabilities
      break;
  }
}
```

## Output Operations Contract

```typescript
async readPixelsAsync(rect?: Rectangle): Promise<Float32Array> {
  if (this.state.type !== "running") {
    throw new Error(`Cannot read pixels in state: ${this.state.type}`);
  }
  
  return this.executor.readPixelsAsync(rect);
}

readPixelsSync(rect?: Rectangle): Float32Array {
  if (this.state.type !== "running") {
    throw new Error(`Cannot read pixels in state: ${this.state.type}`);
  }
  
  return this.executor.readPixelsSync(rect);
}

getResolution(): { width: number; height: number } {
  return {
    width: this.viewport.width,
    height: this.viewport.height
  };
}
```

## Performance Monitoring Contract

```typescript
getPerformanceReport(): PerformanceReport {
  return {
    frame: this.executor.getFrameStats(),
    memory: this.resources.getMemoryStats(),
    uniforms: this.uniforms.getUpdateStats(),
    compilation: this.compiler.getCompilationReport()
  };
}

resetStatistics(): void {
  this.executor.resetFrameStats();
  this.uniforms.resetStats();
}
```

## Cleanup Contract

```typescript
dispose(): void {
  // Cleanup in reverse order
  
  // Deactivate program
  if (this.activeProgram) {
    this.deactivateProgram();
  }
  
  // Delete compiled programs
  for (const program of this.compiledPrograms.values()) {
    this.gl.deleteProgram(program.program);
  }
  
  // Cleanup subsystems
  this.uniforms.dispose();
  this.compiler.dispose();
  this.executor.dispose();
  this.resources.dispose();
  this.registry.dispose();
  
  // Clear references
  this.compiledPrograms.clear();
  this.activeProgram = null;
  
  this.state = { type: "uninitialized" };
}
```

## Minimal Working Example

```typescript
// Create engine
const canvas = document.getElementById('canvas') as HTMLCanvasElement;
const gl = canvas.getContext('webgl2');
if (!gl) throw new Error('WebGL2 not supported');

const engine = new Engine(gl, {
  viewport: { x: 0, y: 0, width: 1920, height: 1080 },
  enableStatistics: true,
  fallbackBehavior: 'suggest'
});

// Define recipes (2-3 typical)
const recipes: Recipe[] = [
  {
    id: 'pathtracer',
    name: 'Path Tracer',
    world: {
      geometry: { kind: 'geometry', name: 'euclidean' },
      material: { kind: 'material', name: 'disney' },
      scene: { kind: 'scene', name: 'sdf' },
      lights: { kind: 'lights', name: 'hdri' }
    },
    photography: {
      camera: { kind: 'camera', name: 'pinhole' },
      estimator: { kind: 'estimator', name: 'pathtracer' },
      film: { kind: 'film', name: 'variance' },
      developer: { kind: 'developer', name: 'aces' }
    }
  },
  {
    id: 'debug',
    name: 'Debug View',
    // ... similar structure with debug modules
  }
];

// Compile all recipes at startup (eager)
engine.initialize(recipes);

// Select initial recipe (instant - pre-compiled)
engine.selectRecipe('pathtracer');

// Render loop
function animate() {
  // Update parameters
  const changes = parameterStore.getChanges();
  if (changes) {
    engine.updateUniforms(changes);
  }
  
  // Render frame
  engine.renderFrame();
  
  // Check performance
  if (frameCount % 60 === 0) {
    const report = engine.getPerformanceReport();
    console.log(`FPS: ${report.frame.fps.toFixed(1)}`);
  }
  
  requestAnimationFrame(animate);
}

animate();

// Switch recipes instantly
document.getElementById('debug-btn').onclick = () => {
  engine.selectRecipe('debug');  // No compilation!
};

// Read pixels
document.getElementById('save-btn').onclick = async () => {
  const pixels = await engine.readPixelsAsync();
  saveImage(pixels);
};

// Cleanup
window.onbeforeunload = () => {
  engine.dispose();
};
```

## Invariants

1. **State transitions** are always validated
2. **Subsystems** are initialized in exact order
3. **All recipes** are compiled before any can be selected
4. **Active program** matches current state.program
5. **Frame counter** increments monotonically during running
6. **Capabilities** are checked before GPU operations
7. **Uniforms** are batched and flushed once per frame
8. **Resources** are properly cleaned up in dispose()

## Error Handling

The Engine MUST handle these error conditions:

| Error | Response |
|-------|----------|
| WebGL2 not available | Throw immediately in constructor |
| Missing required capabilities | Follow fallbackBehavior config |
| Recipe compilation failure | Fail fast during initialize() |
| Recipe not found | Throw on selectRecipe() |
| Invalid state transition | Throw with current state info |
| Context loss | Transition to error state (recoverable) |
| Resource allocation failure | Transition to error state |

## Integration Requirements

The Engine MUST:
- Hide all WebGL operations from App
- Provide simple recipe-based interface
- Make state always queryable
- Support instant recipe switching (pre-compiled)
- Batch all uniform updates per frame
- Provide clear capability reporting
- Clean up all GPU resources on dispose
