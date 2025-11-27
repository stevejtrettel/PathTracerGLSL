// app/extensions/ParameterPanelExtension.ts
// Parameter panel UI extension for App

import type { Extension, ParameterMetadata } from '../types.js';
import type { App } from '../App.js';
import type { EventBus } from '../EventBus.js';
import { MODULE_ORDER } from '../../engine/types.js';
import parameterPanelStyles from './styles/parameter-panel.css?inline';

/**
 * ParameterPanelExtension
 *
 * Beautiful glassmorphism parameter panel with:
 * - Auto-generated widgets from metadata
 * - Smooth slide-in/out animation
 * - Tab key toggle + chevron indicator
 * - Grouped by module type, sorted by MODULE_ORDER
 * - Throttled updates for smooth performance
 */
export class ParameterPanelExtension implements Extension {
    name = 'parameter-panel';
    version = '1.0.0';
    description = 'Auto-generated parameter controls panel';

    private app!: App;
    private panel!: HTMLElement;
    private chevron!: HTMLElement;
    private isOpen = false;
    private width = 340;

    // Update throttling
    private updateQueue = new Map<string, any>();
    private throttleTimer: number | null = null;
    private readonly THROTTLE_MS = 16; // ~60fps

    install(app: App, _bus: EventBus): void {
        this.app = app;

        this.injectStyles();
        this.createChevronIndicator();
        this.createPanel();
        this.populatePanel();
        this.attachKeyboardShortcut();

        console.log('Parameter Panel installed (Tab to toggle)');
    }

    uninstall(): void {
        this.panel?.remove();
        this.chevron?.remove();

        // Remove injected styles
        const style = document.getElementById('parameter-panel-styles');
        style?.remove();

        if (this.throttleTimer !== null) {
            clearTimeout(this.throttleTimer);
        }
    }

    // ============================================================================
    // Styles
    // ============================================================================

    private injectStyles(): void {
        // Check if styles already exist
        if (document.getElementById('parameter-panel-styles')) return;

        const style = document.createElement('style');
        style.id = 'parameter-panel-styles';
        style.textContent = parameterPanelStyles;

        document.head.appendChild(style);
    }

    // ============================================================================
    // UI Creation
    // ============================================================================

    private createChevronIndicator(): void {
        this.chevron = document.createElement('div');
        this.chevron.className = 'param-chevron';
        this.chevron.title = 'Toggle Parameters (Tab)';
        this.chevron.onclick = () => this.toggle();
        document.body.appendChild(this.chevron);
    }

    private createPanel(): void {
        this.panel = document.createElement('div');
        this.panel.className = 'param-panel';

        // Header
        const header = document.createElement('div');
        header.className = 'param-panel-header';

        const title = document.createElement('h2');
        title.className = 'param-panel-title';
        title.textContent = 'Parameters';

        const subtitle = document.createElement('p');
        subtitle.className = 'param-panel-subtitle';
        subtitle.textContent = 'Press Tab to toggle';

        header.appendChild(title);
        header.appendChild(subtitle);
        this.panel.appendChild(header);

        document.body.appendChild(this.panel);
    }

    private populatePanel(): void {
        const metadata = this.app.getParameterMetadata();

        // Show empty state if no parameters
        if (metadata.size === 0) {
            const empty = document.createElement('div');
            empty.className = 'param-empty';
            empty.textContent = 'No parameters available for current renderer';
            this.panel.appendChild(empty);
            return;
        }

        // Group parameters by group name
        const groups = this.groupParameters(metadata);

        // Sort groups by MODULE_ORDER
        const sortedGroups = this.sortGroups(groups);

        // Create UI for each group
        for (const [groupName, params] of sortedGroups) {
            const groupElement = this.createGroup(groupName, params);
            this.panel.appendChild(groupElement);
        }
    }

    private groupParameters(metadata: Map<string, ParameterMetadata>): Map<string, Array<{ path: string; meta: ParameterMetadata }>> {
        const groups = new Map<string, Array<{ path: string; meta: ParameterMetadata }>>();

        for (const [path, meta] of metadata) {
            const group = meta.group || 'Other';
            if (!groups.has(group)) {
                groups.set(group, []);
            }
            groups.get(group)!.push({ path, meta });
        }

        return groups;
    }

    private sortGroups(groups: Map<string, any[]>): Map<string, any[]> {
        // Create ordering from MODULE_ORDER
        const order = new Map<string, number>();
        MODULE_ORDER.forEach((kind, index) => {
            const groupName = kind.charAt(0).toUpperCase() + kind.slice(1);
            order.set(groupName, index);
        });

        // Sort groups
        const sorted = Array.from(groups.entries()).sort((a, b) => {
            const orderA = order.get(a[0]) ?? 999;
            const orderB = order.get(b[0]) ?? 999;
            return orderA - orderB;
        });

        return new Map(sorted);
    }

    private createGroup(name: string, params: Array<{ path: string; meta: ParameterMetadata }>): HTMLElement {
        const details = document.createElement('details');
        details.className = 'param-group';

        const summary = document.createElement('summary');
        summary.textContent = `${name} (${params.length})`;

        const content = document.createElement('div');
        content.className = 'param-group-content';

        for (const { path, meta } of params) {
            const widget = this.createWidget(path, meta);
            content.appendChild(widget);
        }

        details.appendChild(summary);
        details.appendChild(content);

        return details;
    }

    // ============================================================================
    // Widget Builders
    // ============================================================================

    private createWidget(path: string, meta: ParameterMetadata): HTMLElement {
        const container = document.createElement('div');
        container.className = 'param-row';

        // Label
        const label = this.createLabel(meta);
        container.appendChild(label);

        // Widget based on type
        let widget: HTMLElement;

        if (meta.type === 'float' && meta.range) {
            widget = this.createSlider(path, meta, label);
        } else if (meta.type === 'float' || meta.type === 'int') {
            widget = this.createNumberInput(path, meta);
        } else if (meta.type === 'bool') {
            widget = this.createCheckbox(path, meta);
        } else if (meta.type === 'vec2' || meta.type === 'vec3' || meta.type === 'vec4') {
            widget = this.createVectorInput(path, meta);
        } else if (meta.type === 'color') {
            widget = this.createColorPicker(path, meta);
        } else if (meta.type === 'int' && meta.values) {
            widget = this.createDropdown(path, meta);
        } else {
            widget = this.createNumberInput(path, meta);
        }

        container.appendChild(widget);

        return container;
    }

    private createLabel(meta: ParameterMetadata): HTMLElement {
        const label = document.createElement('div');
        label.className = 'param-label';

        const labelText = document.createElement('div');
        labelText.className = 'param-label-text';
        labelText.textContent = meta.name || '';

        // Add reset indicator if triggers reset
        if (meta.triggersReset !== false) {
            const resetIcon = document.createElement('span');
            resetIcon.className = 'param-reset-indicator';
            resetIcon.textContent = '⟲';
            resetIcon.title = 'Changing this resets accumulation';
            labelText.appendChild(resetIcon);
        }

        label.appendChild(labelText);

        return label;
    }

    private createSlider(path: string, meta: ParameterMetadata, label: HTMLElement): HTMLElement {
        const container = document.createElement('div');
        container.className = 'param-slider-container';

        const slider = document.createElement('input');
        slider.type = 'range';
        slider.className = 'param-slider';
        slider.min = String(meta.range![0]);
        slider.max = String(meta.range![1]);
        slider.step = String(meta.step || (meta.range![1] - meta.range![0]) / 100);

        const currentValue = this.app.getParameter(path);
        slider.value = String(currentValue ?? meta.default);

        // Value display
        const valueDisplay = document.createElement('div');
        valueDisplay.className = 'param-value-display';
        const updateDisplay = (val: number) => {
            const formatted = meta.type === 'int' ? val.toFixed(0) : val.toFixed(2);
            valueDisplay.textContent = meta.unit ? `${formatted} ${meta.unit}` : formatted;
        };
        updateDisplay(parseFloat(slider.value));

        // Append value display to label
        label.appendChild(valueDisplay);

        slider.oninput = () => {
            const value = meta.type === 'int' ? parseInt(slider.value) : parseFloat(slider.value);
            updateDisplay(value);
            this.queueUpdate(path, value);
        };

        container.appendChild(slider);

        return container;
    }

    private createNumberInput(path: string, meta: ParameterMetadata): HTMLElement {
        const input = document.createElement('input');
        input.type = 'number';
        input.className = 'param-number';

        if (meta.range) {
            input.min = String(meta.range[0]);
            input.max = String(meta.range[1]);
        }
        if (meta.step) {
            input.step = String(meta.step);
        }

        const currentValue = this.app.getParameter(path);
        input.value = String(currentValue ?? meta.default);

        input.oninput = () => {
            const value = meta.type === 'int' ? parseInt(input.value) : parseFloat(input.value);
            if (!isNaN(value)) {
                this.queueUpdate(path, value);
            }
        };

        return input;
    }

    private createCheckbox(path: string, meta: ParameterMetadata): HTMLElement {
        const container = document.createElement('div');
        container.className = 'param-checkbox-container';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'param-checkbox';

        const currentValue = this.app.getParameter(path);
        checkbox.checked = currentValue ?? meta.default;

        checkbox.onchange = () => {
            this.queueUpdate(path, checkbox.checked);
        };

        const label = document.createElement('span');
        label.textContent = meta.name || path;

        container.appendChild(checkbox);
        container.appendChild(label);

        return container;
    }

    private createVectorInput(path: string, meta: ParameterMetadata): HTMLElement {
        const container = document.createElement('div');
        container.className = 'param-vector';

        const components = meta.type === 'vec2' ? 2 : meta.type === 'vec3' ? 3 : 4;
        const labels = ['X', 'Y', 'Z', 'W'];

        const currentValue = this.app.getParameter(path) || meta.default;
        const inputs: HTMLInputElement[] = [];

        for (let i = 0; i < components; i++) {
            const componentDiv = document.createElement('div');
            componentDiv.className = 'param-vector-component';

            const componentLabel = document.createElement('span');
            componentLabel.className = 'param-vector-label';
            componentLabel.textContent = labels[i];

            const input = document.createElement('input');
            input.type = 'number';
            input.step = '0.01';
            input.value = String(currentValue[i] ?? 0);

            inputs.push(input);

            input.oninput = () => {
                const values = inputs.map(inp => parseFloat(inp.value));
                if (values.every(v => !isNaN(v))) {
                    this.queueUpdate(path, values);
                }
            };

            componentDiv.appendChild(componentLabel);
            componentDiv.appendChild(input);
            container.appendChild(componentDiv);
        }

        return container;
    }

    private createColorPicker(path: string, meta: ParameterMetadata): HTMLElement {
        const container = document.createElement('div');
        container.className = 'param-color-container';

        const currentValue = this.app.getParameter(path) || meta.default;

        // Color swatch
        const swatch = document.createElement('div');
        swatch.className = 'param-color-swatch';

        // Hidden color picker
        const picker = document.createElement('input');
        picker.type = 'color';
        picker.className = 'param-color-picker';

        // RGB display
        const rgbDisplay = document.createElement('div');
        rgbDisplay.className = 'param-color-rgb';

        const updateColor = (rgb: number[]) => {
            const hex = this.rgbToHex(rgb);
            swatch.style.background = hex;
            picker.value = hex;
            rgbDisplay.textContent = `RGB(${rgb.map(v => v.toFixed(2)).join(', ')})`;
        };

        updateColor(currentValue);

        swatch.onclick = () => picker.click();

        picker.oninput = () => {
            const rgb = this.hexToRgb(picker.value);
            updateColor(rgb);
            this.queueUpdate(path, rgb);
        };

        container.appendChild(swatch);
        container.appendChild(picker);
        container.appendChild(rgbDisplay);

        return container;
    }

    private createDropdown(path: string, meta: ParameterMetadata): HTMLElement {
        const select = document.createElement('select');
        select.className = 'param-dropdown';

        const currentValue = this.app.getParameter(path) ?? meta.default;

        for (const value of meta.values!) {
            const option = document.createElement('option');
            option.value = String(value);
            option.textContent = String(value);
            option.selected = value === currentValue;
            select.appendChild(option);
        }

        select.onchange = () => {
            this.queueUpdate(path, parseInt(select.value));
        };

        return select;
    }

    // ============================================================================
    // Update Management
    // ============================================================================

    private queueUpdate(path: string, value: any): void {
        this.updateQueue.set(path, value);

        if (this.throttleTimer !== null) {
            return; // Already scheduled
        }

        this.throttleTimer = window.setTimeout(() => {
            this.flushUpdates();
            this.throttleTimer = null;
        }, this.THROTTLE_MS);
    }

    private flushUpdates(): void {
        for (const [path, value] of this.updateQueue) {
            this.app.setParameter(path, value);
        }
        this.updateQueue.clear();
    }

    // ============================================================================
    // Toggle
    // ============================================================================

    private toggle(): void {
        this.isOpen = !this.isOpen;

        if (this.isOpen) {
            this.panel.classList.add('open');
            this.chevron.classList.add('open');
        } else {
            this.panel.classList.remove('open');
            this.chevron.classList.remove('open');
        }
    }

    /**
     * Programmatically open the panel
     */
    open(): void {
        if (!this.isOpen) {
            this.toggle();
        }
    }

    /**
     * Programmatically close the panel
     */
    close(): void {
        if (this.isOpen) {
            this.toggle();
        }
    }

    private attachKeyboardShortcut(): void {
        // Use capture phase to intercept Tab before browser's focus cycling
        window.addEventListener('keydown', (e) => {
            if (e.key === 'Tab' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
                // Allow Tab in form fields within the param panel itself
                const target = e.target as HTMLElement;
                const inParamPanel = target.closest('.param-panel');

                if (!inParamPanel) {
                    // Outside param panel - toggle it
                    e.preventDefault();
                    e.stopPropagation();
                    this.toggle();
                }
            }
        }, { capture: true });
    }

    // ============================================================================
    // Utilities
    // ============================================================================

    private rgbToHex(rgb: number[]): string {
        const r = Math.round(rgb[0] * 255);
        const g = Math.round(rgb[1] * 255);
        const b = Math.round(rgb[2] * 255);
        return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
    }

    private hexToRgb(hex: string): number[] {
        const r = parseInt(hex.slice(1, 3), 16) / 255;
        const g = parseInt(hex.slice(3, 5), 16) / 255;
        const b = parseInt(hex.slice(5, 7), 16) / 255;
        return [r, g, b];
    }
}
