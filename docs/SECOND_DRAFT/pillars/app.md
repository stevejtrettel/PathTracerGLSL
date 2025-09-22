# App Pillar Overview

## Purpose

The App is the **research orchestration layer** that transforms a GPU path tracer into a complete experimental apparatus. It provides the minimal scaffolding needed to coordinate Engine, World, and Photography into working experiments, while enabling unlimited growth through extensions. The App makes path tracing research feel like using a scientific instrument, not programming a renderer.

## Core Philosophy

The App embodies **orchestration without opinion**. While the Engine hides GPU complexity and Photography defines observation algorithms, the App purely coordinates - it has no rendering opinions, no built-in UI, no mandatory workflows. Every research feature is an extension. The core remains minimal, stable, and focused solely on orchestration.

This minimalism is deliberate. Research needs vary wildly - some need parameter sweeps, others need animation, many just need to render one beautiful image. By keeping the core minimal and making everything else an extension, the App adapts to any research style without imposing workflow assumptions.

## The App Architecture

The App consists of four core components and an extension system:

```
ParameterStore (central state)
    ↕
ResearchApp (orchestrator)
    ↕
RenderCoordinator (execution modes)
    ↕
SessionManager (persistence)

    +

ExtensionSystem (all features)
```

### Understanding the Core Components

Each component has a single, focused responsibility that cannot be delegated to extensions:

**ParameterStore** is the single source of truth for all renderer state. Every parameter - from camera position to material roughness - flows through this central store. It validates values against metadata, batches updates for efficiency, and notifies observers of changes. This isn't just a key-value store - it understands parameter types, ranges, and relationships. When you change `camera.fov`, the store knows this is a float between 10 and 170 degrees. Critically, the store knows nothing about rendering - it just manages state and emits change events.

**ResearchApp** is the orchestration hub that wires everything together. At initialization, it defines your 2-3 research recipes (complete configurations of all 8 modules), asks the Engine to eagerly compile them, creates the core components, and establishes the data flow between them. During runtime, it provides the minimal API needed for research: switch recipes, start/stop rendering, save/load sessions. Everything else - camera controls, UI, experiments - comes from extensions. The app keeps no rendering state, makes no rendering decisions, and provides no features beyond pure orchestration.

**RenderCoordinator** manages the execution of rendering across three modes: interactive (real-time preview), progressive (accumulation), and production (tiled high-res). It owns the critical decision of when to reset accumulation - a camera move requires reset, a tonemapping change doesn't. It tracks sample counts, manages frame timing, and reports progress. But it doesn't touch WebGL or shaders - it just tells the Engine when to render frames and tracks the results.

**SessionManager** enables reproducible research by saving and restoring complete system state. A session includes the active recipe, all parameter values, camera position, and any extension-specific state. This isn't just for convenience - reproducibility is fundamental to research. Every beautiful image, every parameter study, every debugging session can be perfectly recreated from a session file.

---

The **Extension System** is where all features live. Extensions aren't second-class citizens - they're the primary way to add functionality. Camera controls? Extension. Parameter UI? Extension. Screenshot export? Extension. The core provides the hooks, extensions provide the features.

## Key Design Decisions

### 1. Known Recipes - No Dynamic Shader Compilation

The App requires you to define your 2-3 research recipes upfront:

```typescript
const app = new ResearchApp(canvas, {
  recipes: {
    pathtracer: {
      world: { 
        geometry: 'euclidean', 
        material: 'disney',
        scene: 'sdf',
        lights: 'hdri'
      },
      photography: {
        camera: 'pinhole',
        estimator: 'pathtracer', 
        film: 'variance',
        developer: 'aces'
      }
    },
    debug: {
      // Debug configuration
    },
    production: {
      // High quality configuration  
    }
  }
});
```

These recipes are compiled eagerly at startup (taking ~1-2 seconds total), then switching between them is instant. No dynamic module loading, no runtime compilation, no shader recompilation stutters. You define your experimental apparatus, it gets built once, then you use it.

### 2. Service Pattern - Clean Extension Architecture

Extensions register themselves as services rather than polluting the app interface:

```typescript
// BAD: Adding methods to app
install(app) {
  app.takeScreenshot = () => { /* ... */ };
}

// GOOD: Registering as service  
install(app) {
  app.registerService('screenshot', this);
}
takeScreenshot() {
  const pixels = this.app.engine.readPixels();
  // ...
}

// Usage: Get service explicitly
const screenshot = app.getService('screenshot');
await screenshot.takeScreenshot();
```

This keeps the App interface minimal and makes dependencies explicit. You can see exactly which extensions you're using.

### 3. Direct Core Flow, Events for Extensions

The critical rendering path uses direct references for zero overhead:

```
ParameterStore.onChange → Engine.updateUniforms() → GPU
                       ↘ RenderCoordinator.checkReset()
```

Extensions communicate through events for loose coupling:

```
InputExtension →emit('camera.moved')→ UIExtension
                                    ↘ PerformanceMonitor
```

This hybrid approach gives performance where it matters and flexibility where it's useful.

### 4. Reset Logic Ownership

The RenderCoordinator, not the ParameterStore, decides when to reset accumulation:

```typescript
class RenderCoordinator {
  private resetPrefixes = ['camera.', 'material.', 'scene.', 'lights.'];
  private noResetPrefixes = ['developer.', 'ui.', 'debug.'];
  
  shouldResetForParameter(path: string): boolean {
    // Check no-reset list first (higher priority)
    for (const prefix of this.noResetPrefixes) {
      if (path.startsWith(prefix)) return false;
    }
    
    // Check reset triggers
    for (const prefix of this.resetPrefixes) {
      if (path.startsWith(prefix)) return true;
    }
    
    return true; // Default: reset to be safe
  }
}
```

This separation keeps the ParameterStore pure (just state management) while giving the coordinator the context it needs to make intelligent reset decisions.

### 5. Everything Synchronous That Can Be

Unlike many web renderers, the App avoids unnecessary async operations:

```typescript
// Recipe switching is synchronous (pre-compiled)
app.switchRecipe('pathtracer');  // Instant!

// Parameter updates are synchronous  
store.set('material.roughness', 0.5);  // Immediate!

// Only truly async operations use promises
await engine.readPixelsAsync();  // GPU readback
await session.save('research.json');  // File I/O
```

This makes the app predictable and debuggable. You can step through the entire render flow without promise chains.

## Core Workflows

### Research Loop

The fundamental research pattern the App enables:

```typescript
// 1. Define your apparatus (once at startup)
const app = new ResearchApp(canvas, {
  recipes: { /* your configurations */ }
});

// 2. Add the tools you need
app.use(new InputExtension());   // Camera controls
app.use(new UIExtension());      // Parameter tweaking

// 3. Run your experiment
app.switchRecipe('pathtracer');
app.renderCoordinator.start();

// 4. Iterate on parameters
app.parameterStore.set('material.roughness', 0.3);
// Accumulation automatically resets!

// 5. Save interesting results
await app.sessionManager.save('good_result.json');
```

### Progressive Enhancement

Start minimal, add complexity as needed:

```typescript
// Day 1: Just render something
const app = new ResearchApp(canvas, { recipes });
app.quickStart();

// Day 2: Add camera controls
app.use(new FlyControls());

// Day 3: Need parameter UI
app.use(new ParameterPanel());

// Day 7: Running experiments
app.use(new ExperimentExtension());
const exp = app.getService('experiment');
await exp.sweep(app, {
  parameter: 'material.ior',
  values: [1.3, 1.4, 1.5, 1.6, 1.7],
  samplesPerValue: 100
});

// Day 30: Production rendering
app.use(new TilingExtension());
```

Each extension adds capabilities without modifying the core. Your Day 1 code still works on Day 30.

## Integration with Other Pillars

The App orchestrates but doesn't intrude:

### With Engine
- Tells Engine which recipe to use (Engine compiles)
- Passes parameter updates (Engine maps to uniforms)
- Requests frames (Engine executes WebGL)
- Never touches GPU directly

### With World and Photography
- Specifies module names in recipes
- Never knows about module internals
- Parameters flow through store to Engine to GPU

### Data Flow
```
User Input
    ↓
ParameterStore (validates, stores)
    ↓
Engine (maps to uniforms)
    ↓
GPU (executes shaders)
    ↓
Pixels
```

The App coordinates this flow but doesn't participate in it.

## Extension Categories

Extensions naturally fall into categories based on what they add:

### Input Controllers
Manage camera and interaction:
- `FlyControls` - WASD + mouse
- `OrbitControls` - Trackball rotation
- `GamepadControls` - Controller input
- `VRControls` - Headset tracking

### UI Components
Add visual interfaces:
- `ParameterPanel` - Sliders and controls
- `ProgressBar` - Render progress
- `StatsOverlay` - Performance metrics
- `ColorPicker` - Material editing

### Workflow Tools
Enable research methods:
- `ExperimentExtension` - Parameter sweeps
- `ComparisonExtension` - A/B testing
- `ConvergenceAnalyzer` - Statistical analysis
- `BatchRenderer` - Queue multiple renders

### Import/Export
Handle data and assets:
- `ImageExporter` - PNG, EXR, JPEG
- `VideoExporter` - Animation sequences
- `SceneImporter` - Load geometry
- `HDRILoader` - Environment maps

### Production Features
Add professional capabilities:
- `TilingExtension` - Huge resolutions
- `NetworkRenderer` - Distributed rendering
- `CheckpointManager` - Resume interrupted renders
- `ColorManagement` - Color spaces

## Service Discovery Pattern

Extensions find each other through services:

```typescript
class AnimationExtension {
  install(app: ResearchApp, bus: EventEmitter) {
    app.registerService('animation', this);
    
    // Find required services
    const timeline = app.getService('timeline');
    if (!timeline) {
      console.warn('Animation: Timeline service not found');
      // Can work without it, just with reduced functionality
    }
    
    // Find optional services
    const ui = app.getService('ui');
    if (ui) {
      ui.addPanel('animation-controls', this.createControls());
    }
  }
}
```

This allows extensions to cooperate without hard dependencies.

## Error Philosophy

The App fails fast for critical errors, recovers gracefully for extensions:

```typescript
// Critical error - stop immediately
if (!engine.initialize()) {
  throw new Error('Failed to initialize Engine - cannot continue');
}

// Extension error - warn and continue
try {
  extension.install(this, this.bus);
} catch (error) {
  console.error(`Extension '${extension.name}' failed to install:`, error);
  // App continues working without that extension
}

// Parameter error - validate and warn
if (value > metadata.max) {
  console.warn(`Parameter ${path}: value ${value} exceeds max ${metadata.max}`);
  value = metadata.max;  // Clamp to valid range
}
```

## Performance Considerations

The App stays out of the hot path:

### What's Fast
- Recipe switching (pre-compiled shaders)
- Parameter updates (direct flow)
- Frame rendering (minimal orchestration overhead)
- Event dispatch (efficient emitter)

### What's Deliberately Slower
- Extension loading (startup only)
- Session save/load (file I/O)
- Service lookup (explicit indirection)

The App optimizes for research iteration speed, not framework overhead.

## The Research Philosophy

The App embodies a specific philosophy about research tools:

**Minimal Core**: Only orchestration is mandatory. Every feature is optional.

**Extension-Based Growth**: Your needs change, your tools adapt. Start simple, grow as needed.

**Explicit Over Magic**: You can trace every parameter change, every service call, every event. No hidden behavior.

**Reproducible By Design**: Every session can be saved, shared, and perfectly recreated.

**Fast Iteration**: Change parameters, see results immediately. No compilation waits during research.

The App doesn't impose a workflow - it enables yours.

## Summary

The App transforms the mathematical machinery of World and Photography pillars, orchestrated by the Engine, into a complete research environment. Through its minimal core of just four components - ParameterStore for state, ResearchApp for orchestration, RenderCoordinator for execution control, and SessionManager for persistence - it provides exactly what's needed for research and nothing more.

The extension system isn't an afterthought but the primary growth mechanism. Every UI panel, every control scheme, every analysis tool lives as an extension, keeping the core clean and stable. The service pattern prevents interface pollution while enabling sophisticated multi-extension workflows.

By requiring recipes to be defined upfront and compiled eagerly, the App eliminates runtime compilation stutters. By keeping parameter updates synchronous and using direct references for the core rendering path, it maintains predictable, debuggable behavior. By owning reset logic in the coordinator rather than the store, it separates concerns cleanly.

The result is an orchestration layer that gets out of your way during research. Write mathematics in your modules, define your apparatus in recipes, then iterate rapidly on parameters to explore the space of light transport. The App makes GPU path tracing feel like using a microscope - you focus on what you're studying, not how the instrument works.
