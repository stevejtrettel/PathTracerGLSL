// Light-kind registry (mix-many family, module-anatomy §5). The kind-specific facts —
// sampler file, CDF power formula, dispatcher arm, lighting_pdf arm — live on the
// descriptors; lighting.ts composes them and owns everything cross-kind (selection CDF,
// cdf_rescale, the two-stage env wrapper). Adding a kind = one GLSL file + one
// descriptor + one line here.

import type { LightKindDescriptor } from '../descriptors.js';
import { pointLightDescriptor } from './point/point.js';
import { quadLightDescriptor } from './quad/quad.js';
import { sphereLightDescriptor } from './sphere/sphere.js';
import { diskLightDescriptor } from './disk/disk.js';
import { spotLightDescriptor } from './spot/spot.js';
import { meshLightDescriptor } from './mesh/mesh.js';
import { directionalLightDescriptor } from './directional/directional.js';
import { beamLightDescriptor } from './beam/beam.js';
import { softbeamLightDescriptor } from './softbeam/softbeam.js';

export const LIGHT_KINDS: Record<string, LightKindDescriptor> = {
    point: pointLightDescriptor,
    quad: quadLightDescriptor,
    sphere: sphereLightDescriptor,
    disk: diskLightDescriptor,
    spot: spotLightDescriptor,
    mesh: meshLightDescriptor,   // data-driven; sampleAsLight-route only (fable-mesh-lights)
    directional: directionalLightDescriptor,   // delta-direction class (impl-plan-directional-beam)
    beam: beamLightDescriptor,                 // delta-direction class (impl-plan-directional-beam)
    softbeam: softbeamLightDescriptor,         // hittable finite-divergence beam (fable-emitter-profiles v0)
};

// radiantScalar lives in power.ts (D5: family-root shared part — occupants import it
// there, killing the registry↔occupant ESM cycle); re-exported for external callers.
export { radiantScalar } from './power.js';

/** NEE light-selection occupants (fable-light-bvh §2 — the carved axis). Membership +
 *  default only, the OBJECT_DISPATCHES precedent: the selection regimes differ
 *  structurally throughout the lighting feature (baked CDF chain vs the table-resident
 *  tree walk), so there is nothing per-occupant to emit — the Validator gatekeeps
 *  membership from these keys and the feature branches on the id.
 *  'power'   — the area-aware power CDF (position-blind; the founding occupant).
 *  'uniform' — the naive baseline CDF.
 *  'bvh'     — stochastic light-tree descent (spatially-aware O(log n) selection;
 *              accel/light_tree builds, the lighting feature emits the walk pair). */
export interface LightSelectionDescriptor { id: string; }
export const DEFAULT_LIGHT_SELECTION = 'power';
export const LIGHT_SELECTIONS: Record<string, LightSelectionDescriptor> = {
    power: { id: 'power' },
    uniform: { id: 'uniform' },
    bvh: { id: 'bvh' },
};

/** Apply the kind's authored-row defaults ONCE (D1: defaults-in-rows — the framework
 *  step every consumer goes through, so `toValues`/`region.parameters`/`validateAuthored`
 *  read plain values and can never disagree about a default). Returns a new record;
 *  authored values win. Computed defaults (spot's falloffStart = 0.8·angle) are NOT
 *  row defaults and remain the descriptor's own business. */
export function applyAuthoredDefaults(
    d: LightKindDescriptor,
    authored: Record<string, unknown>,
): Record<string, unknown> {
    const out = { ...authored };
    for (const p of d.authoredParams) {
        if (out[p.name] === undefined && p.default !== undefined) out[p.name] = p.default;
    }
    return out;
}
