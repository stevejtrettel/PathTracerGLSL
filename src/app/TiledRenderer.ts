// app/TiledRenderer.ts — large images, rendered in tiles and saved as ONE file.
//
// An image larger than the screen (an 8K still, a poster) is split into tiles. The canvas
// is resized to one tile at a time; each tile is rendered to the full sample count and read
// back, and the pieces are stitched on the CPU into one file per requested save (a picture
// in a format, app/capture.ts), each carrying the full image's stamp. Tiling bounds the work in one draw call (a full 8K frame of a heavy
// scene can outlast the GPU watchdog and lose the context) and the GPU memory the
// accumulation buffers need.
//
// Tiling does not change the image (tiling.ts says why): rendering the stamped scene at the
// stamped size in one piece, with the stamped salt pinned, reproduces it bit for bit.
//
// Memory: each requested save is held stitched at 4 bytes per pixel (RGBE for HDR, RGBA for
// PNG) — 133 MB each at 7680×4320. All are allocated before the first tile, so a size the
// browser cannot hold fails at once rather than after hours of rendering.
//
// Not resumable: stopping discards the job, since the partial image lives only in memory.

import type { App } from './App.js';
import type { EventBus } from './EventBus.js';
import type { ProductionOrchestrator } from './ProductionOrchestrator.js';
import { AppEvents } from './events.js';
import { planTiles, placeTile } from './tiling.js';
import { floatToRGBE, hdrHeader, encodePNG, downloadBlob } from './utils/file-export.js';
import { validateSaves, type SaveRequest } from './capture.js';

export interface TiledRenderConfig {
    /** Full image size in pixels. */
    width: number;
    height: number;
    /** Samples per pixel. */
    spp: number;
    /** What to save: each entry is one file. Validated before the first tile. */
    save: SaveRequest[];
    /** Tile edge in pixels, rounded up to a multiple of 64 (default 1024). Smaller tiles
     *  put less work in each draw call; larger ones finish sooner, because the render loop
     *  draws one sample per animation frame, however small the tile. */
    tileSize?: number;
}

export const DEFAULT_TILE_SIZE = 1024;

/** Payload of TILED_JOB_PROGRESS. Tiles are named [col, row], rows counted from the top. */
export interface TiledJobProgressInfo {
    width: number;
    height: number;
    spp: number;
    cols: number;
    rows: number;
    completedTiles: number;
    totalTiles: number;
    completed: [number, number][];
    /** The tile rendering now; null once the last one is done. */
    current: [number, number] | null;
}

/** Payload of TILED_JOB_COMPLETE. */
export interface TiledJobCompleteInfo {
    files: string[];
    elapsedSeconds: number;
}

export class TiledRenderer {
    private readonly app: App;
    private readonly production: ProductionOrchestrator;
    private readonly bus: EventBus;
    private job: TiledJobProgressInfo | null = null;

    constructor(app: App, production: ProductionOrchestrator, bus: EventBus) {
        this.app = app;
        this.production = production;
        this.bus = bus;
    }

    isActive(): boolean { return this.job !== null; }

    /** Render and save. Resolves once the files are handed to the browser; rejects with
     *  RenderStoppedError if stopped (nothing is saved). */
    async render(config: TiledRenderConfig): Promise<void> {
        if (this.job) throw new Error('A tiled render is already running');
        const { width, height, spp, save } = config;
        if (!Number.isInteger(spp) || spp < 1) throw new Error(`Tiled render: spp must be a positive integer (got ${spp})`);
        const plan = planTiles(width, height, config.tileSize ?? DEFAULT_TILE_SIZE);
        validateSaves(this.app.getPictureFormats(), save);
        // One stitched image per save: RGBE for 'hdr', RGBA for 'png', top row first.
        const images = save.map((request) => ({ request, pixels: new Uint8Array(width * height * 4) }));

        // One salt for the whole job, so the stamp can record it: every tile resets
        // accumulation, which would otherwise draw a new salt per tile. A pin the user
        // already set is kept.
        const pinned = this.app.getPinnedResetSalt();
        this.app.pinResetSalt(pinned ?? this.app.getResetSalt() + 1);

        const first = plan.tiles[0];
        const job: TiledJobProgressInfo = this.job = {
            width, height, spp,
            cols: plan.cols, rows: plan.rows,
            completedTiles: 0, totalTiles: plan.tiles.length,
            completed: [], current: [first.col, first.row],
        };
        const started = performance.now();
        console.log(`Tiled render: ${width}×${height} at ${spp} spp, ${plan.cols}×${plan.rows} tiles of ${plan.size}px`);

        try {
            this.emitProgress();
            await this.production.renderTiles([width, height], plan.tiles, spp, (tile, index) => {
                for (const { request, pixels } of images) {
                    const captured = this.app.capture(request);
                    placeTile(pixels, width, height, tile,
                        captured.format === 'hdr' ? floatToRGBE(captured.pixels, tile.width, tile.height) : captured.pixels);
                }
                job.completed.push([tile.col, tile.row]);
                job.completedTiles++;
                const next = plan.tiles[index + 1];
                job.current = next ? [next.col, next.row] : null;
                this.emitProgress();
            });

            const timestamp = fileTimestamp();
            const files: string[] = [];
            for (const { request: { picture, format }, pixels } of images) {
                const stamp = this.app.buildRenderStamp(picture, { resolution: [width, height], spp });
                const name = `render_${timestamp}_${picture}_${width}x${height}_${spp}spp.${format}`;
                if (format === 'hdr') {
                    downloadBlob(new Blob([hdrHeader(width, height, stamp), pixels] as BlobPart[], { type: 'application/octet-stream' }), name);
                } else {
                    const rowBytes = width * 4;
                    downloadBlob(await encodePNG(width, height, (y) => pixels.subarray(y * rowBytes, (y + 1) * rowBytes), stamp), name);
                }
                files.push(name);
            }
            const elapsedSeconds = (performance.now() - started) / 1000;
            console.log(`Tiled render complete in ${(elapsedSeconds / 60).toFixed(1)} min: ${files.join(', ')}`);
            const info: TiledJobCompleteInfo = { files, elapsedSeconds };
            this.bus.emit(AppEvents.TILED_JOB_COMPLETE, info);
        } finally {
            this.app.pinResetSalt(pinned);
            this.job = null;
        }
    }

    private emitProgress(): void {
        if (this.job) this.bus.emit(AppEvents.TILED_JOB_PROGRESS, { ...this.job, completed: [...this.job.completed] });
    }
}

function fileTimestamp(): string {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
}
