// Authored radiometric and index forms: classification is independent of the transport representation.
import type { Value, ValueParam, BlackbodyValue, Vec3, SpectralIndex } from '../../compiler/types.js';
import { blackbodyRGB } from './blackbody/blackbody.js';
import { isCauchyIndex, cauchyIndex } from './cauchy/cauchy.js';
import { isSellmeierIndex, sellmeierIndex } from './sellmeier/sellmeier.js';

export function isValueParam<T>(v: Value<T>): v is ValueParam<T> {
    return typeof v === 'object' && v !== null && !Array.isArray(v) && 'param' in v;
}

export function isBlackbody(v: unknown): v is BlackbodyValue {
    return typeof v === 'object' && v !== null && 'blackbody' in v;
}

/** Parameter paths read by an authored value. Constant blackbodies have no dependencies. */
export function radiometricValueDeps(v: unknown): string[] {
    if (isValueParam(v)) return [v.param];
    if (isBlackbody(v)) {
        const { kelvin, scale } = v.blackbody;
        return [...(isValueParam(kelvin) ? [kelvin.param] : []), ...(scale !== undefined && isValueParam(scale) ? [scale.param] : [])];
    }
    return [];
}

export function isDrivenRadiometric(v: unknown): boolean {
    return radiometricValueDeps(v).length > 0;
}

/** Eligibility for a constant-power emitter roster. Driven values are excluded. */
export function hasConstantNonzeroEmission(emission: unknown): boolean {
    if (typeof emission === 'number') return emission !== 0;
    if (Array.isArray(emission)) return emission.some((c) => typeof c === 'number' && c !== 0);
    if (isBlackbody(emission)) {
        const { kelvin, scale } = emission.blackbody;
        return !isValueParam(kelvin) && (scale === undefined || (!isValueParam(scale) && scale !== 0));
    }
    return false;
}

/** Whether emission can contribute: positive constants or a runtime binding/expression. */
export function emissionMayBeNonzero(v: unknown): boolean {
    if (v === undefined) return false;
    if (typeof v === 'number') return v > 0;
    if (Array.isArray(v)) return v.some(c => c > 0);
    if (isBlackbody(v)) {
        const scale = v.blackbody.scale;
        return scale === undefined || isValueParam(scale) || scale > 0;
    }
    return true;
}

/** RGB projection for shader constants, live uniforms, and RGB light-selection data. */
export function projectRGB(v: number | number[] | ValueParam<number | number[]> | BlackbodyValue, params: Record<string, unknown> = {}): Vec3 {
    if (isBlackbody(v)) {
        const { kelvin, scale } = v.blackbody;
        return blackbodyRGB(
            isValueParam(kelvin) ? ((params[kelvin.param] as number) ?? kelvin.default!) : kelvin,
            scale === undefined ? 1 : isValueParam(scale) ? ((params[scale.param] as number) ?? scale.default!) : scale,
        );
    }
    const raw = isValueParam(v) ? params[v.param] ?? v.default : v;
    return typeof raw === 'number' ? [raw, raw, raw] : raw as Vec3;
}

/** Helium d line, in nm: the RGB preview's fixed index reference. */
export const indexReferenceNM = 587.5618;
export type IndexForm = 'cauchy' | 'sellmeier';

export function isSpectralIndex(value: unknown): value is SpectralIndex {
    return isCauchyIndex(value) || isSellmeierIndex(value);
}

export function indexForm(value: SpectralIndex): IndexForm {
    return isCauchyIndex(value) ? 'cauchy' : 'sellmeier';
}

export function evaluateIndex(value: SpectralIndex, lambdaNM: number): number {
    return isCauchyIndex(value) ? cauchyIndex(value, lambdaNM) : sellmeierIndex(value, lambdaNM);
}

export function indexIsDispersive(value: unknown): boolean {
    if (isCauchyIndex(value)) return value.cauchy[1] !== 0 || (value.cauchy[2] ?? 0) !== 0;
    if (isSellmeierIndex(value)) return value.sellmeier.B.some((b, i) => b !== 0 && value.sellmeier.C[i] !== 0);
    return false;
}
