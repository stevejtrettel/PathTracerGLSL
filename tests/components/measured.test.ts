// The measured spectrum kind (color/spectra/measured): pbrt-v4's metal tables, read per
// wavelength lane by a generated binary-search helper, and their daylight RGB stand-ins.

import { describe, it, expect } from 'vitest';
import { measuredKind, measuredNames, measuredKnots, measuredValue, measuredGLSL, searchSteps } from '../../src/components/color/spectra/measured/measured.js';
import { measuredTables } from '../../src/components/color/spectra/measured/data.js';
import { valueProblems } from '../../src/compiler/analyze/propertyValidation.js';

// pbrt-v4's PiecewiseLinearSpectrum inside its range: a linear scan for the bracketing knots.
function reference(name: string, lambda: number): number {
    const { lambda: L, value: V } = measuredKnots(name);
    let i = 0;
    while (L[i + 1] < lambda) i++;
    const t = (lambda - L[i]) / (L[i + 1] - L[i]);
    return V[i] * (1 - t) + V[i + 1] * t;
}

describe('measured spectra', () => {
    it('ships the ten pbrt-v4 metal tables, each covering 360–830 nm with increasing knots and positive values', () => {
        expect([...measuredNames].sort()).toEqual(['Ag', 'Al', 'Au', 'Cu', 'CuZn'].flatMap(m => [`metal-${m}-eta`, `metal-${m}-k`]).sort());
        for (const name of measuredNames) {
            expect(measuredTables[name].length % 2, name).toBe(0);
            const { lambda, value } = measuredKnots(name);
            expect(lambda[0], name).toBeLessThanOrEqual(360);
            expect(lambda[lambda.length - 1], name).toBeGreaterThanOrEqual(830);
            for (let i = 1; i < lambda.length; i++) expect(lambda[i], name).toBeGreaterThan(lambda[i - 1]);
            for (const v of value) expect(v, name).toBeGreaterThan(0);
        }
    });

    it('the binary search brackets every wavelength: the twin equals pbrt\'s interpolation at every knot and midpoint', () => {
        for (const name of measuredNames) {
            const { lambda } = measuredKnots(name);
            expect(2 ** searchSteps(lambda.length)).toBeGreaterThanOrEqual(lambda.length - 1);
            for (let i = 0; i < lambda.length; i++) {
                expect(measuredValue(name, lambda[i]), `${name} knot ${i}`).toBe(reference(name, lambda[i]));
                if (i + 1 < lambda.length) {
                    const mid = 0.5 * (lambda[i] + lambda[i + 1]);
                    expect(Math.abs(measuredValue(name, mid) - reference(name, mid)), `${name} midpoint ${i}`).toBeLessThan(1e-12);
                }
            }
        }
    });

    it('has no value outside its table', () => {
        expect(() => measuredValue('metal-Au-eta', 200)).toThrow();
        expect(() => measuredValue('metal-Au-eta', 900)).toThrow();
    });

    it('RGB stand-ins: positive, and gold\'s are the D65 projections of η and κ', () => {
        for (const name of measuredNames) {
            for (const c of measuredKind.toRGB({ measured: name }, 'optical', {}) as number[]) expect(c, name).toBeGreaterThan(0);
        }
        const eta = measuredKind.toRGB({ measured: 'metal-Au-eta' }, 'optical', {}) as number[];
        const k = measuredKind.toRGB({ measured: 'metal-Au-k' }, 'optical', {}) as number[];
        [0.080, 0.405, 1.561].forEach((x, c) => expect(Math.abs(eta[c] - x)).toBeLessThan(5e-4));
        [3.390, 2.504, 1.771].forEach((x, c) => expect(Math.abs(k[c] - x)).toBeLessThan(5e-4));
    });

    it('links one helper per table in use (exact linkage)', () => {
        const block = measuredKind.glsl!([{ measured: 'metal-Au-eta' }, { measured: 'metal-Au-k' }, { measured: 'metal-Au-eta' }]);
        const functions = [...block.source.matchAll(/^Spectrum (\w+)\(/gm)].map(m => m[1]);
        expect(functions).toEqual(['measured_metal_Au_eta', 'measured_metal_Au_k']);
        expect(measuredKind.emit({ measured: 'metal-CuZn-k' }, { role: 'optical', wl: 'wl', bind: () => '', lift: () => '' }))
            .toBe('measured_metal_CuZn_k(wl)');
        // The helper's search runs the twin's number of steps over the table's knots.
        expect(measuredGLSL('metal-CuZn-eta')).toContain(`step < ${searchSteps(61)}`);
        expect(measuredGLSL('metal-CuZn-eta')).toContain('const float L[61]');
    });

    it('sits only in optical settings, and names the known tables when the name is unknown', () => {
        expect(valueProblems({ measured: 'metal-Au-eta' }, { shape: 'spectrum', role: 'optical' }, 'X')).toEqual([]);
        expect(valueProblems({ measured: 'metal-Au-eta' }, { shape: 'spectrum', role: 'reflectance' }, 'X')).toEqual(['X: measured is an optical form']);
        const unknown = valueProblems({ measured: 'metal-Fe-eta' }, { shape: 'spectrum', role: 'optical' }, 'X');
        expect(unknown).toHaveLength(1);
        expect(unknown[0]).toContain('unknown measured spectrum "metal-Fe-eta"');
        expect(unknown[0]).toContain('metal-Au-eta');
    });
});
