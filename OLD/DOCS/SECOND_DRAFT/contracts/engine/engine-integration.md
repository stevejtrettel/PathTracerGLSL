# Engine Integration Contract

## Purpose

This document specifies how the Engine's five subsystems coordinate to transform recipes into rendered frames. It defines the initialization sequence, frame execution flow, data dependencies, error propagation, and recovery procedures that bind the subsystems into a cohesive whole.

## Subsystem Dependencies

```typescript
// Dependency graph (→ means "depends on")
ShaderCompiler → ModuleRegistry     // Needs modules to compile
ResourceManager → (standalone)      // No dependencies
UniformBinder → (needs program)     // Operates on compiled programs  
RenderExecutor → ResourceManager    // Needs framebuffers
Engine → ALL                        // Orchestrates everything
```

## Initialization Sequence

The Engine MUST initialize subsystems in this exact order:

```typescript
class Engine {
  constructor(gl: WebGL2RenderingContext, config?: EngineConfig) {
    // PHASE 1: Core Infrastructure
    this.initializeCore(gl, config);
    
    // PHASE 2: Subsystems (order critical)
    this.initializeSubsystems();
    
    // PHASE 3: Validation
    this.validateInitialization();
    
    // PHASE 4: State transition
    this.transitionToReady();
  }
}
```

### Phase 1: Core Infrastructure

```typescript
private initializeCore(gl: WebGL2RenderingContext, config?: EngineConfig): void {
  // 1. Store WebGL context
  this.gl = gl;
  
  // 2. Check WebGL2 availability
  if (!gl) {
    throw new EngineError('WebGL2 not available', 'Engine', false);
  }
  
  // 3. Apply configuration
  this.config = {
    viewport: { x: 0, y: 0, width: gl.canvas.width, height: gl.canvas.height },
    clearColor: [0, 0, 0, 0],
    enableStatistics: true,
    fallbackBehavior: 'suggest',
    maxCompileTime: 5000,
    ...config
  };
  
  // 4. Initialize state
  this.state = { type: 'uninitialized' };
  this.compiledPrograms = new Map();
  this.activeProgram = null;
  
  // 5. Set up context loss handling
  this.gl.canvas.addEventListener('webglcontextlost', this.handleContextLoss);
  this.gl.canvas.addEventListener('webglcontextrestored', this.handleContextRestore);
}
```

### Phase 2: Subsystem Initialization

```typescript
private initializeSubsystems(): void {
  try {
    // 1. ModuleRegistry FIRST - holds module definitions
    this.registry = new ModuleRegistry();
    this.registry.registerDefaults();
    console.log('✓ ModuleRegistry initialized');
    
    // 2. ResourceManager SECOND - checks GPU capabilities
    this.resources = new ResourceManager(this.gl);
    const capabilities = this.resources.getCapabilities();
    console.log('✓ ResourceManager initialized');
    console.log(`  HDR: ${capabilities.floatRenderTargets ? 'Yes' : 'No'}`);
    console.log(`  Max texture size: ${capabilities.maxTextureSize}`);
    
    // 3. RenderExecutor THIRD - needs ResourceManager for framebuffers
    this.executor = new RenderExecutor(this.gl, this.resources);
    this.executor.setupGeometry();
    console.log('✓ RenderExecutor initialized');
    
    // 4. ShaderCompiler FOURTH - needs ModuleRegistry for modules
    this.compiler = new ShaderCompiler(this.gl, this.registry);
    console.log('✓ ShaderCompiler initialized');
    
    // 5. UniformBinder LAST - operates on compiled programs
    this.uniforms = new UniformBinder(this.gl);
    console.log('✓ UniformBinder initialized');
    
  } catch (error) {
    // Cleanup any partially initialized subsystems
    this.cleanupPartialInitialization();
    throw new EngineError(
      `Subsystem initialization failed: ${error.message}`,
      'Engine',
      false
    );
  }
}
```

### Phase 3: Validation

```typescript
private validateInitialization(): void {
  // Check GPU capabilities
  const validation = this.resources.validateCapabilities();
  
  if (!validation.valid) {
    switch (this.config.fallbackBehavior) {
      case 'error':
        throw new EngineError(
          `GPU capabilities insufficient: ${validation.errors.join(', ')}`,
          'Engine',
          false
        );
        
      case 'suggest':
        console.error('GPU limitations:', validation.errors);
        if (validation.suggestions) {
          console.log('Suggestions:', validation.suggestions);
        }
        break;
        
      case 'auto':
        this.applyAutomaticFallbacks(validation);
        break;
    }
  }
  
  // Verify all subsystems ready
  if (!this.registry || !this.resources || !this.executor || 
      !this.compiler || !this.uniforms) {
    throw new EngineError('Not all subsystems initialized', 'Engine', false);
  }
  
  // Check geometry is set up
  if (!this.executor.isInitialized()) {
    throw new EngineError('RenderExecutor geometry not initialized', 'Engine', false);
  }
}
```

### Phase 4: State Transition

```typescript
private transitionToReady(): void {
  this.state = { type: 'ready' };
  console.log('Engine initialization complete');
}
```

## Recipe Compilation Flow

### Eager Compilation at Startup

```typescript
initialize(recipes: Recipe[]): void {
  if (this.state.type !== 'ready') {
    throw new Error(`Cannot initialize recipes in state: ${this.state.type}`);
  }
  
  // For each recipe:
  for (const recipe of recipes) {
    this.compileRecipe(recipe);
  }
}

private compileRecipe(recipe: Recipe): void {
  const key = this.getRecipeKey(recipe);
  
  // 1. Registry: Validate recipe compatibility
  const compatibility = this.registry.checkCompatibility(recipe);
  if (!compatibility.compatible) {
    throw new Error(`Recipe ${key} incompatible: ${compatibility.issues.join(', ')}`);
  }
  
  // 2. Registry: Resolve modules
  const modules = this.registry.resolveModules(recipe);
  
  // 3. ShaderCompiler: Run 8-stage pipeline
  const program = this.compiler.compile(recipe);
  
  // 4. Cache compiled program
  this.compiledPrograms.set(key, program);
}
```

### Recipe Selection Flow

```typescript
selectRecipe(recipeName: string): void {
  // 1. Retrieve pre-compiled program
  const program = this.compiledPrograms.get(recipeName);
  if (!program) {
    throw new Error(`Recipe not pre-compiled: ${recipeName}`);
  }
  
  // 2. Deactivate current if exists
  if (this.activeProgram) {
    this.deactivateProgram();
  }
  
  // 3. Activate new program
  this.gl.useProgram(program.program);
  this.activeProgram = program;
  
  // 4. UniformBinder: Build parameter mappings
  this.uniforms.buildBindings(program);
  
  // 5. ResourceManager: Setup film buffers
  const filmModule = this.getFilmModule(program);
  const filmResources = this.resources.setupFilmBuffers(filmModule);
  
  // 6. Bind film textures to standard units
  this.bindFilmTextures(filmResources);
  
  // 7. Transition to running
  this.state = { 
    type: 'running', 
    program, 
    frame: 0 
  };
}
```

## Frame Execution Flow

The frame execution follows a strict sequence:

```typescript
renderFrame(): void {
  if (this.state.type !== 'running') {
    throw new Error(`Cannot render in state: ${this.state.type}`);
  }
  
  // PHASE 1: Resource Preparation
  this.prepareResources();
  
  // PHASE 2: Uniform Updates
  this.updateUniforms();
  
  // PHASE 3: Render Execution
  this.executeRender();
  
  // PHASE 4: Resource Finalization
  this.finalizeResources();
  
  // PHASE 5: State Update
  this.updateFrameState();
}
```

### Phase 1: Resource Preparation

```typescript
private prepareResources(): void {
  // ResourceManager: Bind previous frame textures for reading
  this.resources.prepareFrame();
  
  // This binds:
  // - u_film_radiance_previous → texture unit 0
  // - u_film_variance_previous → texture unit 1  
  // - u_film_samples_previous → texture unit 2
}
```

### Phase 2: Uniform Updates

```typescript
private updateUniforms(): void {
  // Build engine state
  const engineState: EngineStateInfo = {
    width: this.viewport.width,
    height: this.viewport.height,
    frameIndex: this.state.frame,
    sampleCount: this.state.frame,  // For now
    time: performance.now() / 1000
  };
  
  // UniformBinder: Flush all pending parameter updates
  this.uniforms.frameUpdate(engineState);
  
  // This updates:
  // 1. Engine uniforms (resolution, frame_index, etc.)
  // 2. All queued parameter changes
  // 3. Texture uniforms if needed
}
```

### Phase 3: Render Execution

```typescript
private executeRender(): void {
  // RenderExecutor: Draw full-screen triangle
  this.executor.renderFrame({
    clear: this.state.frame === 0,
    viewport: this.viewport,
    swapBuffers: true,
    target: { type: "screen" }
  });
  
  // This:
  // 1. Binds the VAO
  // 2. Issues single drawArrays call
  // 3. Unbinds the VAO
}
```

### Phase 4: Resource Finalization

```typescript
private finalizeResources(): void {
  // ResourceManager: Swap film buffers for next frame
  this.resources.finalizeFrame();
  
  // This swaps current/previous framebuffers for accumulation
}
```

### Phase 5: State Update

```typescript
private updateFrameState(): void {
  this.state = {
    ...this.state,
    frame: this.state.frame + 1
  };
}
```

## Data Flow Between Subsystems

### Compilation Data Flow

```
ModuleRegistry                      ShaderCompiler
    ↓                                    ↓
[Modules] ←──── resolveModules() ────→ [Modules]
                                         ↓
                                  [8-stage pipeline]
                                         ↓
                                  [CompiledProgram]
```

### Runtime Data Flow

```
ParameterStore → Engine → UniformBinder
                            ↓
                        [Uniform Updates]
                            ↓
                          GPU

ResourceManager ←→ RenderExecutor
      ↓                    ↓
[Framebuffers]     [Draw Calls]
      ↓                    ↓
     GPU ←─────────────────┘
```

## Parameter Update Flow

```typescript
// 1. App updates parameter
parameterStore.set('camera.position', [0, 5, 10]);

// 2. App gets changes
const changes = parameterStore.getChanges();

// 3. Engine queues updates
engine.updateUniforms(changes);
  ↓
// 4. UniformBinder queues internally
uniforms.queueUpdates(changes);

// 5. During renderFrame(), updates flush
uniforms.frameUpdate(engineState);
  ↓
// 6. WebGL uniform calls
gl.uniform3fv(location, [0, 5, 10]);
```

## Error Propagation

Errors propagate up from subsystems to Engine:

```typescript
class Engine {
  private handleSubsystemError(error: Error, subsystem: string): void {
    // Log with subsystem context
    console.error(`Error in ${subsystem}:`, error);
    
    // Determine if recoverable
    const recoverable = this.isRecoverable(error);
    
    // Transition to error state
    this.state = {
      type: 'error',
      error,
      recoverable
    };
    
    // Emit error event
    this.emitError(error, subsystem);
    
    // Attempt recovery if possible
    if (recoverable) {
      this.attemptRecovery(error, subsystem);
    }
  }
  
  private isRecoverable(error: Error): boolean {
    // Context loss is recoverable
    if (error.message.includes('context lost')) {
      return true;
    }
    
    // Resource allocation might be recoverable
    if (error instanceof ResourceAllocationError) {
      return true;
    }
    
    // Compilation errors are not recoverable
    if (error instanceof CompilationError) {
      return false;
    }
    
    return false;
  }
}
```

## Context Loss and Recovery

```typescript
private handleContextLoss = (event: WebGLContextEvent): void => {
  event.preventDefault();
  console.warn('WebGL context lost');
  
  // Transition to error state
  this.state = {
    type: 'error',
    error: new Error('WebGL context lost'),
    recoverable: true
  };
  
  // Notify subsystems
  this.resources.handleContextLoss();
  this.executor.handleContextLoss();
};

private handleContextRestore = (): void => {
  console.log('WebGL context restored, reinitializing...');
  
  try {
    // Reinitialize subsystems
    this.executor.setupGeometry();
    
    // Recompile all programs
    for (const [key, oldProgram] of this.compiledPrograms) {
      const newProgram = this.compiler.compile(oldProgram.recipe);
      this.compiledPrograms.set(key, newProgram);
    }
    
    // Restore active program if any
    if (this.activeProgram) {
      const recipeName = this.getRecipeKey(this.activeProgram.recipe);
      this.selectRecipe(recipeName);
    } else {
      // Return to ready state
      this.state = { type: 'ready' };
    }
    
    console.log('Context recovery complete');
    
  } catch (error) {
    console.error('Context recovery failed:', error);
    this.state = {
      type: 'error',
      error,
      recoverable: false
    };
  }
};
```

## Cleanup Sequence

Cleanup happens in reverse order of initialization:

```typescript
dispose(): void {
  // 1. Deactivate running program
  if (this.activeProgram) {
    this.deactivateProgram();
  }
  
  // 2. Delete compiled programs
  for (const program of this.compiledPrograms.values()) {
    this.gl.deleteProgram(program.program);
  }
  this.compiledPrograms.clear();
  
  // 3. Dispose subsystems in reverse order
  this.uniforms.dispose();      // 5th initialized, 1st disposed
  this.compiler.dispose();      // 4th initialized, 2nd disposed  
  this.executor.dispose();      // 3rd initialized, 3rd disposed
  this.resources.dispose();     // 2nd initialized, 4th disposed
  this.registry.dispose();      // 1st initialized, 5th disposed
  
  // 4. Remove event listeners
  this.gl.canvas.removeEventListener('webglcontextlost', this.handleContextLoss);
  this.gl.canvas.removeEventListener('webglcontextrestored', this.handleContextRestore);
  
  // 5. Clear state
  this.state = { type: 'uninitialized' };
  this.activeProgram = null;
  
  console.log('Engine disposed');
}
```

## State Coordination

The Engine maintains central state that subsystems query:

```typescript
interface EngineStateCoordination {
  // Engine owns:
  state: EngineState;              // Overall engine state
  viewport: Viewport;              // Current viewport
  activeProgram: CompiledProgram; // Current program
  frameNumber: number;             // In state.frame
  
  // Subsystems maintain their own state but coordinate through Engine:
  registry: {
    modules: Map<string, ModuleDescriptor>;
  };
  
  resources: {
    filmResources: FilmResources | null;
    capabilities: CapabilityReport;
  };
  
  executor: {
    frameStats: FrameStats;
    renderTarget: RenderTarget;
  };
  
  uniforms: {
    uniformMap: UniformMap | null;
    pendingUpdates: Map<string, any>;
  };
  
  compiler: {
    compiledPrograms: Map<string, CompiledProgram>;
  };
}
```

## Frame Synchronization

All subsystems synchronize through the frame execution:

```typescript
// Frame N preparation
resources.prepareFrame();        // Bind frame N-1 textures
uniforms.frameUpdate(state);     // Update uniforms for frame N
executor.renderFrame();           // Render frame N
resources.finalizeFrame();        // Swap for frame N+1

// Critical: No subsystem advances independently
// All state changes happen in lockstep
```

## Performance Monitoring Integration

```typescript
getPerformanceReport(): PerformanceReport {
  return {
    frame: this.executor.getFrameStats(),
    memory: this.resources.getMemoryStats(),
    uniforms: this.uniforms.getUpdateStats(),
    compilation: this.compiler.getCompilationReport(),
    
    // Overall metrics
    overall: {
      state: this.state.type,
      framesRendered: this.state.type === 'running' ? this.state.frame : 0,
      programsCompiled: this.compiledPrograms.size,
      uptime: performance.now() - this.startTime
    }
  };
}
```

## Integration Invariants

1. **Initialization order is strict** - Dependencies must be satisfied
2. **State transitions are atomic** - No partial state changes
3. **Frame execution is sequential** - Phases execute in order
4. **Cleanup is reverse of init** - Proper dependency unwinding
5. **Errors propagate upward** - Subsystems → Engine → App
6. **Context loss is handled** - Recovery attempted once
7. **No orphaned resources** - Everything tracked and cleaned

## Integration Requirements

The Engine integration MUST:

1. Initialize subsystems in dependency order
2. Validate capabilities before operations
3. Compile all recipes before any can run
4. Execute frames in strict phase order
5. Propagate errors with context
6. Handle context loss gracefully
7. Clean up in reverse order
8. Maintain state consistency
9. Provide performance visibility
10. Coordinate subsystem interactions
