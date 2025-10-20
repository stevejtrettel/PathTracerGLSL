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
    currentTileNumber: number;
    completedTiles: [number, number][];
    completedTileCount: number;
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

        const tilesX = Math.ceil(targetWidth / targetTileSize);
        const tilesY = Math.ceil(targetHeight / targetTileSize);
        const tileWidth = Math.ceil(targetWidth / tilesX);
        const tileHeight = Math.ceil(targetHeight / tilesY);

        return { tilesX, tilesY, tileWidth, tileHeight };
    }

    /**
     * Start a new tiled render job
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
            currentTileNumber: 0,
            completedTiles: [],
            completedTileCount: 0,
            jobId: this.generateJobId(),
            startTime: Date.now(),
            state: 'running'
        };

        this.app.sessionManager.save(`${this.currentJob.jobId}_session.json`);
        this.renderNextTile();
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
        this.app.renderCoordinator.stop();

        const { completedTileCount, grid } = this.currentJob;
        const totalTiles = grid.tilesX * grid.tilesY;

        console.log(`Job paused at tile ${this.currentJob.currentTileNumber}`);
        console.log(`Completed: ${completedTileCount}/${totalTiles}`);
    }

    /**
     * Resume job from session
     */
    resumeJob(job: TileJob): void {
        // Convert tile number to grid coordinates if needed
        if (job.currentTileNumber !== undefined) {
            job.currentTile = this.tileNumberToCoords(job.currentTileNumber, job.grid.tilesX);
        }

        this.currentJob = job;
        this.currentJob.state = 'running';

        const totalTiles = job.grid.tilesX * job.grid.tilesY;
        console.log(`Resuming from tile ${job.currentTileNumber} [${job.currentTile}]`);
        console.log(`Completed: ${job.completedTileCount}/${totalTiles}`);

        this.renderNextTile();
    }

    // ============================================================================
    // Private: Rendering
    // ============================================================================

    private async renderNextTile(): Promise<void> {
        if (!this.currentJob || this.currentJob.state !== 'running') return;

        const [tx, ty] = this.currentJob.currentTile;
        const { grid, config } = this.currentJob;

        if (ty >= grid.tilesY) {
            this.completeJob();
            return;
        }

        const totalTiles = grid.tilesX * grid.tilesY;
        console.log(`\n[${this.currentJob.completedTileCount + 1}/${totalTiles}] Tile ${this.currentJob.currentTileNumber} [${tx}, ${ty}]`);

        // Setup rendering environment
        this.app.handleResize(grid.tileWidth, grid.tileHeight);
        this.app.engine.setImageSize(config.targetWidth, config.targetHeight);
        this.app.engine.setPixelOffset(tx * grid.tileWidth, ty * grid.tileHeight);

        // Render tile
        this.app.renderCoordinator.resetAccumulation('tile_start');
        await this.renderToCompletion(config.samplesPerTile);

        // Save and advance
        await this.saveTile(tx, ty);
        this.currentJob.completedTiles.push([tx, ty]);
        this.currentJob.completedTileCount++;
        this.advanceToNextTile();

        // Continue
        this.renderNextTile();
    }

    private async renderToCompletion(targetSamples: number): Promise<void> {
        return new Promise<void>((resolve) => {
            const checkComplete = () => {
                if (this.app.engine.sampleCount >= targetSamples) {
                    this.app.renderCoordinator.stop();
                    resolve();
                } else {
                    requestAnimationFrame(checkComplete);
                }
            };

            if (!this.app.renderCoordinator.isRunning()) {
                this.app.renderCoordinator.start();
            }

            checkComplete();
        });
    }

    private advanceToNextTile(): void {
        if (!this.currentJob) return;

        const [tx, ty] = this.currentJob.currentTile;
        const { tilesX } = this.currentJob.grid;

        let nextX = tx + 1;
        let nextY = ty;

        if (nextX >= tilesX) {
            nextX = 0;
            nextY++;
        }

        this.currentJob.currentTile = [nextX, nextY];
        this.currentJob.currentTileNumber = this.coordsToTileNumber(nextX, nextY, tilesX);
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
        const executor = this.app.engine['executor'];
        const filename = `${jobId}_tile_${String(tx).padStart(2, '0')}_${String(ty).padStart(2, '0')}_${config.samplesPerTile}spp`;

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

    private generateJobId(): string {
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');

        return `job_${year}_${month}${day}_${hours}${minutes}`;
    }

    // ============================================================================
    // Private: Helpers
    // ============================================================================

    private tileNumberToCoords(tileNumber: number, tilesX: number): [number, number] {
        const tx = tileNumber % tilesX;
        const ty = Math.floor(tileNumber / tilesX);
        return [tx, ty];
    }

    private coordsToTileNumber(tx: number, ty: number, tilesX: number): number {
        return ty * tilesX + tx;
    }
}
