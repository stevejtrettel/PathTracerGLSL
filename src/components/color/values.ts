// Authored radiometric forms: classification is independent of the transport representation.
import type { Value, ValueParam, BlackbodyValue, Vec3 } from '../../compiler/types.js';
import { blackbodyRGB } from './rgb/blackbody.js';

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
            isValueParam(kelvin) ? ((params[kelvin.param] as number) ?? kelvin.default ?? 6500) : kelvin,
            scale === undefined ? 1 : isValueParam(scale) ? ((params[scale.param] as number) ?? scale.default ?? 1) : scale,
        );
    }
    const raw = isValueParam(v) ? params[v.param] ?? v.default : v;
    return typeof raw === 'number' ? [raw, raw, raw] : raw as Vec3;
}
