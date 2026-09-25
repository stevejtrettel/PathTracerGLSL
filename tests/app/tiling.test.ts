// The arithmetic of a tiled render: which tiles cover the image, and where each tile's
// read-back pixels land in the stitched image.

import { describe, it, expect } from 'vitest';
import { planTiles, placeTile, TILE_ALIGN, type Tile } from '../../src/app/tiling.js';

describe('planTiles', () => {
    it('covers the image exactly once', () => {
        for (const [w, h, size] of [[1030, 700, 512], [64, 64, 64], [1, 1, 1024], [4000, 2250, 1000]]) {
            const plan = planTiles(w, h, size);
            const hits = new Uint8Array(w * h);
            for (const t of plan.tiles) {
                for (let y = t.y; y < t.y + t.height; y++) for (let x = t.x; x < t.x + t.width; x++) hits[y * w + x]++;
            }
            expect(hits.every(n => n === 1)).toBe(true);
            expect(plan.tiles.length).toBe(plan.cols * plan.rows);
        }
    });

    it('puts every offset on the 64-pixel dither grid, rounding the tile size up', () => {
        const plan = planTiles(1030, 700, 500);
        expect(plan.size).toBe(512);
        for (const t of plan.tiles) {
            expect(t.x % TILE_ALIGN).toBe(0);
            expect(t.y % TILE_ALIGN).toBe(0);
        }
    });

    it('cuts the last column and the TOP row (the grid is anchored at the lower left)', () => {
        const plan = planTiles(1030, 700, 512);
        expect([plan.cols, plan.rows]).toEqual([3, 2]);
        const at = (col: number, row: number) => plan.tiles.find(t => t.col === col && t.row === row)!;
        expect(at(0, 1)).toMatchObject({ x: 0, y: 0, width: 512, height: 512 });      // bottom-left
        expect(at(2, 1)).toMatchObject({ x: 1024, y: 0, width: 6, height: 512 });
        expect(at(0, 0)).toMatchObject({ x: 0, y: 512, width: 512, height: 188 });    // top row
        expect(plan.tiles[0]).toMatchObject({ col: 0, row: 0 });                       // top row first
    });

    it('rejects non-positive or fractional sizes', () => {
        expect(() => planTiles(0, 10, 64)).toThrow(/width/);
        expect(() => planTiles(10, 10.5, 64)).toThrow(/height/);
        expect(() => planTiles(10, 10, 0)).toThrow(/tileSize/);
    });
});

describe('placeTile', () => {
    // Stitch a whole image from tiles and compare with the image read back in one piece.
    // Pixel value = its (x, y) in engine coordinates (y from the bottom), so any misplaced
    // row or column shows.
    it('reassembles tiles into the one-piece image, top row first', () => {
        const W = 150, H = 100;
        const plan = planTiles(W, H, 64);
        const pixel = (x: number, y: number) => [x & 0xff, y & 0xff, (x >> 8) | ((y >> 8) << 4), 255];

        // The one-piece readback is bottom row first; the stitched image is top row first.
        const expected = new Uint8Array(W * H * 4);
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) expected.set(pixel(x, y), ((H - 1 - y) * W + x) * 4);

        const image = new Uint8Array(W * H * 4);
        for (const t of plan.tiles) placeTile(image, W, H, t, readTile(t, pixel));
        expect(Buffer.from(image).equals(Buffer.from(expected))).toBe(true);
    });

    it('rejects a readback of the wrong size', () => {
        const tile: Tile = { col: 0, row: 0, x: 0, y: 0, width: 4, height: 4 };
        expect(() => placeTile(new Uint8Array(64), 4, 4, tile, new Uint8Array(60))).toThrow(/expected 64 bytes/);
    });
});

/** What readPixels returns for one tile: its rows bottom first, 4 bytes a pixel. */
function readTile(t: Tile, pixel: (x: number, y: number) => number[]): Uint8Array {
    const out = new Uint8Array(t.width * t.height * 4);
    for (let r = 0; r < t.height; r++) {
        for (let c = 0; c < t.width; c++) out.set(pixel(t.x + c, t.y + r), (r * t.width + c) * 4);
    }
    return out;
}
