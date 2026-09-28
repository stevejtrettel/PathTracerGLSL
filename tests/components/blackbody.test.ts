import { projectRGB, isDrivenRadiometric, emissionMayBeNonzero, hasConstantNonzeroEmission } from '../../src/components/color/values.js';
// Planck projection preserves signed linear RGB at fixed reference CIE Y.

import { describe, it, expect } from 'vitest';
import { blackbodyColor, blackbodyRGB, planckShape } from '../../src/components/color/blackbody/blackbody.js';
import { spectralData } from '../../src/components/color/spectral/data.js';
import { referenceY } from '../helpers/planckReference.js';

describe('Planck → normalized signed linear sRGB', () => {
    it('holds the evaluated spectrum and its RGB projection at unit reference Y', () => {
        for (const k of [1000, 2000, 3200, 5000, 6500, 9000, 12000, 25000, 40000]) {
            const { rgb, normalization } = blackbodyColor(k);
            expect(referenceY(lambda => normalization * planckShape(lambda, k))).toBeCloseTo(1, 9);
            const y = spectralData.rgbToXYZ[1].reduce((sum, v, i) => sum + v * rgb[i], 0);
            expect(y).toBeCloseTo(1, 9);
            for (const c of rgb) { expect(Number.isFinite(c)).toBe(true); }
        }
    });

    it('2000K is strongly red-dominant (candle/tungsten)', () => {
        const [r, g, b] = blackbodyRGB(2000);
        expect(r).toBeGreaterThan(g);
        expect(g / r).toBeLessThan(0.75);
        expect(b / r).toBeLessThan(0.35);
    });

    it('~6500K is near white (all channels high)', () => {
        const rgb = blackbodyRGB(6500);
        for (const c of rgb) expect(c).toBeGreaterThan(0.85);
    });

    it('12000K is blue-dominant', () => {
        const [r, , b] = blackbodyRGB(12000);
        expect(b).toBeGreaterThan(r);
    });

    it('blue/red ratio is monotone in temperature (the physical direction)', () => {
        let prev = -Infinity;
        for (const k of [1800, 2500, 3500, 5000, 6500, 8500, 12000, 20000]) {
            const [r, , b] = blackbodyRGB(k);
            const ratio = b / r;
            expect(ratio).toBeGreaterThan(prev);
            prev = ratio;
        }
    });

    it('retains low-temperature signed projection and evaluates the authored temperature', () => {
        const warm = blackbodyRGB(1000), cool = blackbodyRGB(40000);
        expect(warm[1] / warm[0]).toBeCloseTo(0.008696905553, 8);
        expect(warm[2] / warm[0]).toBeCloseTo(-0.019583581807, 8);
        expect(cool[0] / cool[2]).toBeCloseTo(0.342393, 6);
    });

    it('scales the spectrum linearly, including zero', () => {
        for (const k of [1000, 6500, 40000]) {
            const { normalization } = blackbodyColor(k);
            for (const scale of [0, 0.25, 2]) {
                const y = referenceY(lambda => scale * normalization * planckShape(lambda, k));
                expect(Math.abs(y - scale)).toBeLessThan(1e-9 * Math.max(1, scale));
                blackbodyRGB(k, scale).forEach((v, i) => expect(v).toBe(blackbodyRGB(k)[i] * scale));
            }
        }
    });
});

describe('authored blackbody RGB projection', () => {
    it('constant dials fold to blackbodyRGB (bake ≡ ship: one body)', () => {
        expect(projectRGB({ blackbody: { kelvin: 3200, scale: 5 } })).toEqual(blackbodyRGB(3200, 5));
        expect(projectRGB({ blackbody: { kelvin: 3200 } })).toEqual(blackbodyRGB(3200, 1));
    });

    it('projects driven dials from defaults and live parameters', () => {
        const driven = { blackbody: { kelvin: { param: 'lamp.kelvin', default: 3200 }, scale: 5 } };
        expect(projectRGB(driven)).toEqual(blackbodyRGB(3200, 5));
        expect(projectRGB(driven, { 'lamp.kelvin': 6500 })).toEqual(blackbodyRGB(6500, 5));
        const drivenScale = { blackbody: { kelvin: 3200, scale: { param: 'lamp.power', default: 5 } } };
        expect(projectRGB(drivenScale)).toEqual(blackbodyRGB(3200, 5));
        expect(projectRGB(drivenScale, { 'lamp.power': 9 })).toEqual(blackbodyRGB(3200, 9));
    });
});

describe('authored emission classification', () => {
    it('distinguishes constant forms from driven dials', () => {
        expect(isDrivenRadiometric({ blackbody: { kelvin: 3200, scale: 5 } })).toBe(false);
        expect(isDrivenRadiometric({ blackbody: { kelvin: { param: 'k' }, scale: 5 } })).toBe(true);
        expect(isDrivenRadiometric({ blackbody: { kelvin: 3200, scale: { param: 's' } } })).toBe(true);
    });
    it('a fixed zero scale cannot emit, even with driven temperature', () => {
        for (const kelvin of [3200, { param: 'k' }]) {
            expect(emissionMayBeNonzero({ blackbody: { kelvin, scale: 0 } })).toBe(false);
            expect(hasConstantNonzeroEmission({ blackbody: { kelvin, scale: 0 } })).toBe(false);
        }
        expect(emissionMayBeNonzero({ blackbody: { kelvin: 3200, scale: { param: 's', default: 0 } } })).toBe(true);
    });
});
