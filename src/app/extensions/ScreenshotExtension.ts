// app/extensions/ScreenshotExtension.ts
import type { Extension } from '../types';

/**
 * ScreenshotExtension - Save PNG screenshots
 * Press 'X' to save current tone-mapped display as PNG
 */
class ScreenshotExtension implements Extension {
    name = 'screenshot';
    version = '1.0.0';
    description = 'Save PNG screenshots (press X)';

    private app: any;

    install(app: any, bus: any): void {
        this.app = app;

        // Listen for 'X' key
        window.addEventListener('keydown', this.handleKeyDown);

        console.log('Screenshot extension installed - Press X to save PNG');
    }

    uninstall(): void {
        window.removeEventListener('keydown', this.handleKeyDown);
    }

    private handleKeyDown = (e: KeyboardEvent): void => {
        // Trigger on 'X' without modifiers
        if ((e.key === 'x' || e.key === 'X') && !e.ctrlKey && !e.metaKey && !e.altKey) {
            e.preventDefault();
            this.saveScreenshot();
        }
    };

    private async saveScreenshot(): Promise<void> {
        const executor = this.app.engine['executor'];
        const gl = this.app.engine['gl'];
        const width = gl.canvas.width;
        const height = gl.canvas.height;

        // Get sample count
        const sampleCount = this.app.engine.sampleCount;

        console.log(`Saving PNG screenshot (${width}×${height}, ${sampleCount}spp)...`);

        // Read tone-mapped display pixels
        const pixels = executor.readDisplay();

        // Convert to PNG via canvas
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d')!;

        // Create ImageData and flip Y axis (WebGL bottom-left → Canvas top-left)
        const imageData = ctx.createImageData(width, height);
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const srcIdx = ((height - 1 - y) * width + x) * 4; // Flip Y
                const dstIdx = (y * width + x) * 4;

                imageData.data[dstIdx + 0] = pixels[srcIdx + 0]; // R
                imageData.data[dstIdx + 1] = pixels[srcIdx + 1]; // G
                imageData.data[dstIdx + 2] = pixels[srcIdx + 2]; // B
                imageData.data[dstIdx + 3] = 255;                // A (force opaque)
            }
        }

        ctx.putImageData(imageData, 0, 0);

        // Convert to blob and download
        canvas.toBlob((blob) => {
            if (!blob) {
                console.error('Failed to create PNG blob');
                return;
            }

            // Generate filename: screenshot_2025_1020_1905_235spp.png
            const now = new Date();
            const year = now.getFullYear();
            const month = String(now.getMonth() + 1).padStart(2, '0');
            const day = String(now.getDate()).padStart(2, '0');
            const hours = String(now.getHours()).padStart(2, '0');
            const minutes = String(now.getMinutes()).padStart(2, '0');

            const dateStr = `${month}${day}`;  // MMDD
            const timeStr = `${hours}${minutes}`;  // HHMM

            const filename = `screenshot_${year}_${dateStr}_${timeStr}_${sampleCount}spp.png`;

            // Trigger download
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a); // Required for Firefox
            a.click();
            document.body.removeChild(a);

            URL.revokeObjectURL(url);

            console.log(`✓ Saved ${filename}`);
        }, 'image/png');
    }
}

export { ScreenshotExtension };
