// components/transport/combiner.ts
// The COMBINER (fable-components §7, pinned July 2026: the technique-centric carve).
//
// Two techniques (kernel sampling T1, light sampling T2) estimate the SAME direct-
// lighting term; run both at full weight and every samplable emitter is counted twice.
// The combiner is the partition of unity that keeps them honest — it owns every line
// where a technique's estimate is weighted and added. The three directLighting
// strategies are three configurations of THESE functions and nothing else (§11.2's
// "pt/pt-nee/pt-mis differ only in weights", now structural):
//
//   strategy | T2 (light sample)         | T1 (kernel-found emitter / env)
//   pt       | technique absent          | 1 (no weight code emitted)
//   pt-nee   | 1                         | 0 for samplable, 1 post-delta (support rule)
//   pt-mis   | power_heuristic(pL, pK)   | power_heuristic(pK, pL)
//
// T1's weights are evaluated at its DEFERRED scoring sites (emitter-hit, miss) using the
// sampling record it carried forward (prev_bsdf_pdf/prev_p) — see techniques/kernel.ts.

import type { Flags } from './flags.js';

/** T1's weight at the surface emitter-hit site (inside the `lid_emit ≥ 0 && !prev_was_delta`
 *  guard — the support rule already handled: delta-preceded hits keep weight 1). */
export function t1EmitterWeight(f: Flags): string[] {
    if (f.mis) {
        return ['                w_emit = power_heuristic(prev_bsdf_pdf, lighting_pdf(prev_p, current_ray.direction, lid_emit, hit));'];
    }
    return ['                w_emit = 0.0;'];
}

/** T1's weight at the miss site (samplable environment — same table, boundary row). */
export function t1MissWeight(f: Flags): string[] {
    if (f.mis) {
        return [
            '                // The selection factor (u_envSelectProb) mirrors lighting_sample\'s stage 0 —',
            '                // total pdf symmetry (§6.1).',
            '                w_env = power_heuristic(prev_bsdf_pdf, u_envSelectProb * environment_pdf(current_ray.direction));',
        ];
    }
    return ['                w_env = 0.0;'];
}

/** T2's weighted score at the surface site: balance against the kernel's density
 *  (reference §8 line 2); delta lights get weight 1 — T1 can never hit them (§6.4). */
export function t2SurfaceScore(f: Flags): string[] {
    if (f.mis) {
        return [
            '                    // Reference §8 line 2: balance the light sample against the BSDF\'s density.',
            '                    // Delta lights get weight 1 — BSDF sampling can never hit them (§6.4).',
            '                    float w_l = 1.0;',
            '                    if ((ls.flags & LIGHT_DELTA) == 0u) {',
            '                        w_l = power_heuristic(ls.pdf, interaction_surface_pdf(mat, ls.wi, wo, hit, props));',
            '                    }',
            '                    radiance += throughput * ls.radiance * f * cos_i * vis * w_l / ls.pdf;',
        ];
    }
    return ['                    radiance += throughput * ls.radiance * f * cos_i * vis / ls.pdf;'];
}

/** T2's weighted score at the medium site: balance against the phase density — no
 *  cosine anywhere (§2.2: the cosine is a surface Jacobian). */
export function t2MediumScore(f: Flags): string[] {
    if (f.mis) {
        return [
            '                            // Reference §8\'s closing line: the medium-side NEE weight balances',
            '                            // against the phase density (hg_pdf) — no cosine anywhere (§2.2).',
            '                            float w_m = 1.0;',
            '                            if ((ls.flags & LIGHT_DELTA) == 0u) {',
            '                                w_m = power_heuristic(ls.pdf, hg_pdf(ls.wi, wo_med, m_evt));',
            '                            }',
            '                            radiance += throughput * ls.radiance * hg_eval(ls.wi, wo_med, m_evt) * vis * w_m / ls.pdf;',
        ];
    }
    return ['                            radiance += throughput * ls.radiance * hg_eval(ls.wi, wo_med, m_evt) * vis / ls.pdf;'];
}
