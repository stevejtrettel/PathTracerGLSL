/**
 * ParameterPanelExtension
 *
 * Auto-generated parameter panel using the UI component system.
 *
 * Features:
 * - Auto-generates widgets from renderer parameter metadata
 * - Slide-in/out animation with Tab key toggle
 * - Grouped by module type, sorted by rendering pipeline order
 * - Throttled updates for smooth performance
 * - Disables during production mode (params are locked anyway)
 *
 * Mounts to region-right if layout available, otherwise creates standalone wrapper.
 */
import { UIExtension } from './UIExtension.js';
import type { RegionName } from '../layout/index.js';
import type { ParameterMetadata } from '../types.js';
import { Panel, Folder } from '../ui/index.js';
import { WidgetFactory } from '../ui/WidgetFactory.js';
import type { UIComponent } from '../ui/index.js';
import { AppEvents } from '../events.js';

export class ParameterPanelExtension extends UIExtension {
    name = 'parameter-panel';
    version = '5.0.0';
    description = 'Auto-generated parameter controls panel';

    protected readonly region: RegionName = 'region-right';

    private panel!: Panel;
    private folders: Map<string, Folder> = new Map();
    private widgets: UIComponent[] = [];
    private isOpen = false;

    // The container that receives 'open' class (region or standalone wrapper)
    private toggleContainer: HTMLElement | null = null;

    // Update throttling
    private updateQueue = new Map<string, unknown>();
    private throttleTimer: number | null = null;
    private readonly THROTTLE_MS = 16;

    // Keyboard handler
    private keydownHandler: ((e: KeyboardEvent) => void) | null = null;

    // ============================================================================
    // UIExtension Implementation
    // ============================================================================

    protected createRoot(): HTMLElement {
        this.panel = new Panel({ title: 'Parameters', className: 'param-panel' });
        this.panel.setSubtitle('Press Tab to toggle');
        return this.panel.domElement;
    }

    protected mount(): void {
        if (this.useLayout) {
            // Layout mode: mount to region, add special class to region for animation
            const region = this.app.getRegion(this.region);
            region.classList.add('param-panel-region');
            region.appendChild(this.root);
            this.toggleContainer = region;
        } else {
            // Standalone mode: create wrapper
            const wrapper = document.createElement('div');
            wrapper.className = 'param-panel-standalone';
            wrapper.appendChild(this.root);
            document.body.appendChild(wrapper);
            this.toggleContainer = wrapper;
        }
    }

    protected setup(): void {
        this.populatePanel();
        this.attachKeyboardShortcut();

        // Disable during production mode
        this.on(AppEvents.RENDER_STARTED, this.onRenderStarted);
        this.on(AppEvents.RENDER_COMPLETE, this.onRenderEnded);
        this.on(AppEvents.RENDER_STOPPED, this.onRenderEnded);

        console.log(`ParameterPanel installed (Tab to toggle) [${this.useLayout ? 'layout' : 'standalone'}]`);
    }

    protected cleanup(): void {
        // Remove keyboard listener
        if (this.keydownHandler) {
            window.removeEventListener('keydown', this.keydownHandler, true);
        }

        // Clear timer
        if (this.throttleTimer !== null) {
            clearTimeout(this.throttleTimer);
        }

        // Dispose widgets
        for (const widget of this.widgets) {
            widget.dispose();
        }
        this.widgets = [];

        // Dispose folders
        for (const folder of this.folders.values()) {
            folder.dispose();
        }
        this.folders.clear();

        // Dispose panel
        this.panel?.dispose();

        // Cleanup region class
        if (this.useLayout) {
            const region = this.app.getRegion(this.region);
            region.classList.remove('param-panel-region', 'open');
        }

        // Remove standalone wrapper
        if (!this.useLayout && this.toggleContainer) {
            this.toggleContainer.remove();
        }
    }

    // ============================================================================
    // Mode Handling
    // ============================================================================

    private onRenderStarted = (data: { mode: string }): void => {
        if (data.mode === 'production') {
            this.close();
            this.setDisabled(true);
        }
    };

    private onRenderEnded = (): void => {
        this.setDisabled(false);
    };

    private setDisabled(disabled: boolean): void {
        this.root.style.pointerEvents = disabled ? 'none' : '';
        this.root.style.opacity = disabled ? '0.5' : '';
    }

    // ============================================================================
    // Toggle (custom - uses 'open' class on container)
    // ============================================================================

    toggle(): void {
        this.isOpen = !this.isOpen;
        this.toggleContainer?.classList.toggle('open', this.isOpen);
    }

    open(): void {
        if (!this.isOpen) {
            this.isOpen = true;
            this.toggleContainer?.classList.add('open');
        }
    }

    close(): void {
        if (this.isOpen) {
            this.isOpen = false;
            this.toggleContainer?.classList.remove('open');
        }
    }

    get isVisible(): boolean {
        return this.isOpen;
    }

    // ============================================================================
    // Panel Population
    // ============================================================================

    private populatePanel(): void {
        const metadata = this.app.getParameterMetadata();

        if (metadata.size === 0) {
            const empty = document.createElement('div');
            empty.className = 'param-empty';
            empty.textContent = 'No parameters available for current renderer';
            this.panel.domElement.querySelector('.ui-panel-content')?.appendChild(empty);
            return;
        }

        const groups = this.groupParameters(metadata);
        const sortedGroups = this.sortGroups(groups);

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
        // Group display order (matches module compilation order)
        const GROUP_ORDER = [
            'Ambient', 'Scene', 'Environment', 'Lighting',
            'Camera', 'Interaction', 'Transport', 'Accumulator', 'Developer'
        ];
        const order = new Map<string, number>();
        GROUP_ORDER.forEach((name, index) => {
            order.set(name, index);
        });

        const sorted = Array.from(groups.entries()).sort((a, b) => {
            const orderA = order.get(a[0]) ?? 999;
            const orderB = order.get(b[0]) ?? 999;
            return orderA - orderB;
        });

        return new Map(sorted);
    }

    private createWidgetForParam(path: string, meta: ParameterMetadata): UIComponent {
        const currentValue = this.app.getParameter(path) ?? meta.default;

        return WidgetFactory.create(meta, {
            value: currentValue,
            onChange: (value) => this.queueUpdate(path, value)
        });
    }

    // ============================================================================
    // Update Throttling
    // ============================================================================

    private queueUpdate(path: string, value: unknown): void {
        this.updateQueue.set(path, value);

        if (this.throttleTimer !== null) {
            return;
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
    // Keyboard Shortcut
    // ============================================================================

    private attachKeyboardShortcut(): void {
        this.keydownHandler = (e: KeyboardEvent) => {
            if (e.key === 'Tab' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
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

        window.addEventListener('keydown', this.keydownHandler, { capture: true });
    }
}
