import type { CauchyIndex } from '../../../../compiler/types.js';
import { indexReferenceNM, type SpectrumKind } from '../spectrumKind.js';
import { formatFloat, formatVec3 } from '../../../glsl-format.js';
import cauchyGLSL from './cauchy.glsl?raw';

export function isCauchyIndex(value: unknown): value is CauchyIndex {
    return typeof value === 'object' && value !== null && 'cauchy' in value;
}

/** Cauchy coefficients use micrometres: A + B/lambda² + C/lambda⁴. */
export function cauchyIndex(value: CauchyIndex, lambdaNM: number): number {
    const [a, b, c = 0] = value.cauchy;
    const inv2 = (1000 / lambdaNM) ** 2;
    return a + inv2 * (b + inv2 * c);
}

/** `{ cauchy: [A, B, C?] }`: a constant normal-dispersion index formula. Index only. */
export const cauchyKind: SpectrumKind<CauchyIndex> = {
    id: 'cauchy',
    label: 'Cauchy',
    is: isCauchyIndex,
    roles: ['index'],
    liveParams: () => [],
    validate(v, label, report) {
        const coefficients = v.cauchy;
        if (!Array.isArray(coefficients) || coefficients.length < 2 || coefficients.length > 3
            || coefficients.some(x => typeof x !== 'number' || !Number.isFinite(x))
            || !(coefficients[0] > 0) || coefficients.slice(1).some(x => x! < 0)) {
            report(`${label}: Cauchy requires constant [A, B, C?], with finite A > 0 and B, C >= 0 (micrometre units)`);
        }
    },
    toRGB: v => cauchyIndex(v, indexReferenceNM),
    // An index is never emission.
    constantNonzero: () => false,
    mayBeNonzero: () => false,
    glsl: { origin: 'components/color/spectra/cauchy/cauchy.glsl', source: cauchyGLSL },
    dispersive: v => v.cauchy[1] !== 0 || (v.cauchy[2] ?? 0) !== 0,
    emit(v, ctx) {
        // Without B and C the index is A at every wavelength.
        if (!cauchyKind.dispersive(v)) return formatFloat(cauchyIndex(v, indexReferenceNM));
        const [a, b, c = 0] = v.cauchy;
        return `cauchy_index(${formatVec3([a, b, c])}, ${ctx.wl}.lambda.x)`;
    },
};
