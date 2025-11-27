/**
 * Checkbox - Boolean toggle input
 *
 * Features:
 * - Custom styled checkbox
 * - Label support
 */
import { Input, type InputOptions } from '../core/Input.js';

export interface CheckboxOptions extends InputOptions<boolean> {}

export class Checkbox extends Input<boolean> {
    private checkbox: HTMLInputElement;
    private labelElement?: HTMLSpanElement;

    constructor(initialValue: boolean, options: CheckboxOptions = {}) {
        super(initialValue, options, 'label', 'ui-checkbox');

        // Make the whole component clickable via label element
        this.checkbox = document.createElement('input');
        this.checkbox.type = 'checkbox';
        this.checkbox.className = 'ui-checkbox-input';
        this.checkbox.checked = initialValue;

        this.checkbox.addEventListener('change', () => {
            this.emitChange(this.checkbox.checked);
        });

        // Custom checkbox visual
        const checkmark = document.createElement('span');
        checkmark.className = 'ui-checkbox-checkmark';

        this.domElement.appendChild(this.checkbox);
        this.domElement.appendChild(checkmark);

        // Label text
        if (options.label) {
            this.labelElement = document.createElement('span');
            this.labelElement.className = 'ui-checkbox-label';
            this.labelElement.textContent = options.label;
            this.domElement.appendChild(this.labelElement);
        }
    }

    protected updateDisplay(): void {
        this.checkbox.checked = this._value;
    }

    /**
     * Toggle the checkbox value
     */
    toggle(): this {
        this.emitChange(!this._value);
        this.updateDisplay();
        return this;
    }
}
