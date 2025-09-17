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
  private extensions = new Map<string, Extension>();
  private services = new Map<string, any>();  // Services provided by extensions
  private bus: EventEmitter;
  
  // Current state
  private recipes: Record<string, Recipe>;
  private activeRecipeName: string;
}
```

## Architectural Principles

1. **Minimal Core**: Only orchestration essentials in core
2. **Extension-Based Growth**: Features added as plugins
3. **Hybrid Communication**: Direct refs for core flow, events for extensions
4. **Progressive Complexity**: Simple operations stay simple
5. **Session-Oriented**: Everything can be saved/restored
6. **Known Configurations**: Define your 2-3 recipes upfront

## Core Components

### 1. ResearchApp (Main Orchestrator)

```typescript
class ResearchApp {
  constructor(canvas: HTMLCanvasElement) {
    // Define your known configurations
    this.recipes = {
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
        world: { 
          geometry: 'euclidean', 
          material: 'debug', 
          scene: 'sdf', 
          lights: 'point' 
        },
        photography: { 
          camera: 'pinhole', 
          estimator: 'direct', 
          film: 'simple', 
          developer: 'linear' 
        }
      }
    };
    
    this.engine = new Engine(canvas);
    // Compile all known recipes at startup
    this.engine.initializeShaders(Object.values(this.recipes));
    
    this.parameterStore = new ParameterStore();
    this.sessionManager = new SessionManager(this);
    this.renderCoordinator = new RenderCoordinator(this.engine);
    this.bus = new EventEmitter();
    
    this.setupCoreFlow();
  }
  
  private setupCoreFlow() {
    // Direct communication for core rendering flow
    this.parameterStore.onChange = (changes) => {
      // Update engine uniforms (batched)
      this.engine.updateUniforms(changes);
      
      // Check if any change requires reset
      const needsReset = changes.changes.some(c => 
        this.renderCoordinator.shouldResetForParameter(c.path)
      );
      
      if (needsReset) {
        this.renderCoordinator.resetAccumulation();
      }
    };
  }
  
  // Simple recipe switching (no async needed)
  switchRecipe(name: string) {
    if (!this.recipes[name]) {
      throw new Error(`Unknown recipe: ${name}`);
    }
    
    this.activeRecipeName = name;
    this.engine.selectRecipe(this.recipes[name]);
    this.renderCoordinator.resetAccumulation();
    this.bus.emit('recipe.switched', name);
  }
  
  // Simple starting point
  quickStart(recipeName: string = 'pathtracer') {
    this.switchRecipe(recipeName);
    this.renderCoordinator.start();
  }
  
  // Extension system
  use(extension: Extension) {
    extension.install(this, this.bus);
    this.extensions.set(extension.name, extension);
    return this;
  }
  
  // Service registry for extensions (avoids interface pollution)
  registerService(name: string, service: any) {
    this.services.set(name, service);
  }
  
  getService(name: string) {
    return this.services.get(name);
  }
}
```

### 2. ParameterStore (Central State)

```typescript
class ParameterStore {
  private parameters = new Map<string, any>();
  private metadata = new Map<string, ParameterMetadata>();
  onChange: (changes: ParameterChanges) => void;
  
  // Single parameter update
  set(path: string, value: any) {
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
  
  get(path: string): any {
    return this.parameters.get(path);
  }
  
  getAll(): Record<string, any> {
    return Object.fromEntries(this.parameters);
  }
  
  restore(params: Record<string, any>) {
    for (const [path, value] of Object.entries(params)) {
      this.parameters.set(path, value);
    }
  }
}
```

### 3. RenderCoordinator (Execution Control)

```typescript
class RenderCoordinator {
  private mode: 'interactive' | 'progressive' | 'production' = 'progressive';
  private accumulator: Accumulator;
  private animationId?: number;
  
  // Reset triggers - using direct prefixes (no wildcards)
  private resetPrefixes = new Set(['camera.', 'material.', 'scene.', 'lights.']);
  private noResetPrefixes = new Set(['developer.', 'ui.', 'debug.']);
  
  constructor(private engine: Engine) {
    this.accumulator = new Accumulator();
  }
  
  shouldResetForParameter(path: string): boolean {
    // Check no-reset first (higher priority)
    for (const prefix of this.noResetPrefixes) {
      if (path.startsWith(prefix)) return false;
    }
    
    // Check reset triggers
    for (const prefix of this.resetPrefixes) {
      if (path.startsWith(prefix)) return true;
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
  
  stop() {
    this.accumulator.isActive = false;
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
      this.animationId = undefined;
    }
  }
  
  private runProgressive() {
    this.accumulator.isActive = true;
    
    const frame = () => {
      if (!this.accumulator.isActive) return;
      
      this.engine.renderFrame();
      this.accumulator.increment();
      
      // Emit progress events
      if (this.accumulator.count % 10 === 0) {
        this.onProgress?.(this.accumulator.count);
      }
      
      this.animationId = requestAnimationFrame(frame);
    };
    
    this.animationId = requestAnimationFrame(frame);
  }
  
  private runInteractive() {
    this.accumulator.isActive = false;  // No accumulation
    
    const frame = () => {
      if (this.mode !== 'interactive') return;
      
      this.engine.renderFrame();
      this.animationId = requestAnimationFrame(frame);
    };
    
    this.animationId = requestAnimationFrame(frame);
  }
  
  resetAccumulation() {
    this.accumulator.reset();
    this.engine.clearFilm();
  }
  
  setMode(mode: 'interactive' | 'progressive' | 'production') {
    this.stop();
    this.mode = mode;
  }
}

class Accumulator {
  count: number = 0;
  isActive: boolean = false;
  
  increment() {
    this.count++;
  }
  
  reset() {
    this.count = 0;
  }
}
```

### 4. SessionManager (Save/Load)

```typescript
class SessionManager {
  constructor(private app: ResearchApp) {}
  
  async saveSession(filepath: string): Promise<void> {
    const session = {
      version: "1.0.0",
      timestamp: Date.now(),
      recipeName: this.app.activeRecipeName,
      parameters: this.app.parameterStore.getAll(),
      camera: this.app.getService('input')?.getCamera(),
      // Everything needed to reproduce exact state
    };
    
    await this.writeFile(filepath, JSON.stringify(session, null, 2));
  }
  
  async loadSession(filepath: string): Promise<void> {
    const session = JSON.parse(await this.readFile(filepath));
    
    // Restore everything
    this.app.switchRecipe(session.recipeName);
    this.app.parameterStore.restore(session.parameters);
    this.app.getService('input')?.setCamera(session.camera);
  }
  
  private async writeFile(path: string, content: string) {
    // Implementation depends on environment
    // Browser: Use download
    // Node: Use fs.writeFile
  }
  
  private async readFile(path: string): Promise<string> {
    // Implementation depends on environment
    // Browser: Use file input
    // Node: Use fs.readFile
    return "";
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
  private position = [0, 0, 5];
  private rotation = [0, 0];
  
  install(app: ResearchApp, bus: EventEmitter) {
    // Register as a service
    app.registerService('input', this);
    
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
  
  getCamera() {
    return { position: this.position, rotation: this.rotation };
  }
  
  setCamera(camera: any) {
    this.position = camera.position;
    this.rotation = camera.rotation;
  }
  
  private handleKey = (e: KeyboardEvent) => {
    // WASD movement
  }
  
  private handleMouse = (e: MouseEvent) => {
    // Look around
  }
}
```

#### UI Extension (Panels and Controls)
```typescript
class UIExtension implements Extension {
  name = 'ui';
  private panels = new Map<string, Panel>();
  
  install(app: ResearchApp, bus: EventEmitter) {
    // Register as a service
    app.registerService('ui', this);
    
    // Create parameter panel
    this.addPanel('parameters', new ParameterPanel(app.parameterStore));
    
    // Listen for events
    bus.on('render.progress', (count) => {
      this.panels.get('progress')?.update(count);
    });
    
    // Add keyboard shortcuts
    this.registerShortcuts({
      'Ctrl+S': () => this.saveImage(app),
      'Space': () => app.renderCoordinator.stop(),
      'R': () => app.renderCoordinator.resetAccumulation()
    });
  }
  
  private saveImage(app: ResearchApp) {
    // Use app reference to access engine
    const pixels = app.engine.readPixelsAsync();
    // ... save logic
  }
  
  private addPanel(name: string, panel: Panel) {
    this.panels.set(name, panel);
  }
  
  private registerShortcuts(shortcuts: Record<string, () => void>) {
    // Keyboard handler
  }
}
```

#### Performance Extension
```typescript
class PerformanceExtension implements Extension {
  name = 'performance';
  private stats = {
    fps: 0,
    samplesPerSecond: 0,
    frameTime: 0
  };
  
  install(app: ResearchApp, bus: EventEmitter) {
    // Register as a service
    app.registerService('performance', this);
    
    // Track metrics
    bus.on('frame.complete', (timing) => {
      this.stats.fps = 1000 / timing.delta;
      this.stats.samplesPerSecond = timing.samples / timing.delta * 1000;
    });
    
    // Optional overlay
    if (this.config?.overlay) {
      this.createOverlay();
    }
  }
  
  getStats() {
    return { ...this.stats };
  }
  
  private createOverlay() {
    // Create DOM overlay with stats
  }
}
```

#### Experiment Extension
```typescript
class ExperimentExtension implements Extension {
  name = 'experiment';
  
  install(app: ResearchApp, bus: EventEmitter) {
    // Register as a service (NOT polluting app interface)
    app.registerService('experiment', this);
  }
  
  // Methods on the extension itself
  async sweep(app: ResearchApp, config: SweepConfig) {
    const results = [];
    
    for (const value of config.values) {
      app.parameterStore.set(config.parameter, value);
      await this.renderToConvergence(app, config.samplesPerValue);
      
      results.push({
        value,
        image: await app.engine.readPixelsAsync(),
        metrics: this.computeMetrics(app)
      });
    }
    
    return results;
  }
  
  async compare(app: ResearchApp, configs: CompareConfig[]) {
    // Side-by-side comparison logic
    const results = [];
    
    for (const config of configs) {
      app.switchRecipe(config.recipe);
      app.parameterStore.batch(config.parameters);
      await this.renderToConvergence(app, config.samples);
      results.push(await app.engine.readPixelsAsync());
    }
    
    return results;
  }
  
  private async renderToConvergence(app: ResearchApp, samples: number) {
    return new Promise<void>(resolve => {
      app.renderCoordinator.resetAccumulation();
      app.renderCoordinator.start();
      
      const checkConvergence = () => {
        if (app.renderCoordinator.accumulator.count >= samples) {
          app.renderCoordinator.stop();
          resolve();
        } else {
          setTimeout(checkConvergence, 100);
        }
      };
      
      checkConvergence();
    });
  }
  
  private computeMetrics(app: ResearchApp) {
    const perf = app.getService('performance') as PerformanceExtension;
    return perf?.getStats() || {};
  }
}
```

## Workflows

### 1. Simple Exploration
```typescript
const app = new ResearchApp(canvas);

// Start with default pathtracer
app.quickStart();

// Add camera controls
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
await app.sessionManager.loadSession('yesterday.json');

// Continue research
app.renderCoordinator.setMode('progressive');
app.renderCoordinator.start();
```

### 3. Production Render
```typescript
const app = new ResearchApp(canvas);

// Load saved session
await app.sessionManager.loadSession('final_shot.json');

// Switch to production mode
app.renderCoordinator.setMode('production');

// Get production service (if extension loaded)
const prod = app.getService('production');
await prod?.renderHighRes({
  resolution: [4096, 4096],
  tileSize: 512,
  samplesPerTile: 1000
});
```

### 4. Parameter Study
```typescript
const app = new ResearchApp(canvas);
app.use(new ExperimentExtension());

// Get experiment service
const experiment = app.getService('experiment') as ExperimentExtension;

// Sweep roughness values
const results = await experiment.sweep(app, {
  parameter: 'material.roughness',
  values: [0.1, 0.2, 0.3, 0.4, 0.5],
  samplesPerValue: 100
});

// Save comparison grid
await experiment.saveComparisonGrid(results, 'roughness_study.png');
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
app.quickStart();  // That's it!
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
2. **Known Configurations**: 2-3 recipes defined upfront, no dynamic creation
3. **Service Pattern**: Extensions provide services, don't pollute app interface
4. **No Unnecessary Async**: Everything synchronous that can be
5. **Clear Ownership**: Engine owns programs, App owns recipes
6. **Simple Reset Logic**: Direct prefix checking, no wildcards
7. **Proper Dependencies**: Components get references they need

## Summary

This architecture gives you a minimal, stable core that orchestrates your mathematical modules, with all additional features added as extensions. The service pattern keeps extensions from polluting the app interface, and the known recipe approach eliminates unnecessary dynamic configuration. Start with just `quickStart()` and add extensions as your research needs grow.
