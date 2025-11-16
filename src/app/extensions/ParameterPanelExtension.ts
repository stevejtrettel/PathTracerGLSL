// app/extensions/ParameterPanelExtension.ts
import type { Extension, ParameterMetadata } from '../types';
import type { App } from '../App';
import type { EventBus } from '../EventBus';
import { MODULE_ORDER } from '../../engine/types';

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
class ParameterPanelExtension implements Extension {
    name = 'parameter-panel';
    version = '1.0.0';

    private app!: App;
    private bus!: EventBus;
    private panel!: HTMLElement;
    private chevron!: HTMLElement;
    private isOpen = false;
    private width = 340;

    // Update throttling
    private updateQueue = new Map<string, any>();
    private throttleTimer: number | null = null;
    private readonly THROTTLE_MS = 16; // ~60fps

    install(app: App, bus: EventBus): void {
        this.app = app;
        this.bus = bus;

        this.injectStyles();
        this.createChevronIndicator();
        this.createPanel();
        this.populatePanel();
        this.attachKeyboardShortcut();

        console.log('✓ Parameter Panel installed (Tab to toggle)');
    }

    uninstall(): void {
        this.panel?.remove();
        this.chevron?.remove();

        if (this.throttleTimer !== null) {
            clearTimeout(this.throttleTimer);
        }
    }

    // ============================================================================
    // Styles
    // ============================================================================

    private injectStyles(): void {
        const style = document.createElement('style');
        style.id = 'parameter-panel-styles';
        style.textContent = `
            /* Panel - Glassmorphism */
            .param-panel {
                position: fixed;
                top: 0;
                right: 0;
                width: ${this.width}px;
                height: 100vh;
                background: rgba(40, 40, 40, 0.90);
                backdrop-filter: blur(20px) saturate(180%);
                -webkit-backdrop-filter: blur(20px) saturate(180%);
                border-left: 1px solid rgba(255, 255, 255, 0.15);
                box-shadow: -8px 0 32px rgba(0, 0, 0, 0.6);
                z-index: 9999;
                overflow-y: auto;
                overflow-x: hidden;

                /* Animation */
                transform: translateX(100%);
                transition: transform 0.3s cubic-bezier(0.4, 0.0, 0.2, 1);

                /* Typography */
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
                font-size: 13px;
                color: rgba(255, 255, 255, 0.95);

                /* Scrollbar */
                scrollbar-width: thin;
                scrollbar-color: rgba(255, 255, 255, 0.2) transparent;
            }

            .param-panel.open {
                transform: translateX(0);
            }

            .param-panel::-webkit-scrollbar {
                width: 8px;
            }

            .param-panel::-webkit-scrollbar-track {
                background: transparent;
            }

            .param-panel::-webkit-scrollbar-thumb {
                background: rgba(255, 255, 255, 0.2);
                border-radius: 4px;
            }

            .param-panel::-webkit-scrollbar-thumb:hover {
                background: rgba(255, 255, 255, 0.3);
            }

            /* Header */
            .param-panel-header {
                padding: 20px;
                border-bottom: 1px solid rgba(255, 255, 255, 0.08);
                position: sticky;
                top: 0;
                background: rgba(40, 40, 40, 0.95);
                backdrop-filter: blur(20px);
                -webkit-backdrop-filter: blur(20px);
                z-index: 10;
            }

            .param-panel-title {
                font-size: 16px;
                font-weight: 600;
                letter-spacing: -0.02em;
                margin: 0;
                color: rgba(255, 255, 255, 0.95);
            }

            .param-panel-subtitle {
                font-size: 11px;
                color: rgba(255, 255, 255, 0.5);
                margin: 4px 0 0 0;
            }

            /* Group */
            .param-group {
                border-bottom: 1px solid rgba(255, 255, 255, 0.05);
            }

            .param-group summary {
                padding: 14px 20px;
                cursor: pointer;
                user-select: none;
                list-style: none;
                font-weight: 500;
                color: rgba(255, 255, 255, 0.9);
                transition: background 0.15s ease;
                position: relative;
            }

            .param-group summary::-webkit-details-marker {
                display: none;
            }

            .param-group summary:hover {
                background: rgba(255, 255, 255, 0.05);
            }

            .param-group summary::before {
                content: '›';
                position: absolute;
                left: 8px;
                transition: transform 0.2s ease;
                color: rgba(255, 255, 255, 0.5);
            }

            .param-group[open] summary::before {
                transform: rotate(90deg);
            }

            .param-group-content {
                padding: 0 20px 16px 20px;
            }

            /* Parameter Row */
            .param-row {
                margin-bottom: 16px;
            }

            .param-label {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 6px;
                font-size: 12px;
                font-weight: 500;
                color: rgba(255, 255, 255, 0.8);
            }

            .param-label-text {
                display: flex;
                align-items: center;
                gap: 4px;
            }

            .param-reset-indicator {
                font-size: 11px;
                color: rgba(74, 158, 255, 0.6);
                opacity: 0.7;
            }

            .param-value-display {
                font-size: 12px;
                color: rgba(255, 255, 255, 0.6);
                font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
            }

            /* Slider */
            .param-slider-container {
                position: relative;
            }

            .param-slider {
                width: 100%;
                height: 6px;
                -webkit-appearance: none;
                appearance: none;
                background: rgba(255, 255, 255, 0.1);
                border-radius: 3px;
                outline: none;
                transition: background 0.15s ease;
            }

            .param-slider:hover {
                background: rgba(255, 255, 255, 0.12);
            }

            .param-slider::-webkit-slider-thumb {
                -webkit-appearance: none;
                appearance: none;
                width: 16px;
                height: 16px;
                background: rgba(74, 158, 255, 1);
                border: 2px solid rgba(255, 255, 255, 0.2);
                border-radius: 50%;
                cursor: pointer;
                box-shadow: 0 2px 6px rgba(0, 0, 0, 0.3);
                transition: all 0.15s ease;
            }

            .param-slider::-webkit-slider-thumb:hover {
                background: rgba(94, 178, 255, 1);
                transform: scale(1.1);
            }

            .param-slider::-webkit-slider-thumb:active {
                background: rgba(54, 138, 255, 1);
                transform: scale(0.95);
            }

            .param-slider::-moz-range-thumb {
                width: 16px;
                height: 16px;
                background: rgba(74, 158, 255, 1);
                border: 2px solid rgba(255, 255, 255, 0.2);
                border-radius: 50%;
                cursor: pointer;
                box-shadow: 0 2px 6px rgba(0, 0, 0, 0.3);
                transition: all 0.15s ease;
            }

            .param-slider::-moz-range-thumb:hover {
                background: rgba(94, 178, 255, 1);
                transform: scale(1.1);
            }

            /* Number Input */
            .param-number {
                width: 100%;
                padding: 8px 12px;
                background: rgba(255, 255, 255, 0.08);
                border: 1px solid rgba(255, 255, 255, 0.1);
                border-radius: 6px;
                color: rgba(255, 255, 255, 0.95);
                font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
                font-size: 13px;
                outline: none;
                transition: all 0.15s ease;
            }

            .param-number:hover {
                background: rgba(255, 255, 255, 0.1);
                border-color: rgba(255, 255, 255, 0.15);
            }

            .param-number:focus {
                background: rgba(255, 255, 255, 0.12);
                border-color: rgba(74, 158, 255, 0.5);
                box-shadow: 0 0 0 3px rgba(74, 158, 255, 0.1);
            }

            /* Vector Input */
            .param-vector {
                display: flex;
                gap: 4px;
            }

            .param-vector-component {
                flex: 1;
                position: relative;
                min-width: 0;
            }

            .param-vector-label {
                position: absolute;
                left: 6px;
                top: 50%;
                transform: translateY(-50%);
                font-size: 9px;
                font-weight: 600;
                color: rgba(255, 255, 255, 0.4);
                pointer-events: none;
            }

            .param-vector input {
                width: 100%;
                padding: 6px 2px 6px 14px;
                background: rgba(255, 255, 255, 0.08);
                border: 1px solid rgba(255, 255, 255, 0.1);
                border-radius: 6px;
                color: rgba(255, 255, 255, 0.95);
                font-family: 'SF Mono', Monaco, monospace;
                font-size: 10px;
                outline: none;
                transition: all 0.15s ease;
                box-sizing: border-box;
            }

            .param-vector input:hover {
                background: rgba(255, 255, 255, 0.1);
            }

            .param-vector input:focus {
                background: rgba(255, 255, 255, 0.12);
                border-color: rgba(74, 158, 255, 0.5);
                box-shadow: 0 0 0 3px rgba(74, 158, 255, 0.1);
            }

            /* Checkbox */
            .param-checkbox-container {
                display: flex;
                align-items: center;
                gap: 10px;
                padding: 8px 0;
            }

            .param-checkbox {
                width: 20px;
                height: 20px;
                -webkit-appearance: none;
                appearance: none;
                background: rgba(255, 255, 255, 0.08);
                border: 1.5px solid rgba(255, 255, 255, 0.2);
                border-radius: 4px;
                outline: none;
                cursor: pointer;
                position: relative;
                transition: all 0.15s ease;
            }

            .param-checkbox:hover {
                background: rgba(255, 255, 255, 0.12);
                border-color: rgba(255, 255, 255, 0.3);
            }

            .param-checkbox:checked {
                background: rgba(74, 158, 255, 1);
                border-color: rgba(74, 158, 255, 1);
            }

            .param-checkbox:checked::after {
                content: '✓';
                position: absolute;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                color: white;
                font-size: 14px;
                font-weight: bold;
            }

            /* Color Picker */
            .param-color-container {
                display: flex;
                align-items: center;
                gap: 10px;
            }

            .param-color-swatch {
                width: 40px;
                height: 32px;
                border-radius: 6px;
                border: 2px solid rgba(255, 255, 255, 0.2);
                cursor: pointer;
                transition: all 0.15s ease;
                overflow: hidden;
            }

            .param-color-swatch:hover {
                border-color: rgba(255, 255, 255, 0.4);
                transform: scale(1.05);
            }

            .param-color-picker {
                opacity: 0;
                width: 0;
                height: 0;
                position: absolute;
            }

            .param-color-rgb {
                flex: 1;
                font-family: 'SF Mono', Monaco, monospace;
                font-size: 11px;
                color: rgba(255, 255, 255, 0.6);
            }

            /* Dropdown */
            .param-dropdown {
                width: 100%;
                padding: 8px 32px 8px 12px;
                background: rgba(255, 255, 255, 0.08);
                border: 1px solid rgba(255, 255, 255, 0.1);
                border-radius: 6px;
                color: rgba(255, 255, 255, 0.95);
                font-size: 13px;
                outline: none;
                cursor: pointer;
                -webkit-appearance: none;
                appearance: none;
                background-image: url("data:image/svg+xml,%3Csvg width='12' height='8' viewBox='0 0 12 8' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1.5L6 6.5L11 1.5' stroke='rgba(255,255,255,0.6)' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
                background-repeat: no-repeat;
                background-position: right 12px center;
                transition: all 0.15s ease;
            }

            .param-dropdown:hover {
                background-color: rgba(255, 255, 255, 0.1);
                border-color: rgba(255, 255, 255, 0.15);
            }

            .param-dropdown:focus {
                background-color: rgba(255, 255, 255, 0.12);
                border-color: rgba(74, 158, 255, 0.5);
                box-shadow: 0 0 0 3px rgba(74, 158, 255, 0.1);
            }

            /* Chevron Indicator */
            .param-chevron {
                position: fixed;
                top: 20px;
                right: 20px;
                width: 32px;
                height: 32px;
                background: rgba(40, 40, 40, 0.90);
                backdrop-filter: blur(20px);
                -webkit-backdrop-filter: blur(20px);
                border: 1px solid rgba(255, 255, 255, 0.15);
                border-radius: 8px;
                display: flex;
                align-items: center;
                justify-content: center;
                cursor: pointer;
                z-index: 9998;
                transition: all 0.2s ease;
                box-shadow: 0 2px 10px rgba(0, 0, 0, 0.3);
            }

            .param-chevron:hover {
                background: rgba(55, 55, 55, 0.95);
                border-color: rgba(255, 255, 255, 0.25);
                transform: scale(1.05);
            }

            .param-chevron.hidden {
                transform: translateX(calc(100% + 20px));
            }

            .param-chevron::after {
                content: '‹';
                color: rgba(255, 255, 255, 0.8);
                font-size: 20px;
                font-weight: 300;
                transition: transform 0.2s ease;
            }

            .param-chevron.open::after {
                transform: rotate(180deg);
            }
        `;

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
            widget = this.createSlider(path, meta);
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

    private createSlider(path: string, meta: ParameterMetadata): HTMLElement {
        const container = document.createElement('div');
        container.className = 'param-slider-container';

        const slider = document.createElement('input');
        slider.type = 'range';
        slider.className = 'param-slider';
        slider.min = String(meta.range![0]);
        slider.max = String(meta.range![1]);
        slider.step = String(meta.step || (meta.range![1] - meta.range![0]) / 100);

        const currentValue = this.app.parameterStore.get(path);
        slider.value = String(currentValue ?? meta.default);

        // Value display
        const valueDisplay = document.createElement('div');
        valueDisplay.className = 'param-value-display';
        const updateDisplay = (val: number) => {
            const formatted = meta.type === 'int' ? val.toFixed(0) : val.toFixed(2);
            valueDisplay.textContent = meta.unit ? `${formatted} ${meta.unit}` : formatted;
        };
        updateDisplay(parseFloat(slider.value));

        // Find and update label
        const label = container.parentElement?.querySelector('.param-label');
        if (label) {
            label.appendChild(valueDisplay);
        }

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

        const currentValue = this.app.parameterStore.get(path);
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

        const currentValue = this.app.parameterStore.get(path);
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

        const currentValue = this.app.parameterStore.get(path) || meta.default;
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

        const currentValue = this.app.parameterStore.get(path) || meta.default;

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

        const currentValue = this.app.parameterStore.get(path) ?? meta.default;

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
            this.app.parameterStore.set(path, value);
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

    private attachKeyboardShortcut(): void {
        window.addEventListener('keydown', (e) => {
            if (e.key === 'Tab' && !e.ctrlKey && !e.metaKey && !e.altKey) {
                // Only intercept if not in an input field
                const target = e.target as HTMLElement;
                if (target.tagName !== 'INPUT' && target.tagName !== 'TEXTAREA') {
                    e.preventDefault();
                    this.toggle();
                }
            }
        });
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

export { ParameterPanelExtension };
