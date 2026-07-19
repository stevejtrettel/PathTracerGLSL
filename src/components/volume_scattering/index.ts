// Volume-scattering model registry (mix-many family, module-anatomy §5) — the phase
// functions media dispatch over (hg, rayleigh; Mie is the known next occupant). ONE
// family vocabulary (D5, owner-decided): folder, type, and registry all say
// volume_scattering; `phase_g`-style ROW names keep the physics word. Adding a model =
// one GLSL file + one descriptor + one line here.

import type { VolumeScatteringModelDescriptor } from '../descriptors.js';
import { hgDescriptor } from './hg/hg.js';
import { rayleighDescriptor } from './rayleigh/rayleigh.js';

export const VOLUME_SCATTERING_MODELS: Record<string, VolumeScatteringModelDescriptor> = {
    hg: hgDescriptor,
    rayleigh: rayleighDescriptor,
};

/** True iff the volume scattering model has a live occupant — the Validator's gate. */
export function isMediumModelSupported(id: string): boolean {
    return VOLUME_SCATTERING_MODELS[id] !== undefined;
}
