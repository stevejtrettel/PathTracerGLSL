// Light-kind registry (mix-many family, module-anatomy §5). The kind-specific facts —
// sampler file, CDF power formula, dispatcher arm, lighting_pdf arm — live on the
// descriptors; lighting.ts composes them and owns everything cross-kind (selection CDF,
// cdf_rescale, the two-stage env wrapper). Adding a kind = one GLSL file + one
// descriptor + one line here.

import type { LightKindDescriptor } from '../descriptors.js';
import { pointLightDescriptor } from './point.js';
import { quadLightDescriptor } from './quad.js';
import { sphereLightDescriptor } from './sphere.js';

export const LIGHT_KINDS: Record<'point' | 'quad' | 'sphere', LightKindDescriptor> = {
    point: pointLightDescriptor,
    quad: quadLightDescriptor,
    sphere: sphereLightDescriptor,
};

/** Mean channel of color·intensity — the scalar the pbrt power formulas weight by.
 *  Shared by every kind's `power` (§2.5 note: a CPU-side selection heuristic, not a
 *  radiometric reduction in GLSL — spectrum_average's discipline doesn't apply here). */
export function emittedScalar(color: number[], intensity: number): number {
    return ((color[0] + color[1] + color[2]) / 3) * intensity;
}
