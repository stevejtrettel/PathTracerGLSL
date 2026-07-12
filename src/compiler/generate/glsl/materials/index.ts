// Material-model registry (mix-many family, module-anatomy §5). Feature planners iterate
// the models PRESENT in the plan and look descriptors up here — adding a model is one
// GLSL file + one descriptor + one line below, and nothing else (the extension-cost test).
// (Temporary location: moves to glsl/materials/index.ts in the R1c family-folder reorg.)

import type { MaterialModel } from '../../../types.js';
import type { MaterialModelDescriptor } from '../../descriptors.js';
import { lambertDescriptor } from './lambert.js';
import { dielectricDescriptor } from './dielectric.js';

export const MATERIAL_MODELS: Partial<Record<MaterialModel, MaterialModelDescriptor>> = {
    lambert: lambertDescriptor,
    dielectric: dielectricDescriptor,
};

/** Lookup that throws on unregistered models — the Validator rejects them upstream
 *  (reject-not-remove), so this is an unreachable backstop, not a diagnostic. */
export function materialModel(id: MaterialModel): MaterialModelDescriptor {
    const d = MATERIAL_MODELS[id];
    if (!d) throw new Error(`material model '${id}' has no descriptor (Validator should have rejected it)`);
    return d;
}

/** Transmission capability, safe over 'none' (a boundary classification, not a model)
 *  and unregistered models — both transmit nothing. */
export function modelTransmission(id: MaterialModel): boolean {
    return id !== 'none' && (MATERIAL_MODELS[id]?.capabilities.transmission ?? false);
}
