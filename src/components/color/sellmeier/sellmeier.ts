import type { SellmeierIndex } from '../../../compiler/types.js';

export function isSellmeierIndex(value: unknown): value is SellmeierIndex {
    return typeof value === 'object' && value !== null && 'sellmeier' in value;
}

/** Coefficients follow the three-term convention with wavelength in micrometres. */
export function sellmeierIndex(value: SellmeierIndex, lambdaNM: number): number {
    const { B, C } = value.sellmeier;
    const lambda2 = (lambdaNM / 1000) ** 2;
    return Math.sqrt(1 + B.reduce((sum, b, i) => sum + b * lambda2 / (lambda2 - C[i]), 0));
}
