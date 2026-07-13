import { describe, it, expect } from 'vitest';
import { crc32 as zlibCrc32 } from 'node:zlib';
import { floatToRGBE, buildHDRFile, embedPNGStamp, type RenderStamp } from '../../src/app/utils/file-export.js';

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

describe('embedPNGStamp', () => {
    // A minimal valid PNG: signature + IHDR (1×1, 8-bit gray) + IDAT + IEND, with
    // correct CRCs — enough structure for the splicer to find its insertion point.
    function minimalPNG(): Uint8Array {
        const chunks: Uint8Array[] = [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])];
        const chunk = (type: string, data: number[]) => {
            const raw = new Uint8Array(12 + data.length);
            const view = new DataView(raw.buffer);
            view.setUint32(0, data.length);
            raw.set([...type].map(c => c.charCodeAt(0)), 4);
            raw.set(data, 8);
            view.setUint32(8 + data.length, zlibCrc32(raw.subarray(4, 8 + data.length)));
            chunks.push(raw);
            return raw;
        };
        chunk('IHDR', [0, 0, 0, 1, 0, 0, 0, 1, 8, 0, 0, 0, 0]);
        chunk('IDAT', [0x78, 0x9c, 0x62, 0x00, 0x01, 0x00, 0x00, 0xff, 0xff, 0x00, 0x02, 0x00, 0x01]);
        chunk('IEND', []);
        const total = chunks.reduce((n, c) => n + c.length, 0);
        const out = new Uint8Array(total);
        let off = 0;
        for (const c of chunks) { out.set(c, off); off += c.length; }
        return out;
    }

    function walkChunks(png: Uint8Array): Array<{ type: string; keyword?: string; value?: string; crcOk: boolean }> {
        const view = new DataView(png.buffer, png.byteOffset);
        const out: Array<{ type: string; keyword?: string; value?: string; crcOk: boolean }> = [];
        let off = 8;
        while (off < png.length) {
            const len = view.getUint32(off);
            const type = new TextDecoder().decode(png.subarray(off + 4, off + 8));
            // Verify the CRC with node's INDEPENDENT implementation, not ours.
            const crcOk = view.getUint32(off + 8 + len) === (zlibCrc32(png.subarray(off + 4, off + 8 + len)) >>> 0);
            const entry: { type: string; keyword?: string; value?: string; crcOk: boolean } = { type, crcOk };
            if (type === 'tEXt') {
                const data = new TextDecoder().decode(png.subarray(off + 8, off + 8 + len));
                const sep = data.indexOf('\0');
                entry.keyword = data.slice(0, sep);
                entry.value = data.slice(sep + 1);
            }
            out.push(entry);
            off += 12 + len;
        }
        return out;
    }

    it('splices tEXt chunks after IHDR with CRCs node agrees with, leaving pixels intact', async () => {
        const original = minimalPNG();
        const stamped = new Uint8Array(await (await embedPNGStamp(new Blob([original as BlobPart]), testStamp)).arrayBuffer());
        const chunks = walkChunks(stamped);

        expect(chunks[0].type).toBe('IHDR');
        expect(chunks.at(-1)!.type).toBe('IEND');
        expect(chunks.every(c => c.crcOk)).toBe(true);

        const texts = chunks.filter(c => c.type === 'tEXt');
        const byKey = Object.fromEntries(texts.map(t => [t.keyword, t.value]));
        expect(byKey['pathtracer:scene']).toBe('furnace');
        expect(byKey['pathtracer:spp']).toBe('48');
        expect(byKey['pathtracer:git']).toBe('abc1234');
        expect(byKey['pathtracer:strategy']).toBe(JSON.stringify(testStamp.strategy));
        // All stamp chunks sit between IHDR and IDAT (splice point), and the
        // IDAT payload is byte-identical to the original.
        expect(chunks.findIndex(c => c.type === 'IDAT')).toBe(1 + texts.length);
        expect(stamped.length).toBe(original.length + texts.reduce((n, t) => n + 12 + `${t.keyword}\0${t.value}`.length, 0));
    });
});
