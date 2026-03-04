# Architecture Overview

PathTracerGLSL is designed as a three-layer system with clean separation of concerns.

## System Layers

```
┌─────────────────────────────────────────────┐
│           Extensions Layer                   │
│  (OrbitControls, Screenshot, HDRExport)     │
└─────────────────┬───────────────────────────┘
                  │
┌─────────────────▼───────────────────────────┐
│           App Layer                          │
│  • ParameterStore (state management)        │
│  • EventBus (communication)                 │
│  • App (orchestration)                      │
└─────────────────┬───────────────────────────┘
                  │
┌─────────────────▼───────────────────────────┐
│           Engine Layer                       │
│  • ShaderCompiler (module → shader)         │
│  • RenderExecutor (rendering passes)        │
│  • ResourceManager (buffers, textures)      │
│  • ParameterManager (uniforms)              │
└─────────────────┬───────────────────────────┘
                  │
┌─────────────────▼───────────────────────────┐
│              WebGL2                          │
└─────────────────────────────────────────────┘
```

Additionally, a cross-cutting **Error System** validates and reports issues across all layers.

---

## Layer Responsibilities

### Engine Layer (`src/engine/`)

**Purpose**: Manages GPU resources and rendering execution.

**Key Components**:
- `Engine` - Main engine orchestrator
- `ShaderCompiler` - Compiles modules into complete shader programs
- `RenderExecutor` - Executes rendering passes
- `ResourceManager` - Manages framebuffers and accumulation buffers
- `ParameterManager` - Updates shader uniforms
- `TextureRegistry` - Global texture management (environment maps)

**Responsibilities**:
- Compile and link shaders from modules
- Execute multi-pass rendering (main → display → composite)
- Manage WebGL state and resources
- Handle per-recipe accumulation buffers
- Update uniforms from parameter changes

**Does NOT**:
- Know about UI or user input
- Manage application state
- Handle events

---

### App Layer (`src/app/`)

**Purpose**: Application state, events, and user-facing features.

**Key Components**:
- `App` - Application orchestrator
- `ParameterStore` - Centralized parameter state
- `EventBus` - Event-driven communication
- `SessionManager` - Multi-recipe session management
- Extension system

**Responsibilities**:
- Manage application lifecycle
- Store and update parameters
- Coordinate between engine and extensions
- Emit events for parameter changes, render completion, etc.
- Load and switch between recipes

**Does NOT**:
- Directly interact with WebGL
- Know about shader compilation
- Manage GPU resources

---

### Extensions (`src/app/extensions/`)

**Purpose**: Modular, optional features.

**Available Extensions**:
- `OrbitControls` - Camera orbit navigation
- `TouchOrbitControls` - Touch-based orbit controls
- `KeyboardControls` - Keyboard navigation
- `ParameterPanelExtension` - UI controls for parameters
- `ScreenshotExtension` - PNG/JPEG export
- `HDRExportExtension` - EXR export (floating-point)
- `ProductionRenderExtension` - High-quality rendering
- `StatsPanelExtension` - FPS and performance stats

**Extension Interface**:
```typescript
interface Extension {
    name: string;
    initialize?(context: ExtensionContext): void;
    update?(delta: number): void;
    dispose?(): void;
}
```

Extensions communicate via the EventBus and ParameterStore, remaining decoupled from engine internals.

---

### Error System (`src/errors/`)

**Purpose**: Comprehensive validation and error reporting.

**Components**:
- `errors/engine/` - Recipe and uniform validation (pre-compilation)
- `errors/shader/` - GLSL error translation (post-compilation)
- `errors/resources/` - Resource loading validation (HDR, textures)

**Cross-cutting**: Validates at multiple stages:
1. **Pre-compilation** - Recipe structure, uniform bindings
2. **Compilation** - GLSL syntax, missing functions
3. **Runtime** - Resource loading, WebGL state

See [Error System Documentation](errors/) for details.

---

## Data Flow

### 1. Initialization Flow

```
User Code
  ├─> Creates Recipe (module composition)
  ├─> Creates App instance
  └─> Calls app.initialize([recipes])
       │
       ├─> App creates Engine
       │    │
       │    ├─> Engine validates recipes (errors/engine/)
       │    ├─> Engine compiles shaders (ShaderCompiler)
       │    │    └─> Validates shader compilation (errors/shader/)
       │    ├─> Engine initializes resources (ResourceManager)
       │    └─> Engine binds parameters (ParameterManager)
       │
       └─> App initializes ParameterStore
```

### 2. Parameter Update Flow

```
User Input (Extension)
  └─> Extension updates ParameterStore
       │
       ├─> ParameterStore computes changes
       ├─> EventBus emits 'parameters:changed'
       │
       └─> App receives event
            └─> Engine.updateParameters(changes)
                 └─> ParameterManager updates uniforms
                      └─> WebGL uniform calls
```

### 3. Render Loop Flow

```
requestAnimationFrame
  └─> App.renderFrame()
       │
       ├─> Extensions.update(delta)
       │    └─> (May trigger parameter changes)
       │
       └─> Engine.renderFrame()
            │
            ├─> ResourceManager.prepareFrame()
            │    └─> Swap accumulation buffers
            │
            ├─> ParameterManager.updateEngineUniforms()
            │    └─> Set resolution, time, sampleCount
            │
            ├─> RenderExecutor.executeMainPass()
            │    └─> Draw fullscreen quad (path tracing)
            │
            ├─> RenderExecutor.executeDisplayPass()
            │    └─> Tone mapping to RGB buffer
            │
            ├─> RenderExecutor.executeCompositePass()
            │    └─> RGB buffer → screen
            │
            └─> ResourceManager.finalizeFrame()
                 └─> Increment sample count
```

### 4. Recipe Switching Flow

```
User selects different recipe
  └─> App.selectRecipe(recipeId)
       │
       ├─> SessionManager updates active recipe
       ├─> Engine.selectRecipe(recipeId)
       │    │
       │    ├─> Switch shader programs
       │    ├─> Switch accumulation buffers
       │    └─> Rebind parameters
       │
       └─> EventBus emits 'recipe:changed'
            └─> UI updates
```

---

## Module System

### Module Compilation

Modules are compiled into three shader programs:

**1. Main Program (Vertex + Fragment)**
```
Vertex Shader (fullscreen quad)
  ↓
Fragment Shader:
  ├─ Module constants (all modules)
  ├─ Module uniforms (all modules)
  ├─ Module functions (all modules)
  └─ Main function:
       ├─ camera_generateRay()
       ├─ scene_raymarch()
       ├─ interaction_surface_shade()
       ├─ transport_trace()
       └─ accumulator_accumulate()
```

**2. Display Program (Tone Mapping)**
```
Fragment Shader:
  ├─ developer module constants
  ├─ developer module uniforms
  ├─ developer module functions
  └─ developer_tonemap()
```

**3. Composite Program (Final Output)**
```
Simple passthrough to screen
```

### Module Order

Modules compile in dependency order:
```typescript
const MODULE_ORDER = [
    'ambient',      // Mathematical space
    'scene',        // Geometry
    'environment',  // Environment maps
    'lighting',     // Light sources
    'camera',       // Ray generation
    'interaction',  // BRDFs
    'transport',    // Integration
    'accumulator',  // Sample accumulation
    'developer'     // Tone mapping
];
```

---

## Recipe System

A **Recipe** defines a complete rendering pipeline by selecting one module for each slot:

```typescript
interface Recipe {
    id: string;
    name: string;

    world: {
        ambient: ModuleDescriptor;      // e.g., euclidean-ambient
        environment: ModuleDescriptor;  // e.g., hdri-environment
        scene: ModuleDescriptor;        // e.g., raymarch-scene
        lighting: ModuleDescriptor;     // e.g., quad-light
    };

    optics: {
        camera: ModuleDescriptor;       // e.g., pinhole-camera
        interaction: ModuleDescriptor;  // e.g., lambert-interaction
        transport: ModuleDescriptor;    // e.g., path-tracer-direct-light
        accumulator: ModuleDescriptor;  // e.g., average-accumulator
        developer: ModuleDescriptor;    // e.g., gamma-developer
    };

    parameters?: Record<string, any>;
    config?: { targetSamples?: number; renderMode?: string; };
}
```

Multiple recipes can coexist. The engine maintains:
- One shader program per recipe
- One accumulation buffer per recipe
- Shared resources (environment maps, composite program)

---

## Parameter System

Parameters flow from application state to GPU uniforms:

```
Application State (ParameterStore)
  └─> Parameter Path (e.g., 'camera.fov')
       └─> Uniform Binding (in ModuleDescriptor)
            └─> Compute Function
                 └─> GPU Uniform (e.g., u_camera_fov)
```

**Example:**
```typescript
// Module declares uniform
uniforms: `uniform float u_camera_fov;`

// Module binds parameter → uniform
uniformBindings: [{
    uniform: 'u_camera_fov',
    parameters: ['camera.fov'],
    type: 'float',
    compute: (params) => params['camera.fov'] * (Math.PI / 180) // deg→rad
}]

// User sets parameter
app.setParameter('camera.fov', 60);

// System updates uniform
gl.uniform1f(location, 60 * (Math.PI / 180));
```

The compute function allows transformations (units, color space, complex derivations).

---

## WebGL Resource Management

### Accumulation Buffers (Per-Recipe)

```
Recipe 1:
  ├─ accumulatorPingFB (RGBA32F)
  └─ accumulatorPongFB (RGBA32F)

Recipe 2:
  ├─ accumulatorPingFB (RGBA32F)
  └─ accumulatorPongFB (RGBA32F)
```

Double buffering enables:
- Read from previous frame
- Write to current frame
- Swap each frame

### Shared Resources (Global)

```
TextureRegistry:
  ├─ env_map (RGB32F)
  ├─ env_cdf_conditional (R32F)
  └─ env_cdf_marginal (R32F)

CompositeProgram (shared across all recipes)
```

---

## Error Handling Philosophy

**Fail fast, fail clearly:**

1. **Validate early** - Catch structural errors before compilation
2. **Translate errors** - Turn cryptic GLSL errors into helpful diagnostics
3. **Provide context** - Show module, line, and suggestions
4. **Don't crash silently** - Throw with detailed messages

**Error flow:**
```
Recipe created
  └─> validateRecipe()
       └─> validateRecipeModules()
            └─> validateModuleUniforms()
                 └─> ShaderCompiler.compile()
                      └─> GLSL compilation
                           └─> translateShaderErrors()
```

See [Error System](errors/) for comprehensive documentation.

---

## Extension Points

The system is designed for extension:

1. **New Modules** - Add cameras, BRDFs, integrators, scenes
2. **New Extensions** - Add UI, export formats, analysis tools
3. **New Validators** - Add validation for new resource types
4. **New Event Types** - Extend EventBus for custom communication

All without modifying core engine or app code.

---

## Performance Considerations

- **Shader reuse** - Programs compiled once, reused across frames
- **Uniform caching** - Only update changed uniforms
- **Double buffering** - Avoid framebuffer read/write conflicts
- **Float textures** - HDR accumulation for accurate averaging
- **Progressive rendering** - Spread work across frames

---

## Next Steps

Explore detailed documentation:
- [Engine Layer](engine/) - GPU resources and rendering
- [App Layer](app/) - Application state and extensions
- [Error System](errors/) - Validation and diagnostics
- [Guides](guides/) - How to extend the system
- [Reference](reference/) - Type definitions and API
