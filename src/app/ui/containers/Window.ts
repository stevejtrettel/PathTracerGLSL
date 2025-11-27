/**
 * Window - Floating, draggable window
 *
 * Features:
 * - Draggable title bar
 * - Close button
 * - Bring to front on click
 * - Configurable size and position
 */
import { Container } from '../core/Container.js';
import { UIComponent } from '../core/UIComponent.js';

export interface WindowOptions {
    /** Initial width in pixels */
    width?: number;
    /** Initial height in pixels */
    height?: number;
    /** Initial X position (default: centered) */
    x?: number;
    /** Initial Y position (default: centered) */
    y?: number;
    /** Allow dragging (default: true) */
    draggable?: boolean;
    /** Show close button (default: true) */
    closable?: boolean;
    /** Called when window is closed */
    onClose?: () => void;
}

let windowZIndex = 10000;

export class Window extends Container {
    private titleBar: HTMLElement;
    private titleText: HTMLElement;
    private content: HTMLElement;
    private isDragging = false;
    private dragOffset = { x: 0, y: 0 };
    private onCloseCallback?: () => void;

    // Bound handlers for cleanup
    private boundMouseMove: (e: MouseEvent) => void;
    private boundMouseUp: () => void;

    constructor(title: string, options: WindowOptions = {}) {
        super('div', 'ui-window');

        const width = options.width ?? 400;
        const height = options.height ?? 300;
        const x = options.x ?? (window.innerWidth - width) / 2;
        const y = options.y ?? (window.innerHeight - height) / 2;

        this.onCloseCallback = options.onClose;

        // Position and size
        this.domElement.style.left = `${x}px`;
        this.domElement.style.top = `${y}px`;
        this.domElement.style.width = `${width}px`;
        this.domElement.style.minHeight = `${height}px`;
        this.domElement.style.zIndex = String(++windowZIndex);

        // Title bar
        this.titleBar = document.createElement('div');
        this.titleBar.className = 'ui-window-titlebar';

        this.titleText = document.createElement('span');
        this.titleText.className = 'ui-window-title';
        this.titleText.textContent = title;
        this.titleBar.appendChild(this.titleText);

        // Close button
        if (options.closable !== false) {
            const closeBtn = document.createElement('button');
            closeBtn.className = 'ui-window-close';
            closeBtn.textContent = '×';
            closeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.close();
            });
            this.titleBar.appendChild(closeBtn);
        }

        // Content area
        this.content = document.createElement('div');
        this.content.className = 'ui-window-content';

        this.domElement.appendChild(this.titleBar);
        this.domElement.appendChild(this.content);

        // Dragging
        if (options.draggable !== false) {
            this.setupDragging();
        }

        // Bring to front on click
        this.domElement.addEventListener('mousedown', () => this.bringToFront());

        // Bind handlers
        this.boundMouseMove = this.onMouseMove.bind(this);
        this.boundMouseUp = this.onMouseUp.bind(this);
    }

    protected attachChild(child: UIComponent): void {
        child.mount(this.content);
    }

    /**
     * Show the window
     */
    show(): this {
        if (!this.domElement.parentElement) {
            document.body.appendChild(this.domElement);
        }
        this.domElement.style.display = '';
        this.bringToFront();
        return this;
    }

    /**
     * Hide the window (doesn't remove from DOM)
     */
    hide(): this {
        this.domElement.style.display = 'none';
        return this;
    }

    /**
     * Close the window (removes from DOM)
     */
    close(): this {
        this.onCloseCallback?.();
        this.dispose();
        return this;
    }

    /**
     * Bring window to front
     */
    bringToFront(): this {
        this.domElement.style.zIndex = String(++windowZIndex);
        return this;
    }

    /**
     * Set window title
     */
    setTitle(title: string): this {
        this.titleText.textContent = title;
        return this;
    }

    private setupDragging(): void {
        this.titleBar.addEventListener('mousedown', (e) => {
            if ((e.target as HTMLElement).classList.contains('ui-window-close')) {
                return;
            }
            this.isDragging = true;
            this.dragOffset.x = e.clientX - this.domElement.offsetLeft;
            this.dragOffset.y = e.clientY - this.domElement.offsetTop;
            e.preventDefault();

            document.addEventListener('mousemove', this.boundMouseMove);
            document.addEventListener('mouseup', this.boundMouseUp);
        });
    }

    private onMouseMove(e: MouseEvent): void {
        if (!this.isDragging) return;

        const x = e.clientX - this.dragOffset.x;
        const y = e.clientY - this.dragOffset.y;

        this.domElement.style.left = `${x}px`;
        this.domElement.style.top = `${y}px`;
    }

    private onMouseUp(): void {
        this.isDragging = false;
        document.removeEventListener('mousemove', this.boundMouseMove);
        document.removeEventListener('mouseup', this.boundMouseUp);
    }

    dispose(): void {
        document.removeEventListener('mousemove', this.boundMouseMove);
        document.removeEventListener('mouseup', this.boundMouseUp);
        super.dispose();
    }
}
