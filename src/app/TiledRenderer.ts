// app/TiledRenderer.ts
// Production rendering with tiled output for App

import type { App } from './App.js';
import type { EventBus } from './EventBus.js';
import { saveHDRFile, savePNGFile } from './utils/file-export.js';
import { AppEvents } from './events.js';

/**
 * Configuration for a tiled render job
 */
export interface TileJobConfig {
    /** Total output image width in pixels */
    targetWidth: number;
    /** Total output image height in pixels */
    targetHeight: number;
    /** Preferred tile size (actual tiles may be slightly different to divide evenly) */
    targetTileSize: number;
    /** Number of samples to render per tile */
    samplesPerTile: number;
    /** Output format: 'hdr', 'png', or 'both' */
    format: 'hdr' | 'png' | 'both';
}

/**
 * Computed tile grid dimensions
 */
export interface TileGrid {
    /** Number of tiles in X direction */
    tilesX: number;
    /** Number of tiles in Y direction */
    tilesY: number;
    /** Nominal tile width (the stride between tiles); edge tiles are clamped smaller */
    tileWidth: number;
    /** Nominal tile height (the stride between tiles); edge tiles are clamped smaller */
    tileHeight: number;
}

/**
 * Pixel rectangle covered by a single tile
 */
interface TileRect {
    x: number;
    y: number;
    width: number;
    height: number;
}

/**
 * State of a tiled render job
 */
export interface TileJob {
    /** Job configuration */
    config: TileJobConfig;
    /** Computed tile grid */
    grid: TileGrid;
    /** List of completed tile coordinates [x, y] */
    completedTiles: [number, number][];
    /** Count of completed tiles */
    completedTileCount: number;
    /** Unique job identifier */
    jobId: string;
    /** Start timestamp */
    startTime: number;
    /** Current job state */
    state: 'running' | 'paused' | 'complete';
}

// ============================================================================
// Tile Events
// ============================================================================

/**
 * Progress info for a single tile
 */
export interface TileProgressInfo {
    /** Tile grid position (0-indexed) */
    tileX: number;
    tileY: number;
    /** Tile index in the grid (row-major order) */
    tileIndex: number;
    /** Total number of tiles */
    totalTiles: number;
    /** Grid dimensions */
    grid: TileGrid;
}

/**
 * Tiled job progress info
 */
export interface TiledJobProgressInfo {
    /** Job ID */
    jobId: string;
    /** Grid configuration */
    grid: TileGrid;
    /** Target image size */
    targetWidth: number;
    targetHeight: number;
    /** Samples per tile */
    samplesPerTile: number;
    /** Number of completed tiles */
    completedTiles: number;
    /** Total tiles */
    totalTiles: number;
    /** List of completed tile positions */
    completedPositions: [number, number][];
    /** Current tile being rendered (null if none) */
    currentTile: { x: number; y: number } | null;
}

/**
 * TiledRenderer - Production rendering with tiled output
 *
 * Renders high-resolution images by splitting them into tiles,
 * rendering each tile with production mode, and saving individually.
 *
 * Uses production mode internally for each tile, providing:
 * - Automatic parameter locking during render
 * - Clean error handling with pause/resume support
 * - Progress tracking for each tile
 *
 * Usage:
 *   const tiled = new TiledRenderer(app);
 *   await tiled.startJob({
 *       targetWidth: 4096,
 *       targetHeight: 2048,
 *       targetTileSize: 512,
 *       samplesPerTile: 1000,
 *       format: 'hdr'
 *   });
 */
export class TiledRenderer {
    private app: App;
    private bus: EventBus;
    private currentJob: TileJob | null = null;
    private currentTilePosition: { x: number; y: number } | null = null;

    constructor(app: App, bus: EventBus) {
        this.app = app;
        this.bus = bus;
    }

    /**
     * Calculate the tile grid for a target image
     *
     * Tiles use the requested size as a fixed stride; the tiles on the right and
     * bottom edges are clamped to the image bounds (see {@link tileRect}). This
     * guarantees the tiles exactly cover the image with no overrun — unlike
     * rounding the stride up, which can push edge tiles past the target size
     * (e.g. 1030px / ceil(1030/512)=3 → 344px stride → 3×344=1032 ≠ 1030).
     */
    calculateGrid(config: TileJobConfig): TileGrid {
        const { targetWidth, targetHeight, targetTileSize } = config;

        const tilesX = Math.ceil(targetWidth / targetTileSize);
        const tilesY = Math.ceil(targetHeight / targetTileSize);

        return {
            tilesX,
            tilesY,
            tileWidth: targetTileSize,
            tileHeight: targetTileSize,
        };
    }

    /**
     * Pixel rectangle covered by tile (tx, ty), clamped to the image at the edges.
     */
    private tileRect(tx: number, ty: number): TileRect {
        const { grid, config } = this.currentJob!;
        const x = tx * grid.tileWidth;
        const y = ty * grid.tileHeight;
        return {
            x,
            y,
            width: Math.min(grid.tileWidth, config.targetWidth - x),
            height: Math.min(grid.tileHeight, config.targetHeight - y),
        };
    }

    /**
     * Start a new tiled render job
     *
     * @param config - Job configuration
     * @throws Error if a job is already running
     */
    async startJob(config: TileJobConfig): Promise<void> {
        if (this.currentJob) {
            throw new Error('Job already running. Stop or complete current job first.');
        }

        const grid = this.calculateGrid(config);
        const totalTiles = grid.tilesX * grid.tilesY;

        console.log(`\n=== Starting Tiled Render Job ===`);
        console.log(`Target: ${config.targetWidth}×${config.targetHeight}`);
        console.log(`Grid: ${grid.tilesX}×${grid.tilesY} tiles of ${grid.tileWidth}×${grid.tileHeight}`);
        console.log(`Total: ${totalTiles} tiles`);
        console.log(`Samples per tile: ${config.samplesPerTile}`);
        console.log(`Format: ${config.format}`);

        this.currentJob = {
            config,
            grid,
            completedTiles: [],
            completedTileCount: 0,
            jobId: this.generateJobId(),
            startTime: Date.now(),
            state: 'running'
        };

        // Emit job start event
        this.emitJobProgress();

        // Save session before starting (for resume capability)
        const session = this.app.saveSession();
        console.log(`Session saved: ${this.currentJob.jobId}_session.json`);
        this.downloadJSON(session, `${this.currentJob.jobId}_session.json`);

        await this.renderAllTiles();
    }

    /**
     * Get current job state
     *
     * Returns null if no job is running.
     */
    getCurrentJob(): TileJob | null {
        return this.currentJob;
    }

    /**
     * Stop current job (pauses at current tile)
     *
     * The job can be resumed later with resumeJob().
     */
    stopJob(): void {
        if (!this.currentJob) return;

        this.currentJob.state = 'paused';
        this.app.stop();  // Stop current tile render

        const { completedTileCount, grid } = this.currentJob;
        const totalTiles = grid.tilesX * grid.tilesY;

        console.log(`\nJob paused`);
        console.log(`Completed: ${completedTileCount}/${totalTiles} tiles`);
        console.log(`To resume, call resumeJob() with the job state`);
    }

    /**
     * Resume a paused job
     *
     * @param job - Previously saved job state
     */
    async resumeJob(job: TileJob): Promise<void> {
        // FUTURE: Validate job structure (version field, grid consistency)
        this.currentJob = job;
        this.currentJob.state = 'running';

        const totalTiles = job.grid.tilesX * job.grid.tilesY;
        console.log(`\nResuming tile job: ${job.jobId}`);
        console.log(`Completed: ${job.completedTileCount}/${totalTiles} tiles`);

        await this.renderAllTiles();
    }

    /**
     * Get job state for serialization
     *
     * Returns the current job state that can be saved and used to resume later.
     */
    getJobState(): TileJob | null {
        return this.currentJob ? { ...this.currentJob } : null;
    }

    // ============================================================================
    // Private: Rendering
    // ============================================================================

    private async renderAllTiles(): Promise<void> {
        if (!this.currentJob) return;

        const { grid } = this.currentJob;
        const totalTiles = grid.tilesX * grid.tilesY;

        // Render tiles row by row
        for (let ty = 0; ty < grid.tilesY; ty++) {
            for (let tx = 0; tx < grid.tilesX; tx++) {
                // Check if job was stopped
                if (!this.currentJob || this.currentJob.state !== 'running') {
                    console.log('Tile job stopped');
                    this.currentTilePosition = null;
                    this.emitJobProgress();
                    return;
                }

                // Skip already completed tiles (for resume)
                const alreadyDone = this.currentJob.completedTiles.some(
                    ([x, y]) => x === tx && y === ty
                );
                if (alreadyDone) continue;

                // Render tile
                const tileNum = ty * grid.tilesX + tx + 1;
                console.log(`\n[${tileNum}/${totalTiles}] Rendering tile [${tx}, ${ty}]`);

                // Emit tile start event
                this.currentTilePosition = { x: tx, y: ty };
                this.emitTileStart(tx, ty, tileNum - 1, totalTiles, grid);
                this.emitJobProgress();

                try {
                    await this.renderTile(tx, ty);

                    this.currentJob.completedTiles.push([tx, ty]);
                    this.currentJob.completedTileCount++;

                    // Emit tile complete event
                    this.emitTileComplete(tx, ty, tileNum - 1, totalTiles, grid);
                    this.emitJobProgress();

                } catch (error: any) {
                    if (error.name === 'RenderStopped') {
                        console.log(`Tile [${tx}, ${ty}] stopped`);
                        this.currentJob.state = 'paused';
                        this.currentTilePosition = null;
                        this.emitJobProgress();
                        return;
                    } else {
                        console.error(`Tile [${tx}, ${ty}] failed:`, error);
                        throw error;
                    }
                }
            }
        }

        this.currentTilePosition = null;
        this.completeJob();
    }

    private async renderTile(tx: number, ty: number): Promise<void> {
        if (!this.currentJob) return;

        const { config } = this.currentJob;
        const rect = this.tileRect(tx, ty);

        // Setup tile geometry:
        // 1. Resize framebuffer to this tile's (clamped) size
        this.app.resize(rect.width, rect.height);

        // 2. Set full image size (for correct aspect ratio/sampling)
        this.app.setImageSize(config.targetWidth, config.targetHeight);

        // 3. Set pixel offset (where this tile starts in full image)
        this.app.setPixelOffset(rect.x, rect.y);

        // Render using production mode
        // (automatically resets accumulation, locks params, renders to target)
        await this.app.renderProduction(config.samplesPerTile);

        // Save tile
        await this.saveTile(tx, ty, rect);
    }

    private completeJob(): void {
        if (!this.currentJob) return;

        this.currentJob.state = 'complete';

        const elapsed = (Date.now() - this.currentJob.startTime) / 1000;
        const totalTiles = this.currentJob.grid.tilesX * this.currentJob.grid.tilesY;

        console.log(`\n✓ Tiled render complete!`);
        console.log(`Total tiles: ${totalTiles}`);
        console.log(`Total time: ${(elapsed / 60).toFixed(1)} minutes`);
        console.log(`Avg per tile: ${(elapsed / totalTiles).toFixed(1)}s`);

        // Emit final progress
        this.emitJobProgress();
        this.bus.emit(AppEvents.TILED_JOB_COMPLETE, {
            jobId: this.currentJob.jobId,
            totalTiles,
            elapsedSeconds: elapsed
        });

        // Cleanup: restore normal rendering state
        this.app.clearPixelOffset();
        this.app.clearImageSize();
        this.app.resizeToWindow();

        // Clear accumulation and restart interactive rendering
        this.app.clearAccumulation();
        this.app.start();

        this.currentJob = null;
    }

    // ============================================================================
    // Private: File Operations
    // ============================================================================

    private async saveTile(tx: number, ty: number, rect: TileRect): Promise<void> {
        if (!this.currentJob) return;

        const { config, jobId } = this.currentJob;
        const filename = `${jobId}_tile_${String(tx).padStart(2, '0')}_${String(ty).padStart(2, '0')}_${config.samplesPerTile}spp`;

        // Check which exports are available
        const exports = this.app.getAvailableExports();

        if (config.format === 'hdr' || config.format === 'both') {
            if (exports.includes('hdr')) {
                const radiance = this.app.readExport('hdr') as Float32Array;
                saveHDRFile(radiance, rect.width, rect.height, `${filename}.hdr`);
            } else {
                console.warn('HDR export not available for current renderer');
            }
        }

        if (config.format === 'png' || config.format === 'both') {
            if (exports.includes('ldr')) {
                const rgb = this.app.readExport('ldr') as Uint8Array;
                savePNGFile(rgb, rect.width, rect.height, `${filename}.png`);
            } else {
                console.warn('LDR export not available for current renderer');
            }
        }

        console.log(`  ✓ Saved: ${filename}`);
    }

    private generateJobId(): string {
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');

        return `job_${year}_${month}${day}_${hours}${minutes}`;
    }

    private downloadJSON(data: any, filename: string): void {
        const json = JSON.stringify(data, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
    }

    // ============================================================================
    // Private: Event Emission
    // ============================================================================

    private emitTileStart(tx: number, ty: number, tileIndex: number, totalTiles: number, grid: TileGrid): void {
        const info: TileProgressInfo = {
            tileX: tx,
            tileY: ty,
            tileIndex,
            totalTiles,
            grid
        };
        this.bus.emit(AppEvents.TILE_START, info);
    }

    private emitTileComplete(tx: number, ty: number, tileIndex: number, totalTiles: number, grid: TileGrid): void {
        const info: TileProgressInfo = {
            tileX: tx,
            tileY: ty,
            tileIndex,
            totalTiles,
            grid
        };
        this.bus.emit(AppEvents.TILE_COMPLETE, info);
    }

    private emitJobProgress(): void {
        if (!this.currentJob) return;

        const { config, grid, completedTiles, completedTileCount, jobId } = this.currentJob;
        const totalTiles = grid.tilesX * grid.tilesY;

        const info: TiledJobProgressInfo = {
            jobId,
            grid,
            targetWidth: config.targetWidth,
            targetHeight: config.targetHeight,
            samplesPerTile: config.samplesPerTile,
            completedTiles: completedTileCount,
            totalTiles,
            completedPositions: [...completedTiles],
            currentTile: this.currentTilePosition
        };

        this.bus.emit(AppEvents.TILED_JOB_PROGRESS, info);
    }
}
