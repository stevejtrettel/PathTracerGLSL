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

## Tiled Rendering

For high-resolution renders (4K+), the image is split into tiles. Each tile is rendered separately and saved to disk, avoiding memory limits.

### TiledRenderer

Location: `src/app/TiledRenderer.ts`

```typescript
const bus = app.getEventBus();
const tiled = new TiledRenderer(app, bus);

await tiled.startJob({
    targetWidth: 4096,
    targetHeight: 2048,
    targetTileSize: 512,
    samplesPerTile: 1000,
    format: 'hdr'  // 'hdr' | 'png' | 'both'
});
```

**Features:**
- Calculates optimal tile grid to divide evenly
- Renders tiles row-by-row
- Saves each tile immediately after completion
- Supports pause/resume
- Emits progress events for UI

### Tile Grid Configuration

```typescript
interface TileJobConfig {
    targetWidth: number;      // Full image width
    targetHeight: number;     // Full image height
    targetTileSize: number;   // Preferred tile size (adjusted to divide evenly)
    samplesPerTile: number;   // Samples to render per tile
    format: 'hdr' | 'png' | 'both';
}

interface TileGrid {
    tilesX: number;      // Number of columns
    tilesY: number;      // Number of rows
    tileWidth: number;   // Actual tile width
    tileHeight: number;  // Actual tile height
}
```

### Tiled Render Example

```typescript
import { App, TiledRenderer } from './src/app/index.js';

const app = App.create(document.body, { layout: 'fullscreen' });
await app.initialize({ scene, strategies });
app.use(new ProductionPanelExtension());
app.start();

const bus = app.getEventBus();
const tiled = new TiledRenderer(app, bus);

await tiled.startJob({
    targetWidth: 8192,
    targetHeight: 4096,
    targetTileSize: 1024,
    samplesPerTile: 2000,
    format: 'both'
});
// Tiles are saved automatically as they complete
// ProductionPanelExtension shows progress with tile grid
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

### Render Events (from RenderCoordinator)

All event names are defined as constants in `src/app/events.ts` (`AppEvents`):

| Constant | Event String | Data | Description |
|----------|-------------|------|-------------|
| `RENDER_STARTED` | `render.started` | `{ mode, targetSamples? }` | Render begins |
| `RENDER_PROGRESS` | `render.progress` | `ProgressInfo` | Per-frame update |
| `RENDER_COMPLETE` | `render.complete` | `{ samples, elapsedTime }` | Target reached |
| `RENDER_STOPPED` | `render.stopped` | - | Render cancelled |
| `RENDER_PAUSED` | `render.paused` | - | Render paused |
| `RENDER_RESUMED` | `render.resumed` | - | Render resumed |
| `RENDER_LOCKED` | `render.locked` | - | Parameters locked |
| `RENDER_UNLOCKED` | `render.unlocked` | - | Parameters unlocked |

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

### Tile Events (from TiledRenderer)

| Event | Data | Description |
|-------|------|-------------|
| `tiledJob.progress` | `TiledJobProgressInfo` | Job-level progress |
| `tiledJob.complete` | `{ jobId, totalTiles, elapsedSeconds }` | All tiles done |
| `tile.start` | `TileProgressInfo` | Tile begins |
| `tile.complete` | `TileProgressInfo` | Tile finished |

```typescript
interface TiledJobProgressInfo {
    jobId: string;
    grid: TileGrid;
    targetWidth: number;
    targetHeight: number;
    samplesPerTile: number;
    completedTiles: number;
    totalTiles: number;
    completedPositions: [number, number][];
    currentTile: { x: number; y: number } | null;
}

interface TileProgressInfo {
    tileX: number;
    tileY: number;
    tileIndex: number;
    totalTiles: number;
    grid: TileGrid;
}
```

## UI Extensions

### ProductionPanelExtension

Location: `src/app/extensions/ProductionPanelExtension.ts`

The `ProductionPanelExtension` automatically shows during production renders.

**Features:**
- Progress bar with percentage complete
- Sample counter (current / target)
- Elapsed time and ETA
- Pause/Resume/Cancel buttons
- Export PNG/HDR buttons on completion
- Tile grid visualization for tiled renders

**Tile Grid Visualization:**
```
┌───┬───┬───┬───┐
│ ✓ │ ✓ │ ✓ │ ✓ │  ✓ = complete (green)
├───┼───┼───┼───┤
│ ✓ │ ✓ │ ▶ │   │  ▶ = current (blue, pulsing)
├───┼───┼───┼───┤
│   │   │   │   │    = pending (gray)
└───┴───┴───┴───┘
```

**Behavior:**
- Auto-shows when production render starts
- Auto-hides when render completes or is cancelled
- Mounts to `region-statusbar` if layout available, otherwise fixed to bottom of screen

```typescript
app.use(new ProductionPanelExtension());

// Manual control
const panel = app.getExtension<ProductionPanelExtension>('production-panel');
panel?.show();
panel?.hide();
```

### Render Mode System

Production renders are managed by `ProductionRenderManager` (layout switching, resolution, auto-export) which delegates the actual render loop to `RenderCoordinator`:

```typescript
type RenderMode = 'interactive' | 'production';
type RenderState = 'rendering' | 'paused' | 'complete' | 'stopped';
```

### UIExtension Base Class

Location: `src/app/extensions/UIExtension.ts`

All UI extensions extend this base class for consistent behavior:

```typescript
abstract class UIExtension implements Extension {
    abstract readonly name: string;
    protected abstract readonly region: RegionName;

    protected abstract createRoot(): HTMLElement;
    protected abstract setup(): void;
    protected cleanup(): void {}

    show(): void;
    hide(): void;
    toggle(): void;
    get isVisible(): boolean;

    // Event helpers (auto-cleanup on uninstall)
    protected on(event: string, handler: (data?: any) => void): void;
}
```

Features: mounts to layout region if available, automatic event cleanup, show/hide/toggle visibility helpers, consistent install/uninstall lifecycle.

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

## What's Not Yet Implemented

| Feature | Description | Priority |
|---------|-------------|----------|
| Settings Modal | UI for configuring render before starting (resolution presets, sample count, tiling options) | High |
| Low-res preview | Thumbnail composite of completed tiles during tiled rendering | Medium |
| Time estimation | ETA based on average tile render time | Low |
| Settings persistence | localStorage for render settings | Low |

## Tips

1. **Preview first**: Use interactive mode to frame your shot before production render
2. **Start small**: Test with 100-500 samples before committing to thousands
3. **Use HDR export**: For post-processing, HDR preserves full dynamic range
4. **Pause for changes**: You can pause, adjust non-locked parameters, then resume (accumulation will reset)
5. **Session save**: Use `autoSave: true` to save your settings with the render
