// components/transport/techniques/kernel.ts
// T1 — KERNEL SAMPLING (fable-components §7, the technique-centric carve).
//
// Draws the continuation direction from the material/phase kernel. That single draw
// serves TWO estimator terms: it is the recursion's next segment AND a sample of the
// direct-lighting term — whatever emission it lands on IS a direct-light estimate,
// drawn with the kernel's density. The subtlety that shapes this file: T1 cannot score
// that estimate where it samples — at vertex k the far endpoint doesn't exist yet, and
// the MIS weight is a function of the path EDGE. So T1 carries its sampling record
// forward (prev_bsdf_pdf / prev_p / prev_was_delta — the state below) and settles the
// score one vertex later, at the emitter-hit and miss sites. Weights come from the
// combiner; this file owns the sites and the record.
//
// PINNED: prevBookkeeping is the ONE emitter of the MIS state writes — the surface and
// medium sampling sites must agree by construction, never by reading.

import type { Flags } from '../flags.js';
import { t1EmitterWeight, t1MissWeight } from '../combiner.js';

/** T1's carried sampling record — declared in the integrator's state block. */
export function kernelStateDecls(f: Flags): string[] {
    const lines = [
        '',
        '    // §6.2 bookkeeping: the camera "bounce" counts as delta so bounce-0 emission is full-weight.',
        '    bool prev_was_delta = true;',
    ];
    if (f.mis) {
        lines.push(
            '    // Reference §8: the previous vertex and its sampled solid-angle pdf — the BSDF side of the',
            '    // emitter-hit power heuristic. Written at surface AND medium scattering events.',
            '    float prev_bsdf_pdf = 0.0;',
            '    Point prev_p = ray.origin;',
        );
    }
    return lines;
}

/** SAMPLING SITE, surface: draw the continuation from the BSDF, record the density. */
export function kernelSampleSurface(f: Flags): string[] {
    return [
        '        // BSDF sampling: sample-returns-weight collapses scatter+shade+pdf into one line (§2.1).',
        '        InteractionSample bs = interaction_surface_sample(mat, wo, hit, props, random(), random2());',
        '        if (spectrum_is_black(bs.weight)) break;',
        '        throughput *= bs.weight;',
        '        prev_was_delta = (bs.flags & LOBE_DELTA) != 0u;',
        ...prevBookkeeping(f, 'bs.pdf', 'hit.p', '        '),
        '',
    ];
}

/** SAMPLING SITE, medium: draw the continuation from the phase function. */
export function kernelSamplePhase(f: Flags): string[] {
    return [
        '                // Phase sample (§3.5): weight is SPECTRUM_ONE exactly — HG sampling is exact.',
        '                InteractionSample ps = hg_sample(wo_med, scene_medium_properties(med_mat, p_evt), random2());',
        '                throughput *= ps.weight;',
        '                prev_was_delta = false;',
        ...prevBookkeeping(f, 'ps.pdf', 'p_evt', '                '),
        '                current_ray = make_ray(p_evt, ps.wi);   // continue from the event — no surface offset',
        '',
    ];
}

/** DEFERRED SCORING SITE, emitter hit: the sample drawn at the PREVIOUS vertex found an
 *  emitter — settle its direct-lighting score with the carried record. Emission keys on
 *  region_to (§6.2); the combiner supplies the weight. */
export function kernelScoreEmitterHit(f: Flags): string[] {
    const lines = [
        '        // Emission keys on region_to (§6.2 side convention: you receive emission from the region',
        '        // ahead) — NOT on the owner. They differ at exits: leaving an emissive region contributes',
        '        // nothing from behind.',
        '        int mat_emit = material_of(hit.region_to);',
        '        if (material_is_emissive(mat_emit)) {',
        '            // No ternary here: ANGLE rejects \'?:\' on struct operands (ESSL restriction).',
        '            MaterialProperties eprops = props;',
        '            if (mat_emit != mat) eprops = scene_material_properties(mat_emit, hit.p);',
    ];
    if (f.nee && f.emitters) {
        lines.push(
            '            // §6.2 double-count bookkeeping: a SAMPLABLE emitter (light_of ≥ 0) found by a',
            '            // non-delta bounce was already counted by NEE at the previous vertex. Path-only',
            '            // emitters, post-delta hits, and the camera "bounce" stay full-weight.',
            '            float w_emit = 1.0;',
            '            int lid_emit = light_of(hit.region_to);',
            '            if (lid_emit >= 0 && !prev_was_delta) {',
            ...t1EmitterWeight(f),
            '            }',
            '            radiance += throughput * w_emit * interaction_surface_emission(mat_emit, wo, hit, eprops);',
        );
    } else {
        lines.push('            radiance += throughput * interaction_surface_emission(mat_emit, wo, hit, eprops);');
    }
    lines.push('        }', '');
    return lines;
}

/** DEFERRED SCORING SITE, miss: the boundary case — the sample escaped to the
 *  environment. Same table, third row of sites. */
export function kernelScoreMiss(f: Flags): string[] {
    if (f.envSamplable && f.nee) {
        return [
            '            // Reference §5 annotation 3 + §8 line 3: a samplable environment reached by a',
            '            // non-delta bounce was already counted by NEE at the previous vertex. prev_was_delta',
            '            // inits true, so camera-direct misses always show the sky at full weight.',
            '            float w_env = 1.0;',
            '            if (!prev_was_delta) {',
            ...t1MissWeight(f),
            '            }',
            '            radiance += throughput * w_env * environment_radiance(current_ray.direction);',
            '            break;',
        ];
    }
    return [
        '            radiance += throughput * environment_radiance(current_ray.direction);',
        '            break;',
    ];
}

/** The seams T1's emitted code calls under these flags. */
export function kernelRequires(f: Flags): string[] {
    const req = ['interaction_surface_sample', 'interaction_surface_emission', 'material_is_emissive', 'environment_radiance'];
    if (f.nee && f.emitters) req.push('light_of');
    if (f.emittersPdf) req.push('lighting_pdf');
    if (f.scattering) req.push('hg_sample');
    if (f.envSamplable && f.mis) req.push('environment_pdf');
    return req;
}

/** MIS state writes — medium and surface sampling sites MUST agree on these (reference
 *  §8); emitted from one place so they cannot diverge. */
function prevBookkeeping(f: Flags, pdfExpr: string, pointExpr: string, indent: string): string[] {
    if (!f.mis) return [];
    return [
        `${indent}prev_bsdf_pdf = ${pdfExpr};`,
        `${indent}prev_p = ${pointExpr};`,
    ];
}
