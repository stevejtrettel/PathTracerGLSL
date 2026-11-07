// The image-texture field (src/glsl/shared/image_texture.glsl) through its TS twin, and the PNG
// encoder the witness fixtures build their images with. The GLSL itself is held to these values
// on a GPU by the image-texture witnesses (tests/witnesses/scenes/imageTextureWitness.ts).
import { describe, it, expect } from 'vitest';
import { inflateSync } from 'node:zlib';
import { imageTextureTwin, quadrantMean, srgbDecode, type CodeTable, type Quadrant } from './imageTextureTwin.js';
import { encodePng } from '../witnesses/scenes/png.js';
import { TEXTURE_CODES } from '../witnesses/scenes/imageTextureWitness.js';

const CODES: CodeTable = TEXTURE_CODES.g;
const QUADRANTS: Record<Quadrant, [number, number, number, number]> = {
    'bottom-left': [0, 0.5, 0, 0.5], 'bottom-right': [0.5, 1, 0, 0.5],
    'top-left': [0, 0.5, 0.5, 1], 'top-right': [0.5, 1, 0.5, 1],
};

/** Midpoint rule on an N × N grid. The field is bilinear on cells a quarter texel wide, and N is a
 *  multiple of 4·W per unit of uv, so the rule is exact up to rounding. */
function integrate(f: (u: number, v: number) => number, [u0, u1, v0, v1]: [number, number, number, number], n = 256): number {
    let sum = 0;
    for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) sum += f(u0 + (u1 - u0) * (a + 0.5) / n, v0 + (v1 - v0) * (b + 0.5) / n);
    return sum / (n * n);
}

describe('image texture field (twin)', () => {
    it('srgbDecode: 0 → 0, 1 → 1, continuous at the 0.04045 knee', () => {
        expect(srgbDecode(0)).toBe(0);
        expect(srgbDecode(1)).toBeCloseTo(1, 12);
        expect(Math.abs(srgbDecode(0.04045) - srgbDecode(0.04045 + 1e-12))).toBeLessThan(1e-7);
    });

    it('equals the decoded texel at every texel center (row 0 is the top of the image)', () => {
        for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) {
            const u = (i + 0.5) / 4, v = 1 - (j + 0.5) / 4;
            expect(imageTextureTwin(CODES, u, v, true)).toBeCloseTo(srgbDecode(CODES[j][i] / 255), 12);
            expect(imageTextureTwin(CODES, u, v, false)).toBeCloseTo(CODES[j][i] / 255, 12);
        }
    });

    it('is continuous across the repeat seams and periodic', () => {
        for (const t of [0.1, 0.37, 0.8]) {
            expect(Math.abs(imageTextureTwin(CODES, 0, t, true) - imageTextureTwin(CODES, 1 - 1e-12, t, true))).toBeLessThan(1e-9);
            expect(Math.abs(imageTextureTwin(CODES, t, 0, true) - imageTextureTwin(CODES, t, 1 - 1e-12, true))).toBeLessThan(1e-9);
            expect(imageTextureTwin(CODES, t + 3, t - 2, true)).toBeCloseTo(imageTextureTwin(CODES, t, t, true), 12);
        }
    });

    it('integrates over one period to the mean of the decoded texels', () => {
        const mean = CODES.flat().reduce((s, k) => s + srgbDecode(k / 255), 0) / 16;
        expect(integrate((u, v) => imageTextureTwin(CODES, u, v, true), [0, 1, 0, 1])).toBeCloseTo(mean, 9);
    });

    it('a decode after the blend is a different field (it fails the period mean)', () => {
        const mean = CODES.flat().reduce((s, k) => s + srgbDecode(k / 255), 0) / 16;
        const wrong = integrate((u, v) => srgbDecode(imageTextureTwin(CODES, u, v, false)), [0, 1, 0, 1]);
        expect(Math.abs(wrong - mean)).toBeGreaterThan(0.02);
    });

    it('quadrantMean is the exact quadrant integral, for every channel and both encodings', () => {
        for (const codes of [TEXTURE_CODES.r, TEXTURE_CODES.g, TEXTURE_CODES.b]) {
            for (const srgb of [true, false]) {
                for (const [q, box] of Object.entries(QUADRANTS) as Array<[Quadrant, [number, number, number, number]]>) {
                    expect(quadrantMean(codes, q, srgb)).toBeCloseTo(integrate((u, v) => imageTextureTwin(codes, u, v, srgb), box), 9);
                }
            }
        }
    });

    it('the witness image tells the conventions apart: a v flip, a u mirror and a missing half-texel offset each move a quadrant by > 0.05', () => {
        const g = (q: Quadrant) => quadrantMean(CODES, q, true);
        expect(Math.abs(g('top-left') - g('bottom-left'))).toBeGreaterThan(0.05);
        expect(Math.abs(g('top-left') - g('top-right'))).toBeGreaterThan(0.05);
        const noOffset = integrate((u, v) => imageTextureTwin(CODES, u + 1 / 8, v - 1 / 8, true), QUADRANTS['top-left']);
        expect(Math.abs(noOffset - g('top-left'))).toBeGreaterThan(0.05);
    });
});

describe('witness PNG encoder', () => {
    /** The IDAT payload inflated, with each scanline's filter byte removed. */
    function decode(png: Uint8Array): { width: number; height: number; depth: number; colorType: number; samples: number[] } {
        const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
        const width = view.getUint32(16), height = view.getUint32(20);
        const depth = png[24], colorType = png[25];
        let at = 8, idat: Uint8Array | null = null;
        while (at < png.length) {
            const len = view.getUint32(at), type = String.fromCharCode(...png.subarray(at + 4, at + 8));
            if (type === 'IDAT') idat = png.subarray(at + 8, at + 8 + len);
            at += 12 + len;
        }
        const raw = inflateSync(idat!);
        const stride = raw.length / height;
        const samples: number[] = [];
        for (let j = 0; j < height; j++) {
            expect(raw[j * stride]).toBe(0);
            samples.push(...raw.subarray(j * stride + 1, (j + 1) * stride));
        }
        return { width, height, depth, colorType, samples };
    }

    it('writes an 8-bit gray PNG whose pixels are the code table', () => {
        const d = decode(encodePng(TEXTURE_CODES.g));
        expect([d.width, d.height, d.depth, d.colorType]).toEqual([4, 4, 8, 0]);
        expect(d.samples).toEqual(TEXTURE_CODES.g.flat());
    });

    it('writes an 8-bit RGB PNG whose pixels are the three tables interleaved', () => {
        const rows = TEXTURE_CODES.r.map((row, j) => row.map((r, i) => [r, TEXTURE_CODES.g[j][i], TEXTURE_CODES.b[j][i]] as [number, number, number]));
        const d = decode(encodePng(rows));
        expect([d.width, d.height, d.depth, d.colorType]).toEqual([4, 4, 8, 2]);
        expect(d.samples).toEqual(rows.flat(2));
    });
});
