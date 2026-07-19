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

export const LIGHT_KINDS: Record<string, LightKindDescriptor> = {
    point: pointLightDescriptor,
    quad: quadLightDescriptor,
    sphere: sphereLightDescriptor,
    disk: diskLightDescriptor,
    spot: spotLightDescriptor,
};

// radiantScalar lives in power.ts (D5: family-root shared part — occupants import it
// there, killing the registry↔occupant ESM cycle); re-exported for external callers.
export { radiantScalar } from './power.js';

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
