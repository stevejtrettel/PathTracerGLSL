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

// Windows share a compact z-index band starting here — above the canvas/panels
// but below --ui-z-modal (1050) and the error overlay (1100), so a floating
// window can never cover a modal or a fatal compile-error overlay. raise()
// keeps the band compact and bounded (no unbounded ++counter).
const WINDOW_Z_BASE = 100;
const windowStack: Window[] = [];

export class Window extends Container {
    private titleBar: HTMLElement;
    private titleText: HTMLElement;
    private content: HTMLElement;
    private isDragging = false;
    private dragOffset = { x: 0, y: 0 };
    private onCloseCallback?: () => void;

    // Bound handlers for cleanup
    private boundPointerMove: (e: PointerEvent) => void;
    private boundPointerUp: (e: PointerEvent) => void;

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
        this.domElement.addEventListener('pointerdown', () => this.bringToFront());

        // Bind handlers
        this.boundPointerMove = this.onPointerMove.bind(this);
        this.boundPointerUp = this.onPointerUp.bind(this);

        // Register in the window stack and assign an initial z-index.
        this.raise();
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
     * Bring window to front (within the window band, still below modals/overlay)
     */
    bringToFront(): this {
        this.raise();
        return this;
    }

    /**
     * Move this window to the top of the stack and re-assign compact z-indices
     * so the band stays bounded within [WINDOW_Z_BASE, WINDOW_Z_BASE + count).
     */
    private raise(): void {
        const existing = windowStack.indexOf(this);
        if (existing !== -1) windowStack.splice(existing, 1);
        windowStack.push(this);
        windowStack.forEach((win, i) => {
            win.domElement.style.zIndex = String(WINDOW_Z_BASE + i);
        });
    }

    /**
     * Set window title
     */
    setTitle(title: string): this {
        this.titleText.textContent = title;
        return this;
    }

    private setupDragging(): void {
        this.titleBar.addEventListener('pointerdown', (e) => {
            if ((e.target as HTMLElement).classList.contains('ui-window-close')) {
                return;
            }
            this.isDragging = true;
            this.dragOffset.x = e.clientX - this.domElement.offsetLeft;
            this.dragOffset.y = e.clientY - this.domElement.offsetTop;
            // Capture the pointer so move/up keep firing even when the cursor
            // leaves the titlebar or the browser window — no more stuck dragging.
            this.titleBar.setPointerCapture(e.pointerId);
            e.preventDefault();
        });
        this.titleBar.addEventListener('pointermove', this.boundPointerMove);
        this.titleBar.addEventListener('pointerup', this.boundPointerUp);
        this.titleBar.addEventListener('lostpointercapture', this.boundPointerUp);
    }

    private onPointerMove(e: PointerEvent): void {
        if (!this.isDragging) return;

        // Clamp so the window stays within the viewport (titlebar always reachable).
        const maxX = Math.max(0, window.innerWidth - this.domElement.offsetWidth);
        const maxY = Math.max(0, window.innerHeight - this.domElement.offsetHeight);
        const x = Math.min(Math.max(e.clientX - this.dragOffset.x, 0), maxX);
        const y = Math.min(Math.max(e.clientY - this.dragOffset.y, 0), maxY);

        this.domElement.style.left = `${x}px`;
        this.domElement.style.top = `${y}px`;
    }

    private onPointerUp(e: PointerEvent): void {
        if (!this.isDragging) return;
        this.isDragging = false;
        if (this.titleBar.hasPointerCapture(e.pointerId)) {
            this.titleBar.releasePointerCapture(e.pointerId);
        }
    }

    dispose(): void {
        const i = windowStack.indexOf(this);
        if (i !== -1) windowStack.splice(i, 1);
        super.dispose();
    }
}
