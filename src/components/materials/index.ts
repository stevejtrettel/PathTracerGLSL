// Material-model registry (mix-many family, module-anatomy §5). Feature planners iterate
// the models PRESENT in the plan and look descriptors up here — adding a model is one
// GLSL file + one descriptor + one line below, and NOTHING else (true since the
// July 2026 union→string batch: model ids are strings like every other family;
// this registry + the Validator's unknown-model rejection gatekeep).

import type { MaterialModel } from '../../compiler/types.js';
import type { MaterialModelDescriptor } from '../descriptors.js';
import { lambertDescriptor } from './lambert/lambert.js';
import { dielectricDescriptor } from './dielectric/dielectric.js';
import { ggxDescriptor } from './ggx/ggx.js';
import { mirrorDescriptor } from './mirror/mirror.js';

export const MATERIAL_MODELS: Partial<Record<MaterialModel, MaterialModelDescriptor>> = {
    lambert: lambertDescriptor,
    dielectric: dielectricDescriptor,
    ggx: ggxDescriptor,
    mirror: mirrorDescriptor,
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

/** The ONE property key compiler POLICY reads by name: emission feeds the light desugar,
 *  the sampleAsLight registry, and the emission gate — a cross-model concept paired with
 *  `capabilities.emissive` (an emissive-capable model declares a row with this source).
 *  Everything else is read only through schema rows; ior is found structurally (the
 *  declaring model's region-table row), never by name. */
export const EMISSION_KEY = 'emission';
