// app/TiledRenderer.ts
import type { App } from './App';
import { saveHDRFile, savePNGFile } from './utils/file-export';

export interface TileJobConfig {
    targetWidth: number;
    targetHeight: number;
    targetTileSize: number;
    samplesPerTile: number;
    format: 'hdr' | 'png' | 'both';
}

export interface TileGrid {
    tilesX: number;
    tilesY: number;
    tileWidth: number;
    tileHeight: number;
}

export interface TileJob {
    config: TileJobConfig;
    grid: TileGrid;
    completedTiles: [number, number][];
    completedTileCount: number;
    jobId: string;
    startTime: number;
    state: 'running' | 'paused' | 'complete';
}

/**
 * TiledRenderer - Production rendering with tiled output
 *
 * Uses production mode internally for each tile, providing
 * automatic parameter locking and clean error handling.
 */
export class TiledRenderer {
    private app: App;
    private currentJob: TileJob | null = null;

    constructor(app: App) {
        this.app = app;
    }

    /**
     * Calculate evenly-dividing tile grid
     */
    calculateGrid(config: TileJobConfig): TileGrid {
        const { targetWidth, targetHeight, targetTileSize } = config;

        const tilesX = Math.ceil(targetWidth / targetTileSize);
        const tilesY = Math.ceil(targetHeight / targetTileSize);
        const tileWidth = Math.ceil(targetWidth / tilesX);
        const tileHeight = Math.ceil(targetHeight / tilesY);

        return { tilesX, tilesY, tileWidth, tileHeight };
    }

    /**
     * Start a new tiled render job
     */
    async startJob(config: TileJobConfig): Promise<void> {
        if (this.currentJob) {
            throw new Error('Job already running');
        }

        const grid = this.calculateGrid(config);

        console.log(`\n=== Starting Tiled Render Job ===`);
        console.log(`Target: ${config.targetWidth}×${config.targetHeight}`);
        console.log(`Grid: ${grid.tilesX}×${grid.tilesY} tiles of ${grid.tileWidth}×${grid.tileHeight}`);
        console.log(`Total: ${grid.tilesX * grid.tilesY} tiles`);
        console.log(`Samples per tile: ${config.samplesPerTile}`);

        this.currentJob = {
            config,
            grid,
            completedTiles: [],
            completedTileCount: 0,
            jobId: this.generateJobId(),
            startTime: Date.now(),
            state: 'running'
        };

        await this.app.sessionManager.save(`${this.currentJob.jobId}_session.json`);
        await this.renderAllTiles();
    }

    /**
     * Get current job state
     */
    getCurrentJob(): TileJob | null {
        return this.currentJob;
    }

    /**
     * Stop current job
     */
    stopJob(): void {
        if (!this.currentJob) return;

        this.currentJob.state = 'paused';
        this.app.stop();  // Stop current tile render

        const { completedTileCount, grid } = this.currentJob;
        const totalTiles = grid.tilesX * grid.tilesY;

        console.log(`Job paused`);
        console.log(`Completed: ${completedTileCount}/${totalTiles} tiles`);
    }

    /**
     * Resume job from session
     */
    async resumeJob(job: TileJob): Promise<void> {
        this.currentJob = job;
        this.currentJob.state = 'running';

        const totalTiles = job.grid.tilesX * job.grid.tilesY;
        console.log(`Resuming tile job`);
        console.log(`Completed: ${job.completedTileCount}/${totalTiles} tiles`);

        await this.renderAllTiles();
    }

    // ============================================================================
    // Private: Rendering
    // ============================================================================

    private async renderAllTiles(): Promise<void> {
        if (!this.currentJob) return;

        const { grid } = this.currentJob;
        const totalTiles = grid.tilesX * grid.tilesY;

        for (let ty = 0; ty < grid.tilesY; ty++) {
            for (let tx = 0; tx < grid.tilesX; tx++) {
                // Check if job was stopped
                if (!this.currentJob || this.currentJob.state !== 'running') {
                    console.log('Tile job stopped');
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

                try {
                    await this.renderTile(tx, ty);

                    this.currentJob.completedTiles.push([tx, ty]);
                    this.currentJob.completedTileCount++;

                } catch (error: any) {
                    if (error.name === 'RenderStopped') {
                        console.log(`Tile [${tx}, ${ty}] stopped`);
                        this.currentJob.state = 'paused';
                        return;
                    } else {
                        console.error(`Tile [${tx}, ${ty}] failed:`, error);
                        throw error;
                    }
                }
            }
        }

        this.completeJob();
    }

    private async renderTile(tx: number, ty: number): Promise<void> {
        if (!this.currentJob) return;

        const { grid, config } = this.currentJob;

        // Setup tile geometry
        this.app.handleResize(grid.tileWidth, grid.tileHeight);
        this.app.engine.setImageSize(config.targetWidth, config.targetHeight);
        this.app.engine.setPixelOffset(tx * grid.tileWidth, ty * grid.tileHeight);

        // Render using production mode (automatically resets, locks, renders to target)
        await this.app.renderProduction(config.samplesPerTile);

        // Save tile
        await this.saveTile(tx, ty);
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

        // Cleanup
        this.app.engine.clearPixelOffset();
        this.app.engine.clearImageSize();
        this.app.handleResize(window.innerWidth, window.innerHeight);

        this.currentJob = null;
    }

    // ============================================================================
    // Private: File Operations
    // ============================================================================

    private async saveTile(tx: number, ty: number): Promise<void> {
        if (!this.currentJob) return;

        const { config, grid, jobId } = this.currentJob;
        const filename = `${jobId}_tile_${String(tx).padStart(2, '0')}_${String(ty).padStart(2, '0')}_${config.samplesPerTile}spp`;

        if (config.format === 'hdr' || config.format === 'both') {
            const radiance = this.app.engine.readRadiance();
            saveHDRFile(radiance, grid.tileWidth, grid.tileHeight, `${filename}.hdr`);
        }

        if (config.format === 'png' || config.format === 'both') {
            const rgb = this.app.engine.readRGB();
            savePNGFile(rgb, grid.tileWidth, grid.tileHeight, `${filename}.png`);
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
}
