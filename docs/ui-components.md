# UI Component System

The UI component system provides reusable, composable components for building control panels, dialogs, and interactive interfaces. It is **completely standalone** - no dependency on App, EventBus, or any other system.

## Design Principles

1. **Standalone**: Components work with plain DOM and callbacks
2. **Composable**: Containers hold components, which can be other containers
3. **Consistent**: All inputs follow the same pattern (value, onChange)
4. **Themed**: All styling uses CSS variables for easy customization

## Architecture

```
src/app/ui/
├── core/
│   ├── UIComponent.ts    # Base for all components
│   ├── Container.ts      # Base for containers
│   └── Input.ts          # Base for inputs
├── containers/
│   ├── Panel.ts          # Main container with header
│   ├── Folder.ts         # Collapsible group
│   ├── Window.ts         # Draggable floating window
│   └── Modal.ts          # Centered dialog with backdrop
├── inputs/
│   ├── Slider.ts         # Range input for numbers
│   ├── Checkbox.ts       # Boolean toggle
│   ├── ColorPicker.ts    # RGB color selector
│   ├── NumberInput.ts    # Text input for numbers
│   ├── VectorInput.ts    # Multi-component (vec2/3/4)
│   ├── Dropdown.ts       # Select from options
│   ├── Button.ts         # Action trigger
│   └── TextInput.ts      # String input
├── styles/
│   ├── theme.css         # Design tokens
│   └── components.css    # Component styles
├── WidgetFactory.ts      # Creates inputs from metadata
└── index.ts              # Public exports
```

## Quick Start

```typescript
import { Panel, Folder, Slider, Checkbox, Button } from './app/ui/index.js';

// Create a panel
const panel = new Panel({ title: 'Settings' });

// Add a folder with controls
const folder = new Folder('Lighting');
folder.add(new Slider(1.0, {
    label: 'Intensity',
    min: 0, max: 10,
    onChange: (v) => console.log('Intensity:', v)
}));
folder.add(new Checkbox(true, {
    label: 'Shadows',
    onChange: (v) => console.log('Shadows:', v)
}));

panel.add(folder);
panel.add(new Button('Reset', () => console.log('Reset!')));

// Mount to DOM
panel.mount(document.body);
```

## Core Classes

### UIComponent

Base class for all UI elements.

```typescript
class UIComponent {
    readonly domElement: HTMLElement;

    mount(parent: HTMLElement | UIComponent): this;
    unmount(): this;
    show(): this;
    hide(): this;
    dispose(): void;
}
```

### Container

Base class for components that hold children.

```typescript
class Container extends UIComponent {
    add(child: UIComponent): this;
    addAll(...children: UIComponent[]): this;
    remove(child: UIComponent): this;
    clear(): this;
    get childCount(): number;
}
```

### Input<T>

Base class for value-capturing components.

```typescript
class Input<T> extends UIComponent {
    get value(): T;
    setValue(value: T): this;           // Update without triggering onChange
    setOnChange(handler: (v: T) => void): this;
}
```

Key distinction:
- `setValue()`: Updates display without triggering callback (for external sync)
- User interaction triggers the `onChange` callback

## Containers

### Panel

Primary container for UI controls. Has an optional title header and scrollable content.

```typescript
const panel = new Panel({
    title: 'My Panel',      // Optional header
    className: 'my-panel'   // Additional CSS class
});

panel.setTitle('New Title');
panel.setSubtitle('Press Tab to toggle');
```

### Folder

Collapsible group container. Click header to expand/collapse.

```typescript
const folder = new Folder('Section Name', { startOpen: true });

folder.toggle();  // Toggle open/closed
folder.open();    // Force open
folder.close();   // Force closed
folder.isOpen;    // Check state
```

### Window

Floating, draggable window with title bar and close button.

```typescript
const win = new Window('Window Title', {
    width: 400,       // Initial width
    height: 300,      // Initial height
    x: 100,           // Initial X position (default: centered)
    y: 100,           // Initial Y position (default: centered)
    draggable: true,  // Allow dragging (default: true)
    closable: true,   // Show close button (default: true)
    onClose: () => {} // Called when closed
});

win.show();         // Show and add to DOM
win.hide();         // Hide (keep in DOM)
win.close();        // Close and remove from DOM
win.bringToFront(); // Raise z-index
win.setTitle('New Title');
```

### Modal

Centered dialog with backdrop. Blocks interaction with content behind.

```typescript
const modal = new Modal('Dialog Title', {
    width: 500,           // Modal width
    maxHeight: 600,       // Maximum height
    closeOnBackdrop: true, // Click backdrop to close (default: true)
    closable: true,       // Show close button (default: true)
    onClose: () => {}     // Called when closed
});

modal.show();   // Show modal
modal.hide();   // Hide (keep in DOM)
modal.close();  // Close and dispose

// Add footer for buttons
const footer = modal.addFooter();
footer.appendChild(okButton.domElement);
```

## Inputs

### Slider

Range input for numeric values.

```typescript
const slider = new Slider(0.5, {
    label: 'Value',
    min: 0,
    max: 1,
    step: 0.01,
    precision: 2,  // Decimal places in display (auto if not set)
    onChange: (value) => {}
});

slider.setRange(0, 100);  // Update bounds
```

### Checkbox

Boolean toggle.

```typescript
const checkbox = new Checkbox(true, {
    label: 'Enabled',
    onChange: (value) => {}
});

checkbox.toggle();  // Toggle value
```

### NumberInput

Text input for numeric values.

```typescript
const input = new NumberInput(42, {
    label: 'Count',
    min: 0,
    max: 100,
    step: 1,
    integer: true,  // Force integer values
    onChange: (value) => {}
});

input.setBounds(0, 1000);  // Update min/max
```

### ColorPicker

RGB color selector. Values are normalized [0-1] arrays.

```typescript
const color = new ColorPicker([1, 0.5, 0], {
    label: 'Color',
    onChange: (rgb) => {}  // rgb is [r, g, b] in 0-1 range
});
```

### VectorInput

Multi-component numeric input (vec2, vec3, vec4).

```typescript
const vec = new VectorInput([0, 1, 0], {
    label: 'Direction',
    components: 3,           // 2, 3, or 4
    step: 0.01,
    labels: ['X', 'Y', 'Z'], // Custom component labels
    onChange: (values) => {} // values is number[]
});
```

### Dropdown

Select from a list of options.

```typescript
// Simple options
const dropdown = new Dropdown('option1', {
    label: 'Mode',
    options: ['option1', 'option2', 'option3'],
    onChange: (value) => {}
});

// Label/value options
const dropdown = new Dropdown(0, {
    label: 'Quality',
    options: [
        { label: 'Low', value: 0 },
        { label: 'Medium', value: 1 },
        { label: 'High', value: 2 }
    ],
    onChange: (value) => {}
});

dropdown.setOptions([...]); // Update options
```

### Button

Action trigger (no value).

```typescript
const button = new Button('Click Me', () => {
    console.log('Clicked!');
}, {
    variant: 'default',  // 'default' | 'primary' | 'danger'
    disabled: false
});

button.setLabel('New Label');
button.enable();
button.disable();
button.setOnClick(() => {});
```

### TextInput

String text input.

```typescript
const text = new TextInput('Hello', {
    label: 'Name',
    placeholder: 'Enter name...',
    maxLength: 100,
    onChange: (value) => {}
});

text.focus();
text.selectAll();
```

## WidgetFactory

Creates input components from `ParameterMetadata`. Used by `ParameterPanelExtension` to auto-generate UI.

```typescript
import { WidgetFactory } from './app/ui/index.js';

const widget = WidgetFactory.create(
    { name: 'Intensity', type: 'float', range: [0, 10], default: 1 },
    {
        value: 1.0,
        onChange: (v) => app.setParameter('light.intensity', v)
    }
);

panel.add(widget);
```

Type mapping:
| Metadata Type | Widget |
|---------------|--------|
| `float` with `range` | Slider |
| `float` without `range` | NumberInput |
| `int` with `values` | Dropdown |
| `int` with `range` | Slider (step=1) |
| `int` without range | NumberInput (integer) |
| `bool` | Checkbox |
| `color` | ColorPicker |
| `vec2`, `vec3`, `vec4` | VectorInput |

## Theming

All components use CSS variables from `theme.css`. Override these to customize:

```css
:root {
    /* Colors */
    --ui-bg-primary: rgba(30, 30, 30, 0.95);
    --ui-bg-secondary: rgba(45, 45, 45, 0.95);
    --ui-bg-hover: rgba(75, 75, 75, 0.95);
    --ui-text-primary: rgba(255, 255, 255, 0.95);
    --ui-text-secondary: rgba(255, 255, 255, 0.7);
    --ui-accent: rgba(74, 158, 255, 1);
    --ui-border: rgba(255, 255, 255, 0.1);

    /* Spacing */
    --ui-space-sm: 8px;
    --ui-space-md: 12px;
    --ui-space-lg: 16px;

    /* Typography */
    --ui-font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    --ui-font-mono: 'SF Mono', Monaco, monospace;
    --ui-font-size-sm: 11px;
    --ui-font-size-md: 13px;

    /* Effects */
    --ui-blur: blur(20px) saturate(180%);
    --ui-shadow-md: 0 4px 16px rgba(0, 0, 0, 0.4);
    --ui-radius-md: 6px;

    /* Transitions */
    --ui-transition-fast: 0.1s ease;
}
```

## Examples

### Building a Settings Panel

```typescript
import { Panel, Folder, Slider, Checkbox, ColorPicker, Button } from './app/ui/index.js';

function createSettingsPanel(): Panel {
    const panel = new Panel({ title: 'Render Settings' });

    // Quality settings
    const quality = new Folder('Quality');
    quality.add(new Slider(1000, { label: 'Samples', min: 1, max: 10000, step: 1 }));
    quality.add(new Slider(8, { label: 'Bounces', min: 1, max: 32, step: 1 }));
    quality.add(new Checkbox(true, { label: 'Adaptive Sampling' }));
    panel.add(quality);

    // Environment
    const env = new Folder('Environment');
    env.add(new ColorPicker([0.5, 0.7, 1.0], { label: 'Sky Color' }));
    env.add(new Slider(1.0, { label: 'Intensity', min: 0, max: 5 }));
    panel.add(env);

    // Actions
    panel.add(new Button('Start Render', () => {}, { variant: 'primary' }));
    panel.add(new Button('Reset', () => {}));

    return panel;
}
```

### Creating a Modal Dialog

```typescript
import { Modal, Slider, Button } from './app/ui/index.js';

function showExportDialog(): Promise<{ width: number; height: number } | null> {
    return new Promise((resolve) => {
        let width = 1920;
        let height = 1080;

        const modal = new Modal('Export Settings', { width: 400 });

        modal.add(new Slider(width, {
            label: 'Width',
            min: 640, max: 7680, step: 1,
            onChange: (v) => { width = v; }
        }));

        modal.add(new Slider(height, {
            label: 'Height',
            min: 480, max: 4320, step: 1,
            onChange: (v) => { height = v; }
        }));

        const footer = modal.addFooter();

        new Button('Cancel', () => {
            modal.close();
            resolve(null);
        }).mount(footer);

        new Button('Export', () => {
            modal.close();
            resolve({ width, height });
        }, { variant: 'primary' }).mount(footer);

        modal.show();
    });
}
```

### Floating Tool Window

```typescript
import { Window, Slider, Checkbox, Button } from './app/ui/index.js';

const toolWindow = new Window('Brush Settings', {
    width: 280,
    height: 200,
    x: window.innerWidth - 300,
    y: 20
});

toolWindow.add(new Slider(50, { label: 'Size', min: 1, max: 200 }));
toolWindow.add(new Slider(100, { label: 'Opacity', min: 0, max: 100 }));
toolWindow.add(new Checkbox(true, { label: 'Pressure Sensitivity' }));
toolWindow.add(new Button('Reset Defaults', () => {}));

toolWindow.show();
```
