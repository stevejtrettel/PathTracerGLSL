import { describe, it, expect } from 'vitest';
import { TiledRenderer } from '../../src/app/TiledRenderer.js';
import type { App } from '../../src/app/App.js';
import type { EventBus } from '../../src/app/EventBus.js';
import type { TileJobConfig } from '../../src/app/TiledRenderer.js';

// The constructor only stores its args — no DOM/GL — so fakes are fine.
function makeTiled() {
    return new TiledRenderer({} as App, {} as EventBus);
}

const config = (over: Partial<TileJobConfig>): TileJobConfig => ({
    targetWidth: 1024,
    targetHeight: 1024,
    targetTileSize: 512,
    samplesPerTile: 16,
    format: 'hdr',
    ...over,
});

describe('calculateGrid', () => {
    it('uses the requested tile size as a fixed stride', () => {
        const g = makeTiled().calculateGrid(config({ targetWidth: 1024, targetHeight: 768, targetTileSize: 512 }));
        expect(g).toEqual({ tilesX: 2, tilesY: 2, tileWidth: 512, tileHeight: 512 });
    });

    it('ceils the tile count for a non-divisible image', () => {
        const g = makeTiled().calculateGrid(config({ targetWidth: 1030, targetHeight: 1030, targetTileSize: 512 }));
        expect(g.tilesX).toBe(3); // ceil(1030/512)
        expect(g.tilesY).toBe(3);
        expect(g.tileWidth).toBe(512);
    });
});

describe('tileRect (edge clamping)', () => {
    // tileRect is private and reads currentJob; fabricate a job to exercise the clamp math.
    function tileRect(cfg: TileJobConfig, tx: number, ty: number) {
        const tr = makeTiled();
        const grid = tr.calculateGrid(cfg);
        (tr as unknown as { currentJob: unknown }).currentJob = { config: cfg, grid };
        return (tr as unknown as { tileRect(x: number, y: number): { x: number; y: number; width: number; height: number } }).tileRect(tx, ty);
    }

    it('interior tiles get the full nominal size', () => {
        const cfg = config({ targetWidth: 1030, targetHeight: 1030, targetTileSize: 512 });
        expect(tileRect(cfg, 0, 0)).toEqual({ x: 0, y: 0, width: 512, height: 512 });
    });

    it('edge tiles are clamped to the image bounds (no overrun)', () => {
        const cfg = config({ targetWidth: 1030, targetHeight: 1030, targetTileSize: 512 });
        // Last tile starts at 1024, so only 6px remain.
        expect(tileRect(cfg, 2, 2)).toEqual({ x: 1024, y: 1024, width: 6, height: 6 });
    });

    it('tiles exactly cover the image with no overrun', () => {
        const cfg = config({ targetWidth: 1030, targetHeight: 1030, targetTileSize: 512 });
        const grid = makeTiled().calculateGrid(cfg);
        let coveredW = 0;
        for (let tx = 0; tx < grid.tilesX; tx++) coveredW += tileRect(cfg, tx, 0).width;
        expect(coveredW).toBe(1030);
    });
});
