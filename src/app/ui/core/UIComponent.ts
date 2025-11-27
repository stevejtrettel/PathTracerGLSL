/**
 * UIComponent - Base class for all UI elements
 *
 * Provides:
 * - DOM element creation and management
 * - Mount/unmount lifecycle
 * - Dispose cleanup
 *
 * This is framework-agnostic - no dependency on App, EventBus, etc.
 */
export abstract class UIComponent {
    readonly domElement: HTMLElement;
    protected _disposed = false;

    constructor(tag: keyof HTMLElementTagNameMap = 'div', className?: string) {
        this.domElement = document.createElement(tag);
        if (className) {
            this.domElement.className = className;
        }
    }

    /**
     * Mount this component into a parent element
     */
    mount(parent: HTMLElement | UIComponent): this {
        const target = parent instanceof UIComponent ? parent.domElement : parent;
        target.appendChild(this.domElement);
        return this;
    }

    /**
     * Remove this component from its parent
     */
    unmount(): this {
        this.domElement.remove();
        return this;
    }

    /**
     * Show the component
     */
    show(): this {
        this.domElement.style.display = '';
        return this;
    }

    /**
     * Hide the component
     */
    hide(): this {
        this.domElement.style.display = 'none';
        return this;
    }

    /**
     * Check if disposed
     */
    get isDisposed(): boolean {
        return this._disposed;
    }

    /**
     * Clean up and remove from DOM
     */
    dispose(): void {
        if (this._disposed) return;
        this.unmount();
        this._disposed = true;
    }
}
