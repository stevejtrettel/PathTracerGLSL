import { isBlackbody } from '../../components/color/values.js';
import { formatVec3 } from '../../components/glsl-format.js';
import { emitValue, emitBlackbody, type ParamValue } from './values.js';
import type { RadiometricRole } from '../../components/descriptors.js';

/** Evaluate authored RGB at the current wavelengths, after authored arithmetic. */
export function emitColor(rgb: string, role: RadiometricRole, wl: string): string {
    return `color_lift_${role}(${rgb}, ${wl})`;
}

/** Original spectral forms bypass RGB reconstruction; RGB inputs use their role's lift. */
export function emitSpectrum(value: ParamValue, role: RadiometricRole, wl: string, color: 'rgb' | 'spectral'): string {
    if (isBlackbody(value) && color === 'spectral') return emitBlackbody(value, color, wl);
    return emitColor(emitValue(value, formatVec3), role, wl);
}
