// app/ExportManager.ts
// Manages file export operations (PNG, HDR, AOVs)

import { saveHDRFile, savePNGFile } from './utils/file-export.js';
import { ExportError } from '../errors/RenderErrors.js';
import type { Engine } from '../engine/Engine.js';
import type { RenderCoordinator } from './RenderCoordinator.js';

/**
 * ExportManager handles all file export operations
 *
 * Responsibilities:
 * - Export PNG screenshots (LDR)
 * - Export HDR files (Radiance RGBE format)
 * - Export AOVs (Arbitrary Output Variables)
 * - Generate timestamped filenames
 */
export class ExportManager {
    constructor(
        private engine: Engine,
        private coordinator: RenderCoordinator
    ) {}

    /**
     * Get available export names for current renderer
     */
    getAvailableExports(): string[] {
        return this.engine.getExportNames();
    }

    /**
     * Read export data (low-level)
     */
    readExport(name: string): Float32Array | Uint8Array {
        return this.engine.readExport(name);
    }

    /**
     * Get canvas dimensions
     */
    getCanvasSize(): [number, number] {
        return this.engine.getCanvasSize();
    }

    /**
     * Generate default filename with timestamp and sample count
     */
    private _generateFilename(prefix: string, extension: string): string {
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');
        const spp = this.coordinator.getSampleCount();

        return `${prefix}_${year}${month}${day}_${hours}${minutes}_${spp}spp.${extension}`;
    }

    /**
     * Export PNG screenshot (LDR)
     *
     * Reads from 'ldr' export target and saves as PNG.
     * @param filename - Optional custom filename (auto-generated if not provided)
     */
    exportPNG(filename?: string): void {
        const exports = this.getAvailableExports();
        if (!exports.includes('ldr')) {
            throw new ExportError('LDR export not available for current renderer', {
                availableExports: exports
            });
        }

        try {
            const [width, height] = this.getCanvasSize();
            const pixels = this.readExport('ldr') as Uint8Array;
            const name = filename || this._generateFilename('screenshot', 'png');

            savePNGFile(pixels, width, height, name);
            console.log(`Exported PNG: ${name}`);
        } catch (error) {
            if (error instanceof ExportError) {
                throw error;
            }
            throw new ExportError('Failed to export PNG', { error });
        }
    }

    /**
     * Export HDR file (Radiance RGBE format)
     *
     * Reads from 'hdr' export target and saves as .hdr file.
     * @param filename - Optional custom filename (auto-generated if not provided)
     */
    exportHDR(filename?: string): void {
        const exports = this.getAvailableExports();
        if (!exports.includes('hdr')) {
            throw new ExportError('HDR export not available for current renderer', {
                availableExports: exports
            });
        }

        try {
            const [width, height] = this.getCanvasSize();
            const pixels = this.readExport('hdr') as Float32Array;
            const name = filename || this._generateFilename('radiance', 'hdr');

            saveHDRFile(pixels, width, height, name);
            console.log(`Exported HDR: ${name}`);
        } catch (error) {
            if (error instanceof ExportError) {
                throw error;
            }
            throw new ExportError('Failed to export HDR', { error });
        }
    }

    /**
     * Export AOV (Arbitrary Output Variable)
     *
     * Exports a specific AOV like 'albedo', 'normal', etc.
     * @param aovName - Name of the AOV to export
     * @param filename - Optional custom filename
     */
    exportAOV(aovName: string, filename?: string): void {
        const exports = this.getAvailableExports();
        if (!exports.includes(aovName)) {
            throw new ExportError(`AOV '${aovName}' not available`, {
                requestedAOV: aovName,
                availableExports: exports
            });
        }

        try {
            const [width, height] = this.getCanvasSize();
            const pixels = this.readExport(aovName);
            const name = filename || this._generateFilename(aovName, 'hdr');

            if (pixels instanceof Float32Array) {
                saveHDRFile(pixels, width, height, name);
                console.log(`Exported AOV (HDR): ${name}`);
            } else {
                // LDR AOV - save as PNG
                const pngName = filename || this._generateFilename(aovName, 'png');
                savePNGFile(pixels, width, height, pngName);
                console.log(`Exported AOV (PNG): ${pngName}`);
            }
        } catch (error) {
            if (error instanceof ExportError) {
                throw error;
            }
            throw new ExportError(`Failed to export AOV '${aovName}'`, { aovName, error });
        }
    }

    /**
     * Export all available AOVs
     *
     * Exports all AOVs (excluding standard 'hdr' and 'ldr').
     */
    exportAllAOVs(): void {
        const exports = this.getAvailableExports();
        const aovs = exports.filter(e => e !== 'hdr' && e !== 'ldr');

        if (aovs.length === 0) {
            throw new ExportError('No AOVs available for export', {
                availableExports: exports
            });
        }

        console.log(`Exporting ${aovs.length} AOVs...`);
        const errors: Array<{ aov: string; error: any }> = [];

        for (const aov of aovs) {
            try {
                this.exportAOV(aov);
            } catch (error) {
                errors.push({ aov, error });
                console.error(`Failed to export AOV '${aov}':`, error);
            }
        }

        if (errors.length > 0) {
            throw new ExportError(`Failed to export ${errors.length} of ${aovs.length} AOVs`, {
                errors,
                totalAOVs: aovs.length,
                failedAOVs: errors.length
            });
        }

        console.log('AOV export complete');
    }
}
