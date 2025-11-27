/**
 * ParameterPanelExtension
 *
 * Auto-generated parameter panel using the UI component system.
 *
 * Features:
 * - Auto-generates widgets from renderer parameter metadata
 * - Slide-in/out animation with Tab key toggle
 * - Grouped by module type, sorted by MODULE_ORDER
 * - Throttled updates for smooth performance
 */
import type { Extension, ParameterMetadata } from '../types.js';
import type { App } from '../App.js';
import type { EventBus } from '../EventBus.js';
import { MODULE_ORDER } from '../../engine/types.js';

// Import UI components
import { Panel, Folder } from '../ui/index.js';
import { WidgetFactory } from '../ui/WidgetFactory.js';
import type { UIComponent } from '../ui/index.js';

// Extension-specific styles for slide animation
const PANEL_STYLES = `
.param-panel-wrapper {
    position: fixed;
    top: 0;
    right: 0;
    height: 100vh;
    width: 340px;
    transform: translateX(100%);
    transition: transform 0.3s cubic-bezier(0.4, 0.0, 0.2, 1);
    z-index: 9999;
}

.param-panel-wrapper.open {
    transform: translateX(0);
}

.param-panel-wrapper .ui-panel {
    height: 100%;
    border-radius: 0;
    border-right: none;
    border-top: none;
    border-bottom: none;
}

.param-panel-wrapper .ui-panel-content {
    max-height: calc(100vh - 80px);
}

.param-chevron {
    position: fixed;
    top: 20px;
    right: 20px;
    width: 32px;
    height: 32px;
    background: rgba(60, 60, 60, 0.92);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    z-index: 9998;
    transition: all 0.2s ease;
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.3);
}

.param-chevron:hover {
    background: rgba(75, 75, 75, 0.95);
    border-color: rgba(255, 255, 255, 0.25);
    transform: scale(1.05);
}

.param-chevron::after {
    content: '‹';
    color: rgba(255, 255, 255, 0.8);
    font-size: 20px;
    font-weight: 300;
    transition: transform 0.2s ease;
}

.param-chevron.open::after {
    transform: rotate(180deg);
}

.param-empty {
    padding: 40px 20px;
    text-align: center;
    color: rgba(255, 255, 255, 0.5);
    font-size: 13px;
}
`;

export class ParameterPanelExtension implements Extension {
    name = 'parameter-panel';
    version = '2.0.0';
    description = 'Auto-generated parameter controls panel';

    private app!: App;
    private wrapper!: HTMLElement;
    private panel!: Panel;
    private chevron!: HTMLElement;
    private folders: Map<string, Folder> = new Map();
    private widgets: UIComponent[] = [];
    private isOpen = false;

    // Update throttling
    private updateQueue = new Map<string, unknown>();
    private throttleTimer: number | null = null;
    private readonly THROTTLE_MS = 16; // ~60fps

    // Keyboard handler reference for cleanup
    private keydownHandler: ((e: KeyboardEvent) => void) | null = null;

    install(app: App, _bus: EventBus): void {
        this.app = app;

        this.injectStyles();
        this.createChevron();
        this.createPanel();
        this.populatePanel();
        this.attachKeyboardShortcut();

        console.log('Parameter Panel installed (Tab to toggle)');
    }

    uninstall(): void {
        // Remove keyboard listener
        if (this.keydownHandler) {
            window.removeEventListener('keydown', this.keydownHandler, true);
        }

        // Dispose all widgets
        for (const widget of this.widgets) {
            widget.dispose();
        }
        this.widgets = [];

        // Dispose folders
        for (const folder of this.folders.values()) {
            folder.dispose();
        }
        this.folders.clear();

        // Remove DOM elements
        this.panel?.dispose();
        this.wrapper?.remove();
        this.chevron?.remove();

        // Remove styles
        document.getElementById('param-panel-styles')?.remove();

        // Clear timer
        if (this.throttleTimer !== null) {
            clearTimeout(this.throttleTimer);
        }
    }

    // ============================================================================
    // Setup
    // ============================================================================

    private injectStyles(): void {
        if (document.getElementById('param-panel-styles')) return;

        const style = document.createElement('style');
        style.id = 'param-panel-styles';
        style.textContent = PANEL_STYLES;
        document.head.appendChild(style);
    }

    private createChevron(): void {
        this.chevron = document.createElement('div');
        this.chevron.className = 'param-chevron';
        this.chevron.title = 'Toggle Parameters (Tab)';
        this.chevron.onclick = () => this.toggle();
        document.body.appendChild(this.chevron);
    }

    private createPanel(): void {
        // Wrapper for slide animation
        this.wrapper = document.createElement('div');
        this.wrapper.className = 'param-panel-wrapper';

        // Create panel using UI component
        this.panel = new Panel({ title: 'Parameters' });
        this.panel.setSubtitle('Press Tab to toggle');
        this.panel.mount(this.wrapper);

        document.body.appendChild(this.wrapper);
    }

    private populatePanel(): void {
        const metadata = this.app.getParameterMetadata();

        // Show empty state if no parameters
        if (metadata.size === 0) {
            const empty = document.createElement('div');
            empty.className = 'param-empty';
            empty.textContent = 'No parameters available for current renderer';
            this.panel.domElement.querySelector('.ui-panel-content')?.appendChild(empty);
            return;
        }

        // Group parameters by group name
        const groups = this.groupParameters(metadata);

        // Sort groups by MODULE_ORDER
        const sortedGroups = this.sortGroups(groups);

        // Create folders for each group
        for (const [groupName, params] of sortedGroups) {
            const folder = new Folder(`${groupName} (${params.length})`);

            for (const { path, meta } of params) {
                const widget = this.createWidgetForParam(path, meta);
                folder.add(widget);
                this.widgets.push(widget);
            }

            this.panel.add(folder);
            this.folders.set(groupName, folder);
        }
    }

    // ============================================================================
    // Parameter Grouping
    // ============================================================================

    private groupParameters(
        metadata: Map<string, ParameterMetadata>
    ): Map<string, Array<{ path: string; meta: ParameterMetadata }>> {
        const groups = new Map<string, Array<{ path: string; meta: ParameterMetadata }>>();

        for (const [path, meta] of metadata) {
            const group = meta.group || 'Other';
            if (!groups.has(group)) {
                groups.set(group, []);
            }
            groups.get(group)!.push({ path, meta });
        }

        return groups;
    }

    private sortGroups(
        groups: Map<string, Array<{ path: string; meta: ParameterMetadata }>>
    ): Map<string, Array<{ path: string; meta: ParameterMetadata }>> {
        // Create ordering from MODULE_ORDER
        const order = new Map<string, number>();
        MODULE_ORDER.forEach((kind, index) => {
            const groupName = kind.charAt(0).toUpperCase() + kind.slice(1);
            order.set(groupName, index);
        });

        // Sort groups
        const sorted = Array.from(groups.entries()).sort((a, b) => {
            const orderA = order.get(a[0]) ?? 999;
            const orderB = order.get(b[0]) ?? 999;
            return orderA - orderB;
        });

        return new Map(sorted);
    }

    // ============================================================================
    // Widget Creation
    // ============================================================================

    private createWidgetForParam(path: string, meta: ParameterMetadata): UIComponent {
        const currentValue = this.app.getParameter(path) ?? meta.default;

        return WidgetFactory.create(meta, {
            value: currentValue,
            onChange: (value) => this.queueUpdate(path, value)
        });
    }

    // ============================================================================
    // Update Management
    // ============================================================================

    private queueUpdate(path: string, value: unknown): void {
        this.updateQueue.set(path, value);

        if (this.throttleTimer !== null) {
            return; // Already scheduled
        }

        this.throttleTimer = window.setTimeout(() => {
            this.flushUpdates();
            this.throttleTimer = null;
        }, this.THROTTLE_MS);
    }

    private flushUpdates(): void {
        for (const [path, value] of this.updateQueue) {
            this.app.setParameter(path, value);
        }
        this.updateQueue.clear();
    }

    // ============================================================================
    // Toggle
    // ============================================================================

    private toggle(): void {
        this.isOpen = !this.isOpen;
        this.wrapper.classList.toggle('open', this.isOpen);
        this.chevron.classList.toggle('open', this.isOpen);
    }

    /**
     * Programmatically open the panel
     */
    open(): void {
        if (!this.isOpen) {
            this.toggle();
        }
    }

    /**
     * Programmatically close the panel
     */
    close(): void {
        if (this.isOpen) {
            this.toggle();
        }
    }

    private attachKeyboardShortcut(): void {
        this.keydownHandler = (e: KeyboardEvent) => {
            if (e.key === 'Tab' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
                // Allow Tab in form fields within the param panel itself
                const target = e.target as HTMLElement;
                const inParamPanel = target.closest('.param-panel-wrapper');

                if (!inParamPanel) {
                    e.preventDefault();
                    e.stopPropagation();
                    this.toggle();
                }
            }
        };

        // Use capture phase to intercept Tab before browser's focus cycling
        window.addEventListener('keydown', this.keydownHandler, { capture: true });
    }
}
