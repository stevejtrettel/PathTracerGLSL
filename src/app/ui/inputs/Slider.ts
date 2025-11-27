import { Input } from './Input.js';

export interface SliderOptions {
    min?: number;
    max?: number;
    step?: number;
    label?: string;
    onChange?: (value: number) => void;
}

export class Slider extends Input<number> {
    private input: HTMLInputElement;
    private valueDisplay: HTMLSpanElement;

    constructor(initialValue: number, options: SliderOptions = {}) {
        super('div', 'cr-slider');
        this.onChange = options.onChange;

        const min = options.min ?? 0;
        const max = options.max ?? 100;
        const step = options.step ?? 1;

        // Label
        if (options.label) {
            const label = document.createElement('label');
            label.className = 'cr-slider-label.js';
            label.textContent = options.label;
            this.domElement.appendChild(label);
        }

        // Input Container
        const container = document.createElement('div');
        container.className = 'cr-slider-container.js';
        this.domElement.appendChild(container);

        // Range Input
        this.input = document.createElement('input');
        this.input.type = 'range.js';
        this.input.min = min.toString();
        this.input.max = max.toString();
        this.input.step = step.toString();
        this.input.value = initialValue.toString();
        this.input.className = 'cr-slider-input.js';
        container.appendChild(this.input);

        // Value Display
        this.valueDisplay = document.createElement('span');
        this.valueDisplay.textContent = initialValue.toFixed(2);
        this.valueDisplay.className = 'cr-slider-value.js';
        container.appendChild(this.valueDisplay);

        // Event Listeners
        this.input.addEventListener('input', () => {
            const value = parseFloat(this.input.value);
            this.valueDisplay.textContent = value.toFixed(2);
            if (this.onChange) {
                this.onChange(value);
            }
        });
    }

    setValue(value: number): void {
        this.input.value = value.toString();
        this.valueDisplay.textContent = value.toFixed(2);
    }

    getValue(): number {
        return parseFloat(this.input.value);
    }
}
