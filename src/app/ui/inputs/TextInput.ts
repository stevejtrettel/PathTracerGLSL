/**
 * TextInput - String text input
 *
 * Features:
 * - Single line text entry
 * - Placeholder support
 */
import { Input, type InputOptions } from '../core/Input.js';

export interface TextInputOptions extends InputOptions<string> {
    /** Placeholder text */
    placeholder?: string;
    /** Maximum length */
    maxLength?: number;
}

export class TextInput extends Input<string> {
    private input: HTMLInputElement;

    constructor(initialValue: string, options: TextInputOptions = {}) {
        super(initialValue, options, 'div', 'ui-text-input');

        // Label
        if (options.label) {
            const labelRow = document.createElement('div');
            labelRow.className = 'ui-text-input-label-row';

            const labelEl = document.createElement('span');
            labelEl.className = 'ui-text-input-label';
            labelEl.textContent = options.label;
            labelRow.appendChild(labelEl);

            this.domElement.appendChild(labelRow);
        }

        // Text input
        this.input = document.createElement('input');
        this.input.type = 'text';
        this.input.className = 'ui-text-input-field';
        this.input.value = initialValue;

        if (options.placeholder) {
            this.input.placeholder = options.placeholder;
        }

        if (options.maxLength !== undefined) {
            this.input.maxLength = options.maxLength;
        }

        this.input.addEventListener('input', () => {
            this.emitChange(this.input.value);
        });

        this.domElement.appendChild(this.input);
    }

    protected updateDisplay(): void {
        this.input.value = this._value;
    }

    /**
     * Focus the input
     */
    focus(): this {
        this.input.focus();
        return this;
    }

    /**
     * Select all text
     */
    selectAll(): this {
        this.input.select();
        return this;
    }
}
