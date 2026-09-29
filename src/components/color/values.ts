// Questions the compiler asks about an authored spectrum value, answered by the value's kind
// (spectra/index.ts). Classification is independent of the transport representation.
import type { Vec3 } from '../../compiler/types.js';
import type { SpectrumRole } from '../descriptors.js';
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

/** What an RGB program shows for a value in a setting of this role, at the given slider values
 *  (their defaults when absent): the value's own RGB, or a named kind's stand-in (its `toRGB`).
 *  A reflectance is clipped to [0, 1]: the stand-in for something that reflects must itself
 *  reflect (analyze/rgbPreview.ts warns when this clips). */
export function rgbStandIn(v: unknown, role: SpectrumRole, params: Record<string, unknown> = {}): Vec3 | number {
    const rgb = kindOf(v).toRGB(v, role, params);
    return role === 'reflectance' ? (rgb as Vec3).map((c) => Math.min(1, Math.max(0, c))) as Vec3 : rgb;
}

/** The RGB of an emission value: for RGB programs' constants and uniforms, light-table
 *  payloads and light-selection power. */
export function projectRGB(v: unknown, params: Record<string, unknown> = {}): Vec3 {
    return rgbStandIn(v, 'emission', params) as Vec3;
}

/** A light-table row header for a kind kept whole in the row ([code, a, b]), or null for a
 *  plain RGB payload. */
export function packedEmissionHeader(v: unknown): [number, number, number] | null {
    const packed = namedKindOf(v)?.packed;
    return packed ? [packed.code, ...packed.header(v)] : null;
}
