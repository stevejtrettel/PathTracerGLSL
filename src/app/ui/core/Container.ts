/**
 * Container - Base class for components that hold children
 *
 * Provides:
 * - Child management (add, remove, clear)
 * - Automatic disposal of children
 *
 * Subclasses implement `attachChild` to control where children are placed.
 */
import { UIComponent } from './UIComponent.js';

export abstract class Container extends UIComponent {
    protected children: UIComponent[] = [];

    /**
     * Add a child component
     */
    add(child: UIComponent): this {
        this.children.push(child);
        this.attachChild(child);
        return this;
    }

    /**
     * Add multiple children
     */
    addAll(...children: UIComponent[]): this {
        for (const child of children) {
            this.add(child);
        }
        return this;
    }

    /**
     * Remove a specific child
     */
    remove(child: UIComponent): this {
        const idx = this.children.indexOf(child);
        if (idx >= 0) {
            this.children.splice(idx, 1);
            child.unmount();
        }
        return this;
    }

    /**
     * Remove and dispose all children
     */
    clear(): this {
        for (const child of this.children) {
            child.dispose();
        }
        this.children = [];
        return this;
    }

    /**
     * Get number of children
     */
    get childCount(): number {
        return this.children.length;
    }

    /**
     * Subclasses implement this to mount child into the correct location
     */
    protected abstract attachChild(child: UIComponent): void;

    /**
     * Dispose container and all children
     */
    dispose(): void {
        if (this._disposed) return;
        this.clear();
        super.dispose();
    }
}
