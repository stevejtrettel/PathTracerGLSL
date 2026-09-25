// app/tiling.ts — the arithmetic of a tiled render (TiledRenderer), kept pure for tests.
//
// Coordinates are the ENGINE's: a tile's (x, y) is its offset into the full image with y
// counted from the BOTTOM row, because that is what engine.pixelOffset adds to
// gl_FragCoord (whose origin is the lower-left corner). Readbacks (readPixels) also come
// bottom row first. The stitched image is stored TOP row first — the order both file
// formats want.
//
// Why tiling is invisible in the output: the path-tracing RNG seeds with the global pixel
// (accumulators add u_pixelOffset), cameras map the global film point through
// engine.imageSize, and TiledRenderer pins the RNG salt for the whole job. So each pixel
// computes exactly what it would in one full-size render.

/** Tile offsets are multiples of this. The display pass dithers with a 64×64 blue-noise
 *  tile read at the LOCAL fragment coordinate, so an offset that is a multiple of 64
 *  dithers exactly as the untiled image would. */
export const TILE_ALIGN = 64;

export interface Tile {
    /** Grid column, left to right. */
    col: number;
    /** Grid row, TOP to bottom (display order; the engine's y runs the other way). */
    row: number;
    /** Offset into the full image in engine coordinates (y from the bottom). */
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface TilePlan {
    cols: number;
    rows: number;
    /** The tile stride: the requested size rounded up to TILE_ALIGN. */
    size: number;
    /** Every tile, top row first, left to right within a row. */
    tiles: Tile[];
}

/** Cover a width×height image with tiles. The grid is anchored at the engine origin (lower
 *  left), so every offset is a multiple of the stride; the tiles in the last column and the
 *  TOP row are cut to the image. */
export function planTiles(width: number, height: number, tileSize: number): TilePlan {
    for (const [name, v] of [['width', width], ['height', height], ['tileSize', tileSize]] as const) {
        if (!Number.isInteger(v) || v < 1) throw new Error(`planTiles: ${name} must be a positive integer (got ${v})`);
    }
    const size = Math.ceil(tileSize / TILE_ALIGN) * TILE_ALIGN;
    const cols = Math.ceil(width / size);
    const rows = Math.ceil(height / size);
    const tiles: Tile[] = [];
    for (let row = 0; row < rows; row++) {
        const y = (rows - 1 - row) * size;
        for (let col = 0; col < cols; col++) {
            const x = col * size;
            tiles.push({
                col, row, x, y,
                width: Math.min(size, width - x),
                height: Math.min(size, height - y),
            });
        }
    }
    return { cols, rows, size, tiles };
}

/** Copy one tile's pixels — 4 bytes each, bottom row first, as read back — into the full
 *  image, which is stored top row first. */
export function placeTile(image: Uint8Array, imageWidth: number, imageHeight: number, tile: Tile, pixels: Uint8Array): void {
    const rowBytes = tile.width * 4;
    if (pixels.length !== rowBytes * tile.height) {
        throw new Error(`placeTile: expected ${rowBytes * tile.height} bytes for a ${tile.width}×${tile.height} tile, got ${pixels.length}`);
    }
    for (let r = 0; r < tile.height; r++) {
        const imageRow = imageHeight - 1 - (tile.y + r);
        image.set(pixels.subarray(r * rowBytes, (r + 1) * rowBytes), (imageRow * imageWidth + tile.x) * 4);
    }
}
