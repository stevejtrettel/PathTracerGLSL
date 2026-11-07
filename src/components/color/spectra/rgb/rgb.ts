// The plain spectrum kind: a number (gray, or one index at every wavelength), an RGB triple, a
// {param}, a GLSL expression or a per-instance attribute.

import type { Vec3 } from '../../../../compiler/types.js';
import type { SpectrumKind } from '../spectrumKind.js';
import { isValueParam } from '../../../param.js';
import { formatFloat, formatSpectrum } from '../../../glsl-format.js';

/** Plain values. In RGB programs a typed color is used exactly as typed; in spectral programs
 *  the colour model lifts it by the slot's role (an optical constant like a coefficient). */
export const rgbKind: SpectrumKind = {
    id: 'rgb',
    label: 'RGB',
    // The fallback: kindOf returns it for anything the named kinds do not claim.
    is: (_value): _value is unknown => true,
    roles: ['reflectance', 'coefficient', 'emission', 'index', 'optical'],
    liveParams: v => isValueParam(v) ? [v.param] : [],
    toRGB(v, _role, params) {
        const raw = isValueParam(v) ? params[v.param] ?? v.default : v;
        return typeof raw === 'number' ? [raw, raw, raw] : raw as Vec3;
    },
    constantNonzero: v => typeof v === 'number' ? v > 0
        : Array.isArray(v) ? v.some(c => typeof c === 'number' && c > 0) : false,
    mayBeNonzero: v => v === undefined ? false
        : typeof v === 'number' ? v > 0
        : Array.isArray(v) ? v.some(c => c > 0) : true,
    dispersive: () => false,
    emit(v, ctx) {
        if (ctx.role === 'index') return ctx.bind(v, formatFloat);
        return ctx.lift(ctx.bind(v, formatSpectrum));
    },
};
