
# Engine Implementation Guide - Integration and Data Flow

## Overview

Now that we have all the subsystems, we need to wire them together correctly. This guide covers the actual implementation of how data flows between subsystems during initialization and each frame.

## The Critical Initialization Order

The order matters because of dependencies between subsystems:

```typescript
class Engine {
  constructor(private gl: WebGL2RenderingContext) {
    // Order is CRITICAL - each depends on the previous
    
    // 1. Registry first - it holds module definitions
    this.registry = new ModuleRegistry();
    
    // 2. Resources second - needs GL context, provides capabilities
    this.resources = new ResourceManager(gl);
    
    // 3. Executor third - needs resources for framebuffer binding
    this.executor = new RenderExecutor(gl, this.resources);
    
    // 4. Compiler fourth - needs registry for module lookup
    this.compiler = new ShaderCompiler(gl, this.registry);
    
    // 5. UniformBinder last - operates on compiled programs
    this.uniforms = new UniformBinder(gl);
  }
}
```

### Why This Order?

```
ModuleRegistry (standalone)
    ↓
ResourceManager (needs GL context)
    ↓
RenderExecutor (needs ResourceManager for framebuffers)
    ↓
ShaderCompiler (needs Registry for modules)
    ↓
UniformBinder (needs compiled programs)
```

## Startup Sequence Implementation

```typescript
initialize(recipes: Recipe[]): void {
  console.log('Engine initialization starting...');
  
  // Phase 1: Register built-in modules
  console.log('Phase 1: Registering modules');
  this.registry.registerDefaults();
  
  // Phase 2: Validate GPU capabilities
  console.log('Phase 2: Checking GPU capabilities');
  const caps = this.resources.getCapabilities();
  const validation = this.resources.validateCapabilities();
  
  if (!validation.valid) {
    // Can't continue without required features
    this.handleCapabilityFailure(validation);
    throw new Error('GPU capabilities insufficient');
  }
  
  // Phase 3: Setup rendering geometry
  console.log('Phase 3: Creating geometry');
  this.executor.setupGeometry();
  this.executor.initialize();
  
  // Phase 4: Compile all recipe variants
  console.log('Phase 4: Compiling shaders');
  const startCompile = performance.now();
  
  for (const recipe of recipes) {
    try {
      this.compileRecipe(recipe);
    } catch (error) {
      console.error(`Failed to compile recipe ${recipe.id}:`, error);
      // Continue with other recipes
    }
  }
  
  const compileTime = performance.now() - startCompile;
  console.log(`Compiled ${recipes.length} recipes in ${compileTime}ms`);
  
  // Phase 5: Ready!
  this.state = 'ready';
  console.log('Engine initialization complete');
}
```

## Recipe Compilation Flow

Here's how a recipe becomes a GPU program:

```typescript
private compileRecipe(recipe: Recipe): void {
  // Step 1: Check recipe validity
  const compatibility = this.registry.checkCompatibility(recipe);
  if (!compatibility.compatible) {
    throw new Error(`Recipe incompatible: ${compatibility.issues.join(', ')}`);
  }
  
  // Step 2: Resolve modules
  const modules = this.registry.resolveModules(recipe);
  // This gives us the actual ModuleDescriptor objects
  
  // Step 3: Compile to GPU program
  const program = this.compiler.compile(recipe);
  // This runs the entire pipeline and creates WebGLProgram
  
  // Step 4: Cache the compiled program
  const key = this.getRecipeKey(recipe);
  this.compiledPrograms.set(key, program);
  
  console.log(`✓ Compiled ${key}`);
}
```

## Recipe Selection Implementation

When the user selects a recipe:

```typescript
selectRecipe(recipeName: string): void {
  console.log(`Selecting recipe: ${recipeName}`);
  
  // Step 1: Get the pre-compiled program
  const program = this.compiledPrograms.get(recipeName);
  if (!program) {
    throw new Error(`Recipe not found: ${recipeName}`);
  }
  
  // Step 2: Make it active on GPU
  this.gl.useProgram(program.program);
  this.activeProgram = program;
  
  // Step 3: Build uniform bindings for this program
  this.uniforms.clearBindings();
  this.uniforms.buildBindings(program, program.modules);
  
  // Step 4: Setup film buffers based on film module
  const filmModule = program.modules.find(m => m.id.kind === 'film');
  if (!filmModule) {
    throw new Error('No film module in recipe!');
  }
  
  const filmResources = this.resources.setupFilmBuffers(filmModule);
  
  // Step 5: Initialize frame counter
  this.frameCount = 0;
  
  // Step 6: Transition to running state
  this.state = 'running';
  
  console.log(`Recipe active: ${recipeName}`);
}
```

## Frame Execution Implementation

Here's what happens every frame:

```typescript
renderFrame(): void {
  if (this.state !== 'running') {
    throw new Error('Cannot render - engine not running');
  }
  
  const frameStart = performance.now();
  
  // Step 1: Prepare resources (bind textures, set render target)
  this.resources.prepareFrame();
  
  // Step 2: Flush uniform updates
  const engineState = this.getEngineState();
  this.uniforms.frameUpdate(engineState);
  
  // Step 3: Execute the draw call
  this.executor.renderFrame({
    clear: this.frameCount === 0,  // Clear on first frame
    swapBuffers: true,              // Use ping-pong buffers
  });
  
  // Step 4: Finalize resources (swap buffers)
  this.resources.finalizeFrame();
  
  // Step 5: Update frame counter
  this.frameCount++;
  
  // Step 6: Track performance
  const frameTime = performance.now() - frameStart;
  this.trackFramePerformance(frameTime);
  
  // Log every 60 frames
  if (this.frameCount % 60 === 0) {
    console.log(`Frame ${this.frameCount}: ${frameTime.toFixed(2)}ms`);
  }
}

private getEngineState(): EngineStateInfo {
  return {
    width: this.viewport.width,
    height: this.viewport.height,
    frameIndex: this.frameCount,
    sampleCount: this.frameCount,  // Simplified
    time: performance.now() / 1000
  };
}
```

## Parameter Update Flow

How parameter changes flow through the system:

```typescript
updateParameters(changes: ParameterChanges): void {
  // Step 1: Queue the updates (don't apply yet!)
  for (const change of changes.changes) {
    this.uniforms.queueUpdate(change.path, change.newValue);
  }
  
  // Step 2: Check if we need to reset accumulation
  if (this.requiresReset(changes)) {
    this.resetAccumulation();
  }
  
  // Note: Actual GPU update happens in frameUpdate()
}

private requiresReset(changes: ParameterChanges): boolean {
  // Camera changes always reset
  if (changes.changes.some(c => c.path.startsWith('camera.'))) {
    return true;
  }
  
  // Material changes reset
  if (changes.changes.some(c => c.path.startsWith('material.'))) {
    return true;
  }
  
  // Developer changes don't reset (just tone mapping)
  if (changes.changes.every(c => c.path.startsWith('developer.'))) {
    return false;
  }
  
  return true;  // Default to reset
}

private resetAccumulation(): void {
  console.log('Resetting accumulation');
  
  // Clear film buffers
  this.resources.clearFilmBuffers();
  
  // Reset frame counter
  this.frameCount = 0;
  
  // Tell uniform binder about reset
  this.uniforms.queueUpdate('engine.film_reset', true);
}
```

## Error Handling Integration

How errors propagate through the system:

```typescript
private handleCompilationError(error: CompilationError): void {
  console.error('Shader compilation failed:', error);
  
  // Try to provide helpful context
  if (error.sourceContext) {
    console.error('Source context:', error.sourceContext);
  }
  
  // Use line mapping to find module
  if (error.compiledLine && this.activeProgram) {
    const source = this.activeProgram.metadata.lineMap.getSourceLocation(
      error.compiledLine
    );
    if (source) {
      console.error(`Error in module ${source.module} at line ${source.originalLine}`);
    }
  }
  
  // Transition to error state
  this.state = 'error';
  
  // Notify app
  this.onError?.(error);
}

private handleContextLoss(): void {
  console.error('WebGL context lost');
  
  // Stop rendering
  this.state = 'error';
  
  // Mark as recoverable
  this.contextLost = true;
  
  // All GPU resources are now invalid
  // We'll need to recreate everything when context is restored
}

private handleContextRestore(): void {
  console.log('WebGL context restored');
  
  // Recreate all GPU resources
  this.executor.setupGeometry();
  
  // Recompile all shaders
  for (const [key, recipe] of this.cachedRecipes) {
    try {
      this.compileRecipe(recipe);
    } catch (error) {
      console.error(`Failed to recompile ${key}:`, error);
    }
  }
  
  // Reset state
  this.contextLost = false;
  this.state = 'ready';
}
```

## Performance Monitoring Integration

Track performance across subsystems:

```typescript
getPerformanceReport(): PerformanceReport {
  return {
    frame: {
      current: this.frameCount,
      averageTime: this.executor.getAverageFrameTime(),
      fps: this.executor.getFrameStats().fps
    },
    
    compilation: {
      programCount: this.compiler.getProgramCount(),
      report: this.compiler.getCompilationReport()
    },
    
    uniforms: {
      stats: this.uniforms.getUpdateStats(),
      mappingCount: this.uniforms.getUniformMap()?.mappings.size || 0
    },
    
    resources: {
      memory: this.resources.getMemoryUsage(),
      textureCount: this.resources.getTextureCount(),
      framebufferCount: this.resources.getFramebufferCount()
    },
    
    modules: {
      registered: this.registry.getModuleCount(),
      byKind: this.registry.getModuleCountByKind()
    }
  };
}
```

## Key Integration Points

1. **Registry → Compiler**: Modules flow from registry to compiler
2. **Compiler → UniformBinder**: UniformMap created during compilation
3. **Resources → Executor**: Framebuffers bound before drawing
4. **UniformBinder → GPU**: Uniforms flushed before draw call
5. **All → Engine**: State changes coordinated through main Engine

## Common Integration Issues

1. **Wrong initialization order** - Subsystems depend on each other
2. **Missing state transitions** - Must be 'running' to render
3. **Forgetting to flush uniforms** - Updates queued but not applied
4. **Resource/program mismatch** - Film buffers don't match shader
5. **Incomplete error propagation** - Errors lost in subsystem

The key is that each subsystem has a specific responsibility, and the Engine orchestrates them in the right order.
