// components/transport/techniques/light.ts
// T2 — LIGHT SAMPLING / NEE (fable-components §7, the technique-centric carve).
//
// Draws a point on an emitter from the registry's density and evaluates the kernel
// toward it. Unlike T1, both endpoints of the edge are known immediately — so T2
// samples AND scores at the same vertex: sample, shadow-test, add the weighted
// contribution, done locally. Two sites (surface, medium), differing exactly where the
// pinned surface/medium symmetry says: the surface site applies the cosine (a surface
// Jacobian, §2.2), the medium site never does. Weights come from the combiner.
// A future placement variant (equiangular medium NEE) is a SECOND occupant of this
// technique's slot — one new file, this shape.

import type { Flags } from '../flags.js';
import { t2SurfaceScore, t2MediumScore } from '../combiner.js';

/** Surface site: sample + shadow test + local score. Pure-delta materials skip it —
 *  their eval is zero, the shadow march would be wasted. */
export function lightSurfaceSite(f: Flags): string[] {
    if (!f.nee) return [];
    return [
        '        // Next Event Estimation (explicit xi — §2.9; delta lights ignore it). Pure-delta',
        '        // materials skip it entirely: their eval is zero, the shadow march would be wasted.',
        '        if (material_has_nondelta_lobes(mat)) {',
        '            LightSample ls = lighting_sample(hit.p, random2());',
        '            if (ls.pdf > 0.0) {',
        '                // §6.3: per-channel transmittance. Back-off is 2·EPSILON: ray_spawn moved the origin',
        '                // up to EPSILON along the normal, so an AREA light\'s own surface can sit at exactly',
        '                // distance−EPSILON from the spawned origin (the dark-tops bug).',
        '                Ray shadow_ray = ray_spawn(hit, ls.wi);',
        '                Spectrum vis = shadow_transmittance(shadow_ray, ls.distance - 2.0 * EPSILON);',
        '                if (!spectrum_is_black(vis)) {',
        '                    Spectrum f = interaction_surface_eval(mat, ls.wi, wo, hit, props);  // bare f (§2.2)',
        '                    float cos_i = abs(ambient_dot(ls.wi, hit.frame.n, hit.p));          // transport applies the cosine (metric)',
        ...t2SurfaceScore(f),
        '                }',
        '            }',
        '        }',
        '',
    ];
}

/** Medium site: phase EVAL, NO cosine (§2.2). Spectral shadow query (shadow_media)
 *  walks the segments. */
export function lightMediumSite(f: Flags): string[] {
    if (!f.nee) return [];
    return [
        '                // NEE from the medium point: phase EVAL, NO cosine (§2.2 — the cosine is a',
        '                // surface Jacobian). Spectral shadow query (shadow_media) walks the segments.',
        '                {',
        '                    MediumProperties m_evt = scene_medium_properties(med_mat, p_evt);',
        '                    LightSample ls = lighting_sample(p_evt, random2());',
        '                    if (ls.pdf > 0.0) {',
        '                        // Same 2·EPSILON back-off as the surface site: an AREA light\'s sampled point',
        '                        // is ON the emitter\'s surface — a 1·EPSILON far bound is a float coin flip.',
        '                        Spectrum vis = shadow_transmittance(make_ray(p_evt, ls.wi), ls.distance - 2.0 * EPSILON);',
        '                        if (!spectrum_is_black(vis)) {',
        ...t2MediumScore(f),
        '                        }',
        '                    }',
        '                }',
    ];
}

/** The seams T2's emitted code calls under these flags. */
export function lightRequires(f: Flags): string[] {
    if (!f.nee) return [];
    const req = ['lighting_sample', 'shadow_transmittance', 'material_has_nondelta_lobes', 'interaction_surface_eval'];
    if (f.mis) req.push('interaction_surface_pdf');
    if (f.scattering) {
        req.push('hg_eval');
        if (f.mis) req.push('hg_pdf');
    }
    return req;
}
