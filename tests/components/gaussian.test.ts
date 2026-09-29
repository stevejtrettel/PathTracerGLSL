// The Gaussian reflectance kind: its RGB stand-in against an independent quadrature over the
// shipped GPU curves, white, the gamut, and what it emits in each kind of program.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { spectralCurves } from '../../src/components/color/spectral/lookup.js';
import { spectralData } from '../../src/components/color/spectral/data.js';
import { gaussianKind, gaussianReflectance, gaussianStandIn } from '../../src/components/color/spectra/gaussian/gaussian.js';
import type { GaussianValue } from '../../src/compiler/types.js';
import type { EmitContext } from '../../src/components/color/spectra/spectrumKind.js';

const bytes = readFileSync(new URL('../../src/components/color/spectral/data/curves.bin', import.meta.url));
const curves = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));

/** s_c = ∫ g·D65·(M x̄)_c / ∫ D65·(M x̄)_c, by one Simpson rule at 0.25 nm over 360–830 nm, reading
 *  the color-matching functions and D65 from curves.bin (production uses the TypeScript tables
 *  and a 0.5 nm rule per 5 nm interval). */
function referenceStandIn(v: GaussianValue): number[] {
    const num = [0, 0, 0], den = [0, 0, 0];
    for (let i = 0; i <= 1880; i++) {
        const lambda = 360 + 0.25 * i;
        const [x, y, z, d65] = spectralCurves(lambda, curves);
        const weight = 0.25 / 3 * (i === 0 || i === 1880 ? 1 : i % 2 ? 4 : 2);
        for (let c = 0; c < 3; c++) {
            const [a, b, e] = spectralData.xyzToRGB[c];
            const response = a * x + b * y + e * z;
            num[c] += weight * gaussianReflectance(v, lambda) * d65 * response;
            den[c] += weight * d65 * response;
        }
    }
    return num.map((n, c) => n / den[c]);
}

const band = (center: number, width: number, peak: number, floor = 0): GaussianValue => ({ gaussian: { center, width, peak, floor } });

describe('gaussian reflectance kind', () => {
    it('a perfect white reflector projects to (1, 1, 1)', () => {
        for (const c of gaussianStandIn(band(550, 50, 1, 1))) expect(Math.abs(c - 1)).toBeLessThan(1e-12);
    });
    it('its RGB stand-in agrees with an independent fine quadrature', () => {
        for (const v of [band(610, 25, 0.85, 0.04), band(530, 25, 0.9, 0.02), band(450, 40, 0.7, 0.1), band(540, 25, 0.04, 0.85), band(700, 60, 0.95, 0.05)]) {
            const ours = gaussianStandIn(v), ref = referenceStandIn(v);
            for (let c = 0; c < 3; c++) expect(Math.abs(ours[c] - ref[c]), `${JSON.stringify(v.gaussian)} channel ${c}`).toBeLessThan(1e-6);
        }
    });
    it('a saturated green lies outside the RGB gamut; a notch makes magenta', () => {
        expect(gaussianStandIn(band(530, 25, 0.9, 0.02))[0]).toBeLessThan(0);
        const [r, g, b] = gaussianStandIn(band(540, 25, 0.04, 0.85));
        expect(r).toBeGreaterThan(g); expect(b).toBeGreaterThan(g);
    });
    const ctx = (spectral: boolean): EmitContext => ({
        role: 'reflectance', wl: 'wl', spectral, bind: () => { throw new Error('no binding'); },
        lift: (rgb) => `color_lift_reflectance(${rgb}, wl)`,
    });
    it('emits the band in spectral programs and the clipped stand-in in RGB programs', () => {
        expect(gaussianKind.emit(band(600, 20, 0.8, 0.1), ctx(true)))
            .toBe('(Spectrum(0.1) + 0.7000000000000001 * exp(-0.00125 * (wl.lambda - 600.0) * (wl.lambda - 600.0)))');
        const rgb = gaussianKind.emit(band(530, 25, 0.9, 0.02), ctx(false));
        expect(rgb).toMatch(/^color_lift_reflectance\(vec3\(0\.0, /);   // the negative red is clipped
    });
});
