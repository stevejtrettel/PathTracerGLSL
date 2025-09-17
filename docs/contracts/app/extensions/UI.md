# UI Extension Contract

UI extensions add visual interface elements for parameter control and information display.

## Extended Interface

UI extensions implement the base Extension interface and manage panels:

```typescript
interface UIExtension extends Extension {
  // Panel management
  createPanel(config: PanelConfig): Panel;
  removePanel(id: string): void;
  getPanels(): Panel[];
  
  // Layout control (optional)
  setLayout?(layout: LayoutConfig): void;
  toggleVisibility?(): void;
}

interface Panel {
  id: string;
  type: PanelType;
  element: HTMLElement;
  
  update(data: any): void;
  show(): void;
  hide(): void;
  destroy(): void;
}

type PanelType = 'parameters' | 'stats' | 'progress' | 'custom';
```

## Panel Configuration

```typescript
interface PanelConfig {
  id: string;
  type: PanelType;
  title?: string;
  position?: 'left' | 'right' | 'top' | 'bottom' | 'floating';
  size?: { width?: number; height?: number };
  collapsible?: boolean;
  resizable?: boolean;
  className?: string;
}
```

## Standard Panel Types

### Parameter Panel
Controls for adjusting renderer parameters:

```typescript
class ParameterPanel implements UIExtension {
  name = 'parameter-panel';
  dependencies = [];  // UI is often a base extension with no dependencies
  private panels: Map<string, Panel> = new Map();
  
  install(app: ResearchApp, bus: EventEmitter) {
    // Create main panel
    const panel = this.createPanel({
      id: 'main-params',
      type: 'parameters',
      title: 'Parameters',
      position: 'right'
    });
    
    // Build controls from parameter metadata
    this.buildControls(app.parameterStore, panel);
    
    // Listen for parameter changes to update UI
    bus.on('parameter.changed', ({ path, value }) => {
      this.updateControl(path, value);
    });
  }
  
  private buildControls(store: ParameterStore, panel: Panel) {
    const params = store.getAllMetadata();
    
    for (const [path, meta] of params) {
      const control = this.createControl(path, meta);
      panel.element.appendChild(control);
      
      // Wire up control to parameter store
      control.addEventListener('input', (e) => {
        store.set(path, parseValue(e.target.value, meta.type));
      });
    }
  }
  
  private createControl(path: string, meta: ParameterMetadata): HTMLElement {
    switch (meta.uiHint) {
      case 'slider':
        return this.createSlider(path, meta);
      case 'color':
        return this.createColorPicker(path, meta);
      case 'dropdown':
        return this.createDropdown(path, meta);
      default:
        return this.createInput(path, meta);
    }
  }
}
```

### Progress Panel
Shows rendering progress and statistics:

```typescript
class ProgressPanel implements UIExtension {
  name = 'progress-panel';
  
  install(app: ResearchApp, bus: EventEmitter) {
    const panel = this.createPanel({
      id: 'progress',
      type: 'progress',
      title: 'Render Progress',
      position: 'bottom'
    });
    
    // Create progress elements
    const html = `
      <div class="progress-bar">
        <div class="progress-fill"></div>
      </div>
      <div class="progress-stats">
        <span class="samples">Samples: 0</span>
        <span class="time">Time: 0s</span>
        <span class="fps">FPS: 0</span>
      </div>
    `;
    panel.element.innerHTML = html;
    
    // Update on progress events
    bus.on('render.progress', (info: ProgressInfo) => {
      this.updateProgress(panel, info);
    });
    
    // Tile progress for production mode
    bus.on('tile.complete', (info: TileInfo) => {
      this.updateTileProgress(panel, info);
    });
  }
  
  private updateProgress(panel: Panel, info: ProgressInfo) {
    const fill = panel.element.querySelector('.progress-fill');
    const samples = panel.element.querySelector('.samples');
    const time = panel.element.querySelector('.time');
    
    if (info.convergence) {
      fill.style.width = `${info.convergence * 100}%`;
    }
    samples.textContent = `Samples: ${info.samples}`;
    time.textContent = `Time: ${(info.time / 1000).toFixed(1)}s`;
  }
}
```

## Control Types

### Slider Control
```typescript
createSlider(path: string, meta: ParameterMetadata): HTMLElement {
  const container = document.createElement('div');
  container.className = 'control-slider';
  
  const label = document.createElement('label');
  label.textContent = path.split('.').pop();
  
  const slider = document.createElement('input');
  slider.type = 'range';
  slider.min = String(meta.min ?? 0);
  slider.max = String(meta.max ?? 1);
  slider.step = meta.type === 'int' ? '1' : '0.01';
  slider.value = String(meta.default);
  
  const value = document.createElement('span');
  value.textContent = String(meta.default);
  
  slider.addEventListener('input', () => {
    value.textContent = slider.value;
  });
  
  container.append(label, slider, value);
  return container;
}
```

### Color Picker
```typescript
createColorPicker(path: string, meta: ParameterMetadata): HTMLElement {
  const container = document.createElement('div');
  container.className = 'control-color';
  
  // Create color input
  const input = document.createElement('input');
  input.type = 'color';
  input.value = vec3ToHex(meta.default);
  
  // Also show RGB values
  const rgb = document.createElement('div');
  rgb.className = 'color-rgb';
  
  input.addEventListener('input', () => {
    const vec3 = hexToVec3(input.value);
    rgb.textContent = `RGB(${vec3.map(v => Math.round(v * 255)).join(', ')})`;
  });
  
  container.append(input, rgb);
  return container;
}
```

## Layout Management

```typescript
interface LayoutConfig {
  panels: {
    [position: string]: string[];  // Panel IDs per position
  };
  sizes?: {
    left?: number;   // Width in pixels
    right?: number;
    top?: number;    // Height in pixels
    bottom?: number;
  };
}

class DockingUIExtension implements UIExtension {
  setLayout(layout: LayoutConfig) {
    // Reorganize panels according to layout
    for (const [position, panelIds] of Object.entries(layout.panels)) {
      const container = this.containers[position];
      for (const id of panelIds) {
        const panel = this.panels.get(id);
        if (panel) {
          container.appendChild(panel.element);
        }
      }
    }
  }
}
```

## Styling

UI extensions should use consistent styling:

```css
.ui-panel {
  background: rgba(0, 0, 0, 0.8);
  border: 1px solid #333;
  color: white;
  padding: 10px;
  font-family: monospace;
}

.ui-panel-header {
  font-weight: bold;
  margin-bottom: 10px;
  cursor: move;  /* For draggable panels */
}

.control-slider {
  display: grid;
  grid-template-columns: 100px 1fr 50px;
  gap: 10px;
  margin: 5px 0;
}

.progress-bar {
  height: 20px;
  background: #222;
  border: 1px solid #444;
}

.progress-fill {
  height: 100%;
  background: linear-gradient(90deg, #44f, #4f4);
  transition: width 0.2s;
}
```

## Event Integration

```typescript
// Listen for UI-relevant events
bus.on('render.start', () => this.showProgress());
bus.on('render.stop', () => this.hideProgress());
bus.on('parameter.changed', (e) => this.updateControl(e.path, e.value));
bus.on('performance.update', (stats) => this.updateStats(stats));

// Emit UI events
bus.emit('ui.panel_created', { id, type });
bus.emit('ui.visibility_changed', { visible });
bus.emit('ui.layout_changed', { layout });
```

## Persistence

UI state can be saved/restored:

```typescript
interface UIState {
  layout: LayoutConfig;
  visibility: { [panelId: string]: boolean };
  collapsed: { [panelId: string]: boolean };
  positions?: { [panelId: string]: { x: number, y: number } };
}

class PersistentUIExtension implements UIExtension {
  saveState(): UIState {
    return {
      layout: this.currentLayout,
      visibility: this.getVisibilityState(),
      collapsed: this.getCollapsedState()
    };
  }
  
  restoreState(state: UIState) {
    this.setLayout(state.layout);
    this.restoreVisibility(state.visibility);
    this.restoreCollapsed(state.collapsed);
  }
}
```

## Best Practices

1. **Use consistent styling** - Follow the app's visual theme
2. **Debounce rapid updates** - Don't update UI on every frame
3. **Save UI state** - Remember panel positions/visibility
4. **Responsive layout** - Handle window resizing
5. **Keyboard shortcuts** - Provide quick access (Tab to hide all, etc.)
6. **Clear labeling** - Use human-readable parameter names
