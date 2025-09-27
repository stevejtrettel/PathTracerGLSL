# Extension Contract

Extensions add optional functionality to the App without modifying core orchestration. They use the service pattern to avoid polluting the app interface.

## Required Interface

All extensions must implement:

```typescript
interface Extension {
  name: string;  // Unique identifier
  dependencies?: string[];  // Other extensions this one requires
  install(app: ResearchApp, bus: EventEmitter): void;
  uninstall?(): void;  // Optional cleanup
}
```

## Installation Process

When `app.use(extension)` is called:
1. Extension dependencies are checked
2. Extension's `install()` method is invoked with app reference and event bus
3. Extension is stored in app's extension map by name
4. Extension registers itself as a service (NOT adding methods to app)

```typescript
class ResearchApp {
  use(extension: Extension) {
    // Check dependencies first
    for (const dep of extension.dependencies || []) {
      if (!this.extensions.has(dep)) {
        throw new Error(
          `Extension '${extension.name}' requires '${dep}' to be installed first`
        );
      }
    }
    
    // Install the extension
    extension.install(this, this.bus);
    this.extensions.set(extension.name, extension);
    return this; // For chaining
  }
}
```

## Service Pattern (NEW)

Extensions should register themselves as services instead of adding methods to the app:

```typescript
class ExperimentExtension implements Extension {
  name = 'experiment';
  
  install(app: ResearchApp, bus: EventEmitter) {
    // Register as a service - DON'T pollute app interface
    app.registerService('experiment', this);
  }
  
  // Methods stay on the extension
  async sweep(app: ResearchApp, config: SweepConfig) {
    // Implementation uses app reference
  }
}

// Usage - get service first
const experiment = app.getService('experiment') as ExperimentExtension;
await experiment.sweep(app, config);
```

## What Extensions Can Do

Within `install()`, extensions have access to:
- **App instance**: Access core components and services
- **Service registry**: Register themselves as services
- **Parameter store**: Read/write parameters
- **Event bus**: Emit and listen to events
- **DOM**: Create UI elements
- **Browser APIs**: Storage, files, etc.

## What Extensions Should NOT Do

Extensions should not:
- Add methods directly to app (use services instead)
- Modify core rendering pipeline (that's Engine's job)
- Replace core components (ParameterStore, RenderCoordinator)
- Block the render loop
- Assume other extensions are present (unless documented dependency)

## Communication

### With Core
Extensions can directly access app methods:
```typescript
install(app: ResearchApp) {
  // Direct access to core
  app.parameterStore.set('camera.position', [0, 0, 5]);
  app.renderCoordinator.resetAccumulation();
}
```

### With Other Extensions
Extensions communicate via events or services:
```typescript
install(app: ResearchApp, bus: EventEmitter) {
  // Via events
  bus.emit('camera.moved', { position, rotation });
  bus.on('render.complete', this.handleComplete);
  
  // Via services
  const ui = app.getService('ui') as UIExtension;
  ui?.addPanel('my-panel', this.panel);
}
```

## Lifecycle

### Installation
```typescript
install(app: ResearchApp, bus: EventEmitter) {
  // Register as service
  app.registerService(this.name, this);
  
  // Set up event listeners
  bus.on('render.progress', this.handleProgress);
  document.addEventListener('keydown', this.handleKey);
  
  // Add DOM elements if needed
  this.createUI();
  
  // Store references
  this.app = app;
  this.bus = bus;
}
```

### Uninstallation
```typescript
uninstall() {
  // Remove event listeners
  this.bus.off('render.progress', this.handleProgress);
  document.removeEventListener('keydown', this.handleKey);
  
  // Clean up DOM
  this.removeUI();
  
  // Clear references
  this.app = null;
  this.bus = null;
  
  // Note: App handles removing from service registry
}
```

## Standard Events

Extensions can listen to/emit these standard events:

### Core Events
- `recipe.switched` - Active recipe changed (data: recipe name)
- `render.start` - Rendering began
- `render.progress` - Sample completed (data: sample count)
- `render.complete` - Rendering stopped
- `accumulation.reset` - Film cleared
- `parameter.changed` - Parameter updated (data: path, value)

### Extension Events
- `camera.moved` - Camera position/rotation changed
- `experiment.complete` - Sweep/comparison finished
- `screenshot.taken` - Image captured
- `session.loaded` - Session restored

## Extension Categories

### Input Controllers
Manage camera and user input:
```typescript
class KeyboardExtension implements Extension {
  name = 'keyboard';
  
  install(app: ResearchApp, bus: EventEmitter) {
    app.registerService('keyboard', this);
    
    document.addEventListener('keydown', (e) => {
      if (e.key === 'w') this.moveForward(app);
      // etc.
    });
  }
  
  private moveForward(app: ResearchApp) {
    const pos = app.parameterStore.get('camera.position');
    pos[2] -= 0.1;
    app.parameterStore.set('camera.position', pos);
  }
}
```

### UI Components
Add interface panels:
```typescript
class ParameterPanel implements Extension {
  name = 'parameters';
  private panel: HTMLElement;
  
  install(app: ResearchApp, bus: EventEmitter) {
    app.registerService('parameters', this);
    
    this.createPanel();
    bus.on('parameter.changed', this.updateUI);
  }
  
  private createPanel() {
    this.panel = document.createElement('div');
    // Build UI
  }
  
  private updateUI = (change: any) => {
    // Update panel display
  }
}
```

### Workflow Tools
Add research methods (using service pattern):
```typescript
class ExperimentExtension implements Extension {
  name = 'experiments';
  
  install(app: ResearchApp, bus: EventEmitter) {
    app.registerService('experiments', this);
  }
  
  // Method on extension, not app
  async sweep(app: ResearchApp, config: SweepConfig) {
    const results = [];
    
    for (const value of config.values) {
      app.parameterStore.set(config.parameter, value);
      await this.renderSamples(app, config.samplesPerValue);
      
      results.push({
        value,
        image: await app.engine.readPixelsAsync()
      });
    }
    
    return results;
  }
  
  private renderSamples(app: ResearchApp, samples: number): Promise<void> {
    return new Promise(resolve => {
      app.renderCoordinator.resetAccumulation();
      app.renderCoordinator.start();
      
      const check = setInterval(() => {
        if (app.renderCoordinator.accumulator.count >= samples) {
          app.renderCoordinator.stop();
          clearInterval(check);
          resolve();
        }
      }, 100);
    });
  }
}
```

## Example: Full Extension with Service Pattern

```typescript
class ScreenshotExtension implements Extension {
  name = 'screenshot';
  dependencies = ['ui'];  // Requires UI extension for button
  private app: ResearchApp;
  private shortcutHandler: (e: KeyboardEvent) => void;
  
  install(app: ResearchApp, bus: EventEmitter) {
    this.app = app;
    
    // Register as service
    app.registerService('screenshot', this);
    
    // Can safely access UI service since dependency is checked
    const ui = app.getService('ui') as UIExtension;
    ui?.addButton('Screenshot', () => this.takeScreenshot());
    
    // Listen to keyboard
    this.shortcutHandler = (e) => {
      if (e.key === 's' && e.ctrlKey) {
        this.takeScreenshot();
      }
    };
    document.addEventListener('keydown', this.shortcutHandler);
    
    // Listen to events
    bus.on('render.complete', () => {
      console.log('Ready for screenshot');
    });
  }
  
  uninstall() {
    document.removeEventListener('keydown', this.shortcutHandler);
    this.app = null;
  }
  
  // Public method on the service
  async takeScreenshot() {
    const pixels = await this.app.engine.readPixelsAsync();
    const blob = this.pixelsToBlob(pixels);
    this.downloadBlob(blob, `screenshot-${Date.now()}.png`);
    this.app.bus.emit('screenshot.taken', { timestamp: Date.now() });
  }
  
  private pixelsToBlob(pixels: Float32Array): Blob {
    // Convert to blob
    return new Blob([pixels]);
  }
  
  private downloadBlob(blob: Blob, filename: string) {
    // Trigger download
  }
}

// Usage
app.use(new UIExtension());
app.use(new ScreenshotExtension());

// Take screenshot via service
const screenshot = app.getService('screenshot') as ScreenshotExtension;
await screenshot.takeScreenshot();
```

## Best Practices

1. **Use service pattern**: Register as service, don't add methods to app
2. **Keep methods on extension**: Public API stays on the extension class
3. **Pass app reference**: Methods take app as parameter when needed
4. **Clean up properly**: Remove all listeners, DOM elements, timers
5. **Document dependencies**: Make requirements explicit
6. **Handle missing services**: Check if service exists before using
7. **Use events for loose coupling**: Don't assume other extensions' internals

## Migration from Old Pattern

```typescript
// OLD: Adding methods to app
install(app: ResearchApp) {
  app.doSomething = () => { /* ... */ };
}
// Usage: app.doSomething();

// NEW: Service pattern
install(app: ResearchApp) {
  app.registerService('myService', this);
}
doSomething(app: ResearchApp) { /* ... */ }
// Usage: 
const service = app.getService('myService');
service.doSomething(app);
```

This keeps the app interface clean and makes dependencies explicit!
