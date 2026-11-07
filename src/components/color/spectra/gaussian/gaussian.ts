import type { GaussianValue, Vec3 } from '../../../../compiler/types.js';
import type { SpectrumKind } from '../spectrumKind.js';
import { d65StandIn } from '../standIn.js';
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

/** The RGB stand-in: the band's daylight projection (d65StandIn). A saturated band can fall
 *  outside [0, 1]. */
export function gaussianStandIn(v: GaussianValue): Vec3 {
    return d65StandIn(lambda => gaussianReflectance(v, lambda));
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
