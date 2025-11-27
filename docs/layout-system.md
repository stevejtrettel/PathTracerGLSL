# Layout System

The layout system provides flexible page arrangements for different use cases. It manages named regions and CSS-driven layouts that adapt to various screen configurations.

## Design Principles

1. **CSS-Driven**: Layouts are controlled via CSS using `data-layout` attribute
2. **Standalone**: Works independently or integrates with App
3. **Region-Based**: Creates and manages named DOM regions
4. **Configurable**: CSS custom properties control dimensions

## Architecture

```
src/app/layout/
├── AppLayout.ts     # Region management and mode switching
├── layouts.css      # CSS for all layout modes
└── index.ts         # Public exports
```

## Quick Start

```typescript
import { AppLayout } from './app/layout/index.js';

// Create layout
const layout = new AppLayout(document.body, {
    mode: 'fullscreen',
    variables: {
        '--layout-sidebar-width': '340px'
    }
});

// Get regions
const canvasContainer = layout.getCanvasContainer();
const rightPanel = layout.getRegion('region-right');

// Add your canvas to the canvas container
const canvas = document.createElement('canvas');
canvasContainer.appendChild(canvas);

// Add UI to regions
myPanel.mount(rightPanel);
```

## Layout Modes

### fullscreen

Canvas fills the entire viewport. UI panels overlay on top.

```
┌─────────────────────────────────┐
│  [toolbar]                      │
├──────────────────────────────────┤
│                                  │
│  Canvas (fills viewport)         │
│                                  │
│  [left panel]     [right panel]  │
│                                  │
├──────────────────────────────────┤
│  [statusbar]                     │
└─────────────────────────────────┘
```

Best for: Immersive rendering, presentations, fullscreen apps.

### centered

Canvas centered with fixed width, optional panels on sides.

```
┌──────────────────────────────────┐
│                                  │
│  [left]    ┌─────────┐   [right] │
│  panel     │ Canvas  │   panel   │
│            │(centered)│          │
│            └─────────┘           │
│                                  │
└──────────────────────────────────┘
```

Best for: Focused viewing, gallery-style presentations.

### editor

Fixed regions on all sides, like an IDE layout.

```
┌──────────────────────────────────┐
│  toolbar                         │
├────────┬─────────────┬───────────┤
│  left  │             │   right   │
│ sidebar│   Canvas    │  sidebar  │
│        │             │           │
├────────┴─────────────┴───────────┤
│  statusbar                       │
└──────────────────────────────────┘
```

Best for: Development/editing workflows, complex UIs.

### split

Canvas on one side, large panel on the other.

```
┌───────────────────┬──────────────┐
│                   │              │
│                   │    right     │
│     Canvas        │    panel     │
│                   │              │
│                   │              │
└───────────────────┴──────────────┘
```

Best for: Side-by-side editing, documentation views.

## Regions

The layout system creates these named regions:

| Region | Description |
|--------|-------------|
| `canvas-container` | Where the WebGL canvas lives |
| `region-left` | Left sidebar |
| `region-right` | Right sidebar |
| `region-toolbar` | Top toolbar area |
| `region-statusbar` | Bottom status area |
| `region-overlay` | For modals, popups (z-index: 100+) |

```typescript
// Access regions
const canvas = layout.getCanvasContainer();
const left = layout.getRegion('region-left');
const right = layout.getRegion('region-right');
const toolbar = layout.getRegion('region-toolbar');
const statusbar = layout.getRegion('region-statusbar');
const overlay = layout.getOverlay();
```

## API Reference

### AppLayout

```typescript
class AppLayout {
    constructor(root?: HTMLElement, options?: LayoutOptions);

    // Current mode
    get mode(): LayoutMode;

    // Switch modes
    setMode(mode: LayoutMode): void;

    // Get regions
    getRegion(name: RegionName): HTMLElement;
    getCanvasContainer(): HTMLElement;
    getOverlay(): HTMLElement;

    // Show/hide regions
    showRegion(name: RegionName): void;
    hideRegion(name: RegionName): void;

    // CSS custom properties
    setVariables(variables: Record<string, string>): void;
    setVariable(name: string, value: string): void;

    // Sizing
    getCanvasSize(): { width: number; height: number };

    // Cleanup
    dispose(): void;
}
```

### LayoutOptions

```typescript
interface LayoutOptions {
    mode?: LayoutMode;              // 'fullscreen' | 'centered' | 'editor' | 'split'
    variables?: Record<string, string>;  // CSS custom properties
}
```

## CSS Custom Properties

Configure layout dimensions with CSS variables:

| Property | Default | Description |
|----------|---------|-------------|
| `--layout-canvas-width` | `1024px` | Canvas width (centered mode) |
| `--layout-canvas-aspect` | `16/9` | Canvas aspect ratio (centered mode) |
| `--layout-sidebar-width` | `320px` | Default sidebar width |
| `--layout-left-width` | `280px` | Left sidebar (editor mode) |
| `--layout-right-width` | `320px` | Right sidebar (editor mode) |
| `--layout-toolbar-height` | `48px` | Toolbar height (editor mode) |
| `--layout-statusbar-height` | `28px` | Statusbar height (editor mode) |
| `--layout-panel-width` | `480px` | Panel width (split mode) |

```typescript
// Set at construction
const layout = new AppLayout(document.body, {
    variables: {
        '--layout-canvas-width': '1280px',
        '--layout-sidebar-width': '400px'
    }
});

// Or update dynamically
layout.setVariable('--layout-sidebar-width', '500px');
```

## Switching Layouts

```typescript
// Switch to a different mode
layout.setMode('centered');

// Cycle through modes
const modes = ['fullscreen', 'centered', 'split'];
let current = 0;

window.addEventListener('keydown', (e) => {
    if (e.key === 'L') {
        current = (current + 1) % modes.length;
        layout.setMode(modes[current]);
    }
});
```

## Showing/Hiding Regions

```typescript
// Hide left sidebar
layout.hideRegion('region-left');

// Show it again
layout.showRegion('region-left');
```

## Integration with UI Components

The layout system integrates seamlessly with UI components:

```typescript
import { AppLayout } from './app/layout/index.js';
import { Panel, Folder, Slider } from './app/ui/index.js';

// Create layout
const layout = new AppLayout(document.body, { mode: 'fullscreen' });

// Create panel
const panel = new Panel({ title: 'Settings' });
panel.add(new Folder('Quality').add(
    new Slider(100, { label: 'Samples', min: 1, max: 1000 })
));

// Mount panel to right region
panel.mount(layout.getRegion('region-right'));
```

## Example: Complete Setup

```typescript
import { AppLayout } from './app/layout/index.js';
import { Panel, Folder, Slider, Button } from './app/ui/index.js';
import { App, STRATEGY_PRESETS } from './app/index.js';

async function setup() {
    // 1. Create layout
    const layout = new AppLayout(document.body, {
        mode: 'fullscreen',
        variables: {
            '--layout-sidebar-width': '340px'
        }
    });

    // 2. Create canvas
    const canvas = document.createElement('canvas');
    layout.getCanvasContainer().appendChild(canvas);

    // 3. Create app with canvas and connect layout
    const app = new App(canvas);
    app.setLayout(layout);  // Connect layout to app

    await app.initialize({
        scene: { id: 'my-scene', name: 'My Scene' },
        strategies: [STRATEGY_PRESETS['pathtracer-full'].strategy]
    });

    // 4. Create UI (can use app.getRegion() now)
    const panel = new Panel({ title: 'Controls' });
    panel.add(new Slider(1.0, {
        label: 'Exposure',
        min: 0, max: 5,
        onChange: (v) => app.setParameter('exposure', v)
    }));
    panel.mount(app.getRegion('region-right'));

    // 5. Handle resize
    window.addEventListener('resize', () => {
        const { width, height } = layout.getCanvasSize();
        app.resize(width, height);
    });

    // 6. Start
    app.start();
}
```

## Integration with App

When using the layout with App, connect them using `setLayout()`:

```typescript
const layout = new AppLayout(document.body, { mode: 'fullscreen' });
const app = new App(canvas);
app.setLayout(layout);
```

This enables:
- Extensions to access layout regions via `app.getRegion()`
- Layout mode switching via `app.setLayoutMode()`
- Automatic layout disposal when app is disposed

### App Layout API

```typescript
// Connect layout
app.setLayout(layout: AppLayout): void;

// Access layout
app.getLayout(): AppLayout | null;
app.hasLayout(): boolean;

// Convenience methods
app.setLayoutMode(mode: LayoutMode): void;
app.getLayoutMode(): LayoutMode | null;
app.getRegion(name: RegionName): HTMLElement;
app.getCanvasContainer(): HTMLElement;
```

### Extensions and Layout

Extensions that support layout (like `ParameterPanelExtension`) will:
1. Check if layout is available via `app.hasLayout()`
2. Mount to appropriate regions if available
3. Fall back to standalone mode if no layout

```typescript
// Extension checks for layout
if (app.hasLayout()) {
    // Mount to layout region
    panel.mount(app.getRegion('region-right'));
} else {
    // Fall back to standalone positioning
    document.body.appendChild(wrapper);
}
```

## Responsive Behavior

Layouts respond to window size:

- **fullscreen**: Always fills viewport
- **centered**: Canvas has max-width constraint, panels scroll if needed
- **editor**: Grid adapts, sidebars have fixed width
- **split**: Panel has fixed width, canvas fills remaining space

For custom responsive behavior:

```typescript
window.addEventListener('resize', () => {
    const width = window.innerWidth;

    if (width < 768) {
        layout.setMode('fullscreen');
        layout.hideRegion('region-right');
    } else if (width < 1200) {
        layout.setMode('centered');
        layout.showRegion('region-right');
    } else {
        layout.setMode('editor');
    }
});
```

## Cleanup

```typescript
// Remove all regions and reset
layout.dispose();
```

Note: `dispose()` preserves the canvas container if it contains a canvas element.
