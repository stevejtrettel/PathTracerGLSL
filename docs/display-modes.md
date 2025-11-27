# Display Modes

The display mode system provides an abstraction layer between the rendering pipeline and on-screen presentation. Different modes handle how rendered output is displayed to the user.

## Design Principles

1. **Separation of Concerns**: Rendering produces output; display modes present it
2. **Extensible**: Easy to add custom display modes
3. **Lifecycle-Aware**: Proper activation/deactivation hooks
4. **Frame-Aware**: Can update UI each frame with render stats

## Architecture

```
src/app/display/
├── DisplayMode.ts      # Interface definition
├── FullscreenDisplay.ts # Default implementation
├── DisplayManager.ts   # Mode registration and switching
└── index.ts            # Public exports
```

## Concepts

### Rendering vs Display

The path tracer renders to offscreen buffers. The display mode handles:

- How the output appears on screen
- Additional UI overlays (progress bars, stats)
- Scaling/cropping for different resolutions
- User interaction specific to display mode

This separation allows:
- High-resolution production renders displayed at preview scale
- Tiled rendering progress visualization
- Split-screen comparisons
- Custom presentation modes

## Quick Start

```typescript
import { DisplayManager, FullscreenDisplay } from './app/display/index.js';

// Create manager (includes fullscreen mode by default)
const displayManager = new DisplayManager();

// Initialize with context
displayManager.initialize({
    canvas,
    gl,
    container: document.getElementById('canvas-container')
});

// Switch modes (if you have others registered)
displayManager.setMode('fullscreen');
```

## DisplayMode Interface

```typescript
interface DisplayMode {
    readonly id: string;

    // Called when mode becomes active
    activate(context: DisplayModeContext): void;

    // Called when switching away
    deactivate(): void;

    // Optional: handle resize
    onResize?(width: number, height: number): void;

    // Optional: update each frame
    onFrame?(frameInfo: DisplayFrameInfo): void;

    // Cleanup resources
    dispose(): void;
}
```

### DisplayModeContext

```typescript
interface DisplayModeContext {
    canvas: HTMLCanvasElement;
    gl: WebGL2RenderingContext;
    container: HTMLElement;
}
```

### DisplayFrameInfo

```typescript
interface DisplayFrameInfo {
    samples: number;           // Current sample count
    targetSamples?: number;    // Target (production mode)
    fps: number;               // Frames per second
    elapsedMs: number;         // Total elapsed time
    state: 'rendering' | 'paused' | 'complete' | 'stopped';
    mode: 'interactive' | 'production';
}
```

## Built-in Display Modes

### FullscreenDisplay

The default display mode. Canvas fills its container.

```typescript
import { FullscreenDisplay } from './app/display/index.js';

const fullscreen = new FullscreenDisplay();
displayManager.register(fullscreen);
```

Behavior:
- Sets canvas to 100% width/height
- No additional UI
- Handles resize by updating canvas buffer size

## DisplayManager

The `DisplayManager` handles mode registration and switching.

```typescript
class DisplayManager {
    // Initialize with context
    initialize(context: DisplayModeContext): void;

    // Register a mode
    register(mode: DisplayMode): void;

    // Unregister a mode
    unregister(id: string): void;

    // Get current mode
    get activeMode(): DisplayMode | null;
    get activeModeId(): string | null;

    // Get all registered modes
    get modeIds(): string[];

    // Switch modes
    setMode(id: string): void;

    // Check if mode exists
    hasMode(id: string): boolean;
    getMode(id: string): DisplayMode | undefined;

    // Handle events
    onResize(width: number, height: number): void;
    onFrame(frameInfo: DisplayFrameInfo): void;

    // Cleanup
    dispose(): void;
}
```

## Creating Custom Display Modes

### Example: Preview Display

A mode that displays high-res renders at a scaled preview size:

```typescript
import type { DisplayMode, DisplayModeContext, DisplayFrameInfo } from './app/display/index.js';
import { Panel, Slider, Button } from './app/ui/index.js';

export class PreviewDisplay implements DisplayMode {
    readonly id = 'preview';

    private canvas: HTMLCanvasElement | null = null;
    private container: HTMLElement | null = null;
    private panel: Panel | null = null;
    private scale = 0.5;

    activate(context: DisplayModeContext): void {
        this.canvas = context.canvas;
        this.container = context.container;

        // Scale canvas down for preview
        this.updateScale();

        // Add UI for controlling scale
        this.panel = new Panel({ title: 'Preview' });
        this.panel.add(new Slider(this.scale, {
            label: 'Scale',
            min: 0.1,
            max: 1.0,
            step: 0.1,
            onChange: (v) => {
                this.scale = v;
                this.updateScale();
            }
        }));
        this.panel.mount(this.container);
    }

    private updateScale(): void {
        if (this.canvas) {
            this.canvas.style.width = `${this.scale * 100}%`;
            this.canvas.style.height = `${this.scale * 100}%`;
        }
    }

    deactivate(): void {
        // Reset canvas
        if (this.canvas) {
            this.canvas.style.width = '100%';
            this.canvas.style.height = '100%';
        }

        // Remove UI
        this.panel?.dispose();
        this.panel = null;
    }

    dispose(): void {
        this.deactivate();
        this.canvas = null;
        this.container = null;
    }
}
```

### Example: Progress Display

Shows render progress with a progress bar:

```typescript
export class ProgressDisplay implements DisplayMode {
    readonly id = 'progress';

    private progressBar: HTMLElement | null = null;
    private container: HTMLElement | null = null;

    activate(context: DisplayModeContext): void {
        this.container = context.container;

        // Create progress bar
        this.progressBar = document.createElement('div');
        this.progressBar.style.cssText = `
            position: absolute;
            bottom: 20px;
            left: 50%;
            transform: translateX(-50%);
            width: 300px;
            height: 4px;
            background: rgba(255, 255, 255, 0.2);
            border-radius: 2px;
            overflow: hidden;
        `;

        const fill = document.createElement('div');
        fill.style.cssText = `
            width: 0%;
            height: 100%;
            background: #4a9eff;
            transition: width 0.1s ease;
        `;
        fill.id = 'progress-fill';
        this.progressBar.appendChild(fill);

        this.container.appendChild(this.progressBar);
    }

    onFrame(frameInfo: DisplayFrameInfo): void {
        if (frameInfo.targetSamples && this.progressBar) {
            const progress = (frameInfo.samples / frameInfo.targetSamples) * 100;
            const fill = this.progressBar.querySelector('#progress-fill') as HTMLElement;
            if (fill) {
                fill.style.width = `${progress}%`;
            }
        }
    }

    deactivate(): void {
        this.progressBar?.remove();
        this.progressBar = null;
    }

    dispose(): void {
        this.deactivate();
    }
}
```

## Registering Custom Modes

```typescript
import { DisplayManager } from './app/display/index.js';
import { PreviewDisplay } from './custom/PreviewDisplay.js';
import { ProgressDisplay } from './custom/ProgressDisplay.js';

const displayManager = new DisplayManager();

// Register custom modes
displayManager.register(new PreviewDisplay());
displayManager.register(new ProgressDisplay());

// Initialize
displayManager.initialize({ canvas, gl, container });

// Switch modes
displayManager.setMode('preview');
displayManager.setMode('progress');
displayManager.setMode('fullscreen'); // Built-in default
```

## Integration with App

The display system is designed to work with the App class but doesn't require it:

```typescript
// With App (future integration)
app.setDisplayMode('preview');

// Or standalone
const displayManager = new DisplayManager();
displayManager.initialize({ canvas, gl, container });
displayManager.setMode('preview');

// Update each frame
function render() {
    // ... render ...

    displayManager.onFrame({
        samples: currentSamples,
        targetSamples: 10000,
        fps: 60,
        elapsedMs: performance.now() - startTime,
        state: 'rendering',
        mode: 'production'
    });

    requestAnimationFrame(render);
}
```

## Future Display Modes

The system is designed to support:

### ProductionDisplay

For high-resolution offline renders:
- Render at higher resolution than display
- Show scaled preview during render
- Progress bar with ETA
- Pause/resume controls
- Export when complete

### TiledDisplay

For very large renders:
- Show tile grid
- Highlight active tiles
- Per-tile progress
- Memory-efficient rendering

### ComparisonDisplay

For comparing renderers:
- Split screen view
- Slider to compare
- A/B toggle

### StereoDisplay

For VR/3D:
- Side-by-side rendering
- Anaglyph mode
- VR headset output

## Cleanup

```typescript
// Cleanup when done
displayManager.dispose();
```

This deactivates the current mode and disposes all registered modes.
