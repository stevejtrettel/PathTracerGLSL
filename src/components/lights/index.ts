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

export const LIGHT_KINDS: Record<string, LightKindDescriptor> = {
    point: pointLightDescriptor,
    quad: quadLightDescriptor,
    sphere: sphereLightDescriptor,
    disk: diskLightDescriptor,
};

/** Mean channel of a precomputed radiometric product (intensity or Le) — the scalar
 *  the pbrt power formulas weight by. Shared by every kind's `power` (§2.5 note: a
 *  CPU-side selection heuristic, not a radiometric reduction in GLSL —
 *  spectrum_average's discipline doesn't apply here). */
export function radiantScalar(product: number[]): number {
    return (product[0] + product[1] + product[2]) / 3;
}
