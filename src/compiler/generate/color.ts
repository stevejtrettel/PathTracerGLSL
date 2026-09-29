import { emitValue, type ParamValue } from './values.js';
import type { IndexProperty, GlslExpression } from '../types.js';
import type { RadiometricRole, SpectrumRole } from '../../components/descriptors.js';
import { kindOf } from '../../components/color/spectra/index.js';
import type { EmitContext } from '../../components/color/spectra/spectrumKind.js';

/** The RGB kind's evaluation: the color model's lift of an RGB expression, in a role, at the
 *  wavelengths. Only the RGB kind reaches it, through its EmitContext. */
function emitColor(rgb: string, role: RadiometricRole, wl: string): string {
    return `color_lift_${role}(${rgb}, ${wl})`;
}

/** A value whose numbers a GLSL expression computes (the expression binding): an image lookup,
 *  a procedural formula, a clamped field, a packed light-table payload. */
export function glslValue(source: string): GlslExpression {
    return { kind: 'glsl', source };
}

/** Where a spectrum is emitted: the GLSL expression of the wavelength carrier, the program's
 *  color model, a scalar strength multiplying the value (the sky's intensity), and the GLSL
 *  expression of the instance index when one is in scope (a per-instance value needs it). */
export interface SpectrumSite {
    wl: string;
    color: 'rgb' | 'spectral';
    factor?: string;
    instance?: string;
}

/** What a spectrum kind needs from the compiler to emit a value in this role. */
export function spectrumContext(role: SpectrumRole, site: SpectrumSite): EmitContext {
    return {
        role, wl: site.wl, spectral: site.color === 'spectral', factor: site.factor,
        bind: (value, format) => emitValue(value as ParamValue, format, { instance: site.instance }),
        lift: (rgb) => emitColor(rgb, role as RadiometricRole, site.wl),
    };
}

/** A spectrum setting's GLSL at the site's wavelengths: its value's kind writes it, with the
 *  numbers bound by emitValue. */
export function emitSpectrum(value: ParamValue, role: RadiometricRole, site: SpectrumSite): string {
    return kindOf(value).emit(value, spectrumContext(role, site));
}

/** Index reads keep the surface formula separate from radiometric RGB lifting: the value's
 *  kind emits the index at the hero wavelength, or its d-line value in RGB programs. */
export function emitIndex(value: IndexProperty, color: 'rgb' | 'spectral'): string {
    return kindOf(value).emit(value, spectrumContext('index', { wl: 'wl', color }));
}
