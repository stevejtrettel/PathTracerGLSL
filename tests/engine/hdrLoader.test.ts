import { describe, it, expect } from 'vitest';
import { HDRLoader } from '../../src/engine/loaders/hdr-loader.js';

/** Build an uncompressed (raw, non-RLE) .hdr buffer from a dimension line + RGBE bytes. */
function rawHDR(dimLine: string, pixels: number[]): ArrayBuffer {
    const header = new TextEncoder().encode(`#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n${dimLine}\n`);
    const buf = new Uint8Array(header.length + pixels.length);
    buf.set(header, 0);
    buf.set(pixels, header.length);
    return buf.buffer;
}

describe('HDRLoader.parse', () => {
    it('parses dimensions and decodes a single raw RGBE pixel', () => {
        // RGBE (128,0,0,128): scale = 2^(128-128) = 1 → R = 128/255
        const hdr = HDRLoader.parse(rawHDR('-Y 1 +X 1', [128, 0, 0, 128]));
        expect(hdr.width).toBe(1);
        expect(hdr.height).toBe(1);
        expect(hdr.data).toHaveLength(3);
        expect(hdr.data[0]).toBeCloseTo(128 / 255, 5);
        expect(hdr.data[1]).toBe(0);
        expect(hdr.data[2]).toBe(0);
    });

    it('applies the RGBE exponent scale', () => {
        // E = 129 → scale = 2^1 = 2 → R = (128/255) * 2
        const hdr = HDRLoader.parse(rawHDR('-Y 1 +X 1', [128, 0, 0, 129]));
        expect(hdr.data[0]).toBeCloseTo((128 / 255) * 2, 5);
    });

    it('reads the width from the resolution line and decodes multiple pixels', () => {
        const hdr = HDRLoader.parse(rawHDR('-Y 1 +X 2', [64, 0, 0, 128, 0, 64, 0, 128]));
        expect(hdr.width).toBe(2);
        expect(hdr.height).toBe(1);
        expect(hdr.data[0]).toBeCloseTo(64 / 255, 5); // pixel 0 red
        expect(hdr.data[4]).toBeCloseTo(64 / 255, 5); // pixel 1 green
    });

    it('throws when the resolution line is missing', () => {
        const header = new TextEncoder().encode('#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n').buffer;
        expect(() => HDRLoader.parse(header)).toThrow(/dimensions/i);
    });
});
