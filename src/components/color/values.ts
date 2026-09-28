// Questions the compiler asks about an authored spectrum value, answered by the value's kind
// (spectrumKinds.ts). Classification is independent of the transport representation.
import type { Vec3 } from '../../compiler/types.js';
import { kindOf, namedKindOf } from './spectra/index.js';

export { isValueParam } from '../param.js';
export { isBlackbody } from './spectra/blackbody/blackbody.js';
export { indexReferenceNM } from './spectra/spectrumKind.js';

/** Parameter paths read by an authored value. Constant blackbodies have no dependencies. */
export function radiometricValueDeps(v: unknown): string[] {
    return kindOf(v).liveParams(v);
}

export function isDrivenRadiometric(v: unknown): boolean {
    return radiometricValueDeps(v).length > 0;
}

/** Eligibility for a constant-power emitter roster. Driven values are excluded. */
export function hasConstantNonzeroEmission(emission: unknown): boolean {
    return kindOf(emission).constantNonzero(emission);
}

/** Whether emission can contribute: positive constants or a runtime binding/expression. */
export function emissionMayBeNonzero(v: unknown): boolean {
    return kindOf(v).mayBeNonzero(v);
}

/** RGB projection for shader constants, live uniforms, and RGB light-selection data. */
export function projectRGB(v: unknown, params: Record<string, unknown> = {}): Vec3 {
    return kindOf(v).toRGB(v, 'emission', params) as Vec3;
}

/** A light-table row header for a kind kept whole in the row ([code, a, b]), or null for a
 *  plain RGB payload. */
export function packedEmissionHeader(v: unknown): [number, number, number] | null {
    const packed = namedKindOf(v)?.packed;
    return packed ? [packed.code, ...packed.header(v)] : null;
}
