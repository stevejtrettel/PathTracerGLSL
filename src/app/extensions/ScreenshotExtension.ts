// app/extensions/ScreenshotExtension.ts
import type { Extension } from '../types';
import { savePNGFile } from '../utils/file-export';

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

        // Save using shared utility
        savePNGFile(pixels, width, height, filename);

        console.log(`✓ Saved ${filename}`);
    }
}

export { ScreenshotExtension };
