/**
 * AppLayout - Manages page layout and regions
 *
 * Creates and manages named regions for:
 * - Canvas container (where the WebGL canvas lives)
 * - Left/Right sidebars
 * - Toolbar/Statusbar
 * - Overlay (for modals, etc.)
 *
 * Layouts are primarily CSS-driven via the data-layout attribute.
 * This class handles region creation and layout switching.
 */
import './layouts.css';

export type LayoutMode = 'fullscreen' | 'centered' | 'editor' | 'split';

export type RegionName =
    | 'canvas-container'
    | 'region-left'
    | 'region-right'
    | 'region-toolbar'
    | 'region-statusbar'
    | 'region-overlay';

export interface LayoutOptions {
    /** Initial layout mode (default: 'fullscreen') */
    mode?: LayoutMode;
    /** CSS custom properties to set */
    variables?: Record<string, string>;
}

const REGION_NAMES: RegionName[] = [
    'canvas-container',
    'region-left',
    'region-right',
    'region-toolbar',
    'region-statusbar',
    'region-overlay'
];

export class AppLayout {
    private root: HTMLElement;
    private _mode: LayoutMode;
    private regions: Map<RegionName, HTMLElement> = new Map();

    constructor(root: HTMLElement = document.body, options: LayoutOptions = {}) {
        this.root = root;
        this._mode = options.mode ?? 'fullscreen';

        this.createRegions();
        this.setMode(this._mode);

        if (options.variables) {
            this.setVariables(options.variables);
        }
    }

    /**
     * Create all region elements
     */
    private createRegions(): void {
        for (const name of REGION_NAMES) {
            // Check if region already exists
            let el = document.getElementById(name);

            if (!el) {
                el = document.createElement('div');
                el.id = name;
                this.root.appendChild(el);
            }

            this.regions.set(name, el);
        }
    }

    /**
     * Get current layout mode
     */
    get mode(): LayoutMode {
        return this._mode;
    }

    /**
     * Switch to a different layout mode
     */
    setMode(mode: LayoutMode): void {
        this._mode = mode;
        this.root.dataset.layout = mode;
    }

    /**
     * Get a region element by name
     */
    getRegion(name: RegionName): HTMLElement {
        const region = this.regions.get(name);
        if (!region) {
            throw new Error(`Unknown region: ${name}`);
        }
        return region;
    }

    /**
     * Get the canvas container region
     */
    getCanvasContainer(): HTMLElement {
        return this.getRegion('canvas-container');
    }

    /**
     * Get the overlay region (for modals, etc.)
     */
    getOverlay(): HTMLElement {
        return this.getRegion('region-overlay');
    }

    /**
     * Show a region
     */
    showRegion(name: RegionName): void {
        const region = this.getRegion(name);
        region.classList.remove('region-hidden');
    }

    /**
     * Hide a region
     */
    hideRegion(name: RegionName): void {
        const region = this.getRegion(name);
        region.classList.add('region-hidden');
    }

    /**
     * Set CSS custom properties on the root element
     *
     * Useful for configuring layout dimensions:
     * - --layout-canvas-width
     * - --layout-canvas-aspect
     * - --layout-sidebar-width
     * - --layout-left-width
     * - --layout-right-width
     * - --layout-toolbar-height
     * - --layout-statusbar-height
     * - --layout-panel-width
     */
    setVariables(variables: Record<string, string>): void {
        for (const [key, value] of Object.entries(variables)) {
            const propName = key.startsWith('--') ? key : `--${key}`;
            this.root.style.setProperty(propName, value);
        }
    }

    /**
     * Set a single CSS custom property
     */
    setVariable(name: string, value: string): void {
        const propName = name.startsWith('--') ? name : `--${name}`;
        this.root.style.setProperty(propName, value);
    }

    /**
     * Get canvas dimensions based on current layout
     * Useful for creating the WebGL canvas at the right size
     */
    getCanvasSize(): { width: number; height: number } {
        const container = this.getCanvasContainer();
        return {
            width: container.clientWidth || window.innerWidth,
            height: container.clientHeight || window.innerHeight
        };
    }

    /**
     * Dispose and remove all regions
     */
    dispose(): void {
        for (const [name, el] of this.regions) {
            // Don't remove canvas-container if it has a canvas
            if (name === 'canvas-container' && el.querySelector('canvas')) {
                continue;
            }
            el.remove();
        }
        this.regions.clear();
        delete this.root.dataset.layout;
    }
}

/**
 * Create an AppLayout instance with common defaults
 */
export function createLayout(
    mode: LayoutMode = 'fullscreen',
    options: Omit<LayoutOptions, 'mode'> = {}
): AppLayout {
    return new AppLayout(document.body, { ...options, mode });
}
