/**
 * Panel - Primary container for UI controls
 *
 * Features:
 * - Optional title header
 * - Scrollable content area
 * - Can be positioned as overlay or in layout region
 */
import { Container } from '../core/Container.js';
import { UIComponent } from '../core/UIComponent.js';

export interface PanelOptions {
    /** Panel title */
    title?: string;
    /** Additional CSS class */
    className?: string;
}

export class Panel extends Container {
    private header?: HTMLElement;
    private content: HTMLElement;

    constructor(options: PanelOptions = {}) {
        super('div', 'ui-panel');

        if (options.className) {
            this.domElement.classList.add(options.className);
        }

        // Header with title
        if (options.title) {
            this.header = document.createElement('div');
            this.header.className = 'ui-panel-header';

            const title = document.createElement('h2');
            title.className = 'ui-panel-title';
            title.textContent = options.title;
            this.header.appendChild(title);

            this.domElement.appendChild(this.header);
        }

        // Scrollable content area
        this.content = document.createElement('div');
        this.content.className = 'ui-panel-content';
        this.domElement.appendChild(this.content);
    }

    protected attachChild(child: UIComponent): void {
        child.mount(this.content);
    }

    /**
     * Set the panel title
     */
    setTitle(title: string): this {
        if (this.header) {
            const titleEl = this.header.querySelector('.ui-panel-title');
            if (titleEl) {
                titleEl.textContent = title;
            }
        }
        return this;
    }

    /**
     * Add a subtitle or description to the header
     */
    setSubtitle(subtitle: string): this {
        if (this.header) {
            let subtitleEl = this.header.querySelector('.ui-panel-subtitle') as HTMLElement;
            if (!subtitleEl) {
                subtitleEl = document.createElement('p');
                subtitleEl.className = 'ui-panel-subtitle';
                this.header.appendChild(subtitleEl);
            }
            subtitleEl.textContent = subtitle;
        }
        return this;
    }
}
