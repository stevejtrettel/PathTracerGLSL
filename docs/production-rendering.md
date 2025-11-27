# Production Rendering

Production rendering is for creating high-quality, high-sample-count images. Unlike interactive mode (which runs continuously), production mode renders to a target sample count and then stops.

## Quick Start

```typescript
import { App, ProductionPanelExtension } from './app/index.js';

// Create app
const app = App.create(document.body, { layout: 'fullscreen' });
await app.initialize({ scene, strategies });

// Install production panel (shows progress during production renders)
app.use(new ProductionPanelExtension());

// Start interactive mode for setup
app.start();

// Later: Start production render
await app.renderProduction(1000);  // Render 1000 samples
app.exportPNG();
```

## ProductionPanelExtension

The `ProductionPanelExtension` automatically shows during production renders and provides:

- **Progress bar** with percentage complete
- **Sample counter** (current / target)
- **ETA** calculation
- **Elapsed time**
- **Controls**: Pause, Resume, Cancel
- **Export buttons**: PNG and HDR (after completion)

### Installation

```typescript
import { ProductionPanelExtension } from './app/index.js';

app.use(new ProductionPanelExtension());
```

### Behavior

- **Auto-shows** when production render starts
- **Auto-hides** when render completes or is cancelled
- Mounts to `region-statusbar` if layout available, otherwise fixed to bottom of screen

### Manual Control

```typescript
const panel = app.getExtension<ProductionPanelExtension>('production-panel');
panel?.show();
panel?.hide();
```

## Production Render API

### Starting a Production Render

```typescript
// Basic: render to target samples
await app.renderProduction(1000);

// With options
await app.renderProduction(5000, {
    autoSave: true,        // Save session on completion
    autoExportPNG: true,   // Export PNG on completion
    autoExportHDR: true    // Export HDR on completion
});
```

### Extending a Render

Add more samples without resetting:

```typescript
// Initial render
await app.renderProduction(1000);

// Not satisfied? Add more samples
await app.extendProduction(500);  // Now at 1500 samples
```

### Pause and Resume

```typescript
// Start production render (returns Promise)
const renderPromise = app.renderProduction(10000);

// Pause mid-render
app.pause();

// Resume
app.resume();

// Or cancel
app.stop();
```

### Checking State

```typescript
app.isLocked()        // true during production (parameters locked)
app.isPaused()        // true if paused
app.getSampleCount()  // Current sample count
app.getElapsedTime()  // Elapsed time in ms
app.getRenderMode()   // 'interactive' or 'production'
app.getRenderState()  // 'rendering', 'paused', 'complete', 'stopped'
```

## Export

After rendering:

```typescript
// Export PNG (8-bit, tonemapped)
app.exportPNG();
app.exportPNG('my-render.png');

// Export HDR (32-bit float, linear)
app.exportHDR();
app.exportHDR('my-render.hdr');

// Export specific AOV
app.exportAOV('albedo');
app.exportAOV('normal', 'normals.png');

// Export all AOVs
app.exportAllAOVs();
```

## Events

Subscribe to render events:

```typescript
const bus = app.getEventBus();

bus.on('render.progress', (info) => {
    console.log(`${info.samples}/${info.targetSamples} (${info.percentComplete}%)`);
});

bus.on('render.started', () => console.log('Render started'));
bus.on('render.stopped', () => console.log('Render stopped'));
bus.on('render.complete', () => console.log('Render complete!'));
```

### ProgressInfo

```typescript
interface ProgressInfo {
    mode: 'interactive' | 'production';
    state: 'rendering' | 'paused' | 'complete' | 'stopped';
    timestamp: number;
    samples: number;
    elapsedTime: number;
    fps: number;

    // Production-only
    targetSamples?: number;
    percentComplete?: number;
}
```

## Layout Modes for Production

Different layouts work well for different stages:

```typescript
// Setup: fullscreen for immersive preview
app.setLayoutMode('fullscreen');

// Production: centered for focused viewing
app.setLayoutMode('centered');

// Review: split for comparing settings
app.setLayoutMode('split');
```

## Complete Example

```typescript
import {
    App,
    ParameterPanelExtension,
    ProductionPanelExtension,
    OrbitControls,
    STRATEGY_PRESETS
} from './app/index.js';

async function main() {
    // Setup
    const app = App.create(document.body, { layout: 'fullscreen' });

    await app.initialize({
        scene: { id: 'my-scene', name: 'My Scene' },
        strategies: [STRATEGY_PRESETS['pathtracer-full'].strategy]
    });

    // Install extensions
    app.use(new OrbitControls());
    app.use(new ParameterPanelExtension());
    app.use(new ProductionPanelExtension());

    // Interactive exploration
    app.start();

    // Expose for console/UI
    window.app = app;

    // Production render function (call from UI or console)
    window.render = async (samples = 1000) => {
        app.setLayoutMode('centered');
        await app.renderProduction(samples, { autoExportPNG: true });
        console.log('Done! Check your downloads.');
    };
}

main();
```

## Tips

1. **Preview first**: Use interactive mode to frame your shot before production render

2. **Start small**: Test with 100-500 samples before committing to thousands

3. **Use HDR export**: For post-processing, HDR preserves full dynamic range

4. **Pause for changes**: You can pause, adjust non-locked parameters, then resume (accumulation will reset)

5. **Session save**: Use `autoSave: true` to save your settings with the render
