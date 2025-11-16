# App Pillar: Quick Reference

A cheat sheet for common tasks and patterns.

---

## Setup

### Basic Initialization
```typescript
const app = new App(canvas);

await app.initialize(
    [recipe1, recipe2],
    'environment.hdr',  // optional
    { 'camera.position': [0, 5, 10] }  // optional
);

app.use(new KeyboardControls())
   .use(new OrbitControls())
   .use(new StatsPanelExtension());

app.setupKeyboardControls();
```

---

## Rendering Modes

### Interactive (Continuous Preview)
```typescript
app.renderInteractive();
// Press Space to pause/resume
// Press Esc to stop
```

### Production (Goal-Driven)
```typescript
// Simple
await app.renderProduction(1000);

// With progress
await app.renderProduction(1000);
// Progress shown via StatsPanelExtension
// or listen to 'render.progress' events

// Handle interruption
try {
    await app.renderProduction(10000);
} catch (error) {
    if (error.name === 'RenderStopped') {
        console.log('User stopped render');
    }
}
```

### Pause/Resume/Stop
```typescript
app.pause();       // Pause current mode
app.resume();      // Resume paused render
app.stop();        // Stop completely
app.isLocked();    // Check if in production mode
```

---

## Parameters

### Setting Values
```typescript
// Single parameter
app.parameterStore.set('camera.fov', 45);

// Multiple parameters (single onChange event)
app.parameterStore.batch({
    'camera.position': [0, 5, 10],
    'material.roughness': 0.3,
    'developer.exposure': 1.5
});

// Get value
const fov = app.parameterStore.get('camera.fov');
```

### Common Parameters
```typescript
// Camera
'camera.position'      // [x, y, z]
'camera.target'        // [x, y, z] (orbit mode)
'camera.frame'         // Float32Array(9) (6DOF mode)
'camera.fov'           // degrees

// Material
'material.roughness'   // 0-1
'material.metallic'    // 0-1
'material.albedo'      // [r, g, b]

// Developer (tone mapping)
'developer.exposure'   // EV stops
'developer.gamma'      // typically 2.2

// Resolution
'resolution'           // [width, height]
```

### Reset Behavior

Parameters that **trigger accumulation reset**:
- `camera.*` - Camera changes
- `material.*` - Material changes
- `scene.*` - Scene changes
- `quad.*` - Geometry changes

Parameters that **don't trigger reset**:
- `developer.*` - Tone mapping
- `debug.*` - Debug modes
- `resolution` - Canvas size (special handling)

---

## Recipes

### Switch Recipes
```typescript
// By ID
app.switchRecipe('pathtracer');

// Via keyboard (if setupKeyboardControls called)
// Press 1-9 for recipes in order

// Get current recipe
const current = app.engine.getActiveRecipeId();
```

### Recipe List
```typescript
const available = app.engine.getAvailableRecipes();
console.log('Available:', available);
```

---

## Sessions

### Save Session
```typescript
// Quick save (auto-generated filename)
await app.sessionManager.quickSave();
// Saves as: session_YYYY_MMDD_HHMM.json

// Named save
await app.sessionManager.save('my-experiment.json');

// Via keyboard: Press J
```

### Load Session
```typescript
// From file object
await app.sessionManager.loadFromFile(file);

// Via keyboard: Press O (opens file picker)
```

### What Gets Saved
- Active recipe
- All parameters
- Camera state
- Render mode
- Sample count
- Extension states
- Tile job state (if active)

---

## File Export

### Screenshot (PNG)
```typescript
// Press X
// or manually:
const pixels = app.engine.readRGB();
savePNGFile(pixels, width, height, 'screenshot.png');
```

### HDR Radiance
```typescript
// Press H
// or manually:
const radiance = app.engine.readRadiance();
saveHDRFile(radiance, width, height, 'radiance.hdr');
```

### Tiled High-Res
```typescript
await app.tiledRenderer.startJob({
    targetWidth: 7680,
    targetHeight: 4320,
    targetTileSize: 512,
    samplesPerTile: 1000,
    format: 'both'  // 'hdr' | 'png' | 'both'
});

// Via keyboard: Press T (prompts for settings)

// Stop/pause tile job
app.tiledRenderer.stopJob();

// Resume from session
// Session automatically saves before starting
// Load session and it will resume if incomplete
```

---

## Camera Controls

### Keyboard (6DOF Flight)
Install: `app.use(new KeyboardControls())`

```
Movement:
  ↑ - forward    ↓ - backward
  ← - left       → - right
  ' - up         / - down

Rotation:
  W - pitch up   S - pitch down
  A - yaw left   D - yaw right
  Q - roll left  E - roll right

Modifiers:
  Shift - boost (3x speed)
  Ctrl  - slow (0.3x speed)
  R     - stabilize (align with world up)
```

### Mouse Orbit
Install: `app.use(new OrbitControls())`

```
Left drag - Orbit around target
Wheel     - Zoom in/out
```

### Touch Orbit
Install: `app.use(new TouchOrbitControls())`

```
One finger  - Orbit
Two fingers - Pinch zoom
```

**Note**: Only install one camera extension at a time!

---

## Events

### Listen to Events
```typescript
app.bus.on('render.progress', (info) => {
    console.log(`${info.samples} samples`);
});

app.bus.on('parameter.changed', (changes) => {
    console.log('Parameters changed:', changes);
});

app.bus.on('recipe.switched', ({ recipeId }) => {
    console.log('Switched to:', recipeId);
});
```

### Common Events
```typescript
'render.started'
'render.stopped'
'render.paused'
'render.resumed'
'render.progress'    // ProgressInfo
'render.complete'    // { samples, elapsedTime }

'parameter.changed'  // ParameterChanges
'accumulation.reset' // { reason: string }
'recipe.switched'    // { recipeId: string }

'session.saved'      // { filename: string }
'session.loaded'     // { timestamp: number }

'camera.moved'       // { position: vec3, target?: vec3 }
```

---

## Services

### Get Service
```typescript
// Core services (always available)
const engine = app.getService('engine');
const params = app.getService('parameters');
const coordinator = app.getService('coordinator');
const session = app.getService('session');
const tiler = app.getService('tiler');

// Extension services (if installed)
const camera = app.getService('camera');
if (camera) {
    const pos = camera.getPosition();
}

const stats = app.getService('stats');
const screenshot = app.getService('screenshot');
```

### Check Service Exists
```typescript
if (app.hasService('camera')) {
    // Camera extension installed
}
```

---

## Creating Extensions

### Basic Extension
```typescript
class MyExtension implements Extension {
    name = 'my-extension';
    version = '1.0.0';
    description = 'Does something useful';
    dependencies = ['other-extension'];  // optional
    
    private app: App;
    private bus: EventBus;
    
    install(app: App, bus: EventBus): void {
        this.app = app;
        this.bus = bus;
        
        // Register as service
        app.registerService('myext', this);
        
        // Listen to events
        bus.on('render.progress', this.handleProgress);
        
        // Setup UI, keyboard, etc.
    }
    
    uninstall(): void {
        // Clean up listeners, DOM elements, etc.
        this.bus.off('render.progress', this.handleProgress);
    }
    
    private handleProgress = (info: ProgressInfo): void => {
        // Handle event
    };
    
    // Public API methods
    doSomething(): void {
        // Extension functionality
    }
}
```

### Extension with State
```typescript
class StatefulExtension implements Extension {
    name = 'stateful';
    
    private myState = {
        count: 0,
        enabled: true
    };
    
    saveState(): any {
        return this.myState;
    }
    
    restoreState(state: any): void {
        this.myState = state;
        // Apply restored state
    }
    
    install(app: App, bus: EventBus): void {
        app.registerService('stateful', this);
    }
}
```

### Extension with Cleanup
```typescript
import { EventManager } from '../utils/EventManager';

class CleanExtension implements Extension {
    name = 'clean';
    
    private events = new EventManager();
    private panel: HTMLElement | null = null;
    
    install(app: App, bus: EventBus): void {
        // Auto-tracked listeners
        this.events.add(window, 'keydown', this.onKey);
        this.events.onBus(bus, 'render.progress', this.onProgress);
        
        // DOM element
        this.panel = document.createElement('div');
        document.body.appendChild(this.panel);
    }
    
    uninstall(): void {
        // Remove all listeners
        this.events.removeAll();
        
        // Remove DOM
        if (this.panel) {
            this.panel.remove();
            this.panel = null;
        }
    }
    
    private onKey = (e: KeyboardEvent): void => { };
    private onProgress = (info: ProgressInfo): void => { };
}
```

---

## Utilities

### AnimationLoop
```typescript
import { AnimationLoop } from './utils/AnimationLoop';

const loop = new AnimationLoop();
loop.start((dt) => {
    // Update with delta time in seconds
    position += velocity * dt;
});

// Later
loop.stop();
```

### EventManager
```typescript
import { EventManager } from './utils/EventManager';

const events = new EventManager();

// Add DOM listeners (automatically tracked)
events.add(window, 'keydown', handler);
events.add(canvas, 'click', handler);

// Add EventBus listeners (automatically tracked)
events.onBus(app.bus, 'render.progress', handler);

// Clean up everything at once
events.removeAll();
```

### File Export
```typescript
import { saveHDRFile, savePNGFile } from './utils/file-export';

// Save HDR (Radiance RGBE format)
saveHDRFile(float32Array, width, height, 'output.hdr');

// Save PNG
savePNGFile(uint8Array, width, height, 'output.png');
```

---

## Debugging

### Check State
```typescript
// Is rendering?
app.renderCoordinator.isRunning();
app.renderCoordinator.isPaused();
app.renderCoordinator.isLocked();

// Is accumulating?
app.renderCoordinator.isAccumulating();
app.engine.sampleCount;

// Parameters locked?
app.parameterStore.isLocked();

// Current recipe?
app.engine.getActiveRecipeId();
```

### Event Debugging
```typescript
// Log all events
for (const event of app.bus.eventNames()) {
    app.bus.on(event, (data) => {
        console.log(`[${event}]`, data);
    });
}

// Specific event count
console.log('Listeners:', app.bus.listenerCount('render.progress'));
```

### Parameter Debugging
```typescript
// See all parameters
const all = app.parameterStore.serialize();
console.log('All parameters:', all);

// Watch parameter changes
app.bus.on('parameter.changed', (changes) => {
    for (const change of changes.changes) {
        console.log(`${change.path}: ${change.oldValue} → ${change.newValue}`);
    }
});
```

---

## Performance Tips

### Reduce Reset Frequency
```typescript
// Batch parameter changes to avoid multiple resets
app.parameterStore.batch({
    'material.roughness': 0.3,
    'material.metallic': 0.8,
    'material.albedo': [1, 0, 0]
});
// Single reset instead of three
```

### Use Interactive for Preview
```typescript
// Fast preview while adjusting
app.renderInteractive();
// Adjust parameters...

// High quality when done
app.stop();
await app.renderProduction(1000);
```

### Tile Large Images
```typescript
// Don't render 8K at once
// Use tiling for >2K resolution
if (width > 2048 || height > 2048) {
    await app.tiledRenderer.startJob({
        targetWidth: width,
        targetHeight: height,
        targetTileSize: 512,
        samplesPerTile: 1000,
        format: 'hdr'
    });
}
```

---

## Common Patterns

### Research Workflow
```typescript
// 1. Setup
await app.initialize([recipe]);
app.use(new KeyboardControls())
   .use(new StatsPanelExtension());

// 2. Interactive preview
app.renderInteractive();

// 3. Adjust parameters
app.parameterStore.set('material.roughness', 0.3);

// 4. High quality render
await app.renderProduction(1000);

// 5. Save HDR
const radiance = app.engine.readRadiance();
saveHDRFile(radiance, width, height, 'output.hdr');

// 6. Save session
await app.sessionManager.quickSave();
```

### Parameter Sweep
```typescript
const roughness = [0.0, 0.2, 0.4, 0.6, 0.8, 1.0];

for (const r of roughness) {
    app.parameterStore.set('material.roughness', r);
    await app.renderProduction(500);
    
    const pixels = app.engine.readRGB();
    savePNGFile(pixels, width, height, `roughness_${r}.png`);
}
```

### Recipe Comparison
```typescript
const recipes = ['pathtracer', 'bidirectional', 'debug'];

for (const recipe of recipes) {
    app.switchRecipe(recipe);
    await app.renderProduction(1000);
    
    const radiance = app.engine.readRadiance();
    saveHDRFile(radiance, width, height, `${recipe}.hdr`);
}
```

### Tiled HDR Export
```typescript
// Save session before long job
await app.sessionManager.save('pre-tile.json');

// Start tiled render
await app.tiledRenderer.startJob({
    targetWidth: 7680,
    targetHeight: 4320,
    targetTileSize: 512,
    samplesPerTile: 2000,
    format: 'hdr'
});

// If interrupted, reload session and:
// Job will automatically resume
```

---

## Troubleshooting

### "Parameters locked" warning
**Cause**: Trying to change parameters during production render
**Fix**: Stop render first, or wait for completion

### Recipe switch doesn't work
**Cause**: In production mode (locked)
**Fix**: Press Escape to stop, then switch

### Session won't load
**Cause**: Recipe mismatch or corrupt file
**Fix**: Check console for error, ensure recipe exists

### Tiled render fails
**Cause**: Production render already running
**Fix**: Stop current render first

### Extension not working
**Cause**: Dependencies not installed
**Fix**: Install dependencies first, check name matches

### Accumulation not resetting
**Cause**: Parameter has no-reset prefix
**Fix**: Check `developer.*` and `debug.*` don't reset

---

## Keyboard Shortcuts Summary

```
Rendering:
  Space - Toggle render on/off
  \     - Pause/resume
  Esc   - Stop
  r     - Reset accumulation
  p     - Production render (prompts)
  t     - Tiled render (prompts)

Recipes:
  1-9   - Switch recipe by index

Sessions:
  j     - Quick save
  o     - Load session (file picker)

Export:
  x     - Screenshot (PNG)
  h     - HDR export

Camera (6DOF):
  Arrows + ' / - Movement
  WASD   - Rotation
  QE     - Roll
  Shift  - Boost
  Ctrl   - Slow
  R      - Stabilize
```

---

## Next Steps

1. Read `APP_IMPLEMENTATION.md` for detailed architecture
2. Read `APP_BUILD_PLAN.md` for what's left to build
3. Install extensions as needed
4. Focus on Optics and Objects research
5. Come back only if you need to extend functionality

**Remember**: The App pillar should be boring and invisible. If you're spending time here instead of doing research, something's wrong!
