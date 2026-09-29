import type { GaussianValue, Vec3 } from '../../../../compiler/types.js';
import type { SpectrumKind } from '../spectrumKind.js';
import { cie1931Curves } from '../../../sensor/cie1931/curves.js';
import { d65Curve } from '../../spectral/d65.js';
import { spectralData } from '../../spectral/data.js';
import { formatFloat } from '../../../glsl-format.js';

export function isGaussian(value: unknown): value is GaussianValue {
    return typeof value === 'object' && value !== null && 'gaussian' in value;
}

/** Reflectance at one wavelength (nm). */
export function gaussianReflectance(v: GaussianValue, lambda: number): number {
    const { center, width, peak, floor = 0 } = v.gaussian;
    const d = (lambda - center) / width;
    return floor + (peak - floor) * Math.exp(-0.5 * d * d);
}

/** The RGB stand-in: daylight (D65) reflected by the band, in linear sRGB, divided channel by
 *  channel by the same projection of a perfect white reflector:
 *  s_c = ∫ g · D65 · (M x̄)_c dλ / ∫ D65 · (M x̄)_c dλ.
 *  The color-matching functions and D65 are the tabulated samples, linear between 5 nm knots;
 *  Simpson's rule at 0.5 nm within each interval. A saturated band can fall outside [0, 1]. */
export function gaussianStandIn(v: GaussianValue): Vec3 {
    const num = [0, 0, 0], den = [0, 0, 0];
    const M = spectralData.xyzToRGB;
    for (let interval = 0; interval < cie1931Curves.length - 1; interval++) {
        for (let sample = 0; sample <= 10; sample++) {
            const fraction = sample / 10;
            const lambda = 360 + 5 * (interval + fraction);
            const weight = 0.5 / 3 * (sample === 0 || sample === 10 ? 1 : sample % 2 ? 4 : 2);
            const lerp = (a: number, b: number) => a * (1 - fraction) + b * fraction;
            const cmf = [0, 1, 2].map(j => lerp(cie1931Curves[interval][j], cie1931Curves[interval + 1][j]));
            const light = weight * lerp(d65Curve[interval], d65Curve[interval + 1]);
            const g = gaussianReflectance(v, lambda);
            for (let c = 0; c < 3; c++) {
                const response = M[c][0] * cmf[0] + M[c][1] * cmf[1] + M[c][2] * cmf[2];
                num[c] += g * light * response;
                den[c] += light * response;
            }
        }
    }
    return [num[0] / den[0], num[1] / den[1], num[2] / den[2]];
}

/** `{ gaussian: { center, width, peak, floor? } }`: a reflectance band in nm (spec §2 of
 *  docs/claude-spectral-showcase-plan.md). Reflectance only; constants. */
export const gaussianKind: SpectrumKind<GaussianValue> = {
    id: 'gaussian',
    label: 'Gaussian',
    is: isGaussian,
    roles: ['reflectance'],
    liveParams: () => [],
    // Wavelengths in nm; peak and floor are reflectances.
    fields: {
        center: {},
        width: { domain: { kind: 'positive' } },
        peak: { domain: { kind: 'closed-interval', min: 0, max: 1 } },
        floor: { domain: { kind: 'closed-interval', min: 0, max: 1 }, optional: true },
    },
    toRGB: v => gaussianStandIn(v),
    // A reflectance is never emission.
    constantNonzero: () => false,
    mayBeNonzero: () => false,
    dispersive: () => false,
    emit(v, ctx) {
        const { center, width, peak, floor = 0 } = v.gaussian;
        // The square is written as a product: pow() of a negative base is undefined in GLSL.
        const shift = `(${ctx.wl}.lambda - ${formatFloat(center)})`;
        return `(Spectrum(${formatFloat(floor)}) + ${formatFloat(peak - floor)} * exp(${formatFloat(-0.5 / (width * width))} * ${shift} * ${shift}))`;
    },
};
