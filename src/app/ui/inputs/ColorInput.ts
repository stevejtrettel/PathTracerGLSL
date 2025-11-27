import { Input } from './Input.js';

export interface ColorInputOptions {
    label?: string;
    onChange?: (value: string) => void;
}

export class ColorInput extends Input<string> {
    private input: HTMLInputElement;

    constructor(initialValue: string, options: ColorInputOptions = {}) {
        super('div', 'cr-color-input');
        this.onChange = options.onChange;

        if (options.label) {
            const label = document.createElement('label');
            label.className = 'cr-color-input-label.js';
            label.textContent = options.label;
            this.domElement.appendChild(label);
        }

        this.input = document.createElement('input');
        this.input.type = 'color.js';
        this.input.value = initialValue;
        this.input.className = 'cr-color-input-field.js';

        this.input.addEventListener('input', () => {
            if (this.onChange) {
                this.onChange(this.input.value);
            }
        });

        const container = document.createElement('div');
        container.className = 'cr-color-input-container.js';
        container.appendChild(this.input);
        this.domElement.appendChild(container);
    }

    setValue(value: string): void {
        this.input.value = value;
    }

    getValue(): string {
        return this.input.value;
    }
}
