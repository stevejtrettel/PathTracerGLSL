# Cosstalk: System Communication Architecture

## Overview

This document maps all communication patterns between the five pillars of the system (Math, World, Photography, App, Engine) and their internal components. Understanding these communication channels is crucial for maintaining clean architecture boundaries.

## High-Level Communication Flow

```
User Input → App → Engine → GPU → Screen
     ↓        ↕       ↕       ↑
Extensions  Params  Modules  Pixels
```

## Pillar-to-Pillar Communication

### 1. App ↔ Engine

**Direction: App → Engine**
```typescript
// Commands (Direct method calls)
engine.compileRecipe(recipe: Recipe): string
engine.selectProgram(programId: string): void
engine.renderFrame(): void
engine.setViewport(x, y, width, height): void
engine.updateUniforms(changes: ParameterChanges): void
engine.readPixels(rect?: Rectangle): Promise<Float32Array>
engine.clearAccumulation(): void
```

**Direction: Engine → App**
```typescript
// Events (Callbacks or EventEmitter)
engine.onCompilationComplete(programId: string)
engine.onCompilationError(error: CompilationError)
engine.onRenderComplete(frameNumber: number)
engine.onMemoryPressure(available: number)
```

**Data Structures Shared:**
- `Recipe` - App creates, Engine consumes
- `ParameterChanges` - App sends uniform updates
- `CompilationError` - Engine reports issues
- `Float32Array` - Pixel data from Engine

### 2. App Internal Communication

**ParameterStore ↔ ResearchApp**
```typescript
// Direct reference with onChange callback
parameterStore.onChange = (changes: ParameterChanges) => {
  engine.updateUniforms(changes);
  if (changes.requiresReset) {
    renderCoordinator.resetAccumulation();
  }
}
```

**RenderCoordinator ↔ Engine**
```typescript
// RenderCoordinator orchestrates Engine
coordinator.renderFrame() → engine.renderFrame()
coordinator.resetAccumulation() → engine.clearAccumulation()
coordinator.readPixels() → engine.readPixels()
```

**Extensions ↔ App Core**
```typescript
// Extensions get full App reference
extension.install(app: ResearchApp, bus: EventEmitter) {
  // Direct access to App methods
  app.parameterStore.set(path, value);
  app.renderCoordinator.start();
  
  // Event-based communication
  bus.emit('camera.moved', data);
  bus.on('render.progress', handler);
}
```

### 3. Engine Internal Communication

**ShaderCompiler ↔ ModuleRegistry**
```typescript
// Compiler asks Registry for modules
registry.resolveModules(recipe) → ModuleCollection
registry.findProvider(functionName) → ModuleDescriptor
registry.validateDependencies(modules) → ValidationResult
```

**ResourceManager ↔ RenderExecutor**
```typescript
// Executor tells ResourceManager about frame lifecycle
resourceManager.prepareFrame()  // Before rendering
resourceManager.finalizeFrame()  // After rendering
resourceManager.swapFilmBuffers() // For accumulation
```

**UniformBinder ↔ ShaderCompiler**
```typescript
// Compiler provides uniform locations to Binder
compiler.extractUniforms(program) → Map<string, UniformInfo>
binder.buildBindings(program: CompiledProgram)
```

**RenderExecutor ↔ ResourceManager**
```typescript
// Executor uses ResourceManager's buffers
resourceManager.bindFramebuffer(id)
resourceManager.bindTexture(id, unit)
executor.renderFrame() // Uses bound resources
```

### 4. Module Communication (Through Engine)

Modules don't directly communicate - the Engine mediates:

**Cross-Module Function Calls**
```glsl
// Estimator writes:
if (intersect(ray, hit)) { }

// Engine resolves to:
if (sc_intersect(ray, hit)) { }
```

**Material Dispatching**
```glsl
// Scene sets hit.material_id = 2
// Estimator calls: eval_material(hit.material_id, ...)
// Engine-generated dispatcher routes:
switch(id) {
  case 2: return m_disney_eval(...);
}
```

**Type Propagation**
```glsl
// Geometry defines:
typedef vec3 Point;
typedef vec3 Direction;

// All other modules use Point/Direction
// (Geometry compiled first via topological sort)
```

## Data Flow Patterns

### Parameter Updates
```
User Input
    ↓
UI Extension 
    ↓
ParameterStore.set("camera.position", [0, 5, 10])
    ↓
onChange callback
    ↓
Engine.updateUniforms({path: "camera.position", value: [0, 5, 10]})
    ↓
UniformBinder.updateUniforms()
    ↓
GL.uniform3fv(location, [0, 5, 10])
    ↓
GPU Uniform: u_camera_pinhole_position
```

### Render Frame
```
App.renderCoordinator.start()
    ↓
RenderCoordinator.runProgressive()
    ↓
Engine.renderFrame()
    ↓
UniformBinder.frameUpdate()  // Update engine uniforms
ResourceManager.prepareFrame()  // Bind textures
RenderExecutor.renderFrame()  // Draw quad
ResourceManager.finalizeFrame()  // Swap buffers
    ↓
Pixels in Framebuffer
```

### Module Compilation
```
App.loadRecipe(recipe)
    ↓
Engine.compileRecipe(recipe)
    ↓
ModuleRegistry.resolveModules(recipe)
    ↓
ShaderCompiler.compile()
    ├→ Dependency sort (Geometry first)
    ├→ Apply prefixes
    ├→ Generate material dispatcher
    ├→ Resolve cross-module calls
    ├→ Generate main()
    └→ WebGL compilation
    ↓
CompiledProgram stored in Engine
```

## Event Communication

### Standard Events (via EventBus)

**Camera Events**
```typescript
Source: InputExtension
Events: 'camera.moved', 'camera.animation_complete'
Listeners: UIExtension, ExperimentExtension
```

**Render Events**
```typescript
Source: RenderCoordinator
Events: 'render.start', 'render.progress', 'render.complete'
Listeners: UIExtension, PerformanceExtension, ExportExtension
```

**Parameter Events**
```typescript
Source: ParameterStore
Events: 'parameter.changed'
Listeners: UIExtension (update sliders), Engine (update uniforms)
```

**Experiment Events**
```typescript
Source: ExperimentExtension
Events: 'experiment.started', 'experiment.progress', 'experiment.complete'
Listeners: UIExtension (progress bar), ExportExtension (save results)
```

## Communication Protocols

### Direct Reference Protocol
Used for: Core App components, Engine subsystems
```typescript
class Component {
  constructor(private dependency: Dependency) {
    // Direct reference, synchronous calls
    this.dependency.method();
  }
}
```
Characteristics:
- Tight coupling
- Synchronous
- Fast
- Simple debugging

### Callback Protocol
Used for: ParameterStore → App, Engine → App
```typescript
interface Observer {
  onChange: (changes: Changes) => void;
}
```
Characteristics:
- Loose coupling
- Synchronous
- One-to-one
- Clear causality

### Event Emitter Protocol
Used for: Extensions, cross-cutting concerns
```typescript
bus.emit('event.name', data);
bus.on('event.name', handler);
```
Characteristics:
- Very loose coupling
- Asynchronous possible
- Many-to-many
- Harder to trace

### Promise/Async Protocol
Used for: Pixel readback, file I/O, long operations
```typescript
async function operation(): Promise<Result> {
  // Asynchronous operation
  return result;
}
```
Characteristics:
- Non-blocking
- Error propagation
- Composition friendly
- Good for I/O

## Module String Communication

Modules communicate through GLSL strings that the Engine assembles:

### Function Name Resolution
```
Module requires: ["intersect"]
Registry finds: Scene provides ["intersect"]
Compiler prefixes: "intersect" → "sc_intersect"
Final GLSL: if (sc_intersect(ray, hit)) { }
```

### Uniform Mapping
```
Module declares: uniform vec3 position;
Engine prefixes: u_camera_pinhole_position
App parameter: "camera.position"
Binder maps: "camera.position" → u_camera_pinhole_position
```

### Type Dependencies
```
Geometry provides: typedef vec3 Point;
Camera uses: Ray generate_ray(vec2 pixel)
Where Ray contains: struct Ray { Point origin; }
Compiler ensures: Geometry compiled before Camera
```

## Communication Constraints

### What CANNOT Communicate Directly

1. **Modules ↔ Modules**: Only through Engine-mediated function calls
2. **World ↔ Photography**: Only through compiled GLSL
3. **Engine Subsystems ↔ App Extensions**: Only through App core
4. **GPU ↔ JavaScript**: Only through readPixels and uniforms
5. **Different Recipes**: Complete isolation, no shared state

### One-Way Communications

1. **Math → Everyone**: Math utilities available everywhere, but Math never calls others
2. **Modules → Engine**: Modules provide GLSL strings, never receive anything back
3. **Recipe → Engine**: Recipe is data, flows one-way into compilation
4. **GPU → Screen**: Pixels flow out, nothing comes back

## Communication Debugging

### Tracing Parameter Updates
```typescript
// Add logging at each step
parameterStore.set(path, value)
  console.log(`1. ParameterStore: ${path} = ${value}`)
→ onChange(changes)
  console.log(`2. onChange: ${changes.length} changes`)
→ engine.updateUniforms(changes)
  console.log(`3. Engine: updating uniforms`)
→ gl.uniform3fv(location, value)
  console.log(`4. GL: uniform ${location} set`)
```

### Tracing Events
```typescript
// Instrument EventBus
class DebugEventBus extends EventEmitter {
  emit(event: string, data: any) {
    console.log(`Event: ${event}`, data);
    super.emit(event, data);
  }
}
```

### Tracing Module Calls
```glsl
// Engine can inject debug logging
bool sc_intersect_debug(Ray ray, out Hit hit) {
  // _debug_log is a special uniform for debugging
  if (_debug_log > 0.0) {
    _debug_counter += 1.0;
  }
  return sc_intersect(ray, hit);
}
```

## Performance Considerations

### High-Frequency Communications
These happen every frame and must be optimized:
- UniformBinder.frameUpdate()
- RenderExecutor.renderFrame()
- ResourceManager buffer swapping

### Batching Opportunities
- Parameter updates (collect all, apply once)
- Uniform updates (batch all uniforms per frame)
- Event emissions (debounce rapid changes)

### Caching Opportunities
- Compiled programs (never recompile same recipe)
- Uniform locations (cache per program)
- Module resolution (cache dependency graphs)
- Texture bindings (keep common textures bound)

## Summary

The system uses a hybrid communication architecture:
- **Direct references** for core components that need tight coupling
- **Callbacks** for loose coupling with clear causality
- **Events** for extensions and cross-cutting concerns
- **String-based** for module composition

This design ensures:
- Clean architectural boundaries
- Predictable data flow
- Extensibility without core modification
- Clear debugging paths
- Performance where needed
