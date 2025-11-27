/**
 * Layout System
 *
 * Provides CSS-driven layouts for arranging the canvas and UI regions.
 *
 * ## Usage
 *
 * ```typescript
 * import { AppLayout } from './layout/index.js';
 *
 * // Create layout (sets up regions)
 * const layout = new AppLayout(document.body, { mode: 'centered' });
 *
 * // Get canvas container for WebGL
 * const container = layout.getCanvasContainer();
 * container.appendChild(canvas);
 *
 * // Mount UI into regions
 * const panel = new Panel({ title: 'Controls' });
 * panel.mount(layout.getRegion('region-right'));
 *
 * // Switch layouts
 * layout.setMode('fullscreen');
 *
 * // Configure layout variables
 * layout.setVariables({
 *     '--layout-canvas-width': '1280px',
 *     '--layout-sidebar-width': '360px'
 * });
 * ```
 *
 * ## Available Layouts
 *
 * - **fullscreen**: Canvas fills viewport, panels overlay
 * - **centered**: Canvas centered with optional sidebars
 * - **editor**: Fixed regions (toolbar, sidebars, statusbar)
 * - **split**: Canvas + large side panel
 *
 * @module layout
 */

export {
    AppLayout,
    createLayout,
    type LayoutMode,
    type LayoutOptions,
    type RegionName
} from './AppLayout.js';
