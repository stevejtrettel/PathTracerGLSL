/**
 * ColorPicker - RGB color input
 *
 * Features:
 * - Color swatch preview
 * - Native color picker
 * - RGB value display
 * - Values are [0-1] normalized RGB arrays
 */
import { Input, type InputOptions } from '../core/Input.js';

export interface ColorPickerOptions extends InputOptions<number[]> {}

export class ColorPicker extends Input<number[]> {
    private swatch: HTMLDivElement;
    private picker: HTMLInputElement;
    private rgbDisplay: HTMLSpanElement;

    constructor(initialValue: number[], options: ColorPickerOptions = {}) {
        super(initialValue, options, 'div', 'ui-color-picker');

        // Label
        if (options.label) {
            const labelEl = document.createElement('div');
            labelEl.className = 'ui-color-picker-label';
            labelEl.textContent = options.label;
            this.domElement.appendChild(labelEl);
        }

        // Container for swatch and value
        const container = document.createElement('div');
        container.className = 'ui-color-picker-container';

        // Color swatch (clickable)
        this.swatch = document.createElement('div');
        this.swatch.className = 'ui-color-picker-swatch';
        this.swatch.addEventListener('click', () => this.picker.click());

        // Hidden native color picker
        this.picker = document.createElement('input');
        this.picker.type = 'color';
        this.picker.className = 'ui-color-picker-input';

        this.picker.addEventListener('input', () => {
            const rgb = this.hexToRgb(this.picker.value);
            this.emitChange(rgb);
            this.updateDisplay();
        });

        // RGB value display
        this.rgbDisplay = document.createElement('span');
        this.rgbDisplay.className = 'ui-color-picker-rgb';

        container.appendChild(this.swatch);
        container.appendChild(this.picker);
        container.appendChild(this.rgbDisplay);
        this.domElement.appendChild(container);

        this.updateDisplay();
    }

    protected updateDisplay(): void {
        const hex = this.rgbToHex(this._value);
        this.swatch.style.backgroundColor = hex;
        this.picker.value = hex;
        this.rgbDisplay.textContent = this._value
            .slice(0, 3)
            .map(v => v.toFixed(2))
            .join(', ');
    }

    protected valuesEqual(a: number[], b: number[]): boolean {
        if (a.length !== b.length) return false;
        return a.every((v, i) => Math.abs(v - b[i]) < 0.001);
    }

    private rgbToHex(rgb: number[]): string {
        const r = Math.round(Math.min(1, Math.max(0, rgb[0])) * 255);
        const g = Math.round(Math.min(1, Math.max(0, rgb[1])) * 255);
        const b = Math.round(Math.min(1, Math.max(0, rgb[2])) * 255);
        return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
    }

    private hexToRgb(hex: string): number[] {
        const r = parseInt(hex.slice(1, 3), 16) / 255;
        const g = parseInt(hex.slice(3, 5), 16) / 255;
        const b = parseInt(hex.slice(5, 7), 16) / 255;
        return [r, g, b];
    }
}
