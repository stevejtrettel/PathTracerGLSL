/**
 * UI Component System
 *
 * A standalone, framework-agnostic UI library for building control panels,
 * dialogs, and interactive interfaces.
 *
 * ## Design Principles
 *
 * 1. **Standalone**: No dependency on App, EventBus, or other systems.
 *    Components work with plain DOM and callbacks.
 *
 * 2. **Composable**: Containers hold components, which can be other containers.
 *    Build complex UIs from simple pieces.
 *
 * 3. **Consistent**: All inputs follow the same pattern (value, onChange).
 *    All containers follow the same pattern (add, clear, dispose).
 *
 * 4. **Themed**: All styling uses CSS variables from theme.css.
 *    Customize the look by overriding variables.
 *
 * ## Usage Example
 *
 * ```typescript
 * import { Panel, Folder, Slider, Checkbox, Button } from './ui/index.js';
 *
 * // Create a panel
 * const panel = new Panel({ title: 'Settings' });
 *
 * // Add a folder with controls
 * const lightFolder = new Folder('Lighting');
 * lightFolder.add(new Slider(1.0, {
 *     label: 'Intensity',
 *     min: 0, max: 10,
 *     onChange: (v) => console.log('Intensity:', v)
 * }));
 * lightFolder.add(new Checkbox(true, {
 *     label: 'Shadows',
 *     onChange: (v) => console.log('Shadows:', v)
 * }));
 *
 * panel.add(lightFolder);
 * panel.add(new Button('Reset', () => console.log('Reset clicked')));
 *
 * // Mount to DOM
 * panel.mount(document.body);
 * ```
 *
 * @module ui
 */

// Import styles (side effect)
import './styles/components.css';

// Core
export { UIComponent } from './core/UIComponent.js';
export { Container } from './core/Container.js';
export { Input, type InputOptions } from './core/Input.js';
export { HdrColorInput, type HdrColorInputOptions } from './inputs/HdrColorInput.js';

// Containers
export { Panel, type PanelOptions } from './containers/Panel.js';
export { Folder, type FolderOptions } from './containers/Folder.js';
export { Window, type WindowOptions } from './containers/Window.js';
export { Modal, type ModalOptions } from './containers/Modal.js';

// Inputs
export { Slider, type SliderOptions } from './inputs/Slider.js';
export { Checkbox, type CheckboxOptions } from './inputs/Checkbox.js';
export { NumberInput, type NumberInputOptions } from './inputs/NumberInput.js';
export { ColorPicker, type ColorPickerOptions } from './inputs/ColorPicker.js';
export { VectorInput, type VectorInputOptions } from './inputs/VectorInput.js';
export { Dropdown, type DropdownOptions, type DropdownOption } from './inputs/Dropdown.js';
export { Button, type ButtonOptions } from './inputs/Button.js';
export { TextInput, type TextInputOptions } from './inputs/TextInput.js';

// Factory
export { WidgetFactory, createWidget } from './WidgetFactory.js';
