// Phase-model registry (mix-many family, module-anatomy §5). One occupant today (HG is
// v1's sole phase function — every medium's phase_g feeds it); Mie/Rayleigh arrive as
// one GLSL file + one descriptor + one line here.

import type { PhaseModelDescriptor } from '../descriptors.js';
import { hgDescriptor } from './hg/hg.js';
import { rayleighDescriptor } from './rayleigh/rayleigh.js';
import { draineDescriptor } from './draine/draine.js';

export const PHASE_MODELS: Record<string, PhaseModelDescriptor> = {
    hg: hgDescriptor,
    rayleigh: rayleighDescriptor,
    draine: draineDescriptor,
};

/** True iff the volume scattering model has a live occupant — the Validator's gate. */
export function isMediumModelSupported(id: string): boolean {
    return PHASE_MODELS[id] !== undefined;
}
