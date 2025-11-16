# Extensions

Guide to the extension system: creating modular, optional features.

## Overview

Extensions add functionality to the app without modifying core code. They are:
- **Modular** - Plug-and-play architecture
- **Optional** - Enable/disable as needed
- **Decoupled** - Communicate via EventBus and ParameterStore
- **Lifecycle-aware** - Initialize, update, dispose

---

## Extension Interface

```typescript
interface Extension {
    name: string;
    initialize?(context: ExtensionContext): void;
    update?(delta: number): void;
    dispose?(): void;
}

interface ExtensionContext {
    app: App;
    canvas: HTMLCanvasElement;
    engine: Engine;
    bus: EventBus;
}
```

**Methods**:
- `initialize` - Called once during app initialization
- `update` - Called every frame with delta time (seconds)
- `dispose` - Called when app is disposed

---

## Available Extensions

### Control Extensions

#### OrbitControls

Mouse-based orbit camera control.

**Features**:
- Left drag: Rotate around target
- Right drag: Pan
- Scroll: Zoom in/out
- Auto-damping

**Usage**:
```typescript
import { OrbitControls } from './src/app/extensions/OrbitControls';

app.addExtension(new OrbitControls(canvas));
```

**Parameters Updated**:
- `camera.position`
- `camera.target`

#### TouchOrbitControls

Touch-based orbit camera control.

**Features**:
- One finger: Rotate
- Two fingers: Pan and zoom
- Momentum and damping

**Usage**:
```typescript
import { TouchOrbitControls } from './src/app/extensions/TouchOrbitControls';

app.addExtension(new TouchOrbitControls(canvas));
```

#### KeyboardControls

Keyboard navigation.

**Features**:
- WASD: Move camera
- Arrow keys: Rotate
- Q/E: Up/down
- Shift: Move faster

**Usage**:
```typescript
import { KeyboardControls } from './src/app/extensions/KeyboardControls';

app.addExtension(new KeyboardControls());
```

### UI Extensions

#### ParameterPanelExtension

Automatic UI controls for all parameters.

**Features**:
- Auto-generates controls from metadata
- Groups by `group` field
- Respects ranges, steps, units
- Live updates

**Usage**:
```typescript
import { ParameterPanelExtension } from './src/app/extensions/ParameterPanelExtension';

app.addExtension(new ParameterPanelExtension());
```

**Dependencies**: Tweakpane (or similar UI library)

#### StatsPanelExtension

FPS and performance monitoring.

**Features**:
- FPS counter
- Frame time graph
- Sample count
- GPU memory (if available)

**Usage**:
```typescript
import { StatsPanelExtension } from './src/app/extensions/StatsPanelExtension';

app.addExtension(new StatsPanelExtension());
```

### Export Extensions

#### ScreenshotExtension

Capture LDR screenshots (PNG/JPEG).

**Features**:
- Keyboard shortcut (default: 'S')
- Automatic filename with timestamp
- Configurable format and quality

**Usage**:
```typescript
import { ScreenshotExtension } from './src/app/extensions/ScreenshotExtension';

app.addExtension(new ScreenshotExtension({
    key: 'KeyS',
    format: 'png'
}));
```

**Events Emitted**:
- `screenshot:captured` - When screenshot is taken

#### HDRExportExtension

Export HDR radiance (EXR format).

**Features**:
- Captures floating-point radiance
- OpenEXR format export
- Preserves full dynamic range

**Usage**:
```typescript
import { HDRExportExtension } from './src/app/extensions/HDRExportExtension';

app.addExtension(new HDRExportExtension({
    key: 'KeyH'
}));
```

#### ProductionRenderExtension

High-quality offline rendering.

**Features**:
- Render to target sample count
- Progress reporting
- Tile-based rendering for large images
- Auto-export when complete

**Usage**:
```typescript
import { ProductionRenderExtension } from './src/app/extensions/ProductionRenderExtension';

app.addExtension(new ProductionRenderExtension({
    targetSamples: 1000,
    tileSize: 512,
    outputSize: [4000, 4000]
}));
```

---

## Creating Custom Extensions

### Basic Extension

```typescript
class MyExtension implements Extension {
    name = 'my-extension';
    private app: App;
    private bus: EventBus;

    initialize(context: ExtensionContext) {
        this.app = context.app;
        this.bus = context.bus;

        // Subscribe to events
        this.bus.on('parameters:changed', this.onParamsChanged.bind(this));

        console.log('MyExtension initialized');
    }

    update(delta: number) {
        // Called every frame
        // delta = time since last frame (seconds)
    }

    dispose() {
        // Clean up
        console.log('MyExtension disposed');
    }

    private onParamsChanged(changes: ParameterChanges) {
        console.log('Parameters changed:', changes);
    }
}

// Use it
app.addExtension(new MyExtension());
```

### Extension with Options

```typescript
interface MyExtensionOptions {
    enabled?: boolean;
    updateInterval?: number;
}

class ConfigurableExtension implements Extension {
    name = 'configurable-extension';
    private options: Required<MyExtensionOptions>;

    constructor(options: MyExtensionOptions = {}) {
        this.options = {
            enabled: true,
            updateInterval: 1.0,
            ...options
        };
    }

    initialize(context: ExtensionContext) {
        if (!this.options.enabled) return;

        // Setup
    }

    update(delta: number) {
        if (!this.options.enabled) return;

        // Update logic
    }
}

// Use it
app.addExtension(new ConfigurableExtension({
    enabled: true,
    updateInterval: 0.5
}));
```

### Extension with UI

```typescript
class UIExtension implements Extension {
    name = 'ui-extension';
    private container: HTMLElement;

    initialize(context: ExtensionContext) {
        // Create UI
        this.container = document.createElement('div');
        this.container.className = 'my-extension-ui';
        document.body.appendChild(this.container);

        // Add controls
        const button = document.createElement('button');
        button.textContent = 'Click Me';
        button.onclick = () => this.onClick(context);
        this.container.appendChild(button);
    }

    dispose() {
        // Remove UI
        if (this.container && this.container.parentNode) {
            this.container.parentNode.removeChild(this.container);
        }
    }

    private onClick(context: ExtensionContext) {
        // Handle click
        context.app.setParameter('someParam', newValue);
    }
}
```

---

## Extension Patterns

### Listening to Events

```typescript
initialize(context: ExtensionContext) {
    // Parameter changes
    context.bus.on('parameters:changed', (changes) => {
        // React to parameter updates
    });

    // Recipe changes
    context.bus.on('recipe:changed', (recipeId) => {
        // React to recipe switch
    });

    // Frame events
    context.bus.on('render:frame', ({ time, delta }) => {
        // React to each frame
    });
}
```

### Emitting Custom Events

```typescript
class EventEmittingExtension implements Extension {
    name = 'event-emitter';
    private bus: EventBus;

    initialize(context: ExtensionContext) {
        this.bus = context.bus;
    }

    update(delta: number) {
        // Emit custom event
        this.bus.emit('my-extension:tick', { delta });
    }
}

// Other code can listen
app.on('my-extension:tick', ({ delta }) => {
    console.log('Tick:', delta);
});
```

### Updating Parameters

```typescript
class ParameterUpdatingExtension implements Extension {
    name = 'param-updater';
    private app: App;

    initialize(context: ExtensionContext) {
        this.app = context.app;
    }

    update(delta: number) {
        // Read parameter
        const currentFov = this.app.getParameter('camera.fov');

        // Update parameter
        this.app.setParameter('camera.fov', currentFov + delta * 10);

        // Or update multiple
        this.app.setParameters({
            'camera.fov': newFov,
            'light.intensity': newIntensity
        });
    }
}
```

### Accessing Engine

```typescript
class EngineAccessingExtension implements Extension {
    name = 'engine-accessor';
    private engine: Engine;

    initialize(context: ExtensionContext) {
        this.engine = context.engine;

        // Access engine state
        const recipes = this.engine.getAvailableRecipes();
        const activeRecipe = this.engine.getActiveRecipeId();
        const sampleCount = this.engine.sampleCount;

        // Trigger engine actions
        this.engine.clearAccumulation();
        this.engine.selectRecipe('albedo');
    }
}
```

---

## Advanced Examples

### Auto-Rotate Extension

```typescript
class AutoRotateExtension implements Extension {
    name = 'auto-rotate';
    private app: App;
    private enabled = false;
    private speed = 0.1;

    initialize(context: ExtensionContext) {
        this.app = context.app;

        // Keyboard toggle
        window.addEventListener('keydown', (e) => {
            if (e.key === 'r') {
                this.enabled = !this.enabled;
                console.log(`Auto-rotate: ${this.enabled ? 'ON' : 'OFF'}`);
            }
        });
    }

    update(delta: number) {
        if (!this.enabled) return;

        // Get current camera position
        const pos = this.app.getParameter('camera.position');
        const target = this.app.getParameter('camera.target');

        // Rotate around target
        const radius = Math.sqrt(
            Math.pow(pos[0] - target[0], 2) +
            Math.pow(pos[2] - target[2], 2)
        );

        const angle = Math.atan2(pos[2] - target[2], pos[0] - target[0]);
        const newAngle = angle + this.speed * delta;

        const newPos = [
            target[0] + radius * Math.cos(newAngle),
            pos[1],
            target[2] + radius * Math.sin(newAngle)
        ];

        this.app.setParameter('camera.position', newPos);
    }
}
```

### Performance Monitor Extension

```typescript
class PerformanceMonitorExtension implements Extension {
    name = 'performance-monitor';
    private frameTimes: number[] = [];
    private maxSamples = 60;

    update(delta: number) {
        // Record frame time
        this.frameTimes.push(delta * 1000);  // Convert to ms
        if (this.frameTimes.length > this.maxSamples) {
            this.frameTimes.shift();
        }

        // Compute stats every second
        if (this.frameTimes.length === this.maxSamples) {
            const avg = this.frameTimes.reduce((a, b) => a + b) / this.frameTimes.length;
            const fps = 1000 / avg;
            const min = Math.min(...this.frameTimes);
            const max = Math.max(...this.frameTimes);

            console.log(`FPS: ${fps.toFixed(1)} | Avg: ${avg.toFixed(2)}ms | Min: ${min.toFixed(2)}ms | Max: ${max.toFixed(2)}ms`);
        }
    }
}
```

---

## Extension Lifecycle

```
App.initialize()
  ↓
For each extension:
  extension.initialize(context)
  ↓
App.start()
  ↓
Loop:
  For each extension:
    extension.update(delta)
  ↓
App.dispose()
  ↓
For each extension:
  extension.dispose()
```

---

## Best Practices

1. **Use events for communication** - Don't directly call other extensions
2. **Clean up in dispose** - Remove event listeners, DOM elements, etc.
3. **Handle missing context** - Check if app/engine/bus exist
4. **Be efficient in update** - Called every frame (60fps)
5. **Validate parameters** - Check bounds before setting
6. **Provide options** - Make extensions configurable
7. **Document dependencies** - If using external libraries
8. **Emit custom events** - Let other code react to your extension

---

## Debugging Extensions

```typescript
class DebugExtension implements Extension {
    name = 'debug';

    initialize(context: ExtensionContext) {
        // Log all events
        const originalEmit = context.bus.emit.bind(context.bus);
        context.bus.emit = (event: string, data?: any) => {
            console.log(`Event: ${event}`, data);
            return originalEmit(event, data);
        };
    }

    update(delta: number) {
        // Log slow frames
        if (delta > 0.033) {  // Slower than 30fps
            console.warn(`Slow frame: ${(delta * 1000).toFixed(2)}ms`);
        }
    }
}
```

---

## Next Steps

- [Parameter System](parameter-system.md) - Working with parameters
- [Event Bus](event-bus.md) - Event system details
- [Engine API](../engine/api-reference.md) - Engine access
- [App README](README.md) - App layer overview
