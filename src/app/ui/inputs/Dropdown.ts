/**
 * Dropdown - Select from a list of options
 *
 * Features:
 * - Options can be primitives or {label, value} objects
 * - Custom styling
 */
import { Input, type InputOptions } from '../core/Input.js';

export interface DropdownOption<T> {
    label: string;
    value: T;
}

export interface DropdownOptions<T> extends InputOptions<T> {
    /** Options to select from */
    options: Array<T | DropdownOption<T>>;
}

export class Dropdown<T extends string | number> extends Input<T> {
    private select: HTMLSelectElement;
    private optionValues: T[] = [];

    constructor(initialValue: T, options: DropdownOptions<T>) {
        super(initialValue, options, 'div', 'ui-dropdown');

        // Label
        if (options.label) {
            const labelRow = document.createElement('div');
            labelRow.className = 'ui-dropdown-label-row';

            const labelEl = document.createElement('span');
            labelEl.className = 'ui-dropdown-label';
            labelEl.textContent = options.label;
            labelRow.appendChild(labelEl);

            this.domElement.appendChild(labelRow);
        }

        // Select element
        this.select = document.createElement('select');
        this.select.className = 'ui-dropdown-select';

        // Add options
        for (const opt of options.options) {
            const optionEl = document.createElement('option');

            if (this.isDropdownOption(opt)) {
                optionEl.value = String(opt.value);
                optionEl.textContent = opt.label;
                this.optionValues.push(opt.value);
            } else {
                optionEl.value = String(opt);
                optionEl.textContent = String(opt);
                this.optionValues.push(opt);
            }

            if ((this.isDropdownOption(opt) ? opt.value : opt) === initialValue) {
                optionEl.selected = true;
            }

            this.select.appendChild(optionEl);
        }

        this.select.addEventListener('change', () => {
            const index = this.select.selectedIndex;
            if (index >= 0 && index < this.optionValues.length) {
                this.emitChange(this.optionValues[index]);
            }
        });

        this.domElement.appendChild(this.select);
    }

    protected updateDisplay(): void {
        const index = this.optionValues.indexOf(this._value);
        if (index >= 0) {
            this.select.selectedIndex = index;
        }
    }

    private isDropdownOption(opt: T | DropdownOption<T>): opt is DropdownOption<T> {
        return typeof opt === 'object' && opt !== null && 'label' in opt && 'value' in opt;
    }

    /**
     * Update the available options
     */
    setOptions(options: Array<T | DropdownOption<T>>): this {
        this.select.innerHTML = '';
        this.optionValues = [];

        for (const opt of options) {
            const optionEl = document.createElement('option');

            if (this.isDropdownOption(opt)) {
                optionEl.value = String(opt.value);
                optionEl.textContent = opt.label;
                this.optionValues.push(opt.value);
            } else {
                optionEl.value = String(opt);
                optionEl.textContent = String(opt);
                this.optionValues.push(opt);
            }

            this.select.appendChild(optionEl);
        }

        this.updateDisplay();
        return this;
    }
}
