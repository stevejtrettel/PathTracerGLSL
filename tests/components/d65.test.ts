// The CPU's daylight table is the GPU's: every sample of d65Curve equals the fourth channel of
// the shipped curves.bin row 0, as float32.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { d65Curve } from '../../src/components/color/spectral/d65.js';
import { cie1931Curves } from '../../src/components/sensor/cie1931/curves.js';

const bytes = readFileSync(resolve(__dirname, '../../src/components/color/spectral/data/curves.bin'));
const curves = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));

describe('D65 on the CPU', () => {
    it('has one sample per 5 nm from 360 to 830 nm, like the color-matching table', () => {
        expect(d65Curve.length).toBe(95);
        expect(cie1931Curves.length).toBe(95);
    });
    it('equals the shipped curves.bin column exactly', () => {
        for (let i = 0; i < 95; i++) expect(d65Curve[i], `sample ${i}`).toBe(curves[4 * i + 3]);
    });
});
