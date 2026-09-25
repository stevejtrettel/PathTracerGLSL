import { describe, it, expect } from 'vitest';
import { crc32 as zlibCrc32, inflateSync } from 'node:zlib';
import { floatToRGBE, buildHDRFile, encodePNG, type RenderStamp } from '../../src/app/utils/file-export.js';

const testStamp: RenderStamp = {
    scene: 'furnace',
    strategy: { id: 'furnace', estimator: { accumulation: { type: 'average' } } },
    parameters: { 'camera.position': [0, 0, 0] },
    spp: 48,
    resolution: [160, 120],
    resetSalt: 7,
    git: 'abc1234',
    date: '2026-07-13T00:00:00.000Z',
};

describe('floatToRGBE', () => {
    it('encodes a mid-gray pixel to a known RGBE quad', () => {
        // maxVal 0.5 → exponent 0, scale 256; 0.5*256 = 128; alpha = exponent+128 = 128
        const rgbe = floatToRGBE(new Float32Array([0.5, 0.5, 0.5, 1]), 1, 1);
        expect(Array.from(rgbe)).toEqual([128, 128, 128, 128]);
    });

    it('encodes a unit-white pixel (exponent 1)', () => {
        // maxVal 1 → exponent 1, scale 128; 1*128 = 128; alpha = 1+128 = 129
        const rgbe = floatToRGBE(new Float32Array([1, 1, 1, 1]), 1, 1);
        expect(Array.from(rgbe)).toEqual([128, 128, 128, 129]);
    });

    it('encodes a near-zero pixel to all zeros (including alpha)', () => {
        const rgbe = floatToRGBE(new Float32Array([0, 0, 0, 1]), 1, 1);
        expect(Array.from(rgbe)).toEqual([0, 0, 0, 0]);
    });

    it('clamps individual channels to 255', () => {
        // (2, 0.1, 0.1): maxVal 2 → exponent 2, scale 64; 2*64 = 128, 0.1*64 = 6
        const rgbe = floatToRGBE(new Float32Array([2, 0.1, 0.1, 1]), 1, 1);
        expect(rgbe[0]).toBe(128);
        expect(rgbe[1]).toBe(6);
        expect(rgbe[3]).toBe(2 + 128);
    });
});

describe('buildHDRFile', () => {
    it('writes a RADIANCE header with the correct dimension line and total size', () => {
        const w = 4, h = 3;
        const rgbe = new Uint8Array(w * h * 4);
        const file = buildHDRFile(rgbe, w, h);
        const headerText = new TextDecoder().decode(file.slice(0, 60));
        expect(headerText.startsWith('#?RADIANCE')).toBe(true);
        expect(headerText).toContain(`-Y ${h} +X ${w}`);
        // total = header bytes + pixel bytes
        const headerBytes = new TextEncoder().encode(
            ['#?RADIANCE', 'FORMAT=32-bit_rle_rgbe', '', `-Y ${h} +X ${w}`, ''].join('\n'),
        ).length;
        expect(file.length).toBe(headerBytes + w * h * 4);
    });

    it('flips rows vertically (bottom row written first after the header)', () => {
        // 1×2 image: row 0 = [1,2,3,4], row 1 = [5,6,7,8].
        const rgbe = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
        const file = buildHDRFile(rgbe, 1, 2);
        const pixels = file.slice(file.length - 8);
        expect(Array.from(pixels)).toEqual([5, 6, 7, 8, 1, 2, 3, 4]);
    });

    it('writes the reproducibility stamp as # comment lines before the resolution line', () => {
        const file = buildHDRFile(new Uint8Array(4), 1, 1, testStamp);
        const text = new TextDecoder().decode(file);
        expect(text).toContain('# scene=furnace');
        expect(text).toContain('# spp=48');
        expect(text).toContain('# resetSalt=7');
        expect(text).toContain('# git=abc1234');
        expect(text).toContain(`# strategy=${JSON.stringify(testStamp.strategy)}`);
        // The resolution line must remain the last header line (readers require it).
        expect(text.indexOf('# scene=')).toBeLessThan(text.indexOf('-Y 1 +X 1'));
    });
});

describe('encodePNG', () => {
    type Chunk = { type: string; data: Uint8Array; crcOk: boolean };

    function walkChunks(png: Uint8Array): Chunk[] {
        expect(Array.from(png.subarray(0, 8))).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
        const view = new DataView(png.buffer, png.byteOffset);
        const out: Chunk[] = [];
        let off = 8;
        while (off < png.length) {
            const len = view.getUint32(off);
            const type = new TextDecoder().decode(png.subarray(off + 4, off + 8));
            // Verify the CRC with node's INDEPENDENT implementation, not ours.
            const crcOk = view.getUint32(off + 8 + len) === (zlibCrc32(png.subarray(off + 4, off + 8 + len)) >>> 0);
            out.push({ type, data: png.subarray(off + 8, off + 8 + len), crcOk });
            off += 12 + len;
        }
        return out;
    }

    /** A plain PNG decoder for 8-bit RGB, all five filter types (so the test does not
     *  assume which filter the encoder chose). Returns RGB rows top to bottom. */
    function decodeRGB(chunks: Chunk[], width: number, height: number): Uint8Array {
        const idat = Buffer.concat(chunks.filter(c => c.type === 'IDAT').map(c => c.data));
        const raw = inflateSync(idat);
        const stride = 3 * width;
        const out = new Uint8Array(stride * height);
        for (let y = 0; y < height; y++) {
            const filter = raw[y * (stride + 1)];
            for (let i = 0; i < stride; i++) {
                const x = raw[y * (stride + 1) + 1 + i];
                const a = i >= 3 ? out[y * stride + i - 3] : 0;
                const b = y > 0 ? out[(y - 1) * stride + i] : 0;
                const c = i >= 3 && y > 0 ? out[(y - 1) * stride + i - 3] : 0;
                const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
                const pred = [0, a, b, (a + b) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? b : c][filter];
                out[y * stride + i] = (x + pred) & 0xff;
            }
        }
        return out;
    }

    // A 37×23 image of pseudo-random bytes: odd sizes, and noise, which the filters cannot flatten.
    const W = 37, H = 23;
    const rgba = new Uint8Array(W * H * 4);
    let s = 12345;
    for (let i = 0; i < rgba.length; i++) { s = (s * 1103515245 + 12345) >>> 0; rgba[i] = s >>> 24; }
    const row = (y: number) => rgba.subarray(y * W * 4, (y + 1) * W * 4);

    it('round-trips the pixels (RGB, alpha dropped) through an independent zlib', async () => {
        const png = new Uint8Array(await (await encodePNG(W, H, row)).arrayBuffer());
        const chunks = walkChunks(png);
        expect(chunks.every(c => c.crcOk)).toBe(true);
        expect(chunks[0].type).toBe('IHDR');
        expect(Array.from(chunks[0].data)).toEqual([0, 0, 0, W, 0, 0, 0, H, 8, 2, 0, 0, 0]);
        expect(chunks.at(-1)!.type).toBe('IEND');

        const rgb = decodeRGB(chunks, W, H);
        for (let p = 0; p < W * H; p++) {
            expect([rgb[3 * p], rgb[3 * p + 1], rgb[3 * p + 2]]).toEqual([rgba[4 * p], rgba[4 * p + 1], rgba[4 * p + 2]]);
        }
    });

    it('writes the stamp as tEXt chunks between IHDR and the image data', async () => {
        const png = new Uint8Array(await (await encodePNG(W, H, row, testStamp)).arrayBuffer());
        const chunks = walkChunks(png);
        expect(chunks.every(c => c.crcOk)).toBe(true);
        const texts = chunks.filter(c => c.type === 'tEXt').map(c => {
            const text = new TextDecoder().decode(c.data);
            const sep = text.indexOf('\0');
            return [text.slice(0, sep), text.slice(sep + 1)];
        });
        const byKey = Object.fromEntries(texts);
        expect(byKey['pathtracer:scene']).toBe('furnace');
        expect(byKey['pathtracer:spp']).toBe('48');
        expect(byKey['pathtracer:git']).toBe('abc1234');
        expect(byKey['pathtracer:strategy']).toBe(JSON.stringify(testStamp.strategy));
        expect(chunks.findIndex(c => c.type === 'IDAT')).toBe(1 + texts.length);
        expect(decodeRGB(chunks, W, H)[0]).toBe(rgba[0]);
    });
});
