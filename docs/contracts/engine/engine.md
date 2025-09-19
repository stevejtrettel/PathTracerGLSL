# Engine Contract

## Purpose

The Engine is the top-level orchestration class that coordinates GPU operations for the path tracer. It manages five subsystems, maintains explicit state, and provides a clean interface to the App layer.

## Core Interface

```typescript
interface Engine {
  // Initialization
  constructor(gl: WebGL2RenderingContext);
  initialize(recipes: Recipe[]): void;
  
  // State management
  getState(): EngineState;
  isReady(): boolean;
  isRunning(): boolean;
  getFrame(): number | null;
  
  // Recipe management (pre-compiled)
  selectRecipe(recipeName: string): void;
  getCurrentRecipe(): Recipe | null;
  
  // Rendering
  renderFrame(): void;
  clearAccumulation(): void;
  setViewport(x: number, y: number, width: number, height: number): void;
  
  // Parameters
  updateUniforms(changes: ParameterChanges): void;
  getUniformMap(): UniformMap;
  
  // Output
  readPixelsAsync(rect?: Rectangle): Promise<Float32Array>;
  getResolution(): { width: number; height: number };
  
  // Capabilities
  getCapabilities(): CapabilityReport;
  validateCapabilities(): ValidationResult;
}
```

## State Machine

The Engine maintains explicit state with validated transitions:

```typescript
type EngineState = 
  | { type: "uninitialized" }
  | { type: "ready" }
  | { type: "compiling"; recipe: Recipe }
  | { type: "running"; program: CompiledProgram; frame: number }
  | { type: "error"; error: Error; recoverable: boolean };
```

Valid state transitions:
- `uninitialized` → `ready`, `error`
- `ready` → `compiling`, `running`, `error`
- `compiling` → `ready`, `error`
- `running` → `ready`, `error`
- `error` → `ready` (only if recoverable)

## Subsystem Architecture

```typescript
class Engine {
  // Subsystems - each with single responsibility
  private registry: ModuleRegistry;      // Module storage and validation
  private compiler: ShaderCompiler;      // Recipe → GLSL transformation
  private resources: ResourceManager;    // GPU memory management
  private uniforms: UniformBinder;       // Parameter → GPU mapping
  private executor: RenderExecutor;      // WebGL draw calls
  
  // State
  private state: EngineState = { type: "uninitialized" };
  private compiledPrograms: Map<string, CompiledProgram>;
  private activeProgram: CompiledProgram | null = null;
  private gl: WebGL2RenderingContext;
}
```

## Initialization Flow

```typescript
class Engine {
  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    
    // 1. Initialize subsystems
    this.registry = new ModuleRegistry();
    this.compiler = new ShaderCompiler(gl);
    this.resources = new ResourceManager(gl);
    this.uniforms = new UniformBinder(gl);
    this.executor = new RenderExecutor(gl, this.resources, this.uniforms);
    
    // 2. Register built-in modules
    this.registry.registerDefaults();
    
    // 3. Check capabilities
    const capabilities = this.resources.getCapabilities();
    const validation = this.resources.validateCapabilities();
    
    if (!validation.isValid) {
      this.transition({ 
        type: "error", 
        error: new Error(validation.errors.join('\n')),
        recoverable: false 
      });
      return;
    }
    
    // 4. Setup render geometry (full-screen triangle)
    this.executor.setupGeometry();
    
    this.transition({ type: "ready" });
  }
  
  // Eager compilation at startup
  initialize(recipes: Recipe[]): void {
    if (this.state.type !== "ready") {
      throw new Error(`Cannot initialize in state: ${this.state.type}`);
    }
    
    console.log(`Compiling ${recipes.length} shader variants...`);
    
    for (const recipe of recipes) {
      const key = this.getRecipeKey(recipe);
      
      try {
        // Compile and cache
        const program = this.compiler.compile(recipe);
        this.compiledPrograms.set(key, program);
        console.log(`✓ Compiled: ${key}`);
      } catch (error) {
        console.error(`✗ Failed to compile ${key}:`, error);
        throw error;
      }
    }
  }
}
```

## Recipe Selection

```typescript
class Engine {
  selectRecipe(recipeName: string): void {
    if (this.state.type !== "ready" && this.state.type !== "running") {
      throw new Error(`Cannot select recipe in state: ${this.state.type}`);
    }
    
    // Get pre-compiled program
    const program = this.compiledPrograms.get(recipeName);
    if (!program) {
      throw new Error(`Recipe not pre-compiled: ${recipeName}`);
    }
    
    // Switch active program
    this.activeProgram = program;
    this.gl.useProgram(program.program);
    
    // Update subsystems
    this.uniforms.buildBindings(program, program.modules);
    this.resources.setupFilmBuffers(program.recipe.photography.film);
    
    // Transition to running
    this.transition({ 
      type: "running", 
      program, 
      frame: 0 
    });
  }
}
```

## Frame Rendering

```typescript
class Engine {
  renderFrame(): void {
    // Validate state
    if (this.state.type !== "running") {
      throw new Error(`Cannot render in state: ${this.state.type}`);
    }
    
    // 1. Update engine uniforms
    const engineState = {
      width: this.viewport.width,
      height: this.viewport.height,
      frameIndex: this.state.frame,
      sampleCount: this.accumulator?.count || 0,
      time: performance.now() / 1000
    };
    
    // 2. Flush all uniform updates (batched)
    this.uniforms.frameUpdate(engineState);
    
    // 3. Execute render
    this.executor.renderFrame({
      clear: this.state.frame === 0,
      swapBuffers: true,
      viewport: this.viewport,
      target: { type: "screen" }
    });
    
    // 4. Update state
    this.state = {
      ...this.state,
      frame: this.state.frame + 1
    };
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
}
```

## Parameter Updates

```typescript
class Engine {
  updateUniforms(changes: ParameterChanges): void {
    // Queue changes (batched internally)
    this.uniforms.updateUniforms(changes);
    
    // Check if reset needed
    if (this.shouldResetAccumulation(changes)) {
      this.clearAccumulation();
    }
  }
  
  private shouldResetAccumulation(changes: ParameterChanges): boolean {
    // Parameters that require reset
    const resetTriggers = [
      'camera.',      // Any camera change
      'material.',    // Material properties
      'lights.',      // Lighting changes
      'estimator.'    // Transport parameters
    ];
    
    // Parameters that don't reset
    const noResetParams = [
      'developer.',   // Tone mapping
      'film.alpha'    // Blend factor
    ];
    
    for (const change of changes.changes) {
      const requiresReset = resetTriggers.some(trigger => 
        change.path.startsWith(trigger)
      );
      const exemptFromReset = noResetParams.some(exempt =>
        change.path.startsWith(exempt)
      );
      
      if (requiresReset && !exemptFromReset) {
        return true;
      }
    }
    
    return false;
  }
  
  getUniformMap(): UniformMap {
    return this.uniforms.getUniformMap();
  }
}
```

## Output Operations

```typescript
class Engine {
  async readPixelsAsync(rect?: Rectangle): Promise<Float32Array> {
    if (this.state.type !== "running") {
      throw new Error(`Cannot read pixels in state: ${this.state.type}`);
    }
    
    return this.executor.readPixelsAsync(rect);
  }
  
  getResolution(): { width: number; height: number } {
    return {
      width: this.viewport.width,
      height: this.viewport.height
    };
  }
}
```

## State Management

```typescript
class Engine {
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
      "ready": ["compiling", "running", "error"],
      "compiling": ["ready", "error"],
      "running": ["ready", "error"],
      "error": ["ready"] // Only if recoverable
    };
    
    if (from.type === "error" && !from.recoverable) {
      return false; // Cannot recover from fatal errors
    }
    
    return transitions[from.type]?.includes(to.type) ?? false;
  }
  
  getState(): EngineState {
    return this.state;
  }
  
  isReady(): boolean {
    return this.state.type === "ready" || this.state.type === "running";
  }
  
  isRunning(): boolean {
    return this.state.type === "running";
  }
  
  getFrame(): number | null {
    return this.state.type === "running" ? this.state.frame : null;
  }
}
```

## Error Handling

```typescript
class Engine {
  private handleError(error: Error, recoverable: boolean = false): void {
    this.transition({ 
      type: "error", 
      error,
      recoverable 
    });
    
    if (recoverable) {
      console.warn('Engine error (recoverable):', error);
    } else {
      console.error('Engine error (fatal):', error);
      // App must create new Engine instance
    }
  }
}
```

## Recipe Key Generation

```typescript
class Engine {
  private getRecipeKey(recipe: Recipe): string {
    // Simple key from module names
    return [
      recipe.world.geometry.name,
      recipe.world.material.name,  // Single material
      recipe.world.scene.name,
      recipe.world.lights.name,
      recipe.photography.camera.name,
      recipe.photography.estimator.name,
      recipe.photography.film.name,
      recipe.photography.developer.name
    ].join('_');
  }
}
```

## Usage Example

```typescript
// Initialization
const gl = canvas.getContext('webgl2');
const engine = new Engine(gl);

// Check capabilities
const caps = engine.getCapabilities();
if (!caps.floatRenderTargets) {
  console.warn('HDR not supported, using LDR fallback');
}

// Compile all recipes at startup
const recipes = [pathTracerRecipe, debugRecipe];
engine.initialize(recipes);

// Select initial recipe
engine.selectRecipe('pathtracer');

// Render loop
function animate() {
  // Update parameters
  engine.updateUniforms(parameterStore.getChanges());
  
  // Render frame
  engine.renderFrame();
  
  requestAnimationFrame(animate);
}

// Query state
console.log(engine.getState());  // { type: "running", program: ..., frame: 42 }

// Read pixels
const pixels = await engine.readPixelsAsync();
```

## Validation Requirements

1. **State transitions** are always valid
2. **Recipes compiled** before selection
3. **Capabilities checked** before GPU operations
4. **Uniforms batched** per frame
5. **Resources validated** before allocation

## Performance Considerations

- **Eager compilation**: All recipes compiled at startup (no runtime compilation)
- **Pre-compiled switching**: Instant recipe changes via cached programs
- **Batched updates**: Uniforms updated once per frame
- **State validation**: Cheap state checks prevent invalid operations
- **Resource reuse**: Film buffers cleared, not reallocated when possible

## Integration Points

The Engine coordinates between:
- **App**: Receives recipes, parameters, render commands
- **Subsystems**: Orchestrates compilation, resources, rendering
- **GPU**: Manages all WebGL operations through subsystems

## Error Recovery

- **Compilation errors**: Fail fast at startup, clear error messages
- **Runtime errors**: State machine prevents invalid operations
- **GPU errors**: Capability checking prevents unsupported operations
- **Fatal errors**: Require Engine re-initialization
