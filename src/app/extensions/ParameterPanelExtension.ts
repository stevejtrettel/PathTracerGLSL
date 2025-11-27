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
 * - Integrates with AppLayout when available (region-right)
 */
import type { Extension, ParameterMetadata } from '../types.js';
import type { App } from '../App.js';
import type { EventBus } from '../EventBus.js';
import { MODULE_ORDER } from '../../engine/types.js';

// Import UI components
import { Panel, Folder } from '../ui/index.js';
import { WidgetFactory } from '../ui/WidgetFactory.js';
import type { UIComponent } from '../ui/index.js';

// Styles for the parameter panel system
// Supports both layout-integrated and standalone modes
const PANEL_STYLES = `
/* ============================================
   Toggle Chevron (always visible)
   ============================================ */
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

/* ============================================
   Panel styling (layout-integrated mode)
   ============================================ */
#region-right .ui-panel.param-panel {
    height: 100%;
    border-radius: 0;
    border-right: none;
    border-top: none;
    border-bottom: none;
}

#region-right .ui-panel.param-panel .ui-panel-content {
    max-height: calc(100vh - 80px);
}

/* Region slide animation (layout mode) */
#region-right.param-panel-region {
    transition: transform 0.3s cubic-bezier(0.4, 0.0, 0.2, 1);
}

#region-right.param-panel-region:not(.open) {
    transform: translateX(100%);
}

#region-right.param-panel-region.open {
    transform: translateX(0);
}

/* ============================================
   Standalone mode (no layout)
   ============================================ */
.param-panel-standalone {
    position: fixed;
    top: 0;
    right: 0;
    height: 100vh;
    width: 340px;
    transform: translateX(100%);
    transition: transform 0.3s cubic-bezier(0.4, 0.0, 0.2, 1);
    z-index: 9999;
}

.param-panel-standalone.open {
    transform: translateX(0);
}

.param-panel-standalone .ui-panel {
    height: 100%;
    border-radius: 0;
    border-right: none;
    border-top: none;
    border-bottom: none;
}

.param-panel-standalone .ui-panel-content {
    max-height: calc(100vh - 80px);
}

/* ============================================
   Empty state
   ============================================ */
.param-empty {
    padding: 40px 20px;
    text-align: center;
    color: rgba(255, 255, 255, 0.5);
    font-size: 13px;
}
`;

export class ParameterPanelExtension implements Extension {
    name = 'parameter-panel';
    version = '3.0.0';
    description = 'Auto-generated parameter controls panel with layout integration';

    private app!: App;
    private panel!: Panel;
    private chevron!: HTMLElement;
    private folders: Map<string, Folder> = new Map();
    private widgets: UIComponent[] = [];
    private isOpen = false;

    // Mode tracking
    private useLayout = false;
    private region: HTMLElement | null = null;
    private standaloneWrapper: HTMLElement | null = null;

    // Update throttling
    private updateQueue = new Map<string, unknown>();
    private throttleTimer: number | null = null;
    private readonly THROTTLE_MS = 16; // ~60fps

    // Keyboard handler reference for cleanup
    private keydownHandler: ((e: KeyboardEvent) => void) | null = null;

    install(app: App, _bus: EventBus): void {
        this.app = app;

        // Determine if layout is available
        this.useLayout = app.hasLayout();

        this.injectStyles();
        this.createChevron();
        this.createPanel();
        this.populatePanel();
        this.attachKeyboardShortcut();

        const modeStr = this.useLayout ? 'layout-integrated' : 'standalone';
        console.log(`Parameter Panel installed (Tab to toggle) [${modeStr}]`);
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
        this.chevron?.remove();

        // Cleanup based on mode
        if (this.useLayout && this.region) {
            this.region.classList.remove('param-panel-region', 'open');
        }
        this.standaloneWrapper?.remove();

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
        // Create panel using UI component
        this.panel = new Panel({ title: 'Parameters', className: 'param-panel' });
        this.panel.setSubtitle('Press Tab to toggle');

        if (this.useLayout) {
            // Layout-integrated mode: mount to region-right
            this.region = this.app.getRegion('region-right');
            this.region.classList.add('param-panel-region');
            this.panel.mount(this.region);
        } else {
            // Standalone mode: create wrapper and append to body
            this.standaloneWrapper = document.createElement('div');
            this.standaloneWrapper.className = 'param-panel-standalone';
            this.panel.mount(this.standaloneWrapper);
            document.body.appendChild(this.standaloneWrapper);
        }
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

        // Update chevron state
        this.chevron.classList.toggle('open', this.isOpen);

        // Toggle panel visibility based on mode
        if (this.useLayout && this.region) {
            this.region.classList.toggle('open', this.isOpen);
        } else if (this.standaloneWrapper) {
            this.standaloneWrapper.classList.toggle('open', this.isOpen);
        }
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

    /**
     * Check if the panel is currently open
     */
    isVisible(): boolean {
        return this.isOpen;
    }

    private attachKeyboardShortcut(): void {
        this.keydownHandler = (e: KeyboardEvent) => {
            if (e.key === 'Tab' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
                // Allow Tab in form fields within the panel itself
                const target = e.target as HTMLElement;
                const inPanel = target.closest('.param-panel') ||
                               target.closest('.param-panel-standalone') ||
                               target.closest('#region-right');

                if (!inPanel) {
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
