/**
 * Modal - Centered dialog with backdrop
 *
 * Features:
 * - Centered content
 * - Click backdrop to close (optional)
 * - Blocks interaction with content behind
 */
import { Container } from '../core/Container.js';
import { UIComponent } from '../core/UIComponent.js';

export interface ModalOptions {
    /** Modal width in pixels */
    width?: number;
    /** Maximum height in pixels */
    maxHeight?: number;
    /** Close when clicking backdrop (default: true) */
    closeOnBackdrop?: boolean;
    /** Show close button (default: true) */
    closable?: boolean;
    /** Called when modal is closed */
    onClose?: () => void;
}

export class Modal extends Container {
    private backdrop: HTMLElement;
    private dialog: HTMLElement;
    private titleBar: HTMLElement;
    private titleText: HTMLElement;
    private content: HTMLElement;
    private onCloseCallback?: () => void;

    constructor(title: string, options: ModalOptions = {}) {
        super('div', 'ui-modal');

        const width = options.width ?? 500;
        const maxHeight = options.maxHeight ?? 600;

        this.onCloseCallback = options.onClose;

        // Backdrop
        this.backdrop = document.createElement('div');
        this.backdrop.className = 'ui-modal-backdrop';

        if (options.closeOnBackdrop !== false) {
            this.backdrop.addEventListener('click', () => this.close());
        }

        // Dialog container
        this.dialog = document.createElement('div');
        this.dialog.className = 'ui-modal-dialog';
        this.dialog.style.width = `${width}px`;
        this.dialog.style.maxHeight = `${maxHeight}px`;

        // Prevent backdrop click when clicking dialog
        this.dialog.addEventListener('click', (e) => e.stopPropagation());

        // Title bar
        this.titleBar = document.createElement('div');
        this.titleBar.className = 'ui-modal-titlebar';

        this.titleText = document.createElement('span');
        this.titleText.className = 'ui-modal-title';
        this.titleText.textContent = title;
        this.titleBar.appendChild(this.titleText);

        // Close button
        if (options.closable !== false) {
            const closeBtn = document.createElement('button');
            closeBtn.className = 'ui-modal-close';
            closeBtn.textContent = '×';
            closeBtn.addEventListener('click', () => this.close());
            this.titleBar.appendChild(closeBtn);
        }

        // Content area
        this.content = document.createElement('div');
        this.content.className = 'ui-modal-content';

        this.dialog.appendChild(this.titleBar);
        this.dialog.appendChild(this.content);

        this.domElement.appendChild(this.backdrop);
        this.domElement.appendChild(this.dialog);
    }

    protected attachChild(child: UIComponent): void {
        child.mount(this.content);
    }

    /**
     * Show the modal
     */
    show(): this {
        if (!this.domElement.parentElement) {
            document.body.appendChild(this.domElement);
        }
        this.domElement.style.display = '';
        // Prevent body scroll while modal is open
        document.body.style.overflow = 'hidden';
        return this;
    }

    /**
     * Hide the modal
     */
    hide(): this {
        this.domElement.style.display = 'none';
        document.body.style.overflow = '';
        return this;
    }

    /**
     * Close and dispose the modal
     */
    close(): this {
        document.body.style.overflow = '';
        this.onCloseCallback?.();
        this.dispose();
        return this;
    }

    /**
     * Set modal title
     */
    setTitle(title: string): this {
        this.titleText.textContent = title;
        return this;
    }

    /**
     * Add a footer section (useful for buttons)
     */
    addFooter(): HTMLElement {
        let footer = this.dialog.querySelector('.ui-modal-footer') as HTMLElement;
        if (!footer) {
            footer = document.createElement('div');
            footer.className = 'ui-modal-footer';
            this.dialog.appendChild(footer);
        }
        return footer;
    }
}
