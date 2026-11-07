// The measured spectrum kind (color/spectra/measured): pbrt-v4's metal tables, the ColorChecker
// reflectances and the CIE illuminants, read per wavelength lane by a generated binary-search
// helper, and their RGB stand-ins.

import { describe, it, expect } from 'vitest';
import { measuredKind, measuredNames, measuredKnots, measuredValue, measuredGLSL, measuredRole, measuredEmission, searchSteps } from '../../src/components/color/spectra/measured/measured.js';
import { measuredTables } from '../../src/components/color/spectra/measured/data.js';
import { reflectanceTables, emissionTables } from '../../src/components/color/spectra/measured/colors.js';
import { blackbodyColor } from '../../src/components/color/spectra/blackbody/blackbody.js';
import { valueProblems } from '../../src/compiler/analyze/propertyValidation.js';
import type { MeasuredValue } from '../../src/compiler/types.js';
import { referenceY } from '../helpers/planckReference.js';

const m = (table: string, scale?: MeasuredValue['measured']['scale']): MeasuredValue => ({ measured: scale === undefined ? { table } : { table, scale } });
const ctx = { role: 'emission' as const, wl: 'wl', bind: (x: unknown) => String(x), lift: () => '' };

// pbrt-v4's PiecewiseLinearSpectrum inside its range: a linear scan for the bracketing knots.
function reference(name: string, lambda: number): number {
    const { lambda: L, value: V } = measuredKnots(name);
    let i = 0;
    while (L[i + 1] < lambda) i++;
    const t = (lambda - L[i]) / (L[i + 1] - L[i]);
    return V[i] * (1 - t) + V[i + 1] * t;
}

// Linear sRGB of the BabelColor average patches under D65 by colour-science 0.4.4 (ASTM E308
// integration, CIE 1931 2°): tools/spectral/colorchecker-reference.py.
const COLOUR_SCIENCE: Record<string, [number, number, number]> = {
    'dark-skin': [0.17248, 0.08376, 0.05758],
    'light-skin': [0.54812, 0.29852, 0.21698],
    'blue-sky': [0.11026, 0.19676, 0.33588],
    'foliage': [0.10384, 0.15023, 0.05212],
    'blue-flower': [0.22439, 0.21774, 0.43020],
    'bluish-green': [0.12318, 0.51903, 0.40443],
    'orange': [0.71681, 0.19904, 0.02715],
    'purplish-blue': [0.06497, 0.10625, 0.39245],
    'moderate-red': [0.54169, 0.08835, 0.12028],
    'purple': [0.10421, 0.04382, 0.13959],
    'yellow-green': [0.35468, 0.50783, 0.04824],
    'orange-yellow': [0.78046, 0.35407, 0.02151],
    'blue': [0.02338, 0.04917, 0.29156],
    'green': [0.06528, 0.30187, 0.06451],
    'red': [0.42937, 0.03192, 0.04018],
    'yellow': [0.85683, 0.57537, 0.00786],
    'magenta': [0.50316, 0.08892, 0.30553],
    'cyan': [-0.02858, 0.24896, 0.38298],
    'white-9.5': [0.91635, 0.91547, 0.87049],
    'neutral-8': [0.58193, 0.59112, 0.58393],
    'neutral-6.5': [0.35523, 0.36096, 0.35895],
    'neutral-5': [0.18757, 0.19236, 0.19174],
    'neutral-3.5': [0.08707, 0.09007, 0.09083],
    'black-2': [0.03207, 0.03193, 0.03259],
};

describe('measured spectra: the tables', () => {
    it('ships ten metal tables, 24 ColorChecker patches and five illuminants, each with its role', () => {
        const metals = ['Ag', 'Al', 'Au', 'Cu', 'CuZn'].flatMap(x => [`metal-${x}-eta`, `metal-${x}-k`]);
        const patches = Object.keys(COLOUR_SCIENCE).map(p => `colorchecker-${p}`);
        const lights = ['A', 'D65', 'FL2', 'FL11', 'LED-B3'].map(x => `illuminant-${x}`);
        expect([...measuredNames].sort()).toEqual([...metals, ...patches, ...lights].sort());
        for (const name of metals) expect(measuredRole(name)).toBe('optical');
        for (const name of patches) expect(measuredRole(name)).toBe('reflectance');
        for (const name of lights) expect(measuredRole(name)).toBe('emission');
    });

    it('as authored: increasing knots; metals cover 360–830 nm and are positive, reflectances lie in [0, 1], illuminants are nonnegative', () => {
        const all = { ...measuredTables, ...reflectanceTables, ...emissionTables };
        for (const [name, pairs] of Object.entries(all)) {
            expect(pairs.length % 2, name).toBe(0);
            for (let i = 2; i < pairs.length; i += 2) expect(pairs[i], name).toBeGreaterThan(pairs[i - 2]);
            const values = pairs.filter((_, i) => i % 2 === 1);
            if (measuredRole(name) === 'optical') {
                expect(pairs[0], name).toBeLessThanOrEqual(360);
                expect(pairs[pairs.length - 2], name).toBeGreaterThanOrEqual(830);
                for (const v of values) expect(v, name).toBeGreaterThan(0);
            } else if (measuredRole(name) === 'reflectance') {
                for (const v of values) expect(v >= 0 && v <= 1, name).toBe(true);
            } else {
                for (const v of values) expect(v, name).toBeGreaterThanOrEqual(0);
            }
        }
    });

    it('a table that does not reach 360 or 830 nm holds its end values one nm beyond (pbrt-v4 FromInterleaved); the metals are read as authored', () => {
        // BabelColor patches: 380–730 nm.
        const { lambda, value } = measuredKnots('colorchecker-red');
        expect(lambda[0]).toBe(359);
        expect(lambda[lambda.length - 1]).toBe(831);
        expect(lambda.length).toBe(36 + 2);
        // Between equal knots the interpolation returns the value up to rounding.
        expect(measuredValue('colorchecker-red', 360)).toBeCloseTo(value[1], 15);
        expect(measuredValue('colorchecker-red', 830)).toBeCloseTo(value[value.length - 2], 15);
        expect(value[0]).toBe(reflectanceTables['colorchecker-red'][1]);
        expect(value[value.length - 1]).toBe(reflectanceTables['colorchecker-red'].at(-1));
        // A and D65 span 360–830 nm exactly: nothing is added.
        expect(measuredKnots('illuminant-D65').lambda.length).toBe(95);
        expect(measuredKnots('metal-Au-eta').lambda.length).toBe(measuredTables['metal-Au-eta'].length / 2);
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

    it('has no value outside its knots', () => {
        expect(() => measuredValue('metal-Au-eta', 200)).toThrow();
        expect(() => measuredValue('metal-Au-eta', 900)).toThrow();
        expect(() => measuredValue('colorchecker-red', 358)).toThrow();
    });
});

describe('measured spectra: RGB stand-ins', () => {
    it('metals: positive, and gold\'s are the D65 projections of η and κ', () => {
        for (const name of measuredNames.filter(n => measuredRole(n) === 'optical')) {
            for (const c of measuredKind.toRGB(m(name), 'optical', {}) as number[]) expect(c, name).toBeGreaterThan(0);
        }
        const eta = measuredKind.toRGB(m('metal-Au-eta'), 'optical', {}) as number[];
        const k = measuredKind.toRGB(m('metal-Au-k'), 'optical', {}) as number[];
        [0.080, 0.405, 1.561].forEach((x, c) => expect(Math.abs(eta[c] - x)).toBeLessThan(5e-4));
        [3.390, 2.504, 1.771].forEach((x, c) => expect(Math.abs(k[c] - x)).toBeLessThan(5e-4));
    });

    it('ColorChecker: each patch\'s D65 stand-in agrees with colour-science\'s linear sRGB within 0.0025 per channel', () => {
        // The difference comes from the integration: colour-science's ASTM E308 weights the
        // 10 nm data by its own interpolation and extrapolation; the stand-in integrates the
        // linear interpolant. Measured worst: 0.0020 (orange, red channel).
        let worst = 0;
        for (const [patch, expected] of Object.entries(COLOUR_SCIENCE)) {
            const rgb = measuredKind.toRGB(m(`colorchecker-${patch}`), 'reflectance', {}) as number[];
            for (let c = 0; c < 3; c++) worst = Math.max(worst, Math.abs(rgb[c] - expected[c]));
        }
        expect(worst).toBeLessThan(0.0025);
    });

    it('illuminants: normalized to unit reference Y (an independent quadrature), D65 is white, A is Planck at 2856 K', () => {
        for (const name of measuredNames.filter(n => measuredRole(n) === 'emission')) {
            const { normalization } = measuredEmission(name);
            expect(Math.abs(referenceY(l => normalization * measuredValue(name, l)) - 1), name).toBeLessThan(1e-6);
        }
        // sRGB's white is D65: unit Y is (1, 1, 1).
        for (const c of measuredEmission('illuminant-D65').rgb) expect(Math.abs(c - 1)).toBeLessThan(1e-5);
        // CIE A is Planck's law at 2848 K with the former c₂ = 1.435e-2 m·K, which is 2855.54 K
        // with today's c₂; its 5 nm samples, linear between knots, match within 1e-4.
        const planck = blackbodyColor(2848 * 1.438776877503934e-2 / 1.435e-2).rgb;
        measuredEmission('illuminant-A').rgb.forEach((c, i) => expect(Math.abs(c - planck[i])).toBeLessThan(1e-4));
    });

    it('an illuminant\'s scale multiplies its stand-in, at the slider\'s value when live', () => {
        const unit = measuredEmission('illuminant-FL11').rgb;
        const at = (v: MeasuredValue, p = {}) => measuredKind.toRGB(v, 'emission', p) as number[];
        expect(at(m('illuminant-FL11'))).toEqual(unit);
        at(m('illuminant-FL11', 3)).forEach((c, i) => expect(c).toBeCloseTo(3 * unit[i], 12));
        const live = m('illuminant-FL11', { param: 'lamp.power', default: 2 });
        at(live).forEach((c, i) => expect(c).toBeCloseTo(2 * unit[i], 12));
        at(live, { 'lamp.power': 5 }).forEach((c, i) => expect(c).toBeCloseTo(5 * unit[i], 12));
        expect(measuredKind.liveParams(live)).toEqual(['lamp.power']);
    });
});

describe('measured spectra: GLSL', () => {
    it('links one helper per table in use (exact linkage)', () => {
        const block = measuredKind.glsl!([m('metal-Au-eta'), m('colorchecker-white-9.5'), m('metal-Au-eta'), m('illuminant-A', 2)]);
        const functions = [...block.source.matchAll(/^Spectrum (\w+)\(/gm)].map(x => x[1]);
        expect(functions).toEqual(['measured_metal_Au_eta', 'measured_colorchecker_white_9_5', 'measured_illuminant_A']);
        expect(measuredKind.emit(m('metal-CuZn-k'), { ...ctx, role: 'optical' })).toBe('measured_metal_CuZn_k(wl)');
        expect(measuredKind.emit(m('colorchecker-red'), { ...ctx, role: 'reflectance' })).toBe('measured_colorchecker_red(wl)');
        // The helper's search runs the twin's number of steps over the table's knots.
        expect(measuredGLSL('metal-CuZn-eta')).toContain(`step < ${searchSteps(61)}`);
        expect(measuredGLSL('metal-CuZn-eta')).toContain('const float L[61]');
        expect(measuredGLSL('colorchecker-red')).toContain('const float L[38]');
    });

    it('an illuminant is its scale times its unit-luminance normalization times the table', () => {
        const n = measuredEmission('illuminant-D65').normalization;
        const emitted = measuredKind.emit(m('illuminant-D65', 4), ctx);
        expect(emitted).toMatch(/^\(4 \* ([0-9.e-]+) \* measured_illuminant_D65\(wl\)\)$/);
        expect(Number(emitted.match(/\* ([0-9.e-]+) \*/)![1])).toBeCloseTo(n, 7);
        expect(measuredKind.emit(m('illuminant-D65'), ctx)).toMatch(/^\(1 \* /);
    });

    it('a light-table row holds the table\'s index and scale × normalization; the reader selects among the program\'s illuminants', () => {
        const packed = measuredKind.packed!;
        const [index, gain] = packed.header(m('illuminant-LED-B3', 2));
        expect(measuredNames[index]).toBe('illuminant-LED-B3');
        expect(gain).toBeCloseTo(2 * measuredEmission('illuminant-LED-B3').normalization, 12);
        expect(() => packed.header(m('illuminant-A', { param: 'a.b', default: 1 }))).toThrow();
        // No illuminant among the values: no row can hold the kind.
        expect(packed.read('h', 'wl', [m('metal-Au-eta'), m('colorchecker-red')])).toBeNull();
        expect(packed.read('h', 'wl', [m('illuminant-FL2', 3)])).toBe('(h.w * measured_illuminant_FL2(wl))');
        const fl2 = measuredNames.indexOf('illuminant-FL2'), fl11 = measuredNames.indexOf('illuminant-FL11');
        expect(packed.read('h', 'wl', [m('illuminant-LED-B3'), m('colorchecker-red'), m('illuminant-FL11'), m('illuminant-FL2', 3)]))
            .toBe(`(h.w * (int(h.z) == ${fl2} ? measured_illuminant_FL2(wl) : (int(h.z) == ${fl11} ? measured_illuminant_FL11(wl) : measured_illuminant_LED_B3(wl))))`);
    });

    it('only an illuminant emits', () => {
        expect(measuredKind.constantNonzero(m('illuminant-A'))).toBe(true);
        expect(measuredKind.constantNonzero(m('illuminant-A', 0))).toBe(false);
        expect(measuredKind.constantNonzero(m('illuminant-A', { param: 'a.b', default: 1 }))).toBe(false);
        expect(measuredKind.mayBeNonzero(m('illuminant-A', { param: 'a.b', default: 1 }))).toBe(true);
        for (const name of ['colorchecker-white-9.5', 'metal-Au-k', 'no-such-table']) {
            expect(measuredKind.constantNonzero(m(name)), name).toBe(false);
            expect(measuredKind.mayBeNonzero(m(name)), name).toBe(false);
        }
    });
});

describe('measured spectra: validation', () => {
    const problems = (value: unknown, role: 'optical' | 'reflectance' | 'emission' | 'index') =>
        valueProblems(value, { shape: role === 'index' ? 'scalar' : 'spectrum', role }, 'X');

    it('a table sits in settings of its own role', () => {
        expect(problems(m('metal-Au-eta'), 'optical')).toEqual([]);
        expect(problems(m('colorchecker-cyan'), 'reflectance')).toEqual([]);
        expect(problems(m('illuminant-FL11', 2), 'emission')).toEqual([]);
        expect(problems(m('illuminant-FL11', { param: 'lamp.power', default: 2, min: 0, max: 10 }), 'emission')).toEqual([]);
        expect(problems(m('metal-Au-eta'), 'reflectance')).toEqual(["X: the measured table 'metal-Au-eta' is an optical spectrum, and this setting takes a reflectance value"]);
        expect(problems(m('colorchecker-red'), 'emission')).toEqual(["X: the measured table 'colorchecker-red' is a reflectance spectrum, and this setting takes an emission value"]);
        expect(problems(m('illuminant-A'), 'reflectance')).toEqual(["X: the measured table 'illuminant-A' is an emission spectrum, and this setting takes a reflectance value"]);
        expect(problems(m('illuminant-A'), 'index')).toEqual(['X: measured is an optical, reflectance or emission form']);
    });

    it('scale is an illuminant\'s, nonnegative', () => {
        expect(problems(m('colorchecker-red', 2), 'reflectance')).toEqual(["X: scale applies only to emission tables, and 'colorchecker-red' is a reflectance spectrum"]);
        expect(problems(m('illuminant-A', -1), 'emission')).toEqual(['X: measured scale components must be >= 0']);
    });

    it('the table is a known name', () => {
        const unknown = problems(m('metal-Fe-eta'), 'optical');
        expect(unknown).toHaveLength(1);
        expect(unknown[0]).toContain('unknown measured spectrum "metal-Fe-eta"');
        expect(unknown[0]).toContain('(optical tables: metal-Ag-eta, metal-Ag-k, metal-Al-eta,');
        expect(unknown[0]).not.toContain('colorchecker');
        expect(problems(m('colorchecker-pink'), 'reflectance')[0]).toContain('(reflectance tables: colorchecker-dark-skin,');
        expect(problems({ measured: { table: 3 } }, 'optical')).toEqual(['X: measured table must be a name']);
        expect(problems({ measured: 'metal-Au-eta' }, 'optical')).toEqual(['X: measured must be an object { table, scale? }']);
        expect(problems({ measured: {} }, 'optical')).toEqual(['X: measured table must be a name']);
    });
});
