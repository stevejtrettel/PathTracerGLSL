import type { MeasuredValue, Vec3 } from '../../../../compiler/types.js';
import type { SpectrumKind } from '../spectrumKind.js';
import type { SpectrumRole } from '../../../descriptors.js';
import { d65StandIn, unitLuminanceStandIn } from '../standIn.js';
import { isValueParam } from '../../../param.js';
import { formatFloat } from '../../../glsl-format.js';
import { spectralData } from '../../spectral/data.js';
import { measuredTables } from './data.js';
import { reflectanceTables, emissionTables } from './colors.js';

/** The role of the settings a table goes in. */
type TableRole = Extract<SpectrumRole, 'optical' | 'reflectance' | 'emission'>;

/** Every shipped table, as interleaved (λ nm, value) pairs, with its role and the file that
 *  holds it: the metals' optical constants (data.ts), the ColorChecker reflectances and the CIE
 *  illuminants (colors.ts). */
const TABLES: Readonly<Record<string, { role: TableRole; file: string; pairs: readonly number[] }>> = Object.fromEntries([
    ...Object.entries(measuredTables).map(([name, pairs]) => [name, { role: 'optical', file: 'data.ts', pairs }] as const),
    ...Object.entries(reflectanceTables).map(([name, pairs]) => [name, { role: 'reflectance', file: 'colors.ts', pairs }] as const),
    ...Object.entries(emissionTables).map(([name, pairs]) => [name, { role: 'emission', file: 'colors.ts', pairs }] as const),
]);

export function isMeasured(value: unknown): value is MeasuredValue {
    return typeof value === 'object' && value !== null && 'measured' in value;
}

/** The names of the shipped tables: data.ts order, then colors.ts order. A light-table row
 *  header names a table by its index here. */
export const measuredNames: readonly string[] = Object.keys(TABLES);

/** The role of the settings a table goes in. */
export function measuredRole(name: string): TableRole {
    const table = TABLES[name];
    if (table === undefined) throw new Error(`unknown measured spectrum '${name}'`);
    return table.role;
}

/** A table's knots: wavelengths in nm (increasing) and values. A table that starts above
 *  360 nm or ends below 830 nm (the renderer's wavelengths) is extended by its end values to
 *  one nm beyond that range: pbrt-v4's PiecewiseLinearSpectrum::FromInterleaved
 *  (src/pbrt/util/spectrum.cpp:135-149 at commit b0bdf461), which reads every named spectrum
 *  this way. */
export function measuredKnots(name: string): { lambda: number[]; value: number[] } {
    const pairs = TABLES[name]?.pairs;
    if (pairs === undefined) throw new Error(`unknown measured spectrum '${name}'`);
    const nm: number[] = [], value: number[] = [];
    for (let i = 0; i < pairs.length; i += 2) {
        nm.push(pairs[i]);
        value.push(pairs[i + 1]);
    }
    if (nm[0] > spectralData.lambdaMin) {
        nm.unshift(spectralData.lambdaMin - 1);
        value.unshift(value[0]);
    }
    if (nm[nm.length - 1] < spectralData.lambdaMax) {
        nm.push(spectralData.lambdaMax + 1);
        value.push(value[value.length - 1]);
    }
    return { lambda: nm, value };
}

/** Binary-search steps that bracket λ between adjacent knots: ⌈log₂(n − 1)⌉ for n knots. */
export function searchSteps(knots: number): number {
    return Math.ceil(Math.log2(knots - 1));
}

/** The table at λ (nm), linear between knots: pbrt-v4's PiecewiseLinearSpectrum. λ must lie
 *  within the knots, which cover the renderer's wavelengths, 360–830 nm. The TS twin of the
 *  GLSL helper (measuredGLSL): the same bracketing search, then the same interpolation. */
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

/** An emission table's RGB at unit reference CIE Y, and the factor that brings the table to
 *  that luminance (unitLuminanceStandIn). */
export function measuredEmission(name: string): { rgb: Vec3; normalization: number } {
    return unitLuminanceStandIn(lambda => measuredValue(name, lambda));
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
        `// '${name}' (color/spectra/measured/${TABLES[name].file}): linear between ${n} knots in λ (nm).`,
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

type Entry = MeasuredValue['measured'];

/** The `measured` entry if it is an object. The census runs before validation, so it must
 *  tolerate a malformed value; the compiler's check of `fields` reports it. */
function entry(v: MeasuredValue): Partial<Entry> {
    const m: unknown = v.measured;
    return typeof m === 'object' && m !== null && !Array.isArray(m) ? m as Partial<Entry> : {};
}

/** Whether the value names an emission table (an illuminant). */
function emits(v: MeasuredValue): boolean {
    const { table } = entry(v);
    return typeof table === 'string' && Object.hasOwn(TABLES, table) && TABLES[table].role === 'emission';
}

/** The scale at the given slider values (a slider's default when absent); 1 when not
 *  authored. */
function scaleAt(scale: Entry['scale'], params: Record<string, unknown>): number {
    if (scale === undefined) return 1;
    return isValueParam(scale) ? ((params[scale.param] as number) ?? scale.default!) : scale;
}

const article = (word: string) => /^[aeiou]/.test(word) ? 'an' : 'a';

/** `{ measured: { table, scale? } }`: a measured spectrum (data.ts, colors.ts), read per
 *  wavelength lane. A table goes in settings of its own role: a metal's η or κ in optical
 *  settings, a ColorChecker patch in reflectance settings, an illuminant in emission settings.
 *  An illuminant is normalized to unit reference CIE Y and multiplied by `scale` (default 1),
 *  as a blackbody is. */
export const measuredKind: SpectrumKind<MeasuredValue> = {
    id: 'measured',
    label: 'measured',
    is: isMeasured,
    roles: ['optical', 'reflectance', 'emission'],
    liveParams(v) {
        const { scale } = entry(v);
        return isValueParam(scale) ? [scale.param] : [];
    },
    fields: {
        table: { name: true },
        scale: { domain: { kind: 'nonnegative' }, slider: true, optional: true },
    },
    validate(v, label, report, role) {
        const { table, scale } = v.measured;
        if (!Object.hasOwn(TABLES, table)) {
            const known = measuredNames.filter(name => TABLES[name].role === role);
            report(`${label}: unknown measured spectrum ${JSON.stringify(table)} (${role} tables: ${known.join(', ')})`);
            return;
        }
        const own = TABLES[table].role;
        if (own !== role) report(`${label}: the measured table '${table}' is ${article(own)} ${own} spectrum, and this setting takes ${article(role)} ${role} value`);
        else if (scale !== undefined && own !== 'emission') report(`${label}: scale applies only to emission tables, and '${table}' is ${article(own)} ${own} spectrum`);
    },
    toRGB(v, _role, params) {
        const { table, scale } = v.measured;
        if (TABLES[table].role !== 'emission') return d65StandIn(lambda => measuredValue(table, lambda));
        const s = scaleAt(scale, params);
        return measuredEmission(table).rgb.map(c => c * s) as Vec3;
    },
    constantNonzero(v) {
        const { scale } = entry(v);
        return emits(v) && (scale === undefined || (typeof scale === 'number' && scale > 0));
    },
    mayBeNonzero(v) {
        const { scale } = entry(v);
        return emits(v) && (scale === undefined || isValueParam(scale) || (typeof scale === 'number' && scale > 0));
    },
    dispersive: () => false,
    // One function per table the program evaluates, so a gold-only scene carries no silver.
    glsl: (values) => ({
        origin: 'generated:measured-spectra',
        source: measuredNames.filter(name => values.some(v => v.measured.table === name)).map(measuredGLSL).join('\n\n'),
    }),
    emit(v, ctx) {
        const { table, scale = 1 } = v.measured;
        const call = `${functionName(table)}(${ctx.wl})`;
        if (TABLES[table].role !== 'emission') return call;
        return `(${ctx.bind(scale, formatFloat)} * ${formatFloat(measuredEmission(table).normalization)} * ${call})`;
    },
    mint(v, ctx) {
        const { scale } = v.measured;
        if (scale !== undefined) ctx.mint(scale, 'float', 'float', true);
    },
    // A light-table row header holds the illuminant's index in measuredNames and its scale times
    // its normalization; the reader selects among the illuminants the program holds.
    packed: {
        code: 2,
        header(v) {
            const { table, scale = 1 } = v.measured;
            if (isValueParam(scale)) throw new Error('light table requires a constant measured scale');
            return [measuredNames.indexOf(table), scale * measuredEmission(table).normalization];
        },
        read(header, wl, values) {
            const tables = measuredNames.filter(name => TABLES[name].role === 'emission' && values.some(v => v.measured.table === name));
            if (tables.length === 0) return null;
            // A row tagged with this kind holds one of these tables, so the last arm is unconditional.
            const select = tables.slice(0, -1).reduceRight((inner, name) =>
                `(int(${header}.z) == ${measuredNames.indexOf(name)} ? ${functionName(name)}(${wl}) : ${inner})`,
                `${functionName(tables[tables.length - 1])}(${wl})`);
            return `(${header}.w * ${select})`;
        },
    },
};
