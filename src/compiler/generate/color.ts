import type { RadiometricRole } from '../../components/descriptors.js';

/** Evaluate authored RGB at the current wavelengths, after authored arithmetic. */
export function emitColor(rgb: string, role: RadiometricRole, wl: string): string {
    return `color_lift_${role}(${rgb}, ${wl})`;
}
