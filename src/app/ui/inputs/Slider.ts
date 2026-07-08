/**
 * Slider - Range input for numeric values
 *
 * Features:
 * - Label with value display
 * - Configurable min/max/step
 * - Smooth dragging
 */
import { Input, type InputOptions } from '../core/Input.js';

export interface SliderOptions extends InputOptions<number> {
    min?: number;
    max?: number;
    step?: number;
    /** Number of decimal places to show (default: auto based on step) */
    precision?: number;
}

export class Slider extends Input<number> {
    private slider: HTMLInputElement;
    private valueDisplay: HTMLSpanElement;
    private precision: number;

    constructor(initialValue: number, options: SliderOptions = {}) {
        super(initialValue, options, 'div', 'ui-slider');

        const min = options.min ?? 0;
        const max = options.max ?? 1;
        const step = options.step ?? (max - min) / 100;

        // Auto-calculate precision from step if not specified
        this.precision = options.precision ?? this.calculatePrecision(step);

        // Label row (label + value display)
        const labelRow = document.createElement('div');
        labelRow.className = 'ui-slider-label-row';

        if (options.label) {
            const labelEl = document.createElement('span');
            labelEl.className = 'ui-slider-label';
            labelEl.textContent = options.label;
            labelRow.appendChild(labelEl);
        }

        this.valueDisplay = document.createElement('span');
        this.valueDisplay.className = 'ui-slider-value';
        labelRow.appendChild(this.valueDisplay);

        this.domElement.appendChild(labelRow);

        // Slider input
        this.slider = document.createElement('input');
        this.slider.type = 'range';
        this.slider.className = 'ui-slider-input';
        this.slider.min = String(min);
        this.slider.max = String(max);
        this.slider.step = String(step);
        this.slider.value = String(initialValue);

        this.slider.addEventListener('input', () => {
            const value = parseFloat(this.slider.value);
            this.emitChange(value);
            this.updateValueDisplay();
        });

        this.domElement.appendChild(this.slider);
        this.updateDisplay();
    }

    protected updateDisplay(): void {
        this.slider.value = String(this._value);
        this.updateValueDisplay();
    }

    private updateValueDisplay(): void {
        this.valueDisplay.textContent = this._value.toFixed(this.precision);
    }

    private calculatePrecision(step: number): number {
        if (!isFinite(step) || step <= 0) return 2;
        if (step >= 1) return 0;
        // Derive decimals from the step's magnitude and cap them. Reading the
        // digits off step.toString() breaks on float-error steps like
        // (0.7 - 0) / 100 = 0.006999999999999999, which would yield 18 decimals
        // and render "0.350000000000000000".
        const decimals = Math.ceil(-Math.log10(step));
        return Math.min(Math.max(decimals, 0), 6);
    }

    /**
     * Update the range bounds
     */
    setRange(min: number, max: number): this {
        this.slider.min = String(min);
        this.slider.max = String(max);
        return this;
    }
}
