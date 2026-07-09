import { describe, it, expect } from 'vitest';
import { floatToRGBE, buildHDRFile } from '../../src/app/utils/file-export.js';

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
});
