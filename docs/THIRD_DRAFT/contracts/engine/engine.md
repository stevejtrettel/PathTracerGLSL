# Engine Contract (Simplified)

## Purpose

The Engine is the top-level orchestration class that coordinates four subsystems to transform recipes into rendered frames. It maintains explicit state, provides eager compilation, and exposes a simple interface to the App layer while hiding all WebGL complexity.

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
  getFrame(): number;
  getCurrentRecipeId(): string | null;
  
  // Recipe management (pre-compiled)
  selectRecipe(recipeId: string): void;
  getCurrentRecipe(): Recipe | null;
  getAvailableRecipes(): string[];
  
  // Rendering
  renderFrame(): void;
  clearAccumulation(): void;
  setViewport(x: number, y: number, width: number, height: number): void;
  
  // Parameter updates
  updateParameters(changes: ParameterChanges): void;
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
  
  // Resizing
  resize(width: number, height: number): void;
  
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
  maxCompileTime?: number;
  enableSnapshots?: boolean;      // Enable periodic snapshots for accumulating recipes
  snapshotInterval?: number;       // Frames between snapshots (default 600 ~= 10s at 60fps)
}
```

## State Machine

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
  private compiler: SimpleCompiler;      // 4th: Shader compilation
  
  // State
  private state: EngineState = { type: "uninitialized" };
  private activeProgram: CompiledProgram | null = null;
  private activeRecipeId: string | null = null;
  
  // Configuration
  private config: EngineConfig;
  private gl: WebGL2RenderingContext;
  private viewport: Viewport;
  
  // Performance tracking
  private frameCount: number = 0;
  private startTime: number;
}
```

## Initialization Contract

```typescript
constructor(gl: WebGL2RenderingContext, config?: EngineConfig) {
  this.gl = gl;
  this.config = {
    viewport: { x: 0, y: 0, width: gl.canvas.width, height: gl.canvas.height },
    clearColor: [0, 0, 0, 0],
    enableStatistics: true,
    fallbackBehavior: 'suggest',
    maxCompileTime: 2000,
    enableSnapshots: true,        // Default to enabled
    snapshotInterval: 600,        // Default ~10 seconds at 60fps
    ...config
  };
  this.viewport = this.config.viewport!;
  
  // Initialize subsystems in order
  
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
  
  // 4. Compiler last - needs registry for modules
  this.compiler = new SimpleCompiler(gl, this.registry);
  
  // Set up context loss handling
  this.setupContextHandling();
  
  this.state = { type: "ready" };
  this.startTime = performance.now();
  
  console.log('Engine initialized');
}

private setupContextHandling(): void {
  this.gl.canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    console.warn('WebGL context lost');
    this.handleContextLoss();
  });
  
  this.gl.canvas.addEventListener('webglcontextrestored', () => {
    console.log('WebGL context restored');
    this.handleContextRestore();
  });
}
```

## Resizing

```typescript
resize(width: number, height: number): void {
  if (width <= 0 || height <= 0) {
    throw new Error(`Invalid dimensions: ${width}x${height}`);
  }
  
  // Update viewport
  this.viewport = { x: 0, y: 0, width, height };
  this.executor.setViewport(0, 0, width, height);
  
  // Resize film buffers if we have an active recipe
  if (this.activeRecipeId) {
    this.resources.resizeFilmBuffers(this.activeRecipeId, width, height);
    
    // Clear accumulation since dimensions changed
    this.clearAccumulation();
    
    console.log(`Resized to ${width}x${height}, accumulation reset`);
  }
}
```

## Recipe Initialization Contract

```typescript
initialize(recipes: Recipe[]): void {
  if (this.state.type !== "ready") {
    throw new Error(`Cannot initialize in state: ${this.state.type}`);
  }
  
  if (recipes.length === 0) {
    throw new Error('At least one recipe required');
  }
  
  if (recipes.length > LIMITS.MAX_RECIPES) {
    throw new Error(`Too many recipes: ${recipes.length} (max: ${LIMITS.MAX_RECIPES})`);
  }
  
  console.log(`Initializing ${recipes.length} recipes...`);
  const startTime = performance.now();
  
  // Compile all recipes eagerly
  this.compiler.initialize(recipes);
  
  const elapsed = performance.now() - startTime;
  if (elapsed > this.config.maxCompileTime!) {
    console.warn(`Compilation took ${elapsed}ms (expected < ${this.config.maxCompileTime}ms)`);
  }
  
  console.log('All recipes ready');
}
```

## Recipe Selection Contract

```typescript
selectRecipe(recipeId: string): void {
  if (this.state.type !== "ready" && this.state.type !== "running") {
    throw new Error(`Cannot select recipe in state: ${this.state.type}`);
  }
  
  // Get pre-compiled program
  const program = this.compiler.getProgram(recipeId);
  
  // Deactivate current program if any
  if (this.activeProgram) {
    this.gl.useProgram(null);
  }
  
  // Activate new program
  this.activeProgram = program;
  this.activeRecipeId = recipeId;
  this.gl.useProgram(program.program);
  
  // Setup film buffers for this recipe
  const filmModule = this.getFilmModule(program.recipe);
  this.resources.setupFilmBuffers(recipeId, filmModule);
  this.resources.setActiveRecipe(recipeId);
  
  // Bind film texture uniforms
  this.bindFilmTextures();
  
  // Transition to running
  this.state = { 
    type: "running", 
    program,
    frame: 0,
    recipeId
  };
  
  console.log(`Recipe selected: ${recipeId}`);
}

private getFilmModule(recipe: Recipe): ModuleDescriptor {
  return this.registry.get(recipe.photography.film.kind, recipe.photography.film.name)!;
}

private bindFilmTextures(): void {
  // Bind standard film texture units
  const bindTextureUniform = (name: string, unit: number) => {
    const location = this.gl.getUniformLocation(this.activeProgram!.program, name);
    if (location) {
      this.gl.uniform1i(location, unit);
    }
  };
  
  bindTextureUniform('u_film_radiance_previous', TEXTURE_UNITS.FILM_START);
  bindTextureUniform('u_film_variance_previous', TEXTURE_UNITS.FILM_START + 1);
  bindTextureUniform('u_film_samples_previous', TEXTURE_UNITS.FILM_START + 2);
}
```

## Frame Rendering Contract

```typescript
renderFrame(): void {
  if (this.state.type !== "running") {
    throw new Error(`Cannot render in state: ${this.state.type}`);
  }
  
  // 1. Prepare resources (bind previous frame textures)
  this.resources.prepareFrame();
  
  // 2. Update engine uniforms
  const engineState: EngineStateInfo = {
    width: this.viewport.width,
    height: this.viewport.height,
    frameIndex: this.state.frame,
    sampleCount: this.state.frame,  // For now, same as frame
    time: (performance.now() - this.startTime) / 1000
  };
  
  this.compiler.updateEngineUniforms(this.activeProgram!, engineState);
  
  // 3. Execute render
  this.executor.renderFrame({
    clear: this.state.frame === 0,
    clearColor: this.config.clearColor,
    viewport: this.viewport,
    swapBuffers: true,
    target: { type: "screen" }
  });
  
  // 4. Finalize resources (swap buffers)
  this.resources.finalizeFrame();
  
  // 5. Update state
  this.state = {
    ...this.state,
    frame: this.state.frame + 1
  };
  
  // 6. Periodic snapshot for accumulating recipes
  if (this.config.enableSnapshots && 
      this.state.frame % this.config.snapshotInterval === 0 && 
      this.state.frame > 0) {
    try {
      // ResourceManager will check if this recipe actually accumulates
      const pixels = this.executor.readPixelsSync();
      this.resources.captureSnapshot(this.state.recipeId, pixels, this.state.frame);
    } catch (e) {
      // Silent fail - snapshots are nice-to-have, not critical
      if (this.config.enableStatistics) {
        console.debug('Failed to capture snapshot:', e);
      }
    }
  }
  
  this.frameCount++;
}
```

## Parameter Update Contract

```typescript
updateParameters(changes: ParameterChanges): void {
  if (this.state.type !== "running") {
    console.warn('Cannot update parameters - not running');
    return;
  }
  
  // Update uniforms through compiler
  this.compiler.updateUniforms(this.activeProgram!, changes);
  
  // Check if reset needed
  if (this.shouldResetAccumulation(changes)) {
    this.clearAccumulation();
  }
}

private shouldResetAccumulation(changes: ParameterChanges): boolean {
  // Already flagged for reset
  if (changes.triggersReset) return true;
  
  // Parameters that require reset
  const resetTriggers = ['camera.', 'scene.', 'lighting.', 'transport.', 'interaction.'];
  
  // Parameters that don't reset
  const noReset = ['developer.', 'film.alpha'];
  
  return changes.changes.some(c => 
    resetTriggers.some(t => c.path.startsWith(t)) &&
    !noReset.some(n => c.path.startsWith(n))
  );
}

clearAccumulation(): void {
  if (this.state.type !== "running" || !this.activeRecipeId) return;
  
  this.resources.clearFilmBuffers(this.activeRecipeId);
  
  // Reset frame counter
  this.state = {
    ...this.state,
    frame: 0
  };
  
  console.log(`Accumulation cleared for ${this.activeRecipeId}`);
}
```

## State Query Methods

```typescript
getState(): EngineState {
  return this.state;
}

isReady(): boolean {
  return this.state.type === "ready" || this.state.type === "running";
}

isRunning(): boolean {
  return this.state.type === "running";
}

getFrame(): number {
  return this.state.type === "running" ? this.state.frame : 0;
}

getCurrentRecipeId(): string | null {
  return this.activeRecipeId;
}

getCurrentRecipe(): Recipe | null {
  return this.activeProgram?.recipe || null;
}

getAvailableRecipes(): string[] {
  return this.compiler.getAllProgramIds();
}

getUniformMap(): UniformMap | null {
  return this.activeProgram?.uniformMap || null;
}
```

## Capability Methods

```typescript
getCapabilities(): CapabilityReport {
  return this.resources.getCapabilities();
}

validateCapabilities(): ValidationResult {
  return this.resources.validateCapabilities();
}

private handleCapabilityFailure(validation: ValidationResult): void {
  switch (this.config.fallbackBehavior) {
    case 'error':
      throw new Error(`GPU capabilities insufficient: ${validation.errors.join(', ')}`);
      
    case 'suggest':
      console.error('GPU limitations:', validation.errors);
      if (validation.suggestions) {
        console.log('Suggestions:', validation.suggestions);
      }
      break;
      
    case 'auto':
      // Could implement automatic fallbacks here
      console.warn('Auto fallback not yet implemented');
      break;
  }
}
```

## Output Operations

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

setViewport(x: number, y: number, width: number, height: number): void {
  this.viewport = { x, y, width, height };
  this.executor.setViewport(x, y, width, height);
  
  // May need to recreate film buffers at new size
  if (this.state.type === "running" && this.activeRecipeId) {
    console.warn('Viewport changed - film buffers may need resizing');
    // Could implement automatic buffer resizing here
  }
}
```

## Performance Monitoring

```typescript
getPerformanceReport(): PerformanceReport {
  return {
    frame: this.executor.getFrameStats(),
    memory: this.resources.getMemoryStats(),
    compilation: this.compiler.getCompilationReport(),
    
    overall: {
      state: this.state.type,
      framesRendered: this.frameCount,
      programsCompiled: this.compiler.getProgramCount(),
      currentRecipeId: this.activeRecipeId,
      uptime: performance.now() - this.startTime
    }
  };
}

resetStatistics(): void {
  this.executor.resetFrameStats();
  this.frameCount = 0;
}
```

## Context Loss Handling

```typescript
private handleContextLoss(): void {
  // Transition to error state
  this.state = {
    type: 'error',
    error: new Error('WebGL context lost'),
    recoverable: true
  };
  
  // Notify all subsystems about context loss
  this.executor.handleContextLoss();
  this.resources.handleContextLoss();  // This will report available snapshots
  // Note: Compiler and Registry don't need notification (no GPU resources)
  
  // Clear references to GPU resources (don't try to delete - they're gone)
  this.activeProgram = null;
  this.activeRecipeId = null;
  
  // Log clear warning about data loss
  console.warn('WebGL context lost - all GPU resources invalidated');
  console.warn('IMPORTANT: All accumulated samples for all recipes will be lost');
  console.warn('Context can be restored, but accumulation must restart from frame 0');
  
  // Check if we have snapshots as reference
  if (this.config.enableSnapshots) {
    console.log('Note: Snapshots may be available as reference images');
  }
}

private handleContextRestore(): void {
  console.log('Attempting to restore after context loss...');
  
  try {
    // Reinitialize subsystems
    this.executor.setupGeometry();
    
    // Recompile all programs
    const recipes = this.compiler.getAllProgramIds()
      .map(id => this.compiler.getProgram(id).recipe);
    
    this.compiler.dispose();
    this.compiler = new SimpleCompiler(this.gl, this.registry);
    this.compiler.initialize(recipes);
    
    // Return to ready state
    this.state = { type: 'ready' };
    
    console.log('Context restored successfully');
    
  } catch (error) {
    console.error('Context restoration failed:', error);
    this.state = {
      type: 'error',
      error: error as Error,
      recoverable: false
    };
  }
}
```

## Cleanup Contract

```typescript
dispose(): void {
  // Deactivate running program
  if (this.activeProgram) {
    this.gl.useProgram(null);
    this.activeProgram = null;
  }
  
  // Dispose subsystems in reverse order
  this.compiler.dispose();
  this.executor.dispose();
  this.resources.dispose();
  // Registry has no GPU resources, just clear
  this.registry.dispose();
  
  // Remove event listeners
  const canvas = this.gl.canvas;
  canvas.removeEventListener('webglcontextlost', this.handleContextLoss);
  canvas.removeEventListener('webglcontextrestored', this.handleContextRestore);
  
  // Clear state
  this.state = { type: 'uninitialized' };
  this.activeRecipeId = null;
  
  console.log('Engine disposed');
}
```

## Minimal Working Example

```typescript
// Create engine with snapshot configuration
const canvas = document.getElementById('canvas') as HTMLCanvasElement;
const gl = canvas.getContext('webgl2');
if (!gl) throw new Error('WebGL2 not supported');

const engine = new Engine(gl, {
  viewport: { x: 0, y: 0, width: 1920, height: 1080 },
  enableStatistics: true,
  enableSnapshots: true,      // Enable automatic snapshots
  snapshotInterval: 600       // Every ~10 seconds at 60fps
});

// Define recipes using KIND prefixes
const recipes: Recipe[] = [
  {
    id: 'pathtracer',
    name: 'Path Tracer',
    world: {
      geometry: { kind: 'geometry', name: 'euclidean' },
      scene: { kind: 'scene', name: 'sdf' },           // Compiled by WorldCompiler
      lighting: { kind: 'lighting', name: 'hdri' }     // Compiled by WorldCompiler
    },
    photography: {
      camera: { kind: 'camera', name: 'pinhole' },
      transport: { kind: 'transport', name: 'pathtracer' },
      interaction: { kind: 'interaction', name: 'disney' },
      film: { kind: 'film', name: 'variance' },  // Accumulating film
      developer: { kind: 'developer', name: 'aces' }
    }
  },
  {
    id: 'debug',
    name: 'Debug View',
    world: {
      geometry: { kind: 'geometry', name: 'euclidean' },
      scene: { kind: 'scene', name: 'sdf' },
      lighting: { kind: 'lighting', name: 'point' }
    },
    photography: {
      camera: { kind: 'camera', name: 'pinhole' },
      transport: { kind: 'transport', name: 'debug' },
      interaction: { kind: 'interaction', name: 'debug_normal' },
      film: { kind: 'film', name: 'simple' },  // Non-accumulating
      developer: { kind: 'developer', name: 'reinhard' }
    }
  }
];

// Compile all recipes at startup
engine.initialize(recipes);

// Select initial recipe
engine.selectRecipe('pathtracer');

// Render loop
function animate() {
  // Update parameters
  const changes = parameterStore.getChanges();
  if (changes) {
    engine.updateParameters(changes);
  }
  
  // Render frame
  engine.renderFrame();
  
  // Check performance
  if (engine.getFrame() % 60 === 0) {
    const report = engine.getPerformanceReport();
    console.log(`FPS: ${report.frame.fps.toFixed(1)}`);
  }
  
  requestAnimationFrame(animate);
}

animate();

// Switch recipes (instant - pre-compiled)
document.getElementById('debug-btn').onclick = () => {
  engine.selectRecipe('debug');
};

// Return to path tracer (preserves accumulation)
document.getElementById('pathtracer-btn').onclick = () => {
  engine.selectRecipe('pathtracer');
};

// Clear accumulation
document.getElementById('clear-btn').onclick = () => {
  engine.clearAccumulation();
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

1. **State transitions validated** - Invalid transitions throw
2. **Subsystems initialized in order** - Dependencies satisfied
3. **All recipes compiled before selection** - No runtime compilation
4. **Per-recipe film buffers** - Accumulation preserved
5. **Frame counter per recipe** - Resets on clear
6. **Active program matches state** - Consistency maintained
7. **Context loss handled** - Recovery attempted

## Error Handling

| Error | Response |
|-------|----------|
| WebGL2 not available | Throw in constructor |
| Missing capabilities | Follow fallbackBehavior |
| Recipe compilation failure | Fail fast during initialize() |
| Recipe not found | Throw on selectRecipe() |
| Invalid state transition | Throw with state info |
| Context loss | Transition to error state |
| Not running | Throw on render operations |

## Integration Requirements

The Engine MUST:
- Hide all WebGL operations from App
- Provide simple recipe-based interface
- Make state always queryable
- Support instant recipe switching
- Preserve accumulation per recipe
- Handle all GPU resource management
- Clean up properly on dispose
