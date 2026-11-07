// White balance (view.tonemap.whiteBalance; components/tonemap/whiteBalance.ts): the Bradford
// adaptation from the white of a Planck source at T to D65, as a linear-sRGB matrix.

import { describe, it, expect } from 'vitest';
import { whiteBalanceMatrix, LMS_FROM_XYZ, XYZ_FROM_LMS } from '../../src/components/tonemap/whiteBalance.js';
import { blackbodyColor } from '../../src/components/color/spectra/blackbody/blackbody.js';
import { spectralData } from '../../src/components/color/spectral/data.js';

type M3 = readonly (readonly number[])[];
const mul = (a: M3, b: M3): number[][] => a.map((row) => b[0].map((_, j) => row.reduce((s, v, k) => s + v * b[k][j], 0)));
const apply = (a: M3, v: readonly number[]) => a.map((row) => row.reduce((s, x, k) => s + x * v[k], 0));

const TEMPERATURES = [1000, 2700, 3200, 5000, 6504, 40000];

describe('whiteBalanceMatrix', () => {
    it('maps the blackbody color at T to (1, 1, 1), the D65 white at Y = 1', () => {
        for (const T of TEMPERATURES) {
            const out = apply(whiteBalanceMatrix(T), blackbodyColor(T).rgb);
            for (const v of out) expect(v).toBeCloseTo(1, 5);
        }
    });

    it('the Bradford pair is inverse to 1e-6', () => {
        const product = mul(XYZ_FROM_LMS, LMS_FROM_XYZ);
        for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
            expect(Math.abs(product[i][j] - (i === j ? 1 : 0))).toBeLessThan(1e-6);
        }
    });

    it('equals pbrt-v4 RGBFromXYZ · WhiteBalance(srcWhite, D65) · XYZFromRGB (independent transcription)', () => {
        // pbrt util/color.h:546-566: the pair typed again here, and the whites passed as xy
        // chromaticities through XYZ::FromxyY, as pbrt does.
        const lmsFromXyz: M3 = [[0.8951, 0.2664, -0.1614], [-0.7502, 1.7135, 0.0367], [0.0389, -0.0685, 1.0296]];
        const xyzFromLms: M3 = [[0.986993, -0.147054, 0.159963], [0.432305, 0.51836, 0.0492912], [-0.00852866, 0.0400428, 0.968487]];
        const xy = (xyz: readonly number[]) => { const s = xyz[0] + xyz[1] + xyz[2]; return [xyz[0] / s, xyz[1] / s]; };
        const fromxyY = ([x, y]: readonly number[]) => [x / y, 1, (1 - x - y) / y];
        for (const T of TEMPERATURES) {
            const srcXYZ = apply(spectralData.rgbToXYZ, blackbodyColor(T).rgb);
            const srcLMS = apply(lmsFromXyz, fromxyY(xy(srcXYZ)));
            const dstLMS = apply(lmsFromXyz, fromxyY(xy(spectralData.white)));
            const correct: M3 = [[dstLMS[0] / srcLMS[0], 0, 0], [0, dstLMS[1] / srcLMS[1], 0], [0, 0, dstLMS[2] / srcLMS[2]]];
            const pbrt = mul(spectralData.xyzToRGB, mul(xyzFromLms, mul(correct, mul(lmsFromXyz, spectralData.rgbToXYZ))));
            const ours = whiteBalanceMatrix(T);
            for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) expect(ours[i][j]).toBeCloseTo(pbrt[i][j], 6);
        }
    });

    it('is not the identity at 6504 K (a Planck source is not D65)', () => {
        const M = whiteBalanceMatrix(6504);
        const offIdentity = Math.max(...M.flatMap((row, i) => row.map((v, j) => Math.abs(v - (i === j ? 1 : 0)))));
        expect(offIdentity).toBeGreaterThan(1e-3);
    });
});
