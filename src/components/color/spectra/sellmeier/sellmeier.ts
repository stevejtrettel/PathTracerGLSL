import type { SellmeierIndex } from '../../../../compiler/types.js';
import { indexReferenceNM, type SpectrumKind } from '../spectrumKind.js';
import { spectralData } from '../../spectral/data.js';
import { formatFloat, formatVec3 } from '../../../glsl-format.js';
import sellmeierGLSL from './sellmeier.glsl?raw';

export function isSellmeierIndex(value: unknown): value is SellmeierIndex {
    return typeof value === 'object' && value !== null && 'sellmeier' in value;
}

/** Coefficients follow the three-term convention with wavelength in micrometres. */
export function sellmeierIndex(value: SellmeierIndex, lambdaNM: number): number {
    const { B, C } = value.sellmeier;
    const lambda2 = (lambdaNM / 1000) ** 2;
    return Math.sqrt(1 + B.reduce((sum, b, i) => sum + b * lambda2 / (lambda2 - C[i]), 0));
}

/** `{ sellmeier: { B, C } }`: a constant three-term Sellmeier index formula. Index only. */
export const sellmeierKind: SpectrumKind<SellmeierIndex> = {
    id: 'sellmeier',
    label: 'Sellmeier',
    is: isSellmeierIndex,
    roles: ['index'],
    liveParams: () => [],
    validate(v, label, report) {
        const coefficients = v.sellmeier;
        const validTriplet = (x: unknown): x is [number, number, number] => Array.isArray(x)
            && x.length === 3 && x.every(c => typeof c === 'number' && Number.isFinite(c) && c >= 0);
        if (!coefficients || !validTriplet(coefficients.B) || !validTriplet(coefficients.C)) {
            report(`${label}: Sellmeier requires constant finite nonnegative B and C triples (C in micrometres squared)`);
            return;
        }
        const min2 = (spectralData.lambdaMin / 1000) ** 2;
        const max2 = (spectralData.lambdaMax / 1000) ** 2;
        if (coefficients.C.some(c => c >= min2 && c <= max2)) {
            report(`${label}: Sellmeier poles must lie outside ${spectralData.lambdaMin}–${spectralData.lambdaMax} nm`);
        } else {
            // With B,C >= 0 and no poles, d(n²)/d(lambda²) = -sum(B*C/(lambda²-C)²) <= 0.
            // The red endpoint is therefore the minimum across the whole interval.
            const minIndex = sellmeierIndex(v, spectralData.lambdaMax);
            const maxIndex = sellmeierIndex(v, spectralData.lambdaMin);
            if (!(minIndex > 0) || !Number.isFinite(maxIndex))
                report(`${label}: Sellmeier must give finite positive n² throughout the spectral interval`);
        }
    },
    toRGB: v => sellmeierIndex(v, indexReferenceNM),
    // An index is never emission.
    constantNonzero: () => false,
    mayBeNonzero: () => false,
    glsl: { origin: 'components/color/spectra/sellmeier/sellmeier.glsl', source: sellmeierGLSL },
    dispersive: v => v.sellmeier.B.some((b, i) => b !== 0 && v.sellmeier.C[i] !== 0),
    emit(v, ctx) {
        // Every term with B = 0 or C = 0 is constant in wavelength; then so is the index.
        if (!sellmeierKind.dispersive(v)) return formatFloat(sellmeierIndex(v, indexReferenceNM));
        const { B, C } = v.sellmeier;
        return `sellmeier_index(${formatVec3(B)}, ${formatVec3(C)}, wavelengths_hero(${ctx.wl}))`;
    },
};
