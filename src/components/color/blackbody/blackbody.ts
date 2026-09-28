import type { Vec3 } from '../../../compiler/types.js';
import { cie1931Curves } from '../../sensor/cie1931/curves.js';
import { spectralData } from '../spectral/data.js';

export const blackbodyTemperatureRange = [1000, 40000] as const;
// Exact SI h*c/k, expressed in nm K; wavelengths in this renderer are nanometres.
export const planckC2 = 6.62607015e-34 * 299792458 / 1.380649e-23 * 1e9;

/** Planck radiance relative to 550 nm. Its common amplitude cancels in normalization. */
export function planckShape(lambda: number, kelvin: number): number {
    return (550 / lambda) ** 5 * Math.expm1(planckC2 / (550 * kelvin))
        / Math.expm1(planckC2 / (lambda * kelvin));
}

/** Temperature-only normalization against the fixed reference observer, independent of
 * the active camera sensor. Scale multiplies this spectrum after normalization. */
export function blackbodyColor(kelvin: number): { rgb: Vec3; normalization: number } {
    const xyz = [0, 0, 0];
    // Simpson quadrature in each 5 nm CMF interval. The response is piecewise linear;
    // this 0.5 nm rule is checked against an independent 0.25 nm reference.
    for (let interval = 0; interval < cie1931Curves.length - 1; interval++) {
        for (let sample = 0; sample <= 10; sample++) {
            const fraction = sample / 10;
            const lambda = 360 + 5 * (interval + fraction);
            const weight = 0.5 / 3 * (sample === 0 || sample === 10 ? 1 : sample % 2 ? 4 : 2);
            const value = weight * planckShape(lambda, kelvin) / spectralData.cieYIntegral;
            for (let channel = 0; channel < 3; channel++) {
                const response = cie1931Curves[interval][channel] * (1 - fraction)
                    + cie1931Curves[interval + 1][channel] * fraction;
                xyz[channel] += value * response;
            }
        }
    }
    const rgb = spectralData.xyzToRGB.map(row => row.reduce((sum, v, i) => sum + v * xyz[i], 0)) as Vec3;
    const normalization = 1 / Math.max(...rgb);
    return { rgb: rgb.map(v => v * normalization) as Vec3, normalization };
}

export function blackbodyRGB(kelvin: number, scale = 1): Vec3 {
    return blackbodyColor(kelvin).rgb.map(v => v * scale) as Vec3;
}
