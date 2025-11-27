/**
 * Display System
 *
 * Manages how rendered output is presented on screen.
 *
 * ## Concepts
 *
 * **DisplayMode**: Controls presentation of rendered output.
 * Different modes for different use cases:
 * - Fullscreen: Default, canvas fills container
 * - Preview: For production renders, shows scaled preview + progress
 * - Tiled: Shows tile grid during tiled rendering
 *
 * **DisplayManager**: Handles mode registration and switching.
 *
 * ## Usage
 *
 * ```typescript
 * import { DisplayManager, FullscreenDisplay } from './display/index.js';
 *
 * const displayManager = new DisplayManager();
 *
 * // Initialize with context
 * displayManager.initialize({
 *     canvas,
 *     gl,
 *     container: document.getElementById('canvas-container')!
 * });
 *
 * // Switch modes
 * displayManager.setMode('fullscreen');
 *
 * // Register custom mode
 * displayManager.register(new ProductionDisplay());
 * displayManager.setMode('production');
 *
 * // In render loop
 * displayManager.onFrame({
 *     samples: 100,
 *     fps: 60,
 *     elapsedMs: 5000,
 *     state: 'rendering',
 *     mode: 'interactive'
 * });
 * ```
 *
 * @module display
 */

export {
    type DisplayMode,
    type DisplayModeContext,
    type DisplayFrameInfo
} from './DisplayMode.js';

export { FullscreenDisplay } from './FullscreenDisplay.js';
export { DisplayManager } from './DisplayManager.js';
