# Extension System Contract

## Purpose

The Extension System enables unlimited feature growth without modifying the core. Extensions add capabilities through a service registry pattern, keeping the app interface minimal. All features beyond pure orchestration - camera controls, UI, experiments, exports - live as extensions.

## Required Interface

```typescript
interface Extension {
  name: string;                     // Unique identifier
  version?: string;                 // Extension version
  dependencies?: string[];          // Required extensions
  
  install(app: ResearchApp, bus: EventBus): void;
  uninstall?(): void;
  
  // Optional: state persistence
  saveState?(): any;
  restoreState?(state: any): void;
}

interface EventBus {
  on(event: string, handler: Function): void;
  off(event: string, handler: Function): void;
  once(event: string, handler: Function): void;
  emit(event: string, data?: any): void;
}
```

## Service Registry Pattern

Extensions register themselves as services rather than adding methods to the app:

```typescript
// GOOD: Service pattern
class ScreenshotExtension implements Extension {
  name = 'screenshot';
  
  install(app: ResearchApp, bus: EventBus) {
    // Register as service
    app.registerService('screenshot', this);
  }
  
  // Method stays on extension
  takeScreenshot(): Promise<void> {
    const pixels = await this.app.engine.readPixelsAsync();
    return this.saveImage(pixels);
  }
}

// Usage
const screenshot = app.getService('screenshot');
await screenshot?.takeScreenshot();

// BAD: Polluting app interface
install(app) {
  app.takeScreenshot = () => { /* ... */ };  // Don't do this!
}
```

## Installation Process

```typescript
class ResearchApp {
  use(extension: Extension): ResearchApp {
    // 1. Check dependencies
    for (const dep of extension.dependencies || []) {
      if (!this.extensions.has(dep)) {
        throw new Error(
          `Extension '${extension.name}' requires '${dep}' to be installed first`
        );
      }
    }
    
    // 2. Install extension
    try {
      extension.install(this, this.bus);
      this.extensions.set(extension.name, extension);
      
      // 3. Emit installation event
      this.bus.emit('extension.installed', { name: extension.name });
      
    } catch (error) {
      console.error(`Failed to install extension '${extension.name}':`, error);
      throw error;
    }
    
    return this; // For chaining
  }
}
```

## Extension Communication

### Direct Access (Core Components)
Extensions can directly access app components:

```typescript
install(app: ResearchApp, bus: EventBus) {
  // Direct access to core
  app.parameterStore.set('camera.fov', 60);
  app.renderCoordinator.setMode('progressive');
  app.engine.readPixelsAsync();
}
```

### Service Access (Other Extensions)
Extensions find each other through services:

```typescript
install(app: ResearchApp, bus: EventBus) {
  // Find another extension's service
  const ui = app.getService('ui');
  if (ui) {
    ui.addPanel('my-panel', this.createPanel());
  }
}
```

### Event Communication (Loose Coupling)
Extensions communicate through events:

```typescript
install(app: ResearchApp, bus: EventBus) {
  // Listen to events
  bus.on('render.progress', this.handleProgress);
  bus.on('camera.moved', this.handleCamera);
  
  // Emit events
  bus.emit('experiment.started', { type: 'sweep' });
}

uninstall() {
  // Clean up listeners
  bus.off('render.progress', this.handleProgress);
  bus.off('camera.moved', this.handleCamera);
}
```

## State Persistence

Extensions can save/restore state for sessions:

```typescript
class CameraExtension implements Extension {
  name = 'camera';
  private position = [0, 0, 5];
  private mode = 'orbit';
  
  saveState(): any {
    return {
      position: this.position,
      mode: this.mode
    };
  }
  
  restoreState(state: any): void {
    this.position = state.position || [0, 0, 5];
    this.mode = state.mode || 'orbit';
    this.updateCamera();
  }
}
```

## Extension Examples

### Basic Input Extension
```typescript
class KeyboardInput implements Extension {
  name = 'keyboard';
  
  install(app: ResearchApp, bus: EventBus) {
    app.registerService('keyboard', this);
    
    document.addEventListener('keydown', (e) => {
      if (e.key === 'r') {
        app.renderCoordinator.resetAccumulation();
      }
      if (e.key === ' ') {
        app.renderCoordinator.isRunning() 
          ? app.renderCoordinator.stop()
          : app.renderCoordinator.start();
      }
    });
  }
}
```

### UI Panel Extension
```typescript
class StatsPanel implements Extension {
  name = 'stats';
  dependencies = ['ui'];  // Requires UI extension
  
  private panel: HTMLElement;
  
  install(app: ResearchApp, bus: EventBus) {
    app.registerService('stats', this);
    
    // Create panel
    this.panel = this.createPanel();
    
    // Add to UI (dependency guaranteed to exist)
    const ui = app.getService('ui')!;
    ui.addPanel('stats', this.panel);
    
    // Update on progress
    bus.on('render.progress', (info) => {
      this.updateStats(info);
    });
  }
  
  private updateStats(info: ProgressInfo) {
    this.panel.textContent = `Samples: ${info.samples}`;
  }
}
```

### Research Tool Extension
```typescript
class ParameterSweep implements Extension {
  name = 'sweep';
  
  install(app: ResearchApp, bus: EventBus) {
    app.registerService('sweep', this);
  }
  
  // Public API on the service
  async sweep(app: ResearchApp, config: {
    parameter: string,
    values: any[],
    samplesPerValue: number
  }): Promise<any[]> {
    const results = [];
    
    for (const value of config.values) {
      app.parameterStore.set(config.parameter, value);
      app.renderCoordinator.resetAccumulation();
      
      // Wait for samples
      await this.waitForSamples(app, config.samplesPerValue);
      
      results.push({
        value,
        image: await app.engine.readPixelsAsync()
      });
    }
    
    return results;
  }
}
```

## Standard Events

Common events extensions can listen to/emit:

```typescript
// Core events (emitted by app)
'recipe.switched'        // Recipe changed
'parameter.changed'      // Parameter updated
'render.progress'        // Render progress
'extension.installed'    // Extension added

// Extension events (conventions)
'camera.moved'          // Camera position changed
'screenshot.taken'      // Screenshot captured
'experiment.complete'   // Sweep/comparison done
'ui.panel.created'      // UI panel added
```

## Usage Pattern

```typescript
const app = new ResearchApp(canvas, config);

// Add extensions in dependency order
app.use(new UIExtension())        // Base UI
   .use(new KeyboardInput())       // Input handling
   .use(new StatsPanel())          // Depends on UI
   .use(new ParameterSweep());     // Research tools

// Access services explicitly
const sweep = app.getService('sweep');
if (sweep) {
  const results = await sweep.sweep(app, {
    parameter: 'material.roughness',
    values: [0.1, 0.3, 0.5, 0.7, 0.9],
    samplesPerValue: 100
  });
}
```

## Key Principles

1. **Services over methods** - Don't add to app interface
2. **Explicit dependencies** - Declare required extensions
3. **Clean uninstall** - Remove all listeners and DOM
4. **Graceful degradation** - Handle missing services
5. **State persistence** - Support session save/restore

## What Extensions CAN Do

- Access all core components (engine, parameterStore, etc.)
- Register as services for other extensions
- Listen to and emit events
- Create UI elements
- Add keyboard/mouse handlers
- Save/restore their state

## What Extensions CANNOT Do

- Modify core rendering pipeline
- Replace core components
- Access other extensions directly (use services)
- Block the render loop
- Prevent other extensions from loading

## Invariants

1. Extensions installed in dependency order
2. Service names are unique
3. Extension names are unique
4. Uninstall removes all traces
5. State persistence is optional
6. Missing services handled gracefully

## Integration

```
Extension.install()
    ├→ app.registerService()      // Register self
    ├→ app.getService()           // Find dependencies
    ├→ bus.on()                   // Listen to events
    └→ app.parameterStore.set()   // Modify state

Extension.saveState()              // For sessions
    └→ return state object

Extension.restoreState(state)      // From sessions
    └→ apply saved state
```

The extension system enables infinite growth while keeping the core minimal and stable.
