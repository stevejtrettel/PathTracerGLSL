import { Input } from './Input.js';

export interface TextInputOptions {
    label?: string;
    onChange?: (value: string) => void;
}

export class TextInput extends Input<string> {
    private input: HTMLInputElement;

    constructor(initialValue: string, options: TextInputOptions = {}) {
        super('div', 'cr-text-input');
        this.onChange = options.onChange;

        if (options.label) {
            const label = document.createElement('label');
            label.className = 'cr-text-input-label.js';
            label.textContent = options.label;
            this.domElement.appendChild(label);
        }

        this.input = document.createElement('input');
        this.input.type = 'text.js';
        this.input.value = initialValue;
        this.input.className = 'cr-text-input-field.js';

        this.input.addEventListener('change', () => {
            if (this.onChange) {
                this.onChange(this.input.value);
            }
        });

        this.domElement.appendChild(this.input);
    }

    setValue(value: string): void {
        this.input.value = value;
    }

    getValue(): string {
        return this.input.value;
    }
}
