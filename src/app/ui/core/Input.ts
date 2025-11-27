/**
 * Input<T> - Base class for value-capturing components
 *
 * Provides:
 * - Value get/set with change notification
 * - Label support
 * - Separation between programmatic updates (setValue) and user input (emitChange)
 *
 * The key distinction:
 * - setValue(): Updates display without triggering onChange (for external sync)
 * - emitChange(): Called when user interacts, triggers onChange callback
 */
import { UIComponent } from './UIComponent.js';

export interface InputOptions<T> {
    /** Label text displayed with the input */
    label?: string;
    /** Called when user changes the value */
    onChange?: (value: T) => void;
}

export abstract class Input<T> extends UIComponent {
    protected _value: T;
    protected _onChange?: (value: T) => void;
    protected _label?: string;

    constructor(
        initialValue: T,
        options: InputOptions<T> = {},
        tag: keyof HTMLElementTagNameMap = 'div',
        className?: string
    ) {
        super(tag, className);
        this._value = initialValue;
        this._onChange = options.onChange;
        this._label = options.label;
    }

    /**
     * Get current value
     */
    get value(): T {
        return this._value;
    }

    /**
     * Get label text
     */
    get label(): string | undefined {
        return this._label;
    }

    /**
     * Update value and display WITHOUT triggering onChange
     * Use this for external synchronization (e.g., two-way binding)
     */
    setValue(value: T): this {
        if (this.valuesEqual(this._value, value)) return this;
        this._value = value;
        this.updateDisplay();
        return this;
    }

    /**
     * Called by subclasses when user changes the value
     * This triggers the onChange callback
     */
    protected emitChange(value: T): void {
        this._value = value;
        this._onChange?.(value);
    }

    /**
     * Update the onChange callback
     */
    setOnChange(handler: ((value: T) => void) | undefined): this {
        this._onChange = handler;
        return this;
    }

    /**
     * Compare two values for equality (override for complex types)
     */
    protected valuesEqual(a: T, b: T): boolean {
        return a === b;
    }

    /**
     * Update the visual display to match current value
     * Subclasses must implement this
     */
    protected abstract updateDisplay(): void;
}
