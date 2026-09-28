import { projectRGB, isDrivenRadiometric, emissionMayBeNonzero, hasConstantNonzeroEmission } from '../../src/components/color/values.js';
// Planck projection preserves signed linear RGB and the max-channel scale convention.

import { describe, it, expect } from 'vitest';
import { blackbodyRGB } from '../../src/components/color/blackbody/blackbody.js';

describe('Planck → normalized signed linear sRGB', () => {
    it('is max-channel normalized everywhere', () => {
        for (const k of [1000, 2000, 3200, 5000, 6500, 9000, 12000, 25000]) {
            const rgb = blackbodyRGB(k);
            expect(Math.max(...rgb)).toBeCloseTo(1, 9);
            for (const c of rgb) { expect(Number.isFinite(c)).toBe(true); }
        }
    });

    it('2000K is strongly red-dominant (candle/tungsten)', () => {
        const [r, g, b] = blackbodyRGB(2000);
        expect(r).toBe(1);
        expect(g).toBeLessThan(0.75);
        expect(b).toBeLessThan(0.35);
    });

    it('~6500K is near white (all channels high)', () => {
        const rgb = blackbodyRGB(6500);
        for (const c of rgb) expect(c).toBeGreaterThan(0.85);
    });

    it('12000K is blue-dominant', () => {
        const [r, , b] = blackbodyRGB(12000);
        expect(b).toBe(1);
        expect(r).toBeLessThan(1);
    });

    it('blue/red ratio is monotone in temperature (the physical direction)', () => {
        let prev = -Infinity;
        for (const k of [1800, 2500, 3500, 5000, 6500, 8500, 12000, 20000]) {
            const [r, , b] = blackbodyRGB(k);
            const ratio = b / Math.max(r, 1e-9);
            expect(ratio).toBeGreaterThan(prev);
            prev = ratio;
        }
    });

    it('retains low-temperature signed projection and evaluates the authored temperature', () => {
        expect(blackbodyRGB(1000)[1]).toBeCloseTo(0.008696905553, 8);
        expect(blackbodyRGB(1000)[2]).toBeCloseTo(-0.019583581807, 8);
        expect(blackbodyRGB(40000)[0]).toBeCloseTo(0.342393, 6);
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
