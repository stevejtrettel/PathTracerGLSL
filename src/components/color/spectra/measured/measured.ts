import type { MeasuredValue, Vec3 } from '../../../../compiler/types.js';
import type { SpectrumKind } from '../spectrumKind.js';
import { d65StandIn } from '../standIn.js';
import { formatFloat } from '../../../glsl-format.js';
import { measuredTables } from './data.js';

export function isMeasured(value: unknown): value is MeasuredValue {
    return typeof value === 'object' && value !== null && 'measured' in value;
}

/** The names of the shipped tables, in data.ts order. */
export const measuredNames: readonly string[] = Object.keys(measuredTables);

/** A table's knots: wavelengths in nm (increasing) and values. */
export function measuredKnots(name: string): { lambda: number[]; value: number[] } {
    const pairs = measuredTables[name];
    if (pairs === undefined) throw new Error(`unknown measured spectrum '${name}'`);
    const lambda: number[] = [], value: number[] = [];
    for (let i = 0; i < pairs.length; i += 2) {
        lambda.push(pairs[i]);
        value.push(pairs[i + 1]);
    }
    return { lambda, value };
}

/** Binary-search steps that bracket λ between adjacent knots: ⌈log₂(n − 1)⌉ for n knots. */
export function searchSteps(knots: number): number {
    return Math.ceil(Math.log2(knots - 1));
}

/** The table at λ (nm), linear between knots: pbrt-v4's PiecewiseLinearSpectrum. λ must lie
 *  within the table; every table covers 290–885.6 nm or more, and the renderer's wavelengths
 *  lie in 360–830 nm. The TS twin of the GLSL helper (measuredGLSL): the same bracketing
 *  search, then the same interpolation. */
export function measuredValue(name: string, lambda: number): number {
    const { lambda: L, value: V } = measuredKnots(name);
    if (!(lambda >= L[0] && lambda <= L[L.length - 1])) throw new Error(`measured spectrum '${name}' has no value at ${lambda} nm`);
    let lo = 0, hi = L.length - 1;
    for (let step = 0; step < searchSteps(L.length); step++) {
        const mid = Math.trunc((lo + hi) / 2);
        if (L[mid] <= lambda) lo = mid;
        else hi = mid;
    }
    const t = (lambda - L[lo]) / (L[hi] - L[lo]);
    return V[lo] * (1 - t) + V[hi] * t;
}

/** The GLSL function that evaluates a table at the ray's wavelengths. */
function functionName(name: string): string {
    return `measured_${name.replace(/[^A-Za-z0-9]/g, '_')}`;
}

/** The helper for one table: its knots as const arrays, and per wavelength lane the bracketing
 *  binary search and the linear interpolation of measuredValue. */
export function measuredGLSL(name: string): string {
    const { lambda, value } = measuredKnots(name);
    const n = lambda.length;
    const array = (xs: number[]) => `float[${n}](${xs.map(formatFloat).join(', ')})`;
    return [
        `// '${name}' (color/spectra/measured/data.ts): linear between ${n} knots in λ (nm).`,
        `Spectrum ${functionName(name)}(Wavelengths wl) {`,
        `    const float L[${n}] = ${array(lambda)};`,
        `    const float V[${n}] = ${array(value)};`,
        '    Spectrum v;',
        '    for (int lane = 0; lane < SPECTRUM_N; ++lane) {',
        '        float x = wl.lambda[lane];',
        `        int lo = 0, hi = ${n - 1};`,
        `        for (int step = 0; step < ${searchSteps(n)}; ++step) {`,
        '            int mid = (lo + hi) / 2;',
        '            if (L[mid] <= x) lo = mid;',
        '            else hi = mid;',
        '        }',
        '        v[lane] = mix(V[lo], V[hi], (x - L[lo]) / (L[hi] - L[lo]));',
        '    }',
        '    return v;',
        '}',
    ].join('\n');
}

/** `{ measured: '<table>' }`: a measured optical constant of a metal (the tables of data.ts),
 *  read per wavelength lane. Optical slots only; no live numbers. */
export const measuredKind: SpectrumKind<MeasuredValue> = {
    id: 'measured',
    label: 'measured',
    is: isMeasured,
    roles: ['optical'],
    liveParams: () => [],
    validate(v, label, report) {
        if (typeof v.measured !== 'string' || !Object.hasOwn(measuredTables, v.measured)) {
            report(`${label}: unknown measured spectrum ${JSON.stringify(v.measured)} (known: ${measuredNames.join(', ')})`);
        }
    },
    toRGB: (v): Vec3 => d65StandIn(lambda => measuredValue(v.measured, lambda)),
    // An optical constant is never emission, and never an index.
    constantNonzero: () => false,
    mayBeNonzero: () => false,
    dispersive: () => false,
    // One function per table the program evaluates, so a gold-only scene carries no silver.
    glsl: (values) => ({
        origin: 'generated:measured-spectra',
        source: measuredNames.filter(name => values.some(v => v.measured === name)).map(measuredGLSL).join('\n\n'),
    }),
    emit: (v, ctx) => `${functionName(v.measured)}(${ctx.wl})`,
};
