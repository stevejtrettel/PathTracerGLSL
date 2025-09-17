# App Architecture: Research Path Tracer

## Overview

The App is your **research command center** - orchestrating the Engine, World, and Photography pillars while managing experiments, interactions, and extensions. It's designed to start minimal and grow through extensions.

## Core Architecture

```typescript
class ResearchApp {
  // Core managers (direct references)
  private engine: Engine;
  private parameterStore: ParameterStore;
  private sessionManager: SessionManager;
  private renderCoordinator: RenderCoordinator;
  
  // Extension system
  private extensions: Map<string, Extension> = new Map();
  private bus: EventEmitter;
  
  // Current state
  private activeRecipe: RenderRecipe;
  private compiledPrograms: Map<string, CompiledProgram>;
}
```

## Architectural Principles

1. **Minimal Core**: Only orchestration essentials in core
2. **Extension-Based Growth**: Features added as plugins
3. **Hybrid Communication**: Direct refs for core flow, events for extensions
4. **Progressive Complexity**: Simple operations stay simple
5. **Session-Oriented**: Everything can be saved/restored

## Core Components

### 1. ResearchApp (Main Orchestrator)

```typescript
class ResearchApp {
  constructor(canvas: HTMLCanvasElement) {
    this.engine = new Engine(canvas);
    this.parameterStore = new ParameterStore();
    this.sessionManager = new SessionManager();
    this.renderCoordinator = new RenderCoordinator(this.engine);
    this.bus = new EventEmitter();
    
    this.setupCoreFlow();
  }
  
  private setupCoreFlow() {
    // Direct communication for core rendering flow
    this.parameterStore.onChange = (changes) => {
      // Update engine uniforms
      this.engine.updateUniforms(changes);
      
      // Let RenderCoordinator handle reset decisions
      for (const change of changes.changes) {
        this.renderCoordinator.handleParameterChange(
          change.path,
          change.oldValue,
          change.newValue
        );
      }
    };
  }
  
  // Simple starting point
  async quickStart(world: World, photography: Photography) {
    const recipe = this.createRecipe(world, photography);
    await this.engine.compile(recipe);
    this.renderCoordinator.start();
  }
  
  // Extension system
  use(extension: Extension) {
    extension.install(this, this.bus);
    this.extensions.set(extension.name, extension);
    return this;
  }
}
```

### 2. ParameterStore (Central State)

```typescript
class ParameterStore {
  private parameters: Map<string, any> = new Map();
  private metadata: Map<string, ParameterMetadata> = new Map();
  onChange: (changes: ParameterChanges) => void;
  
  // Flexible parameter setting
  set(path: string, value: any) {
    // path like "material.glass.ior" or "camera.position"
    const old = this.get(path);
    this.parameters.set(path, value);
    
    this.onChange?.({
      changes: [{
        path,
        oldValue: old,
        newValue: value,
        metadata: this.metadata.get(path)
      }]
    });
  }
  
  // Batch updates
  batch(updates: Record<string, any>) {
    const changes: ParameterChanges = { changes: [] };
    for (const [path, value] of Object.entries(updates)) {
      const old = this.get(path);
      this.parameters.set(path, value);
      changes.changes.push({ 
        path, 
        oldValue: old, 
        newValue: value,
        metadata: this.metadata.get(path)
      });
    }
    this.onChange?.(changes);
  }
}
```

### 3. RenderCoordinator (Execution Control)

```typescript
class RenderCoordinator {
  private mode: 'interactive' | 'progressive' | 'production' = 'progressive';
  private accumulator: Accumulator;
  private tileManager?: TileManager;
  
  // Reset triggers - owns accumulation reset decisions
  private resetTriggers = new Set(['camera.*', 'material.*', 'scene.*', 'lights.*']);
  private noResetParameters = new Set(['developer.*', 'ui.*', 'debug.*']);
  
  constructor(private engine: Engine) {
    this.accumulator = new Accumulator();
  }
  
  handleParameterChange(path: string, oldValue: any, newValue: any) {
    if (this.shouldResetForParameter(path)) {
      this.resetAccumulation();
    }
  }
  
  private shouldResetForParameter(path: string): boolean {
    // Check no-reset list first
    for (const pattern of this.noResetParameters) {
      if (path.startsWith(pattern.replace('*', ''))) return false;
    }
    // Check reset triggers
    for (const pattern of this.resetTriggers) {
      if (path.startsWith(pattern.replace('*', ''))) return true;
    }
    return true; // Default: reset to be safe
  }
  
  start() {
    switch (this.mode) {
      case 'interactive':
        this.runInteractive();  // 60fps, no accumulation
        break;
      case 'progressive':
        this.runProgressive();  // Accumulate until stopped
        break;
      case 'production':
        this.runProduction();   // Tiles, checkpoints
        break;
    }
  }
  
  private async runProgressive() {
    while (this.accumulator.isActive) {
      await this.engine.renderFrame();
      this.accumulator.increment();
      
      // Emit progress events
      if (this.accumulator.count % 10 === 0) {
        this.onProgress?.(this.accumulator.count);
      }
    }
  }
  
  resetAccumulation() {
    this.accumulator.reset();
    this.engine.clearFilm();
  }
}
```

### 4. SessionManager (Save/Load)

```typescript
class SessionManager {
  async saveSession(filepath: string): Promise<void> {
    const session = {
      version: "1.0.0",
      timestamp: Date.now(),
      recipe: this.app.activeRecipe,
      parameters: this.app.parameterStore.getAll(),
      camera: this.app.extensions.get('input')?.getCamera(),
      // Everything needed to reproduce exact state
    };
    
    await this.writeFile(filepath, JSON.stringify(session, null, 2));
  }
  
  async loadSession(filepath: string): Promise<void> {
    const session = JSON.parse(await this.readFile(filepath));
    
    // Restore everything
    await this.app.setRecipe(session.recipe);
    this.app.parameterStore.restore(session.parameters);
    this.app.extensions.get('input')?.setCamera(session.camera);
  }
}
```

## Extension System

Extensions add features without cluttering the core:

### Extension Interface

```typescript
interface Extension {
  name: string;
  install(app: ResearchApp, bus: EventEmitter): void;
  uninstall?(): void;
}
```

### Core Extensions

#### Input Extension (Camera Controls)
```typescript
class InputExtension implements Extension {
  name = 'input';
  private mode: 'fly' | 'orbit' | 'locked' = 'fly';
  
  install(app: ResearchApp, bus: EventEmitter) {
    // WASD + mouse for fly mode
    document.addEventListener('keydown', this.handleKey);
    canvas.addEventListener('mousemove', this.handleMouse);
    
    // Update parameters directly
    this.onCameraMove = (delta) => {
      app.parameterStore.batch({
        'camera.position': this.position,
        'camera.rotation': this.rotation
      });
    };
    
    // Emit events for other extensions
    bus.emit('camera.updated', this.getCamera());
  }
  
  switchMode(mode: 'fly' | 'orbit' | 'locked') {
    this.mode = mode;
    // Reconfigure handlers
  }
}
```

#### UI Extension (Panels and Controls)
```typescript
class UIExtension implements Extension {
  name = 'ui';
  private panels: Map<string, Panel> = new Map();
  
  install(app: ResearchApp, bus: EventEmitter) {
    // Create parameter panel
    this.addPanel('parameters', new ParameterPanel(app.parameterStore));
    
    // Listen for events
    bus.on('render.progress', (count) => {
      this.panels.get('progress')?.update(count);
    });
    
    // Add keyboard shortcuts
    this.registerShortcuts({
      'Ctrl+S': () => app.saveImage(),
      'Space': () => app.toggleRendering(),
      'R': () => app.resetAccumulation()
    });
  }
}
```

#### Performance Extension
```typescript
class PerformanceExtension implements Extension {
  name = 'performance';
  private stats: Stats = {};
  
  install(app: ResearchApp, bus: EventEmitter) {
    // Track metrics
    bus.on('frame.complete', (timing) => {
      this.stats.fps = 1000 / timing.delta;
      this.stats.samplesPerSecond = timing.samples / timing.delta * 1000;
    });
    
    // Optional overlay
    if (this.config.overlay) {
      this.createOverlay();
    }
  }
}
```

#### Experiment Extension
```typescript
class ExperimentExtension implements Extension {
  name = 'experiment';
  
  install(app: ResearchApp, bus: EventEmitter) {
    // Add experiment methods to app
    app.sweep = async (config: SweepConfig) => {
      const results = [];
      for (const value of config.values) {
        app.parameterStore.set(config.parameter, value);
        await app.renderToConvergence(config.samplesPerValue);
        results.push({
          value,
          image: await app.captureImage(),
          metrics: this.computeMetrics()
        });
      }
      return results;
    };
    
    app.compare = async (configs: CompareConfig[]) => {
      // Side-by-side comparison logic
    };
  }
}
```

## Workflows

### 1. Simple Exploration
```typescript
const app = new ResearchApp(canvas);

// Minimal setup
app.quickStart(
  new SimpleWorld(),
  new BasicPhotography()
);

// Just fly around and render
app.use(new InputExtension());
```

### 2. Research Session
```typescript
const app = new ResearchApp(canvas);

// Add all the tools
app
  .use(new InputExtension())
  .use(new UIExtension())
  .use(new PerformanceExtension())
  .use(new ExperimentExtension());

// Load previous work
await app.loadSession('yesterday.json');

// Continue research
app.renderCoordinator.setMode('progressive');
app.start();
```

### 3. Production Render
```typescript
const app = new ResearchApp(canvas);

// Configure for production
await app.loadSession('final_shot.json');

app.renderCoordinator.setMode('production');
app.renderCoordinator.configureTiles({
  resolution: [4096, 4096],
  tileSize: 512,
  samplesPerTile: 1000
});

// Start overnight render
await app.renderProduction('output/final.exr');
```

### 4. Parameter Study
```typescript
const app = new ResearchApp(canvas);
app.use(new ExperimentExtension());

// Sweep roughness values
const results = await app.sweep({
  parameter: 'material.marble.roughness',
  values: [0.1, 0.2, 0.3, 0.4, 0.5],
  samplesPerValue: 100
});

// Save comparison grid
await app.saveComparisonGrid(results, 'roughness_study.png');
```

## Communication Patterns

### Core Flow (Direct)
```
ParameterStore ──onChange──> Engine.updateUniforms()
                          └─> RenderCoordinator.resetAccumulation()

RenderCoordinator ──render──> Engine.renderFrame()
                          └─> Accumulator.increment()
```

### Extension Flow (Events)
```
InputExtension ──emit('camera.updated')──> UIExtension
                                        └─> PerformanceExtension

RenderCoordinator ──emit('frame.complete')──> PerformanceExtension
                                           └─> UIExtension
                                           └─> ExperimentExtension
```

## File Structure

```
app/
├── core/
│   ├── ResearchApp.ts        # Main orchestrator
│   ├── ParameterStore.ts     # Central state
│   ├── RenderCoordinator.ts  # Execution control
│   └── SessionManager.ts     # Save/load
│
├── extensions/
│   ├── core/                 # Always-useful extensions
│   │   ├── InputExtension.ts
│   │   ├── UIExtension.ts
│   │   └── PerformanceExtension.ts
│   │
│   ├── research/             # Research-specific
│   │   ├── ExperimentExtension.ts
│   │   ├── ComparisonExtension.ts
│   │   └── ValidationExtension.ts
│   │
│   └── production/          # Production tools
│       ├── TilingExtension.ts
│       ├── AnimationExtension.ts
│       └── BatchRenderExtension.ts
│
├── types/
│   ├── Extension.ts         # Extension interface
│   ├── Recipe.ts           # Render recipe types
│   └── Parameters.ts       # Parameter types
│
└── utils/
    ├── EventEmitter.ts     # Simple event bus
    └── FileIO.ts          # Save/load utilities
```

## Progressive Enhancement

Start simple, add complexity as needed:

### Phase 1: Minimal
```typescript
const app = new ResearchApp(canvas);
app.quickStart(world, photography);  // That's it!
```

### Phase 2: Interactive
```typescript
app.use(new InputExtension());  // Add camera controls
app.use(new UIExtension());     // Add parameter UI
```

### Phase 3: Research
```typescript
app.use(new ExperimentExtension());  // Parameter sweeps
app.use(new PerformanceExtension()); // Track metrics
```

### Phase 4: Production
```typescript
app.use(new TilingExtension());      // High-res renders
app.use(new AnimationExtension());   // Sequences
```

## Key Benefits

1. **Clean Core**: Core stays simple and stable
2. **Flexible Growth**: Add features without modifying core
3. **Clear Communication**: Direct for core, events for extensions
4. **Research-Friendly**: Start simple, grow as needed
5. **Session-Based**: Everything saveable/restorable
6. **Type-Light**: No fighting with TypeScript
7. **Extensible**: New workflows via new extensions

## Summary

This architecture gives you a minimal, stable core that orchestrates your mathematical modules, with all additional features added as extensions. The hybrid communication pattern keeps the core flow simple while allowing extensions to cooperate through events. Start with just `quickStart()` and add extensions as your research needs grow.
