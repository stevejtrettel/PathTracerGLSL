/**
 * NumberInput - Text input for numeric values
 *
 * Features:
 * - Direct number entry
 * - Optional min/max bounds
 * - Step increment support
 * - Integer or float mode
 */
import { Input, type InputOptions } from '../core/Input.js';

export interface NumberInputOptions extends InputOptions<number> {
    min?: number;
    max?: number;
    step?: number;
    /** Force integer values */
    integer?: boolean;
}

export class NumberInput extends Input<number> {
    private input: HTMLInputElement;
    private integer: boolean;
    private min?: number;
    private max?: number;

    constructor(initialValue: number, options: NumberInputOptions = {}) {
        super(initialValue, options, 'div', 'ui-number-input');

        this.integer = options.integer ?? false;
        this.min = options.min;
        this.max = options.max;

        // Label
        if (options.label) {
            const labelRow = document.createElement('div');
            labelRow.className = 'ui-number-input-label-row';

            const labelEl = document.createElement('span');
            labelEl.className = 'ui-number-input-label';
            labelEl.textContent = options.label;
            labelRow.appendChild(labelEl);

            this.domElement.appendChild(labelRow);
        }

        // Number input
        this.input = document.createElement('input');
        this.input.type = 'number';
        this.input.className = 'ui-number-input-field';
        this.input.value = this.formatValue(initialValue);

        if (options.min !== undefined) this.input.min = String(options.min);
        if (options.max !== undefined) this.input.max = String(options.max);
        if (options.step !== undefined) this.input.step = String(options.step);

        this.input.addEventListener('input', () => {
            const parsed = this.integer
                ? parseInt(this.input.value, 10)
                : parseFloat(this.input.value);

            if (!isNaN(parsed)) {
                // Clamp to bounds: the HTML min/max attributes don't stop typing
                // out-of-range values, so downstream would otherwise see them.
                this.emitChange(this.clamp(parsed));
            }
        });

        // Handle blur to clean up display
        this.input.addEventListener('blur', () => {
            this.updateDisplay();
        });

        this.domElement.appendChild(this.input);
    }

    protected updateDisplay(): void {
        this.input.value = this.formatValue(this._value);
    }

    private formatValue(value: number): string {
        return this.integer ? value.toFixed(0) : String(value);
    }

    private clamp(value: number): number {
        if (this.min !== undefined && value < this.min) return this.min;
        if (this.max !== undefined && value > this.max) return this.max;
        return value;
    }

    /**
     * Update the bounds
     */
    setBounds(min?: number, max?: number): this {
        if (min !== undefined) { this.input.min = String(min); this.min = min; }
        if (max !== undefined) { this.input.max = String(max); this.max = max; }
        return this;
    }
}
