/**
 * Button - Action trigger
 *
 * Unlike other inputs, Button doesn't have a value.
 * It simply triggers an action when clicked.
 */
import { UIComponent } from '../core/UIComponent.js';

export interface ButtonOptions {
    /** Button style variant */
    variant?: 'default' | 'primary' | 'danger';
    /** Disabled state */
    disabled?: boolean;
}

export class Button extends UIComponent {
    private _onClick: () => void;
    private button: HTMLButtonElement;

    constructor(label: string, onClick: () => void, options: ButtonOptions = {}) {
        super('div', 'ui-button-container');

        this._onClick = onClick;

        this.button = document.createElement('button');
        this.button.className = 'ui-button';
        this.button.textContent = label;

        if (options.variant) {
            this.button.classList.add(`ui-button--${options.variant}`);
        }

        if (options.disabled) {
            this.button.disabled = true;
        }

        this.button.addEventListener('click', (e) => {
            e.preventDefault();
            if (!this.button.disabled) {
                this._onClick();
            }
        });

        this.domElement.appendChild(this.button);
    }

    /**
     * Update button label
     */
    setLabel(label: string): this {
        this.button.textContent = label;
        return this;
    }

    /**
     * Enable the button
     */
    enable(): this {
        this.button.disabled = false;
        return this;
    }

    /**
     * Disable the button
     */
    disable(): this {
        this.button.disabled = true;
        return this;
    }

    /**
     * Check if disabled
     */
    get isDisabled(): boolean {
        return this.button.disabled;
    }

    /**
     * Update the click handler
     */
    setOnClick(handler: () => void): this {
        this._onClick = handler;
        return this;
    }
}
