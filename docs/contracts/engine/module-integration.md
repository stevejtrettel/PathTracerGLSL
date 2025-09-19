# Engine Integration Contract

## Purpose

This document specifies how Engine subsystems integrate to transform recipes into rendered frames. It defines the initialization sequence, data flow between subsystems, frame execution pipeline, and error propagation.

## Initialization Sequence

The Engine MUST initialize subsystems in this order:

```
1. ModuleRegistry
   - Register built-in modules
   - Validate module contracts

2. ResourceManager  
   - Check GPU capabilities
   - Validate WebGL2 context
   - Report fallback options

3. RenderExecutor
   - Setup full-screen triangle geometry
   - Initialize WebGL state
   - Register context loss handlers

4. ShaderCompiler
   - Compile all recipes eagerly
   - Build program cache
   - Generate line mappings

5. UniformBinder
   - Ready for binding creation
   - Initialize statistics
```

## Recipe Compilation Flow

### From Recipe to Program

```
Recipe (from App)
    ↓
ModuleRegistry.resolveModules()
    ↓
ModuleCollection (validated)
    ↓
ShaderCompiler.compile()
    ↓
CompiledProgram (with UniformMap)
    ↓
Program Cache (for instant switching)
```

### Module Resolution

The ModuleRegistry MUST:
1. Resolve all 8 module references
2. Validate dependencies are satisfied
3. Check for circular dependencies
4. Return complete ModuleCollection or throw

### Compilation Pipeline

The ShaderCompiler MUST:
1. Sort modules (Geometry first)
2. Apply prefixes automatically
3. Resolve cross-module calls
4. Generate main function
5. Build UniformMap
6. Compile and link shaders

## Frame Execution Pipeline

### Frame Orchestration

Each frame MUST execute these steps in order:

```
1. Parameter Updates
   App.parameterStore.set() → UniformBinder.queueUpdate()

2. Resource Preparation
   ResourceManager.prepareFrame()
   - Bind previous frame textures
   - Set render target

3. Uniform Flush
   UniformBinder.frameUpdate(engineState)
   - Update engine uniforms
   - Flush parameter queue

4. Rendering
   RenderExecutor.renderFrame(config)
   - Clear if needed
   - Draw full-screen triangle
   - Update statistics

5. Resource Finalization
   ResourceManager.finalizeFrame()
   - Swap film buffers
   - Update timestamps
```

### Data Flow During Frame

```
Parameters → UniformBinder (queue)
    ↓
Engine State → UniformBinder (flush)
    ↓
GPU Uniforms → Shader Execution
    ↓
Frame Buffer → ResourceManager (swap)
    ↓
Display or Film Accumulation
```

## Program Switching

### Recipe Selection Flow

```
1. App.selectRecipe(name)
    ↓
2. Engine.selectRecipe(name)
    - Get pre-compiled program from cache
    - Activate WebGL program
    ↓
3. UniformBinder.buildBindings(program, modules)
    - Create new UniformMap
    - Get uniform locations
    ↓
4. ResourceManager.setupFilmBuffers(film)
    - Compare manifests
    - Reuse or reallocate
    ↓
5. Engine state → 'running'
```

### Resource Reuse

When switching programs:
- Film buffers reused if manifest matches
- Textures cleared, not reallocated
- Uniform map rebuilt for new program

## Parameter Update Flow

### Update Propagation

```
1. User/App changes parameter
    ↓
2. ParameterStore validates and stores
    ↓
3. Engine.updateUniforms(changes)
    ↓
4. UniformBinder.queueUpdate(path, value)
    - Check if binding exists
    - Queue for batch update
    ↓
5. Next frame: UniformBinder.frameUpdate()
    - Map path to GPU location via UniformMap
    - Apply all queued updates
    - Clear queue
```

### Reset Detection

Parameters that trigger accumulation reset:
- `camera.*` - Any camera change
- `material.*` - Material properties
- `lights.*` - Lighting changes
- `scene.*` - Scene modifications

Parameters that DON'T trigger reset:
- `developer.*` - Tone mapping
- `film.alpha` - Blend factors
- `debug.*` - Visualization modes

## Resource Management Integration

### Film Buffer Lifecycle

```
1. ShaderCompiler provides film module
    ↓
2. ResourceManager.setupFilmBuffers(film)
    - Extract manifest
    - Compare with current
    - Allocate if different
    ↓
3. Each frame: ResourceManager manages buffers
    - prepareFrame(): Bind for reading
    - finalizeFrame(): Swap if persistent
    ↓
4. On reset: ResourceManager.clearFilmBuffers()
```

### Texture Unit Allocation

Coordinated between subsystems:

| Units | Managed By | Used For |
|-------|------------|----------|
| 0-7 | ResourceManager | Film textures |
| 8-15 | UniformBinder | Material textures |
| 16-31 | General | Environment, temporary |

## Error Propagation

### Compilation Errors

```
ModuleRegistry (missing module)
    ↓ throws ModuleNotFoundError
ShaderCompiler catches
    ↓ throws CompilationError with context
Engine catches
    ↓ transitions to 'error' state
App receives error
```

### Runtime Errors

```
ResourceManager (allocation failure)
    ↓ returns fallback suggestion
Engine applies fallback
    ↓ logs warning
Continues with reduced features
```

### Context Loss

```
RenderExecutor detects context loss
    ↓ notifies Engine
Engine transitions to 'error' (recoverable)
    ↓ waits for restoration
Context restored
    ↓ re-initialize subsystems
Engine transitions to 'ready'
```

## Capability Negotiation

### Startup Capability Check

```
1. ResourceManager.getCapabilities()
    ↓
2. ResourceManager.validateCapabilities()
    - Check HDR support
    - Check texture limits
    ↓
3. If invalid: ResourceManager.suggestFallback()
    - Alternative modules
    - Reduced features
    ↓
4. App adjusts recipes based on capabilities
    ↓
5. ShaderCompiler compiles adjusted recipes
```

### Fallback Application

When capabilities are insufficient:

| Missing | Fallback Action |
|---------|----------------|
| HDR | Use LDR film module |
| Texture units < 8 | Disable material textures |
| MRT | Use simple film without variance |
| Large textures | Reduce resolution |

## State Synchronization

### Engine State Machine

State transitions trigger subsystem updates:

```
'uninitialized' → 'ready'
    - All subsystems initialized
    
'ready' → 'running'
    - Program selected
    - Bindings created
    - Resources allocated
    
'running' → 'ready'
    - Program deactivated
    - Resources preserved
    
any → 'error'
    - Subsystems notified
    - Cleanup if unrecoverable
```

### Frame State

Each frame, Engine provides state to subsystems:

```typescript
{
  width: viewport.width,
  height: viewport.height,
  frameIndex: currentFrame,
  sampleCount: accumulation,
  time: elapsed
}
```

## Performance Coordination

### Compilation Performance

- ModuleRegistry: O(1) module lookup
- ShaderCompiler: All recipes compiled at startup
- Total startup: < 2 seconds for 2-3 recipes

### Runtime Performance

- UniformBinder: Batched updates, one flush per frame
- ResourceManager: Buffer reuse via manifest comparison
- RenderExecutor: Single draw call (3 vertices)
- Total overhead: < 2ms per frame

## Debugging Integration

### Cross-Subsystem Debugging

```
1. UniformBinder.debugPrint()
    - Shows parameter → uniform mappings
    
2. ResourceManager.getMemoryUsage()
    - GPU memory by subsystem
    
3. RenderExecutor.getFrameStats()
    - Timing breakdown
    
4. ShaderCompiler.getLineMapping()
    - Error line → source module
```

### Coordinated Logging

Each subsystem logs with prefix:
- `[Registry]` Module registration
- `[Compiler]` Compilation stages
- `[Resources]` Allocation/deallocation
- `[Uniforms]` Binding creation
- `[Executor]` Frame execution

## Invariants

These invariants MUST hold across all subsystems:

1. **Initialization Order**: Registry → Resources → Executor → Compiler → Binder
2. **Frame Order**: Prepare → Update → Render → Finalize
3. **Program State**: Active program matches current UniformMap
4. **Resource State**: Film buffers match current film manifest
5. **Parameter State**: Queue empty after frameUpdate()
6. **Texture Units**: Film (0-7), Materials (8-15) never overlap
7. **Error State**: Subsystems inactive in 'error' state
8. **Capability State**: Fallbacks available for all missing capabilities

## Usage Example

```typescript
// Initialize Engine with subsystems
const engine = new Engine(gl);

// Subsystems coordinate during init
engine.initialize([pathtracer, debug]);  // Registry → Compiler chain

// Frame execution coordinates all subsystems
function render() {
  // Parameter update flows through systems
  engine.updateUniforms(changes);  // → Binder queues
  
  // Frame triggers coordinated execution
  engine.renderFrame();  // Resources → Uniforms → Executor
  
  requestAnimationFrame(render);
}

// Program switch coordinates state
engine.selectRecipe('debug');  // Compiler → Binder → Resources

// Capability check coordinates fallbacks
if (!engine.getCapabilities().floatRenderTargets) {
  // Resources suggests → Compiler uses → App informed
}
```
