# Extension Contract

Extensions add optional functionality to the App without modifying core orchestration.

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
4. Extension may modify app, listen to events, or add UI

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

## What Extensions Can Do

Within `install()`, extensions have full access to:
- **App instance**: Add methods, access other extensions
- **Parameter store**: Read/write parameters
- **Event bus**: Emit and listen to events
- **DOM**: Create UI elements
- **Browser APIs**: Storage, files, etc.

## What Extensions Cannot Do

Extensions should not:
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
Extensions communicate via events:
```typescript
install(app: ResearchApp, bus: EventEmitter) {
  // Emit events
  bus.emit('camera.moved', { position, rotation });
  
  // Listen to events
  bus.on('render.complete', this.handleComplete);
}
```

## Lifecycle

### Installation
```typescript
install(app: ResearchApp, bus: EventEmitter) {
  // Set up event listeners
  this.listeners = [
    ['keydown', this.handleKey],
    ['render.progress', this.handleProgress]
  ];
  
  // Add DOM elements
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
  this.listeners.forEach(([event, handler]) => {
    document.removeEventListener(event, handler);
  });
  
  // Clean up DOM
  this.removeUI();
  
  // Clear references
  this.app = null;
  this.bus = null;
}
```

## Standard Events

Extensions can listen to/emit these standard events:

### Core Events
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

While all share the base interface, extensions typically fall into categories:

### Input Controllers
Manage camera and user input:
```typescript
class KeyboardExtension implements Extension {
  name = 'keyboard';
  install(app, bus) {
    document.addEventListener('keydown', (e) => {
      // Update camera based on keys
      bus.emit('camera.moved', {...});
    });
  }
}
```

### UI Components
Add interface panels:
```typescript
class ParameterPanel implements Extension {
  name = 'parameters';
  install(app, bus) {
    this.createPanel();
    bus.on('parameter.changed', this.updateUI);
  }
}
```

### Workflow Tools
Add research methods:
```typescript
class ExperimentExtension implements Extension {
  name = 'experiments';
  install(app, bus) {
    app.sweep = async (config) => {
      // Implementation
    };
  }
}
```

### Monitors
Track performance/progress:
```typescript
class StatsExtension implements Extension {
  name = 'stats';
  install(app, bus) {
    bus.on('render.progress', (count) => {
      this.updateStats(count);
    });
  }
}
```

## Best Practices

1. **Namespace added methods**: If adding to app, prefix with extension name
2. **Clean up properly**: Remove all listeners, DOM elements, timers
3. **Document dependencies**: If extension needs others, document it
4. **Handle missing features**: Check if methods exist before calling
5. **Use events for loose coupling**: Don't assume other extensions' internals

## Example: Minimal Extension

```typescript
class MinimalExtension implements Extension {
  name = 'minimal';
  
  install(app: ResearchApp, bus: EventEmitter) {
    console.log('Extension installed');
    
    // That's it - minimal valid extension
  }
}
```

## Example: Full Extension

```typescript
class ScreenshotExtension implements Extension {
  name = 'screenshot';
  dependencies = ['ui'];  // Requires UI extension for button
  private app: ResearchApp;
  private shortcutHandler: (e: KeyboardEvent) => void;
  
  install(app: ResearchApp, bus: EventEmitter) {
    this.app = app;
    
    // Can safely access UI extension since dependency is checked
    const ui = app.extensions.get('ui') as UIExtension;
    ui.addButton('Screenshot', () => this.takeScreenshot());
    
    // Add method to app
    app.screenshot = () => this.takeScreenshot();
    
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
    delete this.app.screenshot;
    this.app = null;
  }
  
  private async takeScreenshot() {
    const pixels = await this.app.engine.readPixels();
    // Save to file...
    this.app.bus.emit('screenshot.taken', { timestamp: Date.now() });
  }
}
```

## Extension Dependency Examples

```typescript
// PerformanceExtension requires UI to display stats
class PerformanceExtension implements Extension {
  name = 'performance';
  dependencies = ['ui'];  // Needs UI for overlay
  
  install(app: ResearchApp, bus: EventEmitter) {
    const ui = app.extensions.get('ui') as UIExtension;
    this.overlay = ui.createPanel({
      id: 'performance',
      type: 'stats',
      position: 'top-right'
    });
  }
}

// ExperimentExtension needs both UI and performance monitoring
class ExperimentExtension implements Extension {
  name = 'experiments';
  dependencies = ['ui', 'performance'];
  
  install(app: ResearchApp, bus: EventEmitter) {
    const ui = app.extensions.get('ui') as UIExtension;
    const perf = app.extensions.get('performance') as PerformanceExtension;
    
    // Can safely use both extensions
    ui.addPanel('experiment-control', this.createControls());
    perf.trackExperiment(this.experimentId);
  }
}

// Usage - order matters now!
app.use(new UIExtension());          // Must be first
app.use(new PerformanceExtension()); // Can be second (needs UI)
app.use(new ExperimentExtension());  // Must be after both

// This would throw an error:
// app.use(new ExperimentExtension()); // Error: requires 'ui' to be installed first
```
