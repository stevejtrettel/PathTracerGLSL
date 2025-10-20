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
    currentTile: [number, number];
    completedTiles: [number, number][];
    jobId: string;
    startTime: number;
    state: 'running' | 'paused' | 'complete';
}

/**
 * TiledRenderer - Production rendering with tiled output
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

        // Number of tiles (round up)
        const tilesX = Math.ceil(targetWidth / targetTileSize);
        const tilesY = Math.ceil(targetHeight / targetTileSize);

        // Actual tile size (divide evenly)
        const tileWidth = Math.ceil(targetWidth / tilesX);
        const tileHeight = Math.ceil(targetHeight / tilesY);

        return {
            tilesX,
            tilesY,
            tileWidth,
            tileHeight
        };
    }

    /**
     * Start a new tiled render job (auto-renders all tiles)
     */
    startJob(config: TileJobConfig): void {
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
            currentTile: [0, 0],
            completedTiles: [],
            jobId: this.generateJobId(),
            startTime: Date.now(),
            state: 'running'
        };

        // Start rendering tiles automatically
        this.renderNextTile();
    }

    /**
     * Get current job (for session saving)
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
        this.app.renderCoordinator.stop();

        console.log(`Job paused at tile [${this.currentJob.currentTile}]`);
        console.log(`Completed: ${this.currentJob.completedTiles.length}/${this.currentJob.grid.tilesX * this.currentJob.grid.tilesY}`);
    }

    /**
     * Resume a job from session
     */
    resumeJob(job: TileJob): void {
        this.currentJob = job;
        console.log(`Resuming tiled render from tile [${job.currentTile}]`);
        console.log(`Completed: ${job.completedTiles.length}/${job.grid.tilesX * job.grid.tilesY} tiles`);

        this.renderNextTile();
    }

    // ============================================================================
    // Private: Auto-Continuation
    // ============================================================================

    /**
     * Render next tile in sequence (recursive)
     */
    private async renderNextTile(): Promise<void> {
        if (!this.currentJob || this.currentJob.state !== 'running') return;

        const [tx, ty] = this.currentJob.currentTile;
        const { grid, config } = this.currentJob;

        if (ty >= grid.tilesY) {
            this.completeJob();
            return;
        }

        console.log(`\n[${this.currentJob.completedTiles.length + 1}/${grid.tilesX * grid.tilesY}] Rendering tile [${tx}, ${ty}]...`);

        // 1. Resize framebuffer to tile dimensions
        this.app.handleResize(grid.tileWidth, grid.tileHeight);

        // 2. Set full image size (camera needs this!)
        this.app.engine.setImageSize(config.targetWidth, config.targetHeight);

        // 3. Set pixel offset
        const offsetX = tx * grid.tileWidth;
        const offsetY = ty * grid.tileHeight;
        this.app.engine.setPixelOffset(offsetX, offsetY);

        console.log(`  Framebuffer: ${grid.tileWidth}×${grid.tileHeight}`);
        console.log(`  Image size: ${config.targetWidth}×${config.targetHeight}`);
        console.log(`  Offset: [${offsetX}, ${offsetY}]`);

        // 4. Clear and render
        this.app.renderCoordinator.resetAccumulation('tile_start');
        await this.renderToCompletion(config.samplesPerTile);

        // 5. Read and save tile
        await this.saveTile(tx, ty);

        // 6. Mark complete and advance
        this.currentJob.completedTiles.push([tx, ty]);
        this.advanceToNextTile();

        // 7. Continue to next tile
        this.renderNextTile();
    }

    /**
     * Wait for rendering to reach target samples
     */
    private async renderToCompletion(targetSamples: number): Promise<void> {
        return new Promise<void>((resolve) => {
            const checkComplete = () => {
                const current = this.app.engine.sampleCount;

                if (current >= targetSamples) {
                    this.app.renderCoordinator.stop();
                    resolve();
                } else {
                    requestAnimationFrame(checkComplete);
                }
            };

            // Only start if not already running
            if (!this.app.renderCoordinator.isRunning()) {
                this.app.renderCoordinator.start();
            }

            checkComplete();
        });
    }

    /**
     * Advance to next tile position
     */
    private advanceToNextTile(): void {
        const [tx, ty] = this.currentJob!.currentTile;
        const { tilesX } = this.currentJob!.grid;

        let nextX = tx + 1;
        let nextY = ty;

        if (nextX >= tilesX) {
            nextX = 0;
            nextY++;
        }

        this.currentJob!.currentTile = [nextX, nextY];
    }

    /**
     * Job complete
     */
    private completeJob(): void {
        if (!this.currentJob) return;

        this.currentJob.state = 'complete';

        const elapsed = (Date.now() - this.currentJob.startTime) / 1000;
        const totalTiles = this.currentJob.grid.tilesX * this.currentJob.grid.tilesY;

        console.log(`\n✓ Tiled render complete!`);
        console.log(`Total tiles: ${totalTiles}`);
        console.log(`Total time: ${(elapsed / 60).toFixed(1)} minutes`);
        console.log(`Avg per tile: ${(elapsed / totalTiles).toFixed(1)}s`);

        // Clear tiling state
        this.app.engine.clearPixelOffset();
        this.app.engine.clearImageSize();  // ADD THIS

        // Restore normal resolution
        this.app.handleResize(window.innerWidth, window.innerHeight);

        this.currentJob = null;
    }

    // ============================================================================
    // Private: File Saving
    // ============================================================================

    /**
     * Save tile as HDR and/or PNG
     */
    private async saveTile(tx: number, ty: number): Promise<void> {
        const { config, grid, jobId } = this.currentJob!;
        const executor = this.app.engine['executor'];

        // Generate filename
        const filename = `${jobId}_tile_${String(tx).padStart(2, '0')}_${String(ty).padStart(2, '0')}_${config.samplesPerTile}spp`;

        // Save based on format
        if (config.format === 'hdr' || config.format === 'both') {
            const radiance = executor.readRadiance();
            saveHDRFile(radiance, grid.tileWidth, grid.tileHeight, `${filename}.hdr`);
        }

        if (config.format === 'png' || config.format === 'both') {
            const display = executor.readDisplay();
            savePNGFile(display, grid.tileWidth, grid.tileHeight, `${filename}.png`);
        }

        console.log(`  ✓ Saved: ${filename}`);
    }

    /**
     * Generate unique job ID for file naming
     */
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
