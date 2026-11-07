// The daylight stand-in of a spectral function: what an RGB program uses for a value that a
// spectral program evaluates at each wavelength (a reflectance band, a measured optical constant).

import type { Vec3 } from '../../../compiler/types.js';
import { cie1931Curves } from '../../sensor/cie1931/curves.js';
import { d65Curve } from '../spectral/d65.js';
import { spectralData } from '../spectral/data.js';

/** The RGB stand-in of g(λ) (λ in nm): daylight (D65) weighted by g, in linear sRGB, divided
 *  channel by channel by the same projection of the constant 1:
 *  s_c = ∫ g · D65 · (M x̄)_c dλ / ∫ D65 · (M x̄)_c dλ.
 *  The color-matching functions and D65 are the tabulated samples, linear between 5 nm knots;
 *  Simpson's rule at 0.5 nm within each interval. g ≡ 1 gives (1, 1, 1); a saturated g can
 *  fall outside [0, 1]. */
export function d65StandIn(g: (lambda: number) => number): Vec3 {
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
            const value = g(lambda);
            for (let c = 0; c < 3; c++) {
                const response = M[c][0] * cmf[0] + M[c][1] * cmf[1] + M[c][2] * cmf[2];
                num[c] += value * light * response;
                den[c] += light * response;
            }
        }
    }
    return [num[0] / den[0], num[1] / den[1], num[2] / den[2]];
}
