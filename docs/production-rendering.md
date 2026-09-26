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
await app.exportPNG();
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

For images larger than the screen (8K stills, posters), render in tiles. The image is split
into tiles; the canvas is resized to one tile at a time; each tile is rendered to the full
sample count and read back; the tiles are stitched on the CPU into ONE HDR and/or PNG file
carrying the full image's stamp. Tiles bound the work in one draw call (a whole 8K frame of a
heavy scene can outlast the GPU watchdog) and the GPU memory the accumulation needs.

```typescript
await app.renderTiled({
    width: 7680,
    height: 4320,
    spp: 2000,
    format: 'both',      // 'hdr' | 'png' | 'both'
    tileSize: 1024,      // optional; rounded up to a multiple of 64
});
// Saves render_<date>_7680x4320_2000spp.hdr / .png, then resumes interactive rendering.
```

The production dialog offers the same thing ("Render in tiles"; on by default for 8K; a
Custom size is available). Code: `src/app/TiledRenderer.ts` (the job), `src/app/tiling.ts`
(tile grid and stitching, pure), `ProductionOrchestrator.renderTiles` (one parameter lock
around all tiles).

**Tiling does not change the image.** The RNG seeds with the global pixel, cameras map
through `engine.imageSize`, tile offsets are multiples of 64 (the period of the display's
blue-noise dither), and the job pins ONE RNG salt, recorded in the stamp. Rendering the same
scene at the same size in one piece with that salt pinned (`app.pinResetSalt(salt)`) gives
pixel-identical images (the files differ only in their stamps, which carry the date). This was
checked once by hand in headless Chromium for the cornell camera family; no automated test
checks it.

**Memory.** The stitched image is kept at 4 bytes per pixel per format (RGBE for HDR, RGBA
for PNG): 133 MB each at 7680×4320. Both are allocated before the first tile, so a size the
browser cannot hold fails immediately.

**Stopping** (`app.stop()`, or Cancel in the panel) discards the job; nothing is saved, and
there is no resume.

**Throughput.** The render loop draws one sample per animation frame, so a small tile cannot
use a fast GPU fully (a 512² tile at 60 fps is 16M samples/s). Prefer the default 1024 or
larger unless a single frame of the scene is slow. Keep the tab visible: browsers stop
animation frames in background tabs.

## Export

After rendering:

```typescript
// Export PNG (8-bit, tonemapped; encoding is async)
await app.exportPNG();
await app.exportPNG('my-render.png');

// Export HDR (32-bit float, linear)
app.exportHDR();
app.exportHDR('my-render.hdr');

// Export specific AOV
await app.exportAOV('albedo');
await app.exportAOV('normal', 'normals.png');

// Export all AOVs
await app.exportAllAOVs();
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
| `RENDER_ERROR` | `render.error` | `{ error }` | A frame failed; the render loop stops |

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
| `tiledJob.progress` | `TiledJobProgressInfo` | At the start and after each tile |
| `tiledJob.complete` | `TiledJobCompleteInfo` | Files saved |

Each tile is also an ordinary production render, so `render.started` / `render.complete`
fire once per tile; a listener that means "the whole image" checks `app.isTiledRenderActive()`.

```typescript
interface TiledJobProgressInfo {
    width: number; height: number; spp: number;
    cols: number; rows: number;
    completedTiles: number; totalTiles: number;
    completed: [number, number][];        // [col, row], rows counted from the top
    current: [number, number] | null;     // the tile rendering now
}

interface TiledJobCompleteInfo {
    files: string[];
    elapsedSeconds: number;
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
- Export PNG/HDR buttons on completion (not after a tile: a tiled job saves its own files)
- Tile grid visualization for tiled renders; the bar shows the whole image's progress

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
| Low-res preview | Thumbnail composite of completed tiles during tiled rendering | Medium |
| Time estimation | ETA based on average tile render time | Low |
| Settings persistence | localStorage for render settings | Low |

## Tips

1. **Preview first**: Use interactive mode to frame your shot before production render
2. **Start small**: Test with 100-500 samples before committing to thousands
3. **Use HDR export**: For post-processing, HDR preserves full dynamic range
4. **Pause for changes**: You can pause, adjust non-locked parameters, then resume (accumulation will reset)
5. **Session save**: Use `autoSave: true` to save your settings with the render
