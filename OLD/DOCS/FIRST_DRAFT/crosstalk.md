# Crosstalk: System Communication Architecture

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
// ShaderCompiler asks Registry for modules
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
// ShaderCompiler provides uniform locations to Binder
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

### 4. World Module Internal Communication

The World pillar has complex internal communication between its five module types:

**Objects → Scene**
```glsl
// Objects provide shape and material classification
float sphere_0_sdf(vec3 p)           // Distance function
int classify_sphere_0(vec3 p)        // Returns MaterialID
vec3 normal_sphere_0(vec3 p)         // Surface normal

// Scene uses these through dispatch
float eval_object_sdf(int obj_id, vec3 p) {
    switch(obj_id) {
        case 0: return sphere_0_sdf(p);
        // ... dispatch to all world
    }
}
```

**Scene → Materials (Interface Resolution)**
```glsl
// Scene determines material interface using nearby tracking
struct NearbyObjects {
    float dists[3];    // Top 3 closest world
    int ids[3];        
    int count;         // Within boundary threshold
};

// Scene resolves and provides to Hit
hit.material_from = resolve_material(p - epsilon, nearby);
hit.material_to = resolve_material(p + epsilon, nearby);
hit.ior_ratio = ior_table[hit.material_from] / ior_table[hit.material_to];
```

**Materials ← Material IDs (Not Object IDs)**
```glsl
// Materials work with material IDs from Objects
MaterialProperties get_props(int material_id) {
    return material_props[material_id];  // Direct indexing by material ID
}

// Material type flags for dispatch
const int material_types[NUM_MATERIALS] = int[](
    MAT_TYPE_OPAQUE,         // MATERIAL_WOOD
    MAT_TYPE_DIELECTRIC,     // MATERIAL_GLASS
    MAT_TYPE_PARTICIPATING,  // MATERIAL_FOG
);
```

### 5. Photography Module Internal Communication

**Estimator → World Modules**
```glsl
// Estimator queries Scene
bool sc_intersect(Ray ray, out Hit hit)
bool sc_intersect_any(Ray ray, float max_t)  
int sc_classify_point(vec3 p, int obj_id)  // For volume boundary checks

// Estimator queries Materials for surface interaction
vec3 m_interact(wi, hit, xi, wo, pdf)  // Batched BSDF operation

// Estimator queries Materials for volume properties (NOT transport)
vec3 m_sigma_s(Point p, int mat_id)    // Just scattering coefficient
vec3 m_sigma_a(Point p, int mat_id)    // Just absorption coefficient
float m_sigma_max(int mat_id)          // Majorant for delta tracking
Direction m_sample_phase(wi, p, mat_id, xi, pdf)  // Phase function
```

**Estimator Transport Ownership**
```glsl
// Estimator owns HOW to integrate, Materials provide WHAT
TransportResult dispatch_transport(Ray ray, Hit hit, TransportState state) {
    int type = material_types[hit.material_to];
    
    if (type & MAT_TYPE_PARTICIPATING) {
        // Estimator chooses integration strategy at compile time
        #if VOLUME_STRATEGY == DELTA_TRACKING
            return delta_track_volume(ray, hit, state);
        #elif VOLUME_STRATEGY == RAY_MARCHING
            return raymarch_volume(ray, hit, state);
        #endif
    }
    
    return transport_surface(ray, hit, state);
}

// Materials don't implement transport, just provide properties
// Estimator uses these to implement chosen algorithm
```

**Camera → Geometry**
```glsl
// Camera uses geometry functions for ray generation
Ray c_generate_ray(vec2 pixel, vec2 xi) {
    // Uses precomputed u_camera_frame
    // Calls g_geodesic for non-Euclidean spaces
}
```

## Data Flow Patterns

### Material Property Flow
```
Objects define material assignment
    ↓
classify_sphere_0(p) returns MATERIAL_GLASS
    ↓
Scene resolves interfaces using nearby tracking
    ↓
hit.material_to = MATERIAL_GLASS
hit.material_from = MATERIAL_AIR
    ↓
Materials provide properties by ID
    ↓
get_props(MATERIAL_GLASS) returns {ior: 1.5, ...}
    ↓
Estimator uses properties for transport
```

### Volume Transport Flow
```
Estimator hits participating medium boundary
    ↓
Check material_types[hit.material_to] & MAT_TYPE_PARTICIPATING
    ↓
Dispatch to compile-time selected strategy
    ↓
Query m_sigma_s(p, mat_id) for properties
    ↓
Estimator implements integration (delta tracking, etc.)
    ↓
Use sc_classify_point() to check boundaries
    ↓
Continue until exit or absorption
```

### Nearby Object Tracking Flow
```
Scene marches ray
    ↓
Track top 3 closest objects at each step
    ↓
Hit detected
    ↓
Use NearbyObjects to resolve material interface
    ↓
Only check 2-3 objects, not entire scene
    ↓
Efficient boundary resolution
```

### Parameter Updates
```
User Input
    ↓
UI Extension 
    ↓
ParameterStore.set("materials[GLASS].ior", 1.5)
    ↓
onChange callback
    ↓
Engine.updateUniforms({path: "materials[GLASS].ior", value: 1.5})
    ↓
UniformBinder.updateUniforms()
    ↓
GL.uniform1f(location, 1.5)
    ↓
GPU Uniform: u_material_glass_ior
```

## Module String Communication

Modules communicate through GLSL strings that the Engine assembles:

### Function Name Resolution
```
Module requires: ["intersect", "classify_point"]
Registry finds: Scene provides both
Compiler prefixes: "intersect" → "sc_intersect"
                  "classify_point" → "sc_classify_point"
Final GLSL: if (sc_intersect(ray, hit)) { 
              if (sc_classify_point(p, obj_id) == mat_id) { }
            }
```

### Material Dispatch Generation
```
Objects provide: classify_sphere_0, classify_box_1
Scene generates: get_object_material(obj_id, p)
Materials indexed by: material_id (not object_id)
Estimator uses: material_types[mat_id] for dispatch
```

### Transport Strategy Selection
```
App config: volumeStrategy = "delta_tracking"
Compiler generates: #define VOLUME_STRATEGY DELTA_TRACKING
Estimator uses: #if VOLUME_STRATEGY == DELTA_TRACKING
No runtime branching on strategy
```

## Communication Constraints

### What CANNOT Communicate Directly

1. **Objects ↔ Materials**: Objects return IDs, Materials work with IDs, no direct link
2. **Materials ↔ Transport**: Materials provide properties, Estimator owns algorithms
3. **Modules ↔ Modules**: Only through Engine-mediated function calls
4. **World ↔ Photography**: Only through compiled GLSL
5. **Engine Subsystems ↔ App Extensions**: Only through App core
6. **GPU ↔ JavaScript**: Only through readPixels and uniforms

### One-Way Communications

1. **Math → Everyone**: Math utilities available everywhere
2. **Objects → Scene**: Objects provide functions, Scene dispatches
3. **Scene → Hit**: Scene populates material interface
4. **Materials → Properties**: Materials provide properties by ID
5. **Properties → Estimator**: Estimator queries but doesn't modify
6. **Recipe → Engine**: Recipe flows one-way into compilation

### Clear Ownership Boundaries

1. **Objects own**: Shape geometry and material ID assignment
2. **Scene owns**: Object arrangement and material interface resolution
3. **Materials own**: Properties and local scattering behavior for material IDs
4. **Estimator owns**: Transport strategy and integration algorithms
5. **Engine owns**: Compilation and dispatch generation

## Performance-Critical Communications

### High-Frequency (Every Sample)
- `sc_intersect()` - Ray-scene intersection
- `m_interact()` - BSDF evaluation
- `next_2d()` - Random number generation
- Nearby object distance evaluation

### Medium-Frequency (Every Bounce)
- `dispatch_transport()` - Transport strategy selection
- `sc_classify_point()` - Volume boundary checks
- Material property lookups

### Low-Frequency (Per Frame)
- Uniform updates
- Frame buffer swaps
- Camera matrix computation

### Optimization Strategies

**Batching:**
- Material properties in single struct
- BSDF sample+eval in one `m_interact()` call
- Nearby objects tracked together

**Compile-Time Selection:**
- Transport strategies (#if VOLUME_STRATEGY)
- Material features (dead code elimination)
- Constant folding for fixed properties

**Caching:**
- Precomputed hit.frame
- Precomputed ior_ratio
- Camera matrices per frame
- Material type flags

## Communication Debugging

### Tracing Material Resolution
```glsl
// Scene can inject debug info
Hit create_hit(...) {
    #if DEBUG_MATERIALS
    if (hit.material_from != hit.material_to) {
        atomicAdd(u_boundary_crossings, 1);
    }
    #endif
}
```

### Tracing Transport Dispatch
```glsl
#if DEBUG_TRANSPORT
vec3 dispatch_transport(...) {
    if (type & MAT_TYPE_PARTICIPATING) 
        return vec3(1,0,0);  // Red for volumes
    if (type & MAT_TYPE_SUBSURFACE)
        return vec3(0,1,0);  // Green for SSS
    return vec3(0,0,1);      // Blue for surfaces
}
#endif
```

### Tracing Nearby Objects
```glsl
#if DEBUG_NEARBY
    // Visualize how many world are tracked
    return vec3(float(nearby.count) / 3.0);
#endif
```

## Summary

The system uses a layered communication architecture with clear ownership:

**Ownership Hierarchy:**
- Objects define shapes and assign material IDs
- Scene arranges objects and resolves interfaces efficiently
- Materials provide properties indexed by material ID
- Estimator owns transport strategy and integration

**Communication Methods:**
- **Direct references** for core components
- **Callbacks** for parameter updates
- **Events** for extensions
- **String-based** for module composition
- **Compile-time** for transport strategies

**Key Optimizations:**
- Nearby object tracking (2-3 objects vs entire scene)
- Material ID indexing (not object ID)
- Compile-time transport selection
- Batched operations (properties, BSDF)
- Precomputed values (frame, IOR ratio)

This design ensures clean boundaries, predictable data flow, and efficient execution while maintaining flexibility for research.
