// app/extensions/HDRExportExtension.ts
import type { Extension } from '../types';

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

        // Convert Float32Array RGBA → RGBE format
        const rgbeData = this.floatToRGBE(radiance, width, height);

        // Build HDR file with header
        const hdrFile = this.buildHDRFile(rgbeData, width, height);

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

        // Download
        const blob = new Blob([hdrFile], { type: 'application/octet-stream' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);

        URL.revokeObjectURL(url);

        console.log(`✓ Saved ${filename}`);
    }

    /**
     * Convert Float32Array RGBA → RGBE bytes
     * RGBE encoding: rgb = (r,g,b) * 2^(e-128)
     */
    private floatToRGBE(floats: Float32Array, width: number, height: number): Uint8Array {
        const rgbe = new Uint8Array(width * height * 4);

        for (let i = 0; i < width * height; i++) {
            const r = floats[i * 4 + 0];
            const g = floats[i * 4 + 1];
            const b = floats[i * 4 + 2];
            // Ignore alpha (floats[i * 4 + 3])

            // Find max component
            const maxVal = Math.max(r, g, b);

            if (maxVal < 1e-32) {
                // Too small, store as zero
                rgbe[i * 4 + 0] = 0;
                rgbe[i * 4 + 1] = 0;
                rgbe[i * 4 + 2] = 0;
                rgbe[i * 4 + 3] = 0;
            } else {
                // Find exponent
                let exponent = Math.floor(Math.log2(maxVal)) + 1;
                const scale = Math.pow(2, -exponent) * 256;

                // Clamp exponent to valid range
                exponent = Math.max(-128, Math.min(127, exponent));

                // Encode
                rgbe[i * 4 + 0] = Math.min(255, Math.floor(r * scale));
                rgbe[i * 4 + 1] = Math.min(255, Math.floor(g * scale));
                rgbe[i * 4 + 2] = Math.min(255, Math.floor(b * scale));
                rgbe[i * 4 + 3] = exponent + 128;
            }
        }

        return rgbe;
    }

    /**
     * Build complete .hdr file with header and RLE-compressed data
     */
    private buildHDRFile(rgbeData: Uint8Array, width: number, height: number): Uint8Array {
        // Build header
        const header = [
            '#?RADIANCE',
            'FORMAT=32-bit_rle_rgbe',
            '',
            `-Y ${height} +X ${width}`,
            ''
        ].join('\n');

        const headerBytes = new TextEncoder().encode(header);

        // For simplicity, write uncompressed scanlines (RLE compression is complex)
        // Modern HDR readers handle uncompressed data fine
        const totalSize = headerBytes.length + width * height * 4;
        const fileData = new Uint8Array(totalSize);

        // Copy header
        fileData.set(headerBytes, 0);

        // Copy pixel data (flip Y - WebGL bottom-left → HDR top-left)
        let offset = headerBytes.length;
        for (let y = height - 1; y >= 0; y--) {
            const rowStart = y * width * 4;
            const rowEnd = rowStart + width * 4;
            fileData.set(rgbeData.slice(rowStart, rowEnd), offset);
            offset += width * 4;
        }

        return fileData;
    }
}

export { HDRExportExtension };
