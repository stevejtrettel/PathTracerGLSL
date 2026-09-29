import { emitValue, standInUniform, type ParamValue } from './values.js';
import type { IndexProperty, GlslExpression } from '../types.js';
import type { RadiometricRole, SpectrumRole } from '../../components/descriptors.js';
import { kindOf, namedKindOf } from '../../components/color/spectra/index.js';
import type { EmitContext } from '../../components/color/spectra/spectrumKind.js';
import { rgbStandIn } from '../../components/color/values.js';

/** The RGB kind's evaluation: the color model's lift of an RGB expression, in a role, at the
 *  wavelengths. Only the RGB kind reaches it, through its EmitContext. */
function emitColor(rgb: string, role: RadiometricRole, wl: string): string {
    return `color_lift_${role}(${rgb}, ${wl})`;
}

/** A value whose numbers a GLSL expression computes (the expression binding): an image lookup,
 *  a procedural formula, a clamped field, a packed light-table payload, a derived uniform. */
export function glslValue(source: string): GlslExpression {
    return { kind: 'glsl', source };
}

/** Where a spectrum is emitted: the GLSL expression of the wavelength carrier, the program's
 *  color model, and the GLSL expression of the instance index when one is in scope (a
 *  per-instance value needs it). */
export interface SpectrumSite {
    wl: string;
    color: 'rgb' | 'spectral';
    instance?: string;
}

/** What a spectrum kind needs from the compiler to emit a value in this role. */
function spectrumContext(role: SpectrumRole, site: SpectrumSite): EmitContext {
    return {
        role, wl: site.wl,
        bind: (value, format) => emitValue(value as ParamValue, format, { instance: site.instance }),
        lift: (rgb) => emitColor(rgb, role as RadiometricRole, site.wl),
    };
}

/** The value a program evaluates: the value itself, except that an RGB program shows a named
 *  kind by its RGB stand-in (rgbStandIn): a literal, or the uniform carrying a live stand-in. */
function shown(value: ParamValue, role: SpectrumRole, site: SpectrumSite): ParamValue {
    const kind = namedKindOf(value);
    if (site.color === 'spectral' || kind === undefined) return value;
    return kind.liveParams(value).length === 0 ? rgbStandIn(value, role) as ParamValue : glslValue(standInUniform(value, role));
}

/** A spectrum setting's GLSL at the site's wavelengths: its value's kind writes it, with the
 *  numbers bound by emitValue. */
export function emitSpectrum(value: ParamValue, role: RadiometricRole, site: SpectrumSite): string {
    const v = shown(value, role, site);
    return kindOf(v).emit(v, spectrumContext(role, site));
}

/** An index setting's GLSL: its kind's index at the hero wavelength in a spectral program, its
 *  stand-in (the index at the d line) in an RGB program. */
export function emitIndex(value: IndexProperty, color: 'rgb' | 'spectral'): string {
    const site: SpectrumSite = { wl: 'wl', color };
    const v = shown(value as ParamValue, 'index', site);
    return kindOf(v).emit(v, spectrumContext('index', site));
}
