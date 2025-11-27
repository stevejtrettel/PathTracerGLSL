/**
 * DisplayMode - Interface for presentation modes
 *
 * A DisplayMode controls how rendered output is presented on screen.
 * The rendering pipeline produces output to offscreen buffers; the
 * DisplayMode handles the final presentation step.
 *
 * Different modes support different use cases:
 * - Fullscreen: Canvas fills the display area (default)
 * - Preview: Scaled preview for high-res production renders
 * - Tiled: Shows tile progress during tiled rendering
 *
 * DisplayModes can add their own UI (progress bars, controls)
 * using the UI component system.
 */

export interface DisplayModeContext {
    /** The canvas element being displayed to */
    canvas: HTMLCanvasElement;
    /** WebGL context */
    gl: WebGL2RenderingContext;
    /** Container element for the display */
    container: HTMLElement;
}

export interface DisplayMode {
    /** Unique identifier for this mode */
    readonly id: string;

    /**
     * Called when this mode becomes active
     * Set up any DOM elements, event listeners, etc.
     */
    activate(context: DisplayModeContext): void;

    /**
     * Called when switching away from this mode
     * Clean up DOM elements, event listeners, etc.
     */
    deactivate(): void;

    /**
     * Called when the container is resized
     */
    onResize?(width: number, height: number): void;

    /**
     * Called each frame to update display-specific UI
     * (e.g., progress bars, stats)
     */
    onFrame?(frameInfo: DisplayFrameInfo): void;

    /**
     * Clean up all resources
     */
    dispose(): void;
}

export interface DisplayFrameInfo {
    /** Current sample count */
    samples: number;
    /** Target sample count (if in production mode) */
    targetSamples?: number;
    /** Frames per second */
    fps: number;
    /** Elapsed time in milliseconds */
    elapsedMs: number;
    /** Render state */
    state: 'rendering' | 'paused' | 'complete' | 'stopped';
    /** Render mode */
    mode: 'interactive' | 'production';
}
