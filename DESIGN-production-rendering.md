# Production Rendering System - Design Document

## Overview

This document describes the design for a comprehensive production rendering system. The goal is to provide a complete workflow for high-quality offline renders, separate from the interactive preview mode.

**Two distinct concerns:**

1. **Render Settings** - UI for configuring production render parameters before starting
2. **Production Display** - Dedicated view during rendering with progress visualization

---

## User Workflow

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│ Interactive │────▶│ Configuring │────▶│  Rendering  │────▶│  Complete   │
│    Mode     │     │   (Modal)   │     │   (Layout)  │     │  (Export)   │
└─────────────┘     └─────────────┘     └─────────────┘     └─────────────┘
       ▲                   │                   │                   │
       └───────────────────┴───────────────────┴───────────────────┘
                              cancel / return to interactive
```

1. **Interactive Mode**: User explores scene, adjusts parameters, previews in real-time
2. **Configuring**: User opens render settings modal, configures resolution/samples/tiling
3. **Rendering**: Layout switches to production display, shows progress and preview
4. **Complete**: Render finished, export options available, can return to interactive

---

## Part 1: Render Settings

### Purpose

A modal dialog where the user configures all production render parameters before starting.

### UI Mockup

```
┌─────────────────────────────────────────────────┐
│  Production Render Settings                [×]  │
├─────────────────────────────────────────────────┤
│                                                 │
│  Resolution                                     │
│  ┌───────────────────────────────────────────┐  │
│  │ ○ Canvas size (1920 × 1080)               │  │
│  │ ○ Preset: [1080p ▼] [4K ▼] [8K ▼]         │  │
│  │ ○ Custom: [____] × [____]                 │  │
│  └───────────────────────────────────────────┘  │
│                                                 │
│  Quality                                        │
│  Samples: [==========|==========] 1024          │
│  (or presets: Draft 256 | Preview 512 |         │
│   Production 2048 | High 4096)                  │
│                                                 │
│  Tiling                                         │
│  [×] Enable tiled rendering                     │
│      Tile size: [256 ▼] × [256 ▼]              │
│      (Recommended for resolutions > 4K)         │
│                                                 │
│  ───────────────────────────────────────────    │
│                                                 │
│  Estimated time: ~5 min (based on current FPS)  │
│  Output size: 1920×1080, ~6MB PNG               │
│                                                 │
│                [Cancel]    [Start Render]       │
└─────────────────────────────────────────────────┘
```

### Data Structure

```typescript
interface ProductionRenderSettings {
    // Resolution
    resolutionMode: 'canvas' | 'preset' | 'custom';
    preset?: '720p' | '1080p' | '2k' | '4k' | '8k';
    customWidth?: number;
    customHeight?: number;

    // Computed final resolution
    readonly width: number;
    readonly height: number;

    // Sampling
    targetSamples: number;

    // Tiling
    tilingEnabled: boolean;
    tileWidth: number;
    tileHeight: number;

    // Computed tile info
    readonly tileGrid: [number, number];  // e.g., [4, 3] = 12 tiles
    readonly totalTiles: number;
}
```

### Resolution Presets

| Preset | Resolution | Aspect Ratio |
|--------|------------|--------------|
| 720p   | 1280×720   | 16:9         |
| 1080p  | 1920×1080  | 16:9         |
| 2K     | 2560×1440  | 16:9         |
| 4K     | 3840×2160  | 16:9         |
| 8K     | 7680×4320  | 16:9         |

### Implementation Considerations

- **Where settings live**: Could be a standalone `RenderSettingsModal` component, or part of a `ProductionRenderExtension`
- **Persistence**: Should settings persist in localStorage between sessions?
- **Validation**: Warn if resolution is very large without tiling enabled
- **Time estimation**: Based on current render FPS and sample count

---

## Part 2: Production Display Mode

### Purpose

A dedicated layout mode during production rendering that provides:
- Visual preview of the render in progress
- Tile progress visualization (for tiled renders)
- Detailed statistics and ETA
- Render controls (pause/resume/cancel)
- Export options on completion

### Layout: `data-layout="production"`

```
┌─────────────────────────────────────────────────────────────────────┐
│ region-toolbar                                                      │
│ "Production Render: cornell-box"           [Pause] [Cancel]         │
├─────────────────────────────────────┬───────────────────────────────┤
│                                     │ region-right                  │
│  canvas-container                   │                               │
│  ┌─────────────────────────────┐   │ ┌───────────────────────────┐ │
│  │                             │   │ │ Progress                  │ │
│  │                             │   │ │ ████████████░░░░░░ 67%    │ │
│  │    Render Preview           │   │ │                           │ │
│  │    (scaled to fit)          │   │ │ Samples: 687 / 1024      │ │
│  │                             │   │ │ Time: 5m 12s              │ │
│  │                             │   │ │ ETA: 2m 34s               │ │
│  └─────────────────────────────┘   │ │ Rate: 2.3 samples/sec     │ │
│                                     │ └───────────────────────────┘ │
│  Tile Grid (if tiling enabled)     │                               │
│  ┌───┬───┬───┬───┐                 │ ┌───────────────────────────┐ │
│  │ ✓ │ ✓ │ ✓ │ ✓ │                 │ │ Tiles                     │ │
│  ├───┼───┼───┼───┤                 │ │ ████████████░░░░ 12/16    │ │
│  │ ✓ │ ✓ │ ✓ │ ▶ │  ← current     │ │                           │ │
│  ├───┼───┼───┼───┤                 │ │ Current: Tile 8 (2,1)     │ │
│  │ ✓ │ ✓ │ ░ │ ░ │                 │ │ Tile samples: 450/1024    │ │
│  ├───┼───┼───┼───┤                 │ └───────────────────────────┘ │
│  │ ░ │ ░ │ ░ │ ░ │                 │                               │
│  └───┴───┴───┴───┘                 │ ┌───────────────────────────┐ │
│                                     │ │ On Complete:              │ │
│                                     │ │ [Export PNG] [Export HDR] │ │
│                                     │ │ [Return to Interactive]   │ │
│                                     │ └───────────────────────────┘ │
├─────────────────────────────────────┴───────────────────────────────┤
│ region-statusbar                                                    │
│ [████████████████████░░░░░░░░░░] 67% | 687/1024 samples | ETA 2:34  │
└─────────────────────────────────────────────────────────────────────┘
```

### Preview Rendering

**Options:**

1. **Scaled display of full buffer**: Render at full resolution, display scaled down
   - Pro: See actual pixels
   - Con: Memory intensive for large renders

2. **Separate preview buffer**: Maintain a small preview texture updated periodically
   - Pro: Fast, low memory
   - Con: Not pixel-accurate

3. **Progressive display**: Show tiles as they complete
   - Pro: Visual feedback of progress
   - Con: May look choppy

**Recommendation**: For tiled rendering, show completed tiles at full resolution in their grid positions. For non-tiled, scale the live buffer to fit.

### Tile Progress Visualization

**Tile States:**
- `pending` (░) - Not started
- `rendering` (▶) - Currently rendering
- `complete` (✓) - Finished

**Data Structure:**

```typescript
interface TileState {
    index: number;
    gridPosition: [number, number];  // [col, row]
    pixelBounds: { x: number, y: number, width: number, height: number };
    state: 'pending' | 'rendering' | 'complete';
    samples: number;
}

interface TileProgress {
    grid: [number, number];           // [cols, rows]
    tiles: TileState[];
    currentTileIndex: number | null;
    completedCount: number;
    totalTiles: number;
}
```

### Render Controls During Production

| Control | Behavior |
|---------|----------|
| **Pause** | Stop accumulating samples, keep current state |
| **Resume** | Continue from where paused |
| **Cancel** | Abort render, return to interactive (confirm dialog?) |
| **Export** | Available on completion, or mid-render for current state |

---

## Part 3: Current System Analysis

### What Exists

| Component | Location | Status |
|-----------|----------|--------|
| Layout system | `src/app/layout/` | ✅ Ready (need to add 'production' mode) |
| Modal component | `src/app/ui/containers/Modal.ts` | ✅ Exists |
| Form inputs | `src/app/ui/inputs/` | ✅ Complete |
| Progress events | `EventBus` → `render.progress` | ✅ Exists (needs tile info) |
| Tiled rendering | `App.setPixelOffset()`, `setImageSize()` | ✅ Engine supports |
| Export | `App.exportPNG()`, `exportHDR()` | ✅ Exists |
| Pause/Resume | `App.pause()`, `resume()` | ✅ Exists |

### What Needs to Be Added

| Component | Description | Priority |
|-----------|-------------|----------|
| `ProductionRenderSettings` | Data structure for render config | High |
| `RenderSettingsModal` | UI for configuring render | High |
| `production` layout mode | CSS for production display | High |
| `ProductionDisplayExtension` | Main production mode UI | High |
| Tile progress tracking | Engine → UI tile state | Medium |
| Preview rendering | Scaled preview during render | Medium |
| State machine | App state: interactive/configuring/rendering/complete | Medium |
| Time estimation | ETA based on render rate | Low |

---

## Part 4: Extension Coordination

### How Extensions Respond to Production Mode

Extensions need to know when production mode starts/ends:

```typescript
// Option A: EventBus events
bus.on('production.start', (settings: ProductionRenderSettings) => { ... });
bus.on('production.complete', () => { ... });
bus.on('production.cancel', () => { ... });

// Option B: App state query
if (app.getState() === 'production') { ... }

// Option C: Mode change event
bus.on('mode.change', (mode: 'interactive' | 'production') => { ... });
```

### Extension Behavior by Mode

| Extension | Interactive Mode | Production Mode |
|-----------|-----------------|-----------------|
| `ParameterPanelExtension` | Normal (Tab toggle) | Hidden or disabled |
| `StatsPanel` | Top-left overlay | Hidden (info in production panel) |
| `RenderControlsExtension` | Toolbar with "Render" button | Hidden (controls in production panel) |
| `OrbitControls` | Active | Disabled (camera locked) |
| `ProductionDisplayExtension` | Hidden/inactive | Active, takes over layout |

---

## Part 5: State Machine

### Application States

```typescript
type AppMode = 'interactive' | 'configuring' | 'production' | 'complete';

interface AppState {
    mode: AppMode;

    // Only when mode === 'production' or 'complete'
    productionSettings?: ProductionRenderSettings;
    productionProgress?: ProductionProgress;
}
```

### State Transitions

```
                    ┌──────────────────────────────────────┐
                    ▼                                      │
┌─────────────┐  openSettings()  ┌─────────────┐          │
│ interactive │─────────────────▶│ configuring │          │
└─────────────┘                  └─────────────┘          │
       ▲                               │                  │
       │                    startRender()                 │
       │                               ▼                  │
       │                         ┌───────────┐            │
       │ cancel()                │production │───────────▶│
       └─────────────────────────┴───────────┘  complete  │
                                       │                  │
                                cancel()                  │
                                       │                  │
                                       └──────────────────┘
```

### Where State Lives

**Option A: In App**
```typescript
class App {
    private _mode: AppMode = 'interactive';

    get mode(): AppMode { return this._mode; }

    openRenderSettings(): void { ... }
    startProduction(settings: ProductionRenderSettings): void { ... }
    cancelProduction(): void { ... }
}
```

**Option B: In separate RenderSession**
```typescript
class RenderSession {
    readonly settings: ProductionRenderSettings;
    readonly progress: ProductionProgress;

    start(): Promise<void>;
    pause(): void;
    resume(): void;
    cancel(): void;
}

// App creates sessions
const session = app.createRenderSession(settings);
await session.start();
```

**Recommendation**: Option B provides cleaner separation. A RenderSession encapsulates everything about one production render.

---

## Part 6: Engine Integration

### Current Tiled Rendering API

```typescript
// Set the region of the full image this render covers
app.setPixelOffset(tileX * tileWidth, tileY * tileHeight);
app.setImageSize(fullWidth, fullHeight);

// Render to the tile-sized canvas
// ... rendering happens ...

// Read pixels and composite into full image buffer
```

### Needed: Tile Progress Events

```typescript
interface TileProgressEvent {
    type: 'tile.start' | 'tile.progress' | 'tile.complete';
    tileIndex: number;
    gridPosition: [number, number];
    samples: number;
    targetSamples: number;
}

bus.on('tile.start', (e: TileProgressEvent) => { ... });
bus.on('tile.progress', (e: TileProgressEvent) => { ... });
bus.on('tile.complete', (e: TileProgressEvent) => { ... });
```

### Full Image Buffer Management

For tiled rendering, need an offscreen buffer to composite tiles:

```typescript
class TiledRenderBuffer {
    private buffer: ImageData | Float32Array;  // HDR support

    constructor(width: number, height: number, hdr: boolean);

    writeTile(x: number, y: number, data: ImageData): void;
    getFullImage(): ImageData;
    exportPNG(): Blob;
    exportHDR(): Blob;
}
```

---

## Part 7: Implementation Phases

### Phase 1: Foundation
- [ ] Add `production` layout mode CSS
- [ ] Create `ProductionRenderSettings` type
- [ ] Add App state machine (mode property)
- [ ] Add mode change events to EventBus

### Phase 2: Settings Modal
- [ ] Create `RenderSettingsModal` using existing Modal + inputs
- [ ] Resolution presets and custom input
- [ ] Sample count with presets
- [ ] Tiling toggle and size config
- [ ] Time/size estimation

### Phase 3: Production Display
- [ ] Create `ProductionDisplayExtension`
- [ ] Production layout regions (preview + info panel)
- [ ] Progress visualization (overall + per-tile)
- [ ] Render controls (pause/resume/cancel)
- [ ] Export UI on completion

### Phase 4: Tiled Rendering Integration
- [ ] Tile progress events from engine
- [ ] Tile grid visualization
- [ ] `TiledRenderBuffer` for compositing
- [ ] Preview of completed tiles

### Phase 5: Polish
- [ ] Time estimation algorithm
- [ ] Persist settings to localStorage
- [ ] Keyboard shortcuts for production mode
- [ ] Animation/transitions between modes

---

## Open Questions

1. **Preview strategy**: Should we render a separate low-res preview, or just scale the full buffer?

2. **Tile compositing**: WebGL offscreen buffer, or CPU-side ImageData?

3. **Memory management**: For 8K renders, how do we handle memory limits?

4. **Cancel confirmation**: Require confirmation to cancel mid-render?

5. **Background rendering**: Could the render continue if user switches tabs? (Service Worker?)

6. **Batch rendering**: Future support for rendering multiple frames/cameras?

---

## File Structure (Proposed)

```
src/app/
├── production/
│   ├── index.ts
│   ├── ProductionRenderSettings.ts    # Data types
│   ├── RenderSession.ts               # State machine for one render
│   ├── TiledRenderBuffer.ts           # Tile compositing
│   └── ProductionDisplayExtension.ts  # Main UI extension
├── ui/
│   └── containers/
│       └── RenderSettingsModal.ts     # Settings modal
└── layout/
    └── layouts.css                    # Add [data-layout="production"]
```

---

## Summary

The production rendering system consists of:

1. **Settings Modal**: Configure resolution, samples, tiling before render
2. **Production Layout Mode**: Dedicated view during rendering
3. **RenderSession**: State machine managing one production render
4. **Tile Progress**: Track and visualize tile-by-tile progress
5. **Extension Coordination**: Other extensions respond to mode changes

The existing infrastructure (layout system, UI components, engine tiling support) provides a solid foundation. The main work is:
- Adding a new layout mode
- Building the settings modal
- Creating the production display extension
- Connecting tile progress from engine to UI
