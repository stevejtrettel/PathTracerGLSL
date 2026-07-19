// The kelvin → RGB parameterization (impl-plan-blackbody-uv): physical sanity pins on
// the Kim-et-al locus pipeline, and the fold's bake ≡ ship identity.

import { describe, it, expect } from 'vitest';
import { kelvinToRGB, blackbodyRGB, foldBlackbody } from '../../src/components/lights/blackbody.js';

describe('kelvinToRGB (Planckian locus → normalized linear sRGB)', () => {
    it('is max-channel normalized everywhere', () => {
        for (const k of [1000, 2000, 3200, 5000, 6500, 9000, 12000, 25000]) {
            const rgb = kelvinToRGB(k);
            expect(Math.max(...rgb)).toBeCloseTo(1, 9);
            for (const c of rgb) { expect(c).toBeGreaterThanOrEqual(0); expect(Number.isFinite(c)).toBe(true); }
        }
    });

    it('2000K is strongly red-dominant (candle/tungsten)', () => {
        const [r, g, b] = kelvinToRGB(2000);
        expect(r).toBe(1);
        expect(g).toBeLessThan(0.75);
        expect(b).toBeLessThan(0.35);
    });

    it('~6500K is near white (all channels high)', () => {
        const rgb = kelvinToRGB(6500);
        for (const c of rgb) expect(c).toBeGreaterThan(0.85);
    });

    it('12000K is blue-dominant', () => {
        const [r, , b] = kelvinToRGB(12000);
        expect(b).toBe(1);
        expect(r).toBeLessThan(1);
    });

    it('blue/red ratio is monotone in temperature (the physical direction)', () => {
        let prev = -Infinity;
        for (const k of [1800, 2500, 3500, 5000, 6500, 8500, 12000, 20000]) {
            const [r, , b] = kelvinToRGB(k);
            const ratio = b / Math.max(r, 1e-9);
            expect(ratio).toBeGreaterThan(prev);
            prev = ratio;
        }
    });

    it('clamps outside the locus validity range instead of extrapolating', () => {
        expect(kelvinToRGB(500)).toEqual(kelvinToRGB(1667));
        expect(kelvinToRGB(40000)).toEqual(kelvinToRGB(25000));
    });
});

describe('foldBlackbody (plan-entry constant folding)', () => {
    it('constant dials fold to blackbodyRGB (bake ≡ ship: one body)', () => {
        expect(foldBlackbody({ blackbody: { kelvin: 3200, scale: 5 } })).toEqual(blackbodyRGB(3200, 5));
        expect(foldBlackbody({ blackbody: { kelvin: 3200 } })).toEqual(blackbodyRGB(3200, 1));
    });

    it('a driven dial survives to the split point', () => {
        const driven = { blackbody: { kelvin: { param: 'lamp.kelvin', default: 3200 }, scale: 5 } };
        expect(foldBlackbody(driven)).toBe(driven);
        const drivenScale = { blackbody: { kelvin: 3200, scale: { param: 'lamp.power', default: 5 } } };
        expect(foldBlackbody(drivenScale)).toBe(drivenScale);
    });
});
