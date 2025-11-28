# Production Rendering System

## Implementation Status

This document describes the production rendering system for high-resolution tiled renders.

### What's Done

| Component | Location | Status |
|-----------|----------|--------|
| UIExtension base class | `src/app/extensions/UIExtension.ts` | Complete |
| TiledRenderer with events | `src/app/TiledRenderer.ts` | Complete |
| Tile progress visualization | `src/app/extensions/ProductionPanelExtension.ts` | Complete |
| Tile grid CSS | `src/app/ui/styles/extensions.css` | Complete |
| Shared utilities | `src/app/utils/format.ts`, `dom.ts` | Complete |
| Layout system | `src/app/layout/` | Complete |
| Production mode events | `EventBus` | Complete |

### What's Left to Optimize

| Component | Description | Priority |
|-----------|-------------|----------|
| Settings Modal | UI for configuring render before starting | High |
| Low-res preview | Thumbnail of completed tiles | Medium |
| Time estimation | ETA based on render rate | Low |
| Settings persistence | localStorage for render settings | Low |

---

## Architecture

### Three-Layer Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                         App Layer                           │
│  - App (orchestration)                                      │
│  - TiledRenderer (tiled job management)                     │
│  - Extensions (UI components)                               │
│  - EventBus (event coordination)                            │
├─────────────────────────────────────────────────────────────┤
│                        Engine Layer                         │
│  - Engine (GPU execution)                                   │
│  - RenderCoordinator (render loop, production mode)         │
├─────────────────────────────────────────────────────────────┤
│                       Compiler Layer                        │
│  - SimpleCompiler (code generation)                         │
└─────────────────────────────────────────────────────────────┘
```

### Render Mode System

The system uses `RenderCoordinator` to manage render modes:

```typescript
type RenderMode = 'interactive' | 'production';
type RenderState = 'rendering' | 'paused' | 'complete' | 'stopped';
```

**Events emitted by RenderCoordinator:**
- `render.started` - Render begins (includes `mode` and `targetSamples`)
- `render.progress` - Per-frame progress update
- `render.complete` - Production render reached target
- `render.stopped` - Render cancelled
- `render.locked` / `render.unlocked` - Parameter locking state

---

## Tiled Rendering

### Overview

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

### Tile Events

TiledRenderer emits these events through EventBus:

```typescript
// Job-level progress
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

bus.on('tiledJob.progress', (info: TiledJobProgressInfo) => {
    console.log(`${info.completedTiles}/${info.totalTiles} tiles done`);
});

bus.on('tiledJob.complete', (data) => {
    console.log(`Job ${data.jobId} complete in ${data.elapsedSeconds}s`);
});

// Individual tile events
interface TileProgressInfo {
    tileX: number;
    tileY: number;
    tileIndex: number;
    totalTiles: number;
    grid: TileGrid;
}

bus.on('tile.start', (info: TileProgressInfo) => { ... });
bus.on('tile.complete', (info: TileProgressInfo) => { ... });
```

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

---

## UI Extensions

### UIExtension Base Class

Location: `src/app/extensions/UIExtension.ts`

All UI extensions extend this base class for consistent behavior:

```typescript
abstract class UIExtension implements Extension {
    abstract readonly name: string;
    protected abstract readonly region: RegionName;

    // Lifecycle
    protected abstract createRoot(): HTMLElement;
    protected abstract setup(): void;
    protected cleanup(): void {}

    // Visibility
    show(): void;
    hide(): void;
    toggle(): void;
    get isVisible(): boolean;

    // Event helpers (auto-cleanup on uninstall)
    protected on(event: string, handler: (data?: any) => void): void;
}
```

**Features:**
- Mounts to layout region if available, otherwise standalone
- Automatic event subscription cleanup
- Show/hide/toggle visibility helpers
- Consistent install/uninstall lifecycle

### ProductionPanelExtension

Location: `src/app/extensions/ProductionPanelExtension.ts`

Shows production render progress at the bottom of the screen.

**Features:**
- Progress bar with percentage
- Sample count, elapsed time, ETA
- Tile grid visualization (for tiled renders)
- Pause/Resume/Cancel buttons
- Export PNG/HDR buttons on completion

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

**Events Listened:**
- `render.started` - Show panel for production mode
- `render.progress` - Update stats and progress bar
- `render.complete` - Show export buttons
- `render.stopped` - Hide panel
- `tiledJob.progress` - Update tile grid

### StatsPanel

Location: `src/app/extensions/StatsPanel.ts`

Displays render statistics overlay (top-left).

**Features:**
- Sample count
- FPS
- Elapsed time
- Render state indicator
- Toggle with 'S' key
- Auto-hides during production renders

### RenderControlsExtension

Location: `src/app/extensions/RenderControlsExtension.ts`

Toolbar with render controls.

**Features:**
- Scene title
- Sample count input
- "Render" button to start production
- Disabled during production mode

### ParameterPanelExtension

Location: `src/app/extensions/ParameterPanelExtension.ts`

Slide-out panel for parameter editing.

**Features:**
- Auto-generates controls from metadata
- Groups parameters by category
- Toggle with 'Tab' key
- Hidden/disabled during production mode

---

## Shared Utilities

### formatTime

Location: `src/app/utils/format.ts`

```typescript
import { formatTime } from './utils/format.js';

formatTime(5000);    // "5s"
formatTime(125000);  // "2m 5s"
formatTime(3700000); // "1h 1m"
```

### isTypingInInput

Location: `src/app/utils/dom.ts`

```typescript
import { isTypingInInput } from './utils/dom.js';

document.addEventListener('keydown', (e) => {
    if (isTypingInInput(e)) return;  // Skip if user is typing
    // Handle keyboard shortcuts...
});
```

---

## CSS Structure

### Extension Styles

Location: `src/app/ui/styles/extensions.css`

**Production Panel:**
- `.production-panel` - Main container
- `.production-panel-progress` - Progress bar section
- `.production-panel-stats` - Statistics display
- `.production-panel-controls` - Button container
- `.production-panel-tiles` - Tile grid section

**Tile Grid:**
- `.tile-grid` - CSS grid container
- `.tile-cell` - Individual tile cell
- `.tile-cell.complete` - Completed tile (green + checkmark)
- `.tile-cell.current` - Current tile (blue + pulsing animation)
- `.tile-grid-header` - "Tiles" label and count

---

## Usage Example

### Starting a Tiled Production Render

```typescript
import { App, TiledRenderer } from './src/app/index.js';

// Create app
const app = App.create(document.body, { layout: 'fullscreen' });
await app.initialize({ scene, strategies });
app.start();

// Install extensions
app.use(new ProductionPanelExtension());
app.use(new StatsPanel());

// Start tiled render
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

### Listening to Progress

```typescript
const bus = app.getEventBus();

// Overall job progress
bus.on('tiledJob.progress', (info) => {
    console.log(`Tiles: ${info.completedTiles}/${info.totalTiles}`);
    if (info.currentTile) {
        console.log(`Rendering tile [${info.currentTile.x}, ${info.currentTile.y}]`);
    }
});

// Individual tile events
bus.on('tile.complete', (info) => {
    console.log(`Tile [${info.tileX}, ${info.tileY}] done`);
});

// Job completion
bus.on('tiledJob.complete', (data) => {
    console.log(`All ${data.totalTiles} tiles rendered in ${data.elapsedSeconds}s`);
});
```

---

## What's Not Implemented Yet

### Settings Modal

A modal dialog for configuring render settings before starting:
- Resolution presets (1080p, 4K, 8K) or custom
- Sample count presets (Draft, Preview, Production)
- Tiling options (enable/disable, tile size)
- Time/size estimation

**Proposed location:** `src/app/ui/containers/RenderSettingsModal.ts`

### Low-Resolution Preview

During tiled rendering, show a small preview of completed tiles:
- Downscale completed tiles to fit in preview area
- Update as each tile completes
- Helps verify render is proceeding correctly

**Proposed approach:** Store small thumbnail per tile, composite into preview canvas.

### Time Estimation

Calculate ETA based on:
- Average time per tile (from completed tiles)
- Remaining tiles
- Account for variance in render time

**Implementation note:** Already have `formatTime()` utility, just need the calculation logic.

---

## File Structure

```
src/app/
├── extensions/
│   ├── UIExtension.ts           # Base class for UI extensions
│   ├── ProductionPanelExtension.ts  # Production progress UI
│   ├── StatsPanel.ts            # Stats overlay
│   ├── RenderControlsExtension.ts   # Toolbar
│   ├── ParameterPanelExtension.ts   # Parameter panel
│   ├── KeyboardControls.ts      # Keyboard shortcuts
│   ├── AppShortcutsExtension.ts # App-level shortcuts
│   └── index.ts                 # Extension exports
├── utils/
│   ├── format.ts                # formatTime()
│   └── dom.ts                   # isTypingInInput()
├── ui/styles/
│   └── extensions.css           # Extension styling
├── TiledRenderer.ts             # Tiled rendering logic
├── RenderCoordinator.ts         # Render loop & mode management
├── App.ts                       # Main orchestrator
└── index.ts                     # Public exports
```

---

## Event Reference

### Render Events (from RenderCoordinator)

| Event | Data | Description |
|-------|------|-------------|
| `render.started` | `{ mode, targetSamples? }` | Render begins |
| `render.progress` | `ProgressInfo` | Per-frame update |
| `render.complete` | `{ samples, elapsedTime }` | Target reached |
| `render.stopped` | - | Render cancelled |
| `render.paused` | - | Render paused |
| `render.resumed` | - | Render resumed |
| `render.locked` | - | Parameters locked |
| `render.unlocked` | - | Parameters unlocked |

### Tile Events (from TiledRenderer)

| Event | Data | Description |
|-------|------|-------------|
| `tiledJob.progress` | `TiledJobProgressInfo` | Job-level progress |
| `tiledJob.complete` | `{ jobId, totalTiles, elapsedSeconds }` | All tiles done |
| `tile.start` | `TileProgressInfo` | Tile begins |
| `tile.complete` | `TileProgressInfo` | Tile finished |

---

## Summary

The production rendering system provides:

1. **Tiled Rendering** - Split large images into manageable tiles
2. **Event-Driven UI** - Extensions respond to render events automatically
3. **Visual Progress** - Tile grid with checkmarks and current tile highlight
4. **Auto-Save** - Tiles saved immediately as they complete
5. **Pause/Resume** - Control render execution

The core infrastructure is complete. Remaining work is UI polish (settings modal, preview, estimation).
