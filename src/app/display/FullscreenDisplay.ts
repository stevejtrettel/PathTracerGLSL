/**
 * FullscreenDisplay - Default display mode
 *
 * The canvas fills its container. No additional UI.
 * This is the simplest and most common display mode.
 */
import type { DisplayMode, DisplayModeContext } from './DisplayMode.js';

export class FullscreenDisplay implements DisplayMode {
    readonly id = 'fullscreen';

    private canvas: HTMLCanvasElement | null = null;

    activate(context: DisplayModeContext): void {
        this.canvas = context.canvas;

        // Ensure canvas fills container
        this.canvas.style.width = '100%';
        this.canvas.style.height = '100%';
        this.canvas.style.display = 'block';
    }

    deactivate(): void {
        // Nothing special to clean up
    }

    onResize(width: number, height: number): void {
        if (this.canvas) {
            // Canvas buffer size should match display size
            // (This is typically handled by the Engine, but we note it here)
            this.canvas.width = width;
            this.canvas.height = height;
        }
    }

    dispose(): void {
        this.canvas = null;
    }
}
