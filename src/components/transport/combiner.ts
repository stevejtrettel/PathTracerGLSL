// components/transport/combiner.ts
// The COMBINER (fable-components §7 pinned; emitted shape per fable-transport-glsl-target.md).
//
// Two techniques (kernel sampling T1, light sampling T2) estimate the SAME direct-
// lighting term; the combiner is the partition of unity that keeps them honest. It now
// emits GENERATED GLSL FUNCTIONS — the static technique files call them by pinned name,
// and the three directLighting strategies are three sets of function bodies:
//
//   strategy | combiner_w_light[_medium] (T2)  | combiner_w_emitter / combiner_w_env (T1)
//   pt       | not emitted (T2 absent)         | return 1.0
//   pt-nee   | return 1.0                      | 0 for samplable/non-delta, 1 otherwise
//   pt-mis   | power heuristic vs T1's density | power heuristic vs T2's density
//
// Every existence-dependent call (light_of, lighting_pdf, environment_pdf,
// interaction_surface_pdf, hg_pdf, u_envSelectProb) lives INSIDE these generated
// bodies — that is what lets the static files stay static (the flexibility rule).
// Deferred (owner-ratified): an identity-weight elision pass may later fold trivial
// bodies out of the emitted text entirely; uniform emission is the deliberate v1.

import type { ShaderBlock } from '../../compiler/generate/ShaderIR.js';
import type { Flags } from './flags.js';

export function combinerFns(f: Flags): ShaderBlock {
    const lines: string[] = [combinerHeader(f)];

    // T1's emitter-hit weight (kernel.glsl calls it whenever emission can exist).
    lines.push('float combiner_w_emitter(PathState s, Hit hit) {');
    if (f.nee && f.emitters) {
        lines.push(
            '    // §6.2: a SAMPLABLE emitter found by a non-delta bounce competes with last',
            '    // vertex\'s light sample. Path-only emitters and post-delta hits stay full-weight.',
            '    int lid = light_of(hit.region_to);',
            '    if (lid < 0 || s.prev_was_delta) return 1.0;',
        );
        if (f.mis) {
            lines.push('    return power_heuristic(s.prev_bsdf_pdf, lighting_pdf(s.prev_p, s.ray.direction, lid, hit));');
        } else {
            lines.push('    return 0.0;   // NEE already counted it at the previous vertex');
        }
    } else {
        lines.push('    return 1.0;   // T1 owns the emitter term outright in this program');
    }
    lines.push('}');

    // T1's miss weight (the environment is the boundary case of the same term).
    lines.push('float combiner_w_env(PathState s) {');
    if (f.envSamplable && f.nee) {
        lines.push(
            '    // Camera-direct and post-delta misses show the sky at full weight (§5/§8 line 3).',
            '    if (s.prev_was_delta) return 1.0;',
        );
        if (f.mis) {
            // The selection factor mirrors lighting_sample's stage 0 — total pdf symmetry
            // (§6.1). Env-only programs fold it to 1 on BOTH sides (structurally, not by
            // binding — the environmentSelectionLive decision).
            lines.push(f.envSelectLive
                ? '    return power_heuristic(s.prev_bsdf_pdf, u_envSelectProb * environment_pdf(s.ray.direction));   // stage-0 selection × per-light density'
                : '    return power_heuristic(s.prev_bsdf_pdf, environment_pdf(s.ray.direction));   // env-only: selection folded to 1 (§6.1)');
        } else {
            lines.push('    return 0.0;   // NEE already counted the samplable environment');
        }
    } else {
        lines.push('    return 1.0;   // environment not samplable in this program — T1 owns the sky term');
    }
    lines.push('}');

    // T2's weights — emitted only when the light technique is included.
    if (f.nee) {
        lines.push('float combiner_w_light(int mat, LightSample ls, Direction wo, Hit hit, MaterialProperties props) {');
        if (f.mis) {
            lines.push(
                '    // Delta lights get weight 1 — BSDF sampling can never hit them (§6.4).',
                '    if ((ls.flags & LIGHT_DELTA) != 0u) return 1.0;',
                '    return power_heuristic(ls.pdf, interaction_surface_pdf(mat, ls.wi, wo, hit, props));',
            );
        } else {
            lines.push('    return 1.0;   // plain NEE: the light sample carries full weight');
        }
        lines.push('}');

        if (f.scattering && !f.equiangular) {
            lines.push('float combiner_w_light_medium(LightSample ls, Direction wo_med, MediumProperties m_evt) {');
            if (f.mis) {
                lines.push(
                    '    // Balances against the phase density — no cosine anywhere (§2.2).',
                    '    if ((ls.flags & LIGHT_DELTA) != 0u) return 1.0;',
                    // The DISPATCH is the seam (matches light.ts's requires) — calling a
                    // per-model pdf here broke any non-hg medium under mis (unlinkable).
                    '    return power_heuristic(ls.pdf, interaction_medium_pdf(ls.wi, wo_med, m_evt));',
                );
            } else {
                lines.push('    return 1.0;   // plain NEE at the medium site');
            }
            lines.push('}');
        }
    }

    return { origin: 'generated:transport/combiner', source: lines.join('\n') };
}

function combinerHeader(f: Flags): string {
    const strategy = !f.nee ? 'pt — T1 is the only technique; every weight is 1 (this IS the strategy)'
        : f.mis ? 'pt-mis — the power heuristic at every shared term'
        : 'pt-nee — T2 at weight 1; T1\'s shared-term weight is the binary rule';
    return `// ── Combiner (generated): ${strategy} ──`;
}
