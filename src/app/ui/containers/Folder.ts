/**
 * Folder - Collapsible group container
 *
 * Features:
 * - Click header to expand/collapse
 * - Animated icon
 * - Nestable
 */
import { Container } from '../core/Container.js';
import { UIComponent } from '../core/UIComponent.js';

export interface FolderOptions {
    /** Start in open state (default: true) */
    startOpen?: boolean;
}

export class Folder extends Container {
    private header: HTMLElement;
    private icon: HTMLElement;
    private content: HTMLElement;
    private _isOpen: boolean;

    constructor(title: string, options: FolderOptions = {}) {
        super('div', 'ui-folder');

        this._isOpen = options.startOpen ?? true;

        // Header (clickable)
        this.header = document.createElement('div');
        this.header.className = 'ui-folder-header';

        this.icon = document.createElement('span');
        this.icon.className = 'ui-folder-icon';
        this.icon.textContent = '▶';

        const titleEl = document.createElement('span');
        titleEl.className = 'ui-folder-title';
        titleEl.textContent = title;

        this.header.appendChild(this.icon);
        this.header.appendChild(titleEl);

        this.header.addEventListener('click', () => this.toggle());

        // Content area
        this.content = document.createElement('div');
        this.content.className = 'ui-folder-content';

        this.domElement.appendChild(this.header);
        this.domElement.appendChild(this.content);

        // Apply initial state
        this.updateDisplay();
    }

    protected attachChild(child: UIComponent): void {
        child.mount(this.content);
    }

    /**
     * Check if folder is open
     */
    get isOpen(): boolean {
        return this._isOpen;
    }

    /**
     * Toggle open/closed state
     */
    toggle(): this {
        this._isOpen = !this._isOpen;
        this.updateDisplay();
        return this;
    }

    /**
     * Open the folder
     */
    open(): this {
        if (!this._isOpen) {
            this._isOpen = true;
            this.updateDisplay();
        }
        return this;
    }

    /**
     * Close the folder
     */
    close(): this {
        if (this._isOpen) {
            this._isOpen = false;
            this.updateDisplay();
        }
        return this;
    }

    private updateDisplay(): void {
        this.domElement.classList.toggle('ui-folder--open', this._isOpen);
        this.content.style.display = this._isOpen ? '' : 'none';
    }
}
