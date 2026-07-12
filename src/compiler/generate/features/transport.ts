// compiler/generate/features/transport.ts
// The transport loop GENERATOR (§10.1 item 9, impl-plan-transport-split.md).
//
// The loop is assembled from segment emitters — the emitted program contains only the
// code that runs (no preprocessor conditionals; specialization happens HERE, not in the
// browser). The assembler owns ALL control-flow structure (the media/no-media loop-top
// shapes are different skeletons, not toggled branches); segments fill bodies and are
// pure functions of ProgramDescription — never of scene data, which lives behind the
// seams the loop calls (scene_intersect, lighting_sample, medium_sample, …).
//
// PINNED (owner, July 2026):
// - Any invariant spanning emission sites has exactly ONE emitter: `rr()` (both RR
//   sites) and `prevBookkeeping()` (medium + surface MIS state) — agreement by
//   construction, never by reading.
// - Emission quality bar: the output reads as a bespoke tracer for THIS program;
//   comments are emitted conditionally and describe only what is emitted.

import type { RenderPlan, ProgramDescription } from '../../plan/types.js';
import type { ShaderBlock } from '../ShaderIR.js';
import { emptyContribution, type FeatureContribution } from './types.js';

export function contributeTransport(plan: RenderPlan): FeatureContribution {
    const program = plan.program;

    // Structural defines, still emitted (NOT read by the generator): math.glsl gates
    // power_heuristic on ENABLE_MIS and spectrum_exp on HAS_MEDIA (library cleanup is
    // the split's commit D), and the temporary token-equivalence test preprocesses the
    // old template under these. MAX_BOUNCES/RR_START_DEPTH are inlined as literals below;
    // their defines survive only for the test and die in commit C.
    const defines: Record<string, string> = {
        MAX_BOUNCES: String(program.measurement.maxBounces),
    };
    if (program.estimator.lighting !== null) {
        defines['ENABLE_NEE'] = '';
        if (program.estimator.lighting.method === 'mis') defines['ENABLE_MIS'] = '';
    }
    if (program.estimator.russianRoulette) {
        defines['ENABLE_RUSSIAN_ROULETTE'] = '';
        defines['RR_START_DEPTH'] = String(program.estimator.russianRoulette.startDepth);
    }

    // T4 seams: what the loop calls, conditioned exactly like the emitted segments.
    const requires = [
        'scene_intersect', 'material_of', 'scene_material_properties',
        'interaction_surface_sample', 'interaction_surface_emission',
        'material_is_emissive', 'environment_radiance',
    ];
    const lighting = program.estimator.lighting;
    if (lighting !== null) {
        requires.push('lighting_sample', 'shadow_transmittance', 'material_has_nondelta_lobes', 'interaction_surface_eval');
        if (lighting.method === 'mis') requires.push('interaction_surface_pdf');
        if (program.emitters.samplable) requires.push('light_of');
    }
    if (program.emitters.lightingPdf) requires.push('lighting_pdf');
    if (program.media.present) requires.push('material_has_medium', 'medium_sample', 'scene_region_at');
    if (program.media.scatteringArms) {
        requires.push('scene_medium_properties', 'hg_sample');
        if (lighting !== null) requires.push('hg_eval');
        if (lighting?.method === 'mis') requires.push('hg_pdf');
    }
    if (program.media.nullInterfaces) requires.push('is_null_interface');
    if (program.materials.models.includes('dielectric')) requires.push('ior_of');
    if (program.environmentSamplable && lighting?.method === 'mis') requires.push('environment_pdf');

    return {
        ...emptyContribution('transport'),
        defines,
        blocks: emitTransportTrace(program),
        provides: [{ name: 'transport_trace', signature: 'Radiance transport_trace(Ray ray)' }],
        requires,
    };
}

// ============================================================================
// The assembler — owns the skeleton; segments fill bodies.
// ============================================================================

function emitTransportTrace(p: ProgramDescription): ShaderBlock[] {
    const f = flags(p);
    const blocks: ShaderBlock[] = [];
    const seg = (name: string, lines: string[]) => {
        if (lines.length > 0) blocks.push({ origin: `generated:transport/${name}`, source: lines.join('\n') });
    };

    seg('init', stateInit(f));

    if (f.media) {
        // Media skeleton: one trace per iteration; the medium decides what happens on
        // the segment BEFORE the boundary is honored (fable-volumetric-component §2).
        seg('loop', [
            `    for (int bounce = 0; bounce < ${p.measurement.maxBounces}; bounce++) {`,
            '        Hit hit;',
            '        bool boundary = scene_intersect(current_ray, hit);',
            '',
        ]);
        seg('medium', mediumSegment(f));
        seg('loop', ['        if (!boundary) {']);
    } else {
        seg('loop', [
            `    for (int bounce = 0; bounce < ${p.measurement.maxBounces}; bounce++) {`,
            '        Hit hit;',
            '        if (!scene_intersect(current_ray, hit)) {',
        ]);
    }
    seg('miss', missBranch(f));
    seg('loop', ['        }', '']);

    seg('self-heal', selfHeal(f));
    seg('surface', [
        '        int mat = material_of(hit.region_owner);        // §4.1: the boundary OWNER\'s BSDF shades (≠ region_to at exits)',
    ]);
    seg('null', nullCrossing(f));
    seg('surface', [
        '        MaterialProperties props = scene_material_properties(mat, hit.p);',
        '        Direction wo = -current_ray.direction;',
        '',
    ]);
    seg('emission', emission(f));
    seg('nee', surfaceNEE(f));
    seg('bsdf', bsdfSample(f));
    seg('tracking', tracking(f));
    seg('rr', f.rr ? rr(f, 'surface') : []);
    seg('spawn', [
        '        // Continuation ray: ray_spawn escapes the origin to wi\'s side of the surface along the',
        '        // geodesic (self-intersection; transmission gets the far side). See docs/trace-loop-contract.md.',
        '        current_ray = ray_spawn(hit, bs.wi);',
        '    }',
        '',
        '    return radiance;',
        '}',
    ]);

    return blocks;
}

/** The decisions the loop is built from — read once, from the link map (T2). */
function flags(p: ProgramDescription) {
    const lighting = p.estimator.lighting;
    return {
        nee: lighting !== null,
        mis: lighting?.method === 'mis',
        media: p.media.present,
        scattering: p.media.scatteringArms,
        nulls: p.media.nullInterfaces,
        transmission: p.materials.models.includes('dielectric'),
        envSamplable: p.environmentSamplable,
        emitters: p.emitters.samplable,
        rr: p.estimator.russianRoulette,
    };
}
type Flags = ReturnType<typeof flags>;

// ============================================================================
// Segments — each returns the lines it earns under this program, nothing else.
// ============================================================================

function stateInit(f: Flags): string[] {
    const lines = [
        '// Path trace loop — generated for this scene and strategy (item-9 transport generator).',
        'Radiance transport_trace(Ray ray) {',
        '    Spectrum throughput = SPECTRUM_ONE;',
        '    Radiance radiance   = SPECTRUM_ZERO;',
        '    Ray current_ray = ray;',
    ];
    if (f.transmission) {
        lines.push(
            '',
            '    // §7.2 etaScale: transmission compresses radiance by η² (restored on exit), so RR keyed on',
            '    // raw throughput over-kills inside dense media — this factor divides the compression back',
            '    // out of the survival metric only. Efficiency, not bias.',
            '    float eta_scale = 1.0;',
        );
    }
    if (f.media) {
        lines.push(
            '',
            '    // §4.4: THE medium variable — a single int ground-truthed by classification (self-heal',
            '    // at each hit), never a stack. Initialized by classifying the camera origin, so a camera',
            '    // inside a bounded medium tracks its primary segment correctly.',
            '    int current_medium = scene_region_at(ray.origin);',
        );
    }
    if (f.nulls) {
        lines.push('    int null_crossings = 0;   // §3.6: nulls are bookkeeping with their own safety counter');
    }
    lines.push(
        '',
        '    // §6.2 bookkeeping: the camera "bounce" counts as delta so bounce-0 emission is full-weight.',
        '    bool prev_was_delta = true;',
    );
    if (f.mis) {
        lines.push(
            '    // Reference §8: the previous vertex and its sampled solid-angle pdf — the BSDF side of the',
            '    // emitter-hit power heuristic. Written at surface AND medium scattering events.',
            '    float prev_bsdf_pdf = 0.0;',
            '    Point prev_p = ray.origin;',
        );
    }
    lines.push('');
    return lines;
}

function mediumSegment(f: Flags): string[] {
    const lines = [
        '        // The volumetric component\'s call site (fable-volumetric-component §2): one segment,',
        '        // ending at the boundary or the far clip. medium_sample never sees a boundary;',
        '        // entering/exiting is the interface machinery\'s job below.',
        '        int med_mat = material_of(current_medium);',
        '        if (material_has_medium(med_mat)) {',
        '            MediumSample ms = medium_sample(med_mat, current_ray, boundary ? hit.t : MAX_DIST, random2());',
        '            throughput *= ms.weight;',
    ];
    if (f.scattering) {
        lines.push(
            '            if (ms.scattered) {',
            '                // ---- MEDIUM EVENT (§7.2 step 2) ----',
            '                Point p_evt = ambient_geodesic(current_ray.origin, current_ray.direction, ms.t);',
            '                Direction wo_med = -current_ray.direction;',
        );
        if (f.nee) {
            lines.push(
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
            );
            if (f.mis) {
                lines.push(
                    '                            // Reference §8\'s closing line: the medium-side NEE weight balances',
                    '                            // against the phase density (hg_pdf) — no cosine anywhere (§2.2).',
                    '                            float w_m = 1.0;',
                    '                            if ((ls.flags & LIGHT_DELTA) == 0u) {',
                    '                                w_m = power_heuristic(ls.pdf, hg_pdf(ls.wi, wo_med, m_evt));',
                    '                            }',
                    '                            radiance += throughput * ls.radiance * hg_eval(ls.wi, wo_med, m_evt) * vis * w_m / ls.pdf;',
                );
            } else {
                lines.push(
                    '                            radiance += throughput * ls.radiance * hg_eval(ls.wi, wo_med, m_evt) * vis / ls.pdf;',
                );
            }
            lines.push(
                '                        }',
                '                    }',
                '                }',
            );
        }
        lines.push(
            '                // Phase sample (§3.5): weight is SPECTRUM_ONE exactly — HG sampling is exact.',
            '                InteractionSample ps = hg_sample(wo_med, scene_medium_properties(med_mat, p_evt), random2());',
            '                throughput *= ps.weight;',
            '                prev_was_delta = false;',
            ...prevBookkeeping(f, 'ps.pdf', 'p_evt', '                '),
            '                current_ray = make_ray(p_evt, ps.wi);   // continue from the event — no surface offset',
            '',
            ...(f.rr ? rr(f, 'medium') : []),
            '                continue;   // loop-header bounce++: medium events COUNT toward the budget (§7.2)',
            '            }',
        );
    }
    lines.push('        }');
    return lines;
}

function missBranch(f: Flags): string[] {
    if (f.envSamplable && f.nee) {
        const lines = [
            '            // Reference §5 annotation 3 + §8 line 3: a samplable environment reached by a',
            '            // non-delta bounce was already counted by NEE at the previous vertex. prev_was_delta',
            '            // inits true, so camera-direct misses always show the sky at full weight.',
            '            float w_env = 1.0;',
            '            if (!prev_was_delta) {',
        ];
        if (f.mis) {
            lines.push(
                '                // The selection factor (u_envSelectProb) mirrors lighting_sample\'s stage 0 —',
                '                // total pdf symmetry (§6.1).',
                '                w_env = power_heuristic(prev_bsdf_pdf, u_envSelectProb * environment_pdf(current_ray.direction));',
            );
        } else {
            lines.push('                w_env = 0.0;');
        }
        lines.push(
            '            }',
            '            radiance += throughput * w_env * environment_radiance(current_ray.direction);',
            '            break;',
        );
        return lines;
    }
    return [
        '            radiance += throughput * environment_radiance(current_ray.direction);',
        '            break;',
    ];
}

function selfHeal(f: Flags): string[] {
    if (!f.media) return [];
    return [
        '        // §4.4 self-heal (free — the operand was already classified): a missed boundary event',
        '        // mistracks exactly one segment and repairs here, instead of corrupting the path.',
        '        if (hit.region_from != current_medium) current_medium = hit.region_from;',
        '',
    ];
}

function nullCrossing(f: Flags): string[] {
    if (!f.nulls) return [];
    return [
        '        // §3.6 null interface: the boundary is not an optical event — pass through in the same',
        '        // direction; no emission, no NEE, no bounce consumed (nulls have their own safety counter).',
        '        if (is_null_interface(mat)) {',
        '            current_medium = hit.region_to;',
        '            current_ray = ray_spawn(hit, current_ray.direction);   // far side by sign(dir·n)',
        '            null_crossings++;',
        '            if (null_crossings > 32) break;',
        '            bounce--;',
        '            continue;',
        '        }',
    ];
}

function emission(f: Flags): string[] {
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
        );
        if (f.mis) {
            lines.push('                w_emit = power_heuristic(prev_bsdf_pdf, lighting_pdf(prev_p, current_ray.direction, lid_emit, hit));');
        } else {
            lines.push('                w_emit = 0.0;');
        }
        lines.push(
            '            }',
            '            radiance += throughput * w_emit * interaction_surface_emission(mat_emit, wo, hit, eprops);',
        );
    } else {
        lines.push('            radiance += throughput * interaction_surface_emission(mat_emit, wo, hit, eprops);');
    }
    lines.push('        }', '');
    return lines;
}

function surfaceNEE(f: Flags): string[] {
    if (!f.nee) return [];
    const lines = [
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
    ];
    if (f.mis) {
        lines.push(
            '                    // Reference §8 line 2: balance the light sample against the BSDF\'s density.',
            '                    // Delta lights get weight 1 — BSDF sampling can never hit them (§6.4).',
            '                    float w_l = 1.0;',
            '                    if ((ls.flags & LIGHT_DELTA) == 0u) {',
            '                        w_l = power_heuristic(ls.pdf, interaction_surface_pdf(mat, ls.wi, wo, hit, props));',
            '                    }',
            '                    radiance += throughput * ls.radiance * f * cos_i * vis * w_l / ls.pdf;',
        );
    } else {
        lines.push('                    radiance += throughput * ls.radiance * f * cos_i * vis / ls.pdf;');
    }
    lines.push('                }', '            }', '        }', '');
    return lines;
}

function bsdfSample(f: Flags): string[] {
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

function tracking(f: Flags): string[] {
    const lines: string[] = [];
    if (f.media) {
        lines.push(
            '        // §4.4: transmission moves the path into the far region\'s medium.',
            '        if ((bs.flags & LOBE_TRANSMISSION) != 0u) current_medium = hit.region_to;',
            '',
        );
    }
    if (f.transmission) {
        lines.push(
            '        // Accumulate the η² compression this crossing added (derivable from the hit\'s regions).',
            '        if ((bs.flags & LOBE_TRANSMISSION) != 0u) {',
            '            float r = ior_of(hit.region_to) / ior_of(hit.region_from);',
            '            eta_scale *= r * r;',
            '        }',
            '',
        );
    }
    return lines;
}

// ============================================================================
// Shared-invariant emitters — ONE definition, both sites (the pinned rule).
// ============================================================================

/** MIS state writes — medium and surface events MUST agree on these (reference §8);
 *  emitted from one place so they cannot diverge. */
function prevBookkeeping(f: Flags, pdfExpr: string, pointExpr: string, indent: string): string[] {
    if (!f.mis) return [];
    return [
        `${indent}prev_bsdf_pdf = ${pdfExpr};`,
        `${indent}prev_p = ${pointExpr};`,
    ];
}

/** Russian roulette — §7.2 pin: once per iteration, AFTER throughput *= weight, survival
 *  keyed on post-weight throughput. Two integrators (or two sites) with subtly different
 *  RR are un-diffable — hence ONE emitter (this cashes the template's item-9 IOU). */
function rr(f: Flags, site: 'medium' | 'surface'): string[] {
    const sfx = site === 'medium' ? '_med' : '';
    const indent = site === 'medium' ? '                ' : '        ';
    const metric = f.transmission
        ? `spectrum_max(throughput) * eta_scale;   // η²-corrected (§7.2 note)`
        : `spectrum_max(throughput);   // §2.5: basis-agnostic, no Rec.709 weights`;
    return [
        `${indent}// Russian roulette — §7.2 pin: once per iteration, post-weight${site === 'medium' ? ' (medium events included)' : ''}.`,
        `${indent}float rr_metric${sfx} = ${metric}`,
        `${indent}if (bounce >= ${f.rr!.startDepth}) {`,
        `${indent}    float p_survive${sfx} = min(0.95, rr_metric${sfx});`,
        `${indent}    if (random() > p_survive${sfx}) break;`,
        `${indent}    throughput /= p_survive${sfx};`,
        `${indent}}`,
    ];
}
