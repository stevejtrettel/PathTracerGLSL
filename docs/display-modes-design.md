# Display Mode System - Design Document

## Overview

The display mode system provides an abstraction layer between the rendering pipeline and on-screen presentation. While the renderer produces frames to offscreen buffers, display modes control how that output is presented to the user.

## Motivation

Currently, the path tracer has two distinct use cases:

1. **Interactive Mode**: Real-time preview with camera controls, low sample counts, immediate feedback
2. **Production Mode**: High-quality offline renders with many samples, potentially higher resolution

These modes have different display requirements:

| Aspect | Interactive | Production |
|--------|-------------|------------|
| Resolution | Match viewport | Can exceed viewport (4K, 8K) |
| Samples | Low (1-100) | High (1000-100000+) |
| Frame rate | 60fps target | Doesn't matter |
| User feedback | Immediate | Progress bar, ETA |
| Controls | Camera orbit, parameter tweaks | Start/pause/cancel, export |

The display mode system decouples these concerns from the core renderer.

## Current State

### What Exists

```
src/app/display/
├── DisplayMode.ts      # Interface definition
├── FullscreenDisplay.ts # Default mode (canvas fills container)
├── DisplayManager.ts   # Registration and switching
└── index.ts
```

The interface is defined but minimal:

```typescript
interface DisplayMode {
    readonly id: string;
    activate(context: DisplayModeContext): void;
    deactivate(): void;
    onResize?(width: number, height: number): void;
    onFrame?(frameInfo: DisplayFrameInfo): void;
    dispose(): void;
}
```

### What's Missing

1. **ProductionDisplay** - The main display mode for offline rendering
2. **Integration with Engine** - How display modes interact with render loop
3. **Resolution independence** - Rendering at different resolution than display
4. **Export functionality** - Saving rendered images
5. **Progress/stats UI** - Visual feedback during long renders

## Proposed Architecture

### Core Concept: Render Target vs Display Target

```
┌─────────────────────────────────────────────────────────────┐
│                        Engine                                │
│  ┌─────────────────┐    ┌─────────────────┐                 │
│  │  Render Target  │───▶│ Accumulation    │                 │
│  │  (framebuffer)  │    │ Buffer          │                 │
│  │  [render res]   │    │ [render res]    │                 │
│  └─────────────────┘    └────────┬────────┘                 │
└──────────────────────────────────┼──────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────┐
│                    Display Mode                              │
│  ┌─────────────────┐    ┌─────────────────┐                 │
│  │  Tonemapping/   │───▶│  Display Canvas │                 │
│  │  Post-process   │    │  [display res]  │                 │
│  └─────────────────┘    └─────────────────┘                 │
│                                                              │
│  ┌─────────────────────────────────────────┐                │
│  │  Mode-specific UI (progress, controls)  │                │
│  └─────────────────────────────────────────┘                │
└─────────────────────────────────────────────────────────────┘
```

### Display Modes to Implement

#### 1. FullscreenDisplay (exists)
- Canvas fills container
- Render resolution = display resolution
- No additional UI

#### 2. ProductionDisplay (new)
Primary mode for offline rendering.

**Features:**
- Render at configurable resolution (independent of display)
- Scale preview to fit display while rendering
- Progress bar with sample count and ETA
- Start/pause/resume/cancel controls
- Export when complete (PNG, EXR)
- Optional: render queue for multiple frames

**UI Elements:**
```
┌────────────────────────────────────────────────┐
│                                                │
│     ┌────────────────────────────────┐        │
│     │                                │        │
│     │    Scaled Preview              │        │
│     │    (fit to display)            │        │
│     │                                │        │
│     └────────────────────────────────┘        │
│                                                │
│  ┌──────────────────────────────────────────┐ │
│  │ ████████████░░░░░░░░  1234/10000 samples │ │
│  │ ETA: 2:34 remaining   [Pause] [Cancel]   │ │
│  └──────────────────────────────────────────┘ │
│                                                │
│  Resolution: 3840x2160  |  [Export PNG]       │
└────────────────────────────────────────────────┘
```

#### 3. ComparisonDisplay (future)
For A/B comparison of different renderers or settings.

**Features:**
- Split screen or slider comparison
- Sync camera between views
- Toggle between views

#### 4. TiledDisplay (future)
For very large renders that don't fit in GPU memory.

**Features:**
- Divide render into tiles
- Show tile grid progress
- Stitch tiles together
- Memory-efficient for 16K+ renders

### Integration Points

#### With Engine

The Engine needs to support:
```typescript
interface Engine {
    // Current
    render(): void;
    resize(width: number, height: number): void;

    // New: render target management
    setRenderResolution(width: number, height: number): void;
    getRenderResolution(): { width: number; height: number };

    // New: production render control
    startProductionRender(options: ProductionRenderOptions): void;
    pauseRender(): void;
    resumeRender(): void;
    cancelRender(): void;

    // New: frame info for display modes
    getFrameInfo(): DisplayFrameInfo;

    // New: export
    getPixelData(): Float32Array;  // HDR data for export
}
```

#### With App

```typescript
// App gains display mode control
app.setDisplayMode('production');
app.getDisplayManager().getMode('production').configure({
    resolution: [3840, 2160],
    targetSamples: 10000,
    autoExport: true,
    exportFormat: 'png'
});

// Start production render
app.startProductionRender();
```

### ProductionDisplay Implementation Plan

#### Phase 1: Basic Production Mode
1. Create `ProductionDisplay` class
2. Add resolution independence (render res != display res)
3. Add scaled preview (fit rendered output to display)
4. Basic progress bar showing sample count

#### Phase 2: Controls and Feedback
1. Start/pause/resume/cancel buttons
2. ETA calculation based on samples/second
3. Elapsed time display
4. Sample rate (samples/sec) display

#### Phase 3: Export
1. PNG export (8-bit, tonemapped)
2. EXR export (32-bit HDR, requires library)
3. Auto-export on completion option
4. Filename templating (scene name, timestamp, samples)

#### Phase 4: Polish
1. Keyboard shortcuts (Space=pause, Esc=cancel)
2. Sound notification on completion
3. Render queue for animations
4. History/gallery of completed renders

## Usage Examples

### Basic Production Render

```typescript
import { App } from './app/index.js';
import { ProductionDisplay } from './app/display/index.js';

const app = new App(canvas);
await app.initialize({ scene, strategies });

// Register production display
app.getDisplayManager().register(new ProductionDisplay());

// Switch to production mode
app.setDisplayMode('production');

// Configure and start
const production = app.getDisplayManager().getMode('production') as ProductionDisplay;
production.configure({
    width: 3840,
    height: 2160,
    targetSamples: 10000
});

production.onComplete((result) => {
    // Auto-download or show export dialog
    result.exportPNG('render.png');
});

production.start();
```

### Integrated Workflow

```typescript
// In ParameterPanelExtension or custom UI
const renderButton = new Button('Render', () => {
    app.setDisplayMode('production');
    app.startProductionRender({
        resolution: [3840, 2160],
        samples: 10000
    });
});

const previewButton = new Button('Preview', () => {
    app.setDisplayMode('fullscreen');
    app.startInteractiveMode();
});
```

## Key Decisions Needed

1. **EXR Support**: Do we need HDR export? Requires additional library (e.g., OpenEXR.js)

2. **Tiled Rendering**: Is this needed for v1? Adds significant complexity.

3. **Render Queue**: Should we support queuing multiple renders (for animations)?

4. **Resolution Presets**: Should we include common presets (1080p, 4K, 8K)?

5. **Memory Management**: How to handle very large render buffers?

## File Structure (Proposed)

```
src/app/display/
├── DisplayMode.ts           # Interface (exists)
├── DisplayManager.ts        # Manager (exists)
├── FullscreenDisplay.ts     # Default mode (exists)
├── ProductionDisplay.ts     # NEW: Production rendering
├── ProductionControls.ts    # NEW: UI for production mode
├── ProgressBar.ts           # NEW: Reusable progress component
├── RenderExporter.ts        # NEW: Export functionality
└── index.ts                 # Exports
```

## Dependencies

- **UI Components**: Uses Panel, Button, Slider from `src/app/ui/`
- **Engine**: Needs additions for render target management
- **Layout**: Uses AppLayout regions for UI placement

## Success Criteria

1. User can render at higher resolution than display
2. Clear progress feedback during long renders
3. Pause/resume without losing progress
4. Export completed renders to PNG
5. Smooth transition between interactive and production modes
6. No performance impact when in interactive mode

## Timeline Estimate

- Phase 1 (Basic): Core functionality
- Phase 2 (Controls): User interaction
- Phase 3 (Export): Output capabilities
- Phase 4 (Polish): Quality of life improvements

## Questions for Discussion

1. What resolution options should be available?
2. Is EXR export a requirement?
3. Should we integrate with the parameter system (render settings as parameters)?
4. How should we handle browser tab backgrounding during long renders?
5. Should completed renders be cached/stored?
