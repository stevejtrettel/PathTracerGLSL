import { emitValue, type ParamValue } from './values.js';
import type { RadiometricRole } from '../../components/descriptors.js';
import { kindOf } from '../../components/color/spectrumKinds.js';
import type { EmitContext, SpectrumRole } from '../../components/color/spectrumKind.js';

/** Evaluate authored RGB at the current wavelengths, after authored arithmetic. */
export function emitColor(rgb: string, role: RadiometricRole, wl: string): string {
    return `color_lift_${role}(${rgb}, ${wl})`;
}

/** What a spectrum kind needs from the compiler to emit a value in this role. */
export function spectrumContext(role: SpectrumRole, wl: string, color: 'rgb' | 'spectral', factor?: string): EmitContext {
    return {
        role, wl, spectral: color === 'spectral', factor,
        bind: (value, format) => emitValue(value as ParamValue, format),
        lift: (rgb) => emitColor(rgb, role as RadiometricRole, wl),
    };
}

/** A spectrum value at the current wavelengths, emitted by its kind. `factor` is a scalar
 *  strength (the constant sky's intensity). */
export function emitSpectrum(value: ParamValue, role: RadiometricRole, wl: string, color: 'rgb' | 'spectral', factor?: string): string {
    return kindOf(value).emit(value, spectrumContext(role, wl, color, factor));
}
