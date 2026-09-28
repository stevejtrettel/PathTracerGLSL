import type { CauchyIndex } from '../../../compiler/types.js';

/** Helium d line, in nm: the RGB preview's fixed index reference. */
export const indexReferenceNM = 587.5618;

export function isCauchyIndex(value: unknown): value is CauchyIndex {
    return typeof value === 'object' && value !== null && 'cauchy' in value;
}

/** Cauchy coefficients use micrometres: A + B/lambda² + C/lambda⁴. */
export function cauchyIndex(value: CauchyIndex, lambdaNM: number): number {
    const [a, b, c = 0] = value.cauchy;
    const inv2 = (1000 / lambdaNM) ** 2;
    return a + inv2 * (b + inv2 * c);
}

export function indexIsDispersive(value: unknown): boolean {
    return isCauchyIndex(value) && (value.cauchy[1] !== 0 || (value.cauchy[2] ?? 0) !== 0);
}
