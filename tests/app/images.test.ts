// The App's image-texture loader, through its pure helpers: the PNG bit-depth check (browsers
// decode a 16-bit PNG to 8 bits without saying so) and the one-layer-size rule of the array.
import { describe, it, expect } from 'vitest';
import { pngBitDepth, layerSizeProblem } from '../../src/app/images.js';
import { encodePng } from '../witnesses/scenes/png.js';

/** The first 33 bytes of a PNG: signature, then the IHDR chunk (length, type, 13 data bytes). */
function pngHeader(width: number, height: number, depth: number, colorType: number): Uint8Array {
    const be = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
    return new Uint8Array([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
        ...be(13), 0x49, 0x48, 0x44, 0x52, ...be(width), ...be(height), depth, colorType, 0, 0, 0,
    ]);
}

describe('pngBitDepth', () => {
    it("reads 16 from a 16-bit RGB header (Poly Haven's 2k PNG maps: 2048 × 2048, depth 16, color type 2)", () => {
        expect(pngBitDepth(pngHeader(2048, 2048, 16, 2))).toBe(16);
    });

    it('reads 8 from an 8-bit PNG', () => {
        expect(pngBitDepth(encodePng([[0, 255], [128, 64]]))).toBe(8);
    });

    it('is null for a file that is not a PNG (a JPEG starts FF D8 FF)', () => {
        expect(pngBitDepth(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46]))).toBeNull();
    });
});

describe('layerSizeProblem', () => {
    it('accepts images of one size', () => {
        expect(layerSizeProblem([{ url: 'a.jpg', width: 2048, height: 2048 }, { url: 'b.jpg', width: 2048, height: 2048 }])).toBeNull();
    });

    it('names every image and its size when the sizes differ', () => {
        const problem = layerSizeProblem([{ url: 'a.jpg', width: 2048, height: 2048 }, { url: 'b.jpg', width: 4096, height: 4096 }]);
        expect(problem).toMatch(/a\.jpg 2048×2048/);
        expect(problem).toMatch(/b\.jpg 4096×4096/);
    });
});
