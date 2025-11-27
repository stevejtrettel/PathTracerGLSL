/**
 * UIExtension - Base class for UI-based extensions
 *
 * Provides common patterns for extensions that render UI:
 * - Region mounting with standalone fallback
 * - Show/hide/toggle visibility
 * - Event subscription management
 * - Cleanup on uninstall
 *
 * Subclasses implement:
 * - `region`: which layout region to mount in
 * - `createRoot()`: create the root DOM element
 * - `setup()`: initialize UI, subscribe to events
 * - `cleanup()`: optional teardown logic
 */
import type { App } from '../App.js';
import type { EventBus } from '../EventBus.js';
import type { Extension } from '../types.js';
import type { RegionName } from '../layout/index.js';

// Ensure UI styles are loaded
import '../ui/index.js';

export interface UIExtensionConfig {
    /** Start hidden? (default: false) */
    startHidden?: boolean;
    /** Class to add when in standalone mode (default: 'standalone') */
    standaloneClass?: string;
}

export abstract class UIExtension implements Extension {
    abstract readonly name: string;
    version?: string;
    description?: string;

    protected app!: App;
    protected bus!: EventBus;
    protected root!: HTMLElement;

    /** Which layout region to mount in */
    protected abstract readonly region: RegionName;

    /** Configuration */
    protected readonly config: UIExtensionConfig;

    /** Track event subscriptions for cleanup */
    private eventSubscriptions: Array<{ event: string; handler: (data?: any) => void }> = [];

    constructor(config: UIExtensionConfig = {}) {
        this.config = {
            startHidden: false,
            standaloneClass: 'standalone',
            ...config
        };
    }

    // ============================================================================
    // Extension Lifecycle
    // ============================================================================

    install(app: App, bus: EventBus): void {
        this.app = app;
        this.bus = bus;

        this.root = this.createRoot();
        this.mount();

        if (this.config.startHidden) {
            this.hide();
        }

        this.setup();
    }

    uninstall(): void {
        // Unsubscribe all events
        for (const { event, handler } of this.eventSubscriptions) {
            this.bus.off(event, handler);
        }
        this.eventSubscriptions = [];

        // Call subclass cleanup
        this.cleanup();

        // Remove from DOM
        this.root.remove();
    }

    // ============================================================================
    // Subclass Implementation Points
    // ============================================================================

    /** Create the root DOM element for this extension */
    protected abstract createRoot(): HTMLElement;

    /** Setup UI, subscribe to events, etc. Called after mount. */
    protected abstract setup(): void;

    /** Optional cleanup logic. Called before DOM removal. */
    protected cleanup(): void {}

    // ============================================================================
    // Mounting
    // ============================================================================

    /** Check if app has layout system */
    protected get useLayout(): boolean {
        return this.app.hasLayout();
    }

    /** Mount root element to region or body */
    protected mount(): void {
        if (this.useLayout) {
            this.app.getRegion(this.region).appendChild(this.root);
        } else {
            this.root.classList.add(this.config.standaloneClass!);
            document.body.appendChild(this.root);
        }
    }

    // ============================================================================
    // Visibility
    // ============================================================================

    show(): void {
        this.root.classList.remove('hidden');
    }

    hide(): void {
        this.root.classList.add('hidden');
    }

    toggle(): void {
        if (this.isVisible) {
            this.hide();
        } else {
            this.show();
        }
    }

    get isVisible(): boolean {
        return !this.root.classList.contains('hidden');
    }

    // ============================================================================
    // Event Helpers
    // ============================================================================

    /**
     * Subscribe to an event with automatic cleanup on uninstall
     */
    protected on(event: string, handler: (data?: any) => void): void {
        this.bus.on(event, handler);
        this.eventSubscriptions.push({ event, handler });
    }

    /**
     * Manually unsubscribe from an event
     */
    protected off(event: string, handler: (data?: any) => void): void {
        this.bus.off(event, handler);
        this.eventSubscriptions = this.eventSubscriptions.filter(
            sub => !(sub.event === event && sub.handler === handler)
        );
    }
}
