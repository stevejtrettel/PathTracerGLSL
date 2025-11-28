# Extensions

Guide to the extension system: creating modular, optional features.

## Overview

Extensions add functionality to the app without modifying core code. They are:
- **Modular** - Plug-and-play architecture
- **Optional** - Enable/disable as needed
- **Decoupled** - Communicate via EventBus
- **Lifecycle-aware** - Install, setup, cleanup, uninstall

---

## Extension Interface

```typescript
interface Extension {
    name: string;
    version?: string;
    description?: string;
    dependencies?: string[];

    install(app: App, bus: EventBus): void;
    uninstall?(): void;
    saveState?(): any;
    restoreState?(state: any): void;
}
```

**Methods**:
- `install` - Called when extension is added to app
- `uninstall` - Called when extension is removed
- `saveState` / `restoreState` - Session persistence

---

## UIExtension Base Class

For extensions that render UI, extend `UIExtension` for consistent behavior:

```typescript
import { UIExtension } from './UIExtension.js';
import type { RegionName } from '../layout/index.js';

class MyPanel extends UIExtension {
    name = 'my-panel';
    protected readonly region: RegionName = 'region-right';

    protected createRoot(): HTMLElement {
        const div = document.createElement('div');
        div.className = 'my-panel';
        div.innerHTML = '<h2>My Panel</h2>';
        return div;
    }

    protected setup(): void {
        // Subscribe to events, add listeners
        this.on('render.progress', (info) => {
            this.updateDisplay(info);
        });
    }

    protected cleanup(): void {
        // Optional: cleanup before uninstall
    }

    private updateDisplay(info: any): void {
        // Update UI
    }
}
```

### UIExtension Features

**Region Mounting:**
- If app has layout, mounts to specified region
- Falls back to standalone (appends to body with positioning)

**Visibility Helpers:**
```typescript
this.show();        // Remove 'hidden' class
this.hide();        // Add 'hidden' class
this.toggle();      // Toggle visibility
this.isVisible;     // Check current state
```

**Event Subscription:**
```typescript
// Auto-cleaned up on uninstall
protected setup(): void {
    this.on('render.started', this.onRenderStarted);
    this.on('render.stopped', this.onRenderStopped);
}
```

**Configuration:**
```typescript
constructor() {
    super({
        startHidden: true  // Start with 'hidden' class
    });
}
```

---

## Available Extensions

### UI Extensions

| Extension | Region | Description |
|-----------|--------|-------------|
| `ProductionPanelExtension` | region-statusbar | Production render progress |
| `StatsPanel` | region-left | FPS, samples, render state |
| `RenderControlsExtension` | region-toolbar | Render button, sample input |
| `ParameterPanelExtension` | region-right | Parameter editing panel |

### Control Extensions

| Extension | Description |
|-----------|-------------|
| `OrbitControls` | Mouse orbit camera |
| `TouchOrbitControls` | Touch orbit camera |
| `KeyboardControls` | WASD camera movement |
| `AppShortcutsExtension` | App-level keyboard shortcuts |

---

## ProductionPanelExtension

Shows production render progress at the bottom of the screen.

**Location:** `src/app/extensions/ProductionPanelExtension.ts`

**Features:**
- Progress bar with percentage
- Sample count, elapsed time, ETA
- Tile grid visualization (for tiled renders)
- Pause/Resume/Cancel buttons
- Export PNG/HDR buttons on completion

**Events Listened:**
- `render.started` - Show panel (production mode only)
- `render.progress` - Update stats
- `render.complete` - Show export buttons
- `render.stopped` - Hide panel
- `tiledJob.progress` - Update tile grid

**Tile Grid:**
```
┌───┬───┬───┬───┐
│ ✓ │ ✓ │ ✓ │ ✓ │  ✓ = complete
├───┼───┼───┼───┤
│ ✓ │ ✓ │ ▶ │   │  ▶ = current (pulsing)
├───┼───┼───┼───┤
│   │   │   │   │    = pending
└───┴───┴───┴───┘
```

---

## StatsPanel

Displays render statistics overlay.

**Location:** `src/app/extensions/StatsPanel.ts`

**Features:**
- Sample count
- FPS
- Elapsed time
- Render state (rendering/paused/production)
- Toggle with 'S' key
- Auto-hides during production renders

**Usage:**
```typescript
app.use(new StatsPanel());
```

---

## RenderControlsExtension

Toolbar with render controls.

**Location:** `src/app/extensions/RenderControlsExtension.ts`

**Features:**
- Scene title display
- Target sample count input
- "Render" button to start production
- Disabled during active production render

---

## ParameterPanelExtension

Slide-out panel for parameter editing.

**Location:** `src/app/extensions/ParameterPanelExtension.ts`

**Features:**
- Auto-generates controls from parameter metadata
- Groups parameters by category
- Sliders, inputs, color pickers
- Toggle with 'Tab' key
- Closes and disables during production mode

---

## Creating Custom Extensions

### Minimal Extension

```typescript
import type { Extension } from '../types.js';
import type { App } from '../App.js';
import type { EventBus } from '../EventBus.js';

class MinimalExtension implements Extension {
    name = 'minimal';
    private bus!: EventBus;

    install(app: App, bus: EventBus): void {
        this.bus = bus;
        console.log('Installed');
    }

    uninstall(): void {
        console.log('Uninstalled');
    }
}

app.use(new MinimalExtension());
```

### Extension with UI (using UIExtension)

```typescript
import { UIExtension } from './UIExtension.js';

class CustomPanel extends UIExtension {
    name = 'custom-panel';
    protected readonly region = 'region-left';

    protected createRoot(): HTMLElement {
        const root = document.createElement('div');
        root.className = 'custom-panel';
        root.innerHTML = `
            <h3>Custom Panel</h3>
            <div class="content"></div>
        `;
        return root;
    }

    protected setup(): void {
        this.on('render.progress', this.onProgress);
    }

    private onProgress = (info: any): void => {
        const content = this.root.querySelector('.content');
        if (content) {
            content.textContent = `Samples: ${info.samples}`;
        }
    };
}

app.use(new CustomPanel());
```

### Extension with State Persistence

```typescript
class StatefulExtension implements Extension {
    name = 'stateful';
    private value = 0;

    install(app: App, bus: EventBus): void {
        // Setup
    }

    saveState(): any {
        return { value: this.value };
    }

    restoreState(state: any): void {
        this.value = state.value ?? 0;
    }
}
```

---

## Event Patterns

### Listening to Render Events

```typescript
protected setup(): void {
    // Mode changes
    this.on('render.started', (data) => {
        if (data.mode === 'production') {
            this.onProductionStart(data.targetSamples);
        }
    });

    this.on('render.stopped', () => {
        this.onProductionEnd();
    });

    // Progress updates
    this.on('render.progress', (info) => {
        this.updateProgress(info.samples, info.percentComplete);
    });
}
```

### Listening to Parameter Changes

```typescript
protected setup(): void {
    this.on('parameter.changed', (change) => {
        console.log(`${change.path}: ${change.oldValue} → ${change.newValue}`);
    });
}
```

### Listening to Tile Events

```typescript
protected setup(): void {
    this.on('tiledJob.progress', (info) => {
        this.updateTileGrid(info.completedPositions, info.currentTile);
    });

    this.on('tile.complete', (info) => {
        console.log(`Tile [${info.tileX}, ${info.tileY}] done`);
    });
}
```

---

## Extension Lifecycle

```
app.use(extension)
  ↓
extension.install(app, bus)
  ↓
[extension is active]
  ↓
app.unuse('extension-name')
  ↓
extension.uninstall()
```

For UIExtension:

```
install(app, bus)
  ↓
createRoot()        → Create DOM element
  ↓
mount()             → Add to region or body
  ↓
setup()             → Subscribe to events
  ↓
[extension is active]
  ↓
uninstall()
  ↓
cleanup()           → Custom cleanup
  ↓
unsubscribe events  → Auto-cleanup
  ↓
remove from DOM
```

---

## Available Events

### Render Events

| Event | Data | Description |
|-------|------|-------------|
| `render.started` | `{ mode, targetSamples? }` | Render begins |
| `render.progress` | `ProgressInfo` | Per-frame update |
| `render.complete` | `{ samples, elapsedTime }` | Production complete |
| `render.stopped` | - | Render cancelled |
| `render.paused` | - | Render paused |
| `render.resumed` | - | Render resumed |
| `render.locked` | - | Parameters locked |
| `render.unlocked` | - | Parameters unlocked |

### Tile Events

| Event | Data | Description |
|-------|------|-------------|
| `tiledJob.progress` | `TiledJobProgressInfo` | Tile job progress |
| `tiledJob.complete` | `{ jobId, totalTiles, elapsedSeconds }` | Job complete |
| `tile.start` | `TileProgressInfo` | Tile begins |
| `tile.complete` | `TileProgressInfo` | Tile done |

### Other Events

| Event | Data | Description |
|-------|------|-------------|
| `parameter.changed` | `{ path, oldValue, newValue }` | Parameter updated |
| `renderer.switched` | `{ rendererId }` | Active renderer changed |
| `accumulation.reset` | `{ reason }` | Accumulation cleared |
| `extension.installed` | `{ name, version }` | Extension added |
| `extension.uninstalled` | `{ name }` | Extension removed |

---

## Best Practices

1. **Extend UIExtension for UI** - Consistent lifecycle, automatic cleanup
2. **Use `this.on()` for events** - Auto-unsubscribe on uninstall
3. **Check `isVisible` before updates** - Skip work when hidden
4. **Respond to mode changes** - Disable/hide during production mode
5. **Clean up in `cleanup()`** - Remove timers, listeners not managed by `on()`
6. **Use semantic class names** - `.production-panel`, `.stats-panel`
7. **Follow CSS conventions** - Use theme variables from `theme.css`

---

## CSS Conventions

Extensions should use CSS classes with extension-specific prefixes:

```css
/* Good: scoped to extension */
.stats-panel { ... }
.stats-panel-state { ... }
.production-panel-tiles { ... }

/* Bad: generic names that could conflict */
.panel { ... }
.container { ... }
```

Use theme variables:
```css
.my-panel {
    background: var(--ui-bg-primary);
    color: var(--ui-text-primary);
    border: 1px solid var(--ui-border);
    border-radius: var(--ui-radius-md);
    padding: var(--ui-space-md);
}
```

---

## File Structure

```
src/app/extensions/
├── UIExtension.ts              # Base class for UI extensions
├── ProductionPanelExtension.ts # Production progress
├── StatsPanel.ts               # Stats overlay
├── RenderControlsExtension.ts  # Toolbar
├── ParameterPanelExtension.ts  # Parameter panel
├── OrbitControls.ts            # Mouse orbit
├── TouchOrbitControls.ts       # Touch orbit
├── KeyboardControls.ts         # Keyboard movement
├── AppShortcutsExtension.ts    # App shortcuts
└── index.ts                    # Exports
```

---

## Next Steps

- [Production Rendering](../../../DESIGN-production-rendering.md) - Tiled rendering system
- [Event Bus](event-bus.md) - Event system details
- [Parameter System](parameter-system.md) - Parameter management
