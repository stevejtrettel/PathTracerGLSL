// app/extensions/HDRExportExtension.ts
import type { Extension } from '../types';
import { saveHDRFile } from '../utils/file-export';

/**
 * HDRExportExtension - Save HDR radiance files
 * Press 'H' to save current radiance as .hdr (Radiance RGBE format)
 */
class HDRExportExtension implements Extension {
    name = 'hdr-export';
    version = '1.0.0';
    description = 'Save HDR radiance files (press H)';

    private app: any;

    install(app: any, bus: any): void {
        this.app = app;

        // Listen for 'H' key
        window.addEventListener('keydown', this.handleKeyDown);

        console.log('HDR Export extension installed - Press H to save HDR');
    }

    uninstall(): void {
        window.removeEventListener('keydown', this.handleKeyDown);
    }

    private handleKeyDown = (e: KeyboardEvent): void => {
        // Trigger on 'H' without modifiers
        if ((e.key === 'h' || e.key === 'H') && !e.ctrlKey && !e.metaKey && !e.altKey) {
            e.preventDefault();
            this.saveHDR();
        }
    };

    private async saveHDR(): Promise<void> {
        const executor = this.app.engine['executor'];
        const gl = this.app.engine['gl'];
        const width = gl.canvas.width;
        const height = gl.canvas.height;

        // Get sample count
        const sampleCount = this.app.engine.sampleCount;

        console.log(`Saving HDR radiance (${width}×${height}, ${sampleCount}spp)...`);

        // Read HDR radiance (RGBA32F)
        const radiance = executor.readRadiance();

        // Generate filename
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');

        const dateStr = `${month}${day}`;
        const timeStr = `${hours}${minutes}`;

        const filename = `radiance_${year}_${dateStr}_${timeStr}_${sampleCount}spp.hdr`;

        // Save using shared utility
        saveHDRFile(radiance, width, height, filename);

        console.log(`✓ Saved ${filename}`);
    }
}

export { HDRExportExtension };
