# Path Tracer Documentation

This documentation covers the UI and infrastructure systems for the Path Tracer application.

## Overview

The infrastructure is designed around these principles:

- **Standalone Systems**: Each system works independently and can be used without the others
- **Composable**: Components can be combined freely
- **CSS-Driven**: Layouts and themes use CSS custom properties for easy customization
- **Forgettable**: Simple APIs that are easy to understand and don't require constant reference

## Systems

### [UI Component System](./ui-components.md)

Reusable, composable components for building control panels and interfaces.

```typescript
import { Panel, Folder, Slider, Checkbox } from './app/ui/index.js';

const panel = new Panel({ title: 'Settings' });
panel.add(new Slider(1.0, { label: 'Value', min: 0, max: 10 }));
panel.mount(document.body);
```

Key features:
- Core classes: `UIComponent`, `Container`, `Input<T>`
- Containers: `Panel`, `Folder`, `Window`, `Modal`
- Inputs: `Slider`, `Checkbox`, `ColorPicker`, `NumberInput`, `VectorInput`, `Dropdown`, `Button`, `TextInput`
- `WidgetFactory` for creating inputs from parameter metadata
- Themeable via CSS variables

### [Layout System](./layout-system.md)

Flexible page arrangements with named regions.

```typescript
import { AppLayout } from './app/layout/index.js';

const layout = new AppLayout(document.body, { mode: 'fullscreen' });
const canvas = layout.getCanvasContainer();
const rightPanel = layout.getRegion('region-right');
```

Layout modes:
- `fullscreen`: Canvas fills viewport, panels overlay
- `centered`: Canvas centered with side panels
- `editor`: Fixed regions like an IDE
- `split`: Canvas + large side panel

### [Display Modes](./display-modes.md)

Abstraction for how rendered output is presented.

```typescript
import { DisplayManager } from './app/display/index.js';

const displayManager = new DisplayManager();
displayManager.initialize({ canvas, gl, container });
displayManager.setMode('fullscreen');
```

Current modes:
- `fullscreen`: Canvas fills container (default)

Future modes planned:
- `preview`: Scaled preview for high-res renders
- `progress`: Progress bar for production renders
- `tiled`: Tile progress visualization

## Quick Start

### Minimal Setup (UI Only)

```typescript
import { Panel, Slider, Checkbox, Button } from './app/ui/index.js';

const panel = new Panel({ title: 'Controls' });

panel.add(new Slider(0.5, {
    label: 'Intensity',
    min: 0, max: 1,
    onChange: (v) => console.log('Intensity:', v)
}));

panel.add(new Checkbox(true, {
    label: 'Enabled',
    onChange: (v) => console.log('Enabled:', v)
}));

panel.add(new Button('Apply', () => console.log('Applied!')));

panel.mount(document.body);
```

### With Layout System

```typescript
import { AppLayout } from './app/layout/index.js';
import { Panel, Slider } from './app/ui/index.js';

// Create layout
const layout = new AppLayout(document.body, { mode: 'centered' });

// Create canvas
const canvas = document.createElement('canvas');
layout.getCanvasContainer().appendChild(canvas);

// Create UI panel in right region
const panel = new Panel({ title: 'Settings' });
panel.add(new Slider(1.0, { label: 'Exposure', min: 0, max: 5 }));
panel.mount(layout.getRegion('region-right'));
```

### Full App Integration

```typescript
import { App, STRATEGY_PRESETS } from './app/index.js';
import { AppLayout } from './app/layout/index.js';
import { Panel, Slider } from './app/ui/index.js';
import { OrbitControls, StatsPanel } from './app/extensions/index.js';

async function main() {
    // Layout
    const layout = new AppLayout(document.body, { mode: 'fullscreen' });

    // Canvas
    const canvas = document.createElement('canvas');
    layout.getCanvasContainer().appendChild(canvas);

    // App
    const app = new App(canvas);
    await app.initialize({
        scene: { id: 'cornell-box', name: 'Cornell Box' },
        strategies: [STRATEGY_PRESETS['pathtracer-full'].strategy]
    });

    // Extensions
    app.use(new OrbitControls());
    app.use(new StatsPanel());

    // UI
    const panel = new Panel({ title: 'Render' });
    panel.add(new Slider(1.0, {
        label: 'Exposure',
        onChange: (v) => app.setParameter('exposure', v)
    }));
    panel.mount(layout.getRegion('region-right'));

    // Resize handling
    window.addEventListener('resize', () => {
        const { width, height } = layout.getCanvasSize();
        app.resize(width, height);
    });

    app.start();
}

main();
```

## Directory Structure

```
src/app/
├── ui/                    # UI Component System
│   ├── core/              # Base classes
│   ├── containers/        # Panel, Folder, Window, Modal
│   ├── inputs/            # Slider, Checkbox, etc.
│   ├── styles/            # Theme and component CSS
│   ├── WidgetFactory.ts   # Create widgets from metadata
│   └── index.ts           # Public exports
├── layout/                # Layout System
│   ├── AppLayout.ts       # Region management
│   ├── layouts.css        # Layout CSS
│   └── index.ts           # Public exports
├── display/               # Display Mode System
│   ├── DisplayMode.ts     # Interface
│   ├── FullscreenDisplay.ts
│   ├── DisplayManager.ts
│   └── index.ts           # Public exports
└── extensions/            # App Extensions
    └── ParameterPanelExtension.ts  # Uses UI components
```

## Theming

All UI components use CSS custom properties for theming. See [UI Components - Theming](./ui-components.md#theming) for the full list.

Override in your CSS:

```css
:root {
    --ui-bg-primary: rgba(20, 20, 20, 0.95);
    --ui-accent: #ff6b6b;
}
```

Or in JavaScript:

```typescript
document.documentElement.style.setProperty('--ui-accent', '#ff6b6b');
```

## Examples

See the `examples/` directory:

- `cornell-box.ts` - Full app with parameter panel
- `ui-layout-demo.ts` - Standalone UI and layout demonstration

Run examples with:

```bash
npm run dev
# Open http://localhost:3000/examples/ui-layout-demo.html
```
