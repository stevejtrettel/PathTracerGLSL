// components/transport/integrators/pt.ts
// The `pt` INTEGRATOR — the recursive path-tracing walk, emitted FUNCTION-SHAPED per
// fable-transport-glsl-target.md (owner-approved July 2026): the walk reads as the
// estimator's table of contents; technique math arrives from static .glsl files
// (techniques/*.glsl); every decision is a small generated body (combiner, record,
// roulette, PathState).
//
// An integrator owns path advance (intersect, medium segments, self-heal, nulls),
// state, termination (RR, bounce budget), and ray spawning. It does NO sampling — at
// each event it calls the technique functions. A new integrator (one-shot, Whitted,
// probe) is a new file here composing the same static functions with different rules.
//
// PINNED: single-emitter invariants are now single generated FUNCTIONS — kernel_record()
// (both sampling sites, owned by kernel.ts).
//
// roulette() USED TO BE one of those, covering the surface and medium sites together. It is
// now TWO functions, deliberately (docs/fable-subsurface.md §6, owner-approved): a scattering
// collision has a local, exactly-known survival probability that a surface event does not, so
// the two sites no longer obey one rule and emitting one function would imply they do. The
// invariant is not being weakened quietly — the two bodies share no arithmetic at all, so
// there is no common expression left for them to drift out of.
//
// The interior rule's probability is supplied by the GENERATED medium_survival() accessor
// (compiler/generate/features/materials.ts), routed per medium by whether its arm settles
// absorption by weight or by lottery — so an all-delta-tracked program carries neither the
// accessor nor roulette_interior, and the rule never reads a quantity that is not a probability.
// The static-file rule (target doc §1): static files touch only PathState's pinned
// core (ray/throughput/radiance); every program-dependent field is behind generated
// functions. The WALK is generated, so it may touch its own fields freely.

import type { ProgramDescription } from '../../../../compiler/plan/types.js';
import type { ShaderBlock } from '../../../../compiler/generate/ShaderIR.js';
import type { FeatureContribution } from '../../../../compiler/generate/features/types.js';
import { flags, type Flags } from '../../flags.js';
import { combinerFns } from '../../combiner.js';
import {
    kernelStateFields, kernelStateInit, kernelRecordFn, kernelBlocks, kernelRequires,
} from '../../techniques/kernel/kernel.js';
import { lightBlocks, lightRequires } from '../../techniques/light/light.js';
import { equiangularBlocks, equiangularRequires } from '../../techniques/equiangular/equiangular.js';
import mathMisGLSL from '../../math_mis.glsl?raw';
import { formatFloat } from '../../../glsl-format.js';

export function contributeTransport(program: ProgramDescription): FeatureContribution {
    const f = flags(program);

    const blocks: ShaderBlock[] = [lightQueryFns(f), pathState(f)];
    // MIS math (β=2 power heuristic) — transport family property: its only callers are
    // the combiner-emitted weights, so it precedes them (definition-before-use keeps it
    // out of the interface header: an internal helper, not a cross-feature seam).
    if (f.mis) blocks.push({ origin: 'components/transport/math_mis.glsl', source: mathMisGLSL });
    blocks.push(combinerFns(f), kernelRecordFn(f));
    if (f.rr) blocks.push(roulette(f));
    // The interior rule exists only where a collision leaves a survival OWED — a weighted
    // absorption arm. Under tracking, the lottery already settled it (see medium_survival).
    // The Planner folds roulette into weightedAbsorption (the accessor's only consumer is this
    // rule), so f.rr is spelled out here for the startDepth read, not as a second gate.
    if (f.rr && f.weightedAbsorption) blocks.push(rouletteInterior(f));
    blocks.push(...kernelBlocks(f), ...lightBlocks(f), ...equiangularBlocks(f), walk(program, f));

    // Numeric knobs (the house rule: budgets are NAMED pinned defines, never bare
    // literals in the walk — MAX_SHADOW_SEGMENTS/MAX_NULL_COLLISIONS are the siblings).
    const defines: Record<string, string> = {};
    if (f.nulls) defines['MAX_NULL_CROSSINGS'] = '32';   // §3.6 null-interface budget; exhaustion terminates the path
    // §7.2 survival cap — bounds the 1/p_survive weight, and (see the authored field's
    // note) is the ONLY terminator for lossless paths, whose throughput never dims.
    // Authored per strategy; 0.95 is the default, not a constant.
    if (f.rr) defines['RR_MAX_SURVIVAL'] = formatFloat(f.rr.maxSurvival ?? 0.95);

    // Explicit literal (not ...emptyContribution): the purity rule — components import
    // no compiler VALUES, only contract types. tsc keeps this in sync with the type.
    return {
        feature: 'transport',
        blocks,
        defines,
        uniforms: [],
        parameters: {},
        textures: [],
        provides: [
            { name: 'transport_trace', signature: 'Radiance transport_trace(Ray ray)' },
            { name: 'light_query_surface', signature: 'LightQuery light_query_surface(int mat, Hit hit)' },
            { name: 'light_query_medium', signature: 'LightQuery light_query_medium(Point p)' },
        ],
        requires: [...walkRequires(f), ...kernelRequires(f), ...lightRequires(f), ...equiangularRequires(f)],
    };
}

/** The seams the walk itself calls (techniques declare theirs separately). */
function walkRequires(f: Flags): string[] {
    const req = ['scene_intersect', 'material_of', 'scene_material_properties'];
    if (f.media) req.push('material_has_medium', 'medium_sample', 'scene_region_at');
    if (f.scattering) req.push('scene_medium_properties');
    // The interior rule's survival source (docs/fable-subsurface.md §6) — required exactly
    // where the rule is emitted, so seam-unused stays honest.
    if (f.rr && f.weightedAbsorption) req.push('medium_survival');
    if (f.nulls) req.push('is_null_interface');
    if (f.transmission) req.push('ior_of');
    // The generated light-query constructor's runtime arm (fable-rough-dielectric §3.3).
    if (f.twoSided) req.push('material_two_sided');
    return req;
}

// ============================================================================
// Light-query constructors (fable-light-bvh §3.2 v1.5) — the POLICY site for the
// selection context: static technique files pass "everything they have" (mat, hit)
// through these instead of constructing LightQuery themselves, so context growth
// (per-material support policy, spectral, curved frames) changes ONLY these bodies.
// `mat` was in the signature ahead of need; fable-rough-dielectric §3.3 is the need —
// the query's two-sidedness is a per-MATERIAL fact (support 'sphere' ∧ non-delta), and
// this is where it is answered. The twoSidedShading decision folds the question away
// entirely when the scene has no such material.
// ============================================================================

function lightQueryFns(f: Flags): ShaderBlock {
    const sided = f.twoSided
        ? 'material_two_sided(mat)'
        : 'false';
    return {
        origin: 'generated:transport/light-query',
        source: [
            '// ── Light-query constructors (generated policy — fable-light-bvh §3.2) ──',
            'LightQuery light_query_surface(int mat, Hit hit) {',
            `    return LightQuery(hit.p, hit.frame.n, ${sided});`,
            '}',
            'LightQuery light_query_medium(Point p) {',
            '    return LightQuery(p, vec3(0.0), false);   // no orientation at a medium event',
            '}',
        ].join('\n'),
    };
}

// ============================================================================
// Generated state — the union of fields the included parts declare (§3.4 pattern).
// ============================================================================

function pathState(f: Flags): ShaderBlock {
    const lines = [
        '// ── Path state (generated §3.4-style: the union of fields the included parts declare) ──',
        'struct PathState {',
        '    Ray ray;',
        '    Spectrum throughput;',
        '    Radiance radiance;',
        ...kernelStateFields(f),
    ];
    if (f.media) lines.push('    int current_medium;      // walk, §4.4: THE medium variable — classified, never a stack');
    if (f.nulls) lines.push('    int null_crossings;      // walk, §3.6: nulls have their own safety counter');
    if (f.transmission) lines.push('    float eta_scale;         // walk, §7.2: η² compression divided out of the RR metric only');
    lines.push(
        '};',
        '',
        'PathState path_state_init(Ray ray) {',
        '    PathState s;',
        '    s.ray = ray;',
        '    s.throughput = SPECTRUM_ONE;',
        '    s.radiance = SPECTRUM_ZERO;',
        ...kernelStateInit(f),
    );
    if (f.media) lines.push('    s.current_medium = scene_region_at(ray.origin);   // camera may start inside a medium');
    if (f.nulls) lines.push('    s.null_crossings = 0;');
    if (f.transmission) lines.push('    s.eta_scale = 1.0;');
    lines.push('    return s;', '}');
    return { origin: 'generated:transport/state', source: lines.join('\n') };
}

// ============================================================================
// Generated termination — §7.2: once per iteration, post-weight, ONE function
// for both call sites (surface and medium).
// ============================================================================

function roulette(f: Flags): ShaderBlock {
    const metric = f.transmission
        ? 'spectrum_max(s.throughput) * s.eta_scale);   // η²-corrected (§7.2 note)'
        : 'spectrum_max(s.throughput));   // §2.5: basis-agnostic, no Rec.709 weights';
    return {
        origin: 'generated:transport/roulette',
        source: [
            '// ── Russian roulette (generated): §7.2 — once per iteration, post-weight, both sites ──',
            'bool roulette(inout PathState s, int bounce) {',
            `    if (bounce < ${f.rr!.startDepth}) return true;`,
            `    float p_survive = min(RR_MAX_SURVIVAL, ${metric}`,
            '    if (random() > p_survive) return false;',
            '    s.throughput /= p_survive;',
            '    return true;',
            '}',
        ].join('\n'),
    };
}

// ============================================================================
// Generated INTERIOR termination — the medium site's own rule (§7.2 as amended by
// docs/fable-subsurface.md §6). Separate from roulette() on purpose; see the note
// at the top of this file for why the shared emitter was split.
// ============================================================================

function rouletteInterior(f: Flags): ShaderBlock {
    return {
        origin: 'generated:transport/roulette-interior',
        source: [
            '// ── Interior roulette (generated): survive in proportion to how much THIS collision',
            '// dimmed the path — docs/fable-subsurface.md §6 ──',
            '//',
            '// A scattering collision has a LOCAL, exactly-known survival probability: the factor',
            '// the volume arm just applied to the throughput. Multiplying the weight by that factor',
            '// and then surviving with probability EQUAL to it leaves the weight exactly unchanged',
            '// and ends the path at precisely the physical absorption rate. That is not a different',
            '// estimator from the weighted one — it is the same estimator with the survival',
            '// probability it should always have had, which is why this costs one function and no',
            '// change to any volume arm.',
            '//',
            '// TWO DELIBERATE ABSENCES vs roulette():',
            '//   RR_MAX_SURVIVAL — the ceiling exists for a LOSSLESS interaction (clear glass, whose',
            '//     transmission weight is exactly 1 forever, so nothing else could ever end the',
            '//     path). A scattering collision is never lossless, so here the ceiling would BE the',
            '//     terminator: it would cull paths that physically continue and tax every survivor',
            '//     by 1/p for nothing. That compounding factor over hundreds of collisions is the',
            '//     firefly noise this rule exists to remove.',
            '//   eta_scale — it corrects an ACCUMULATED radiance compression across interfaces, and',
            '//     this metric is one event, so there is nothing accumulated to correct.',
            '//',
            '// THE SURVIVAL COMES FROM THE MEDIUM, NOT FROM THE EVENT WEIGHT. An earlier version of',
            '// this rule passed ms.weight, which LOOKS like the dimming factor but is a product:',
            '// the single-scattering albedo (the part this rule is about) times the chromatic',
            '// channel-selection MIS ratio, times — in the GRIN arm — an eta^2 radiance compression.',
            '// Only the first factor is a probability. The consequence was not academic: for any',
            '// medium with a CHROMATIC sigma_t the MIS ratio pushes the product above 1, the clamp',
            '// bound at exactly 1, and the rule did nothing at all — in precisely the dense chromatic',
            '// media (skin, marble) that motivated it. medium_survival() answers sigma_s/sigma_t per',
            '// channel, so THERE IS NO CLAMP HERE, and its absence is the proof the quantity is right.',
            'bool roulette_interior(inout PathState s, int bounce, Spectrum survival) {',
            `    if (bounce < ${f.rr!.startDepth}) return true;`,
            '    // The BRIGHTEST channel, not the mean: never end a path that still carries a bright',
            '    // channel. Averaging would kill paths whose surviving energy sits in one channel,',
            '    // which is exactly the chromatic case that matters (a dense medium whose red travels',
            '    // far and whose blue does not).',
            '    float p_survive = spectrum_max(survival);',
            '    if (p_survive <= 0.0) return false;        // a pure absorber: the path ends here',
            '    // p == 1 (a lossless medium) is deliberately NOT short-circuited. The draw cannot',
            '    // change the outcome and the divide is by one, so an early return would be free',
            '    // correctness-wise — but it would stop consuming a random number, decorrelating the',
            '    // sample stream of every lossless-medium witness (haze, fogcube, F-BOX-M, sss-furnace)',
            '    // for no gain. Stream stability is worth more than one skipped draw.',
            '    if (random() > p_survive) return false;',
            '    s.throughput /= p_survive;',
            '    return true;',
            '}',
        ].join('\n'),
    };
}

// ============================================================================
// The walk — the estimator's table of contents.
// ============================================================================

// THE BOUNCE BUDGET. measurement.maxBounces = N means the measurement is the partial sum
// Σ_{n≤N} TⁿE: paths with at most N scattering events (surface or medium; null crossings
// are not events). Iteration `bounce` traces the segment leaving scattering vertex number
// `bounce`, so emission found at its end (surface, sky, or medium emission along it) closes
// a path with `bounce` events — allowed for bounce ≤ N. Next-event estimation and the
// continuation both ADD an event, so they run only while bounce < N. Hence the loop does
// N + 1 intersections and the last one only scores emission (pbrt-v4's structure). Every
// estimator (pt / pt-nee / pt-mis) then counts exactly the same set of paths; stopping NEE
// one iteration later than the BSDF continuation would make the truncation depend on the
// estimator, which the taxonomy forbids.
function walk(p: ProgramDescription, f: Flags): ShaderBlock {
    const N = p.measurement.maxBounces;
    const lines = [
        `// ── The walk (generated): pt${f.media ? ' over media' : ''} — the estimator's table of contents ──`,
        `// Budget: paths with at most ${N} scattering events. The final iteration (bounce == ${N})`,
        '// only scores emission; NEE and the continuation would add an event beyond the budget.',
        'Radiance transport_trace(Ray ray) {',
        '    PathState s = path_state_init(ray);',
        `    for (int bounce = 0; bounce <= ${N}; bounce++) {`,
        '        Hit hit;',
    ];

    if (f.media) {
        lines.push(
            '        bool boundary = scene_intersect(s.ray, hit);',
            '',
            '        // The volumetric component\'s call site (§2): one segment, ending at the',
            '        // boundary or far clip; entering/exiting is the interface machinery below.',
            '        int med_mat = material_of(s.current_medium);',
            '        if (material_has_medium(med_mat)) {',
        );
        if (f.equiangular) {
            lines.push(
                '            // Per-SEGMENT direct light (equiangular placement, segment-start throughput) —',
                '            // independent of the transmittance sample below; replaces the at-vertex site.',
                '            // It places a scattering event on this segment, so it is part of the budget.',
                `            if (bounce < ${N}) equiangular_sample_direct(s, med_mat, boundary ? hit.t : MAX_DIST);`,
            );
        }
        lines.push(
            '            MediumSample ms = medium_sample(med_mat, s.ray, boundary ? hit.t : MAX_DIST, random2());',
        );
        if (f.mediumEmission) {
            lines.push(
                '            // Inline source term (impl-plan-medium-emission; the §3 partition rule):',
                '            // ms.radiance is weighted relative to SEGMENT-START throughput — add before',
                '            // the segment weight multiplies in.',
                '            s.radiance += s.throughput * ms.radiance;',
            );
        }
        lines.push('            s.throughput *= ms.weight;');
        if (f.deflecting) {
            lines.push(
                '            if (ms.deflected) {',
                '                // ---- GRIN HANDOFF (impl-plan-grin-interface) ---- the ODE walker carried the',
                '                // ray along the bent path to just INSIDE the wall; spawn the continuation and',
                '                // let the NEXT iteration\'s surface hit own the crossing — the wall\'s material',
                '                // (\'none\' pass-through or dielectric Fresnel/TIR with the local n) fires there,',
                '                // so current_medium is deliberately UNCHANGED here. THE GLASS RULE: the bend is',
                '                // a deterministic DELTA event — record it so a subsequent emitter hit scores at',
                '                // full weight (NEE cannot sample bent connections; its shadow rays see the',
                '                // region as opaque — the transmittance twin of this line). The traversal',
                '                // CONSUMES a bounce deliberately: the budget bounds trapped closed orbits',
                '                // (e.g. a Maxwell fisheye) across exhaustion returns AND whispering-gallery',
                '                // TIR loops.',
                `                if (bounce == ${N}) break;   // the bend is an event: over budget`,
                '                kernel_record(s, 1.0, light_query_medium(ms.exit_p), true);',
            );
            if (f.transmission) {
                lines.push('                s.eta_scale *= ms.eta_scale;   // interior L/n² compression (§7.2)');
            }
            lines.push(
                '                s.ray = make_ray(ms.exit_p, ms.exit_dir);',
                '                continue;',
                '            }',
            );
        }
        if (f.scattering) {
            lines.push(
                '            if (ms.scattered) {',
                '                // ---- MEDIUM EVENT ---- The event ray comes FROM THE ARM (impl-plan-grin-media:',
                '                // a bent event is not recomputable from (origin, dir, t), so every scattering',
                '                // arm reports position + incident direction on exit_p/exit_dir).',
                `                if (bounce == ${N}) break;   // a scattering event: over budget`,
                '                Point p_evt = ms.exit_p;',
                '                Direction wo_med = -ms.exit_dir;',
            );
            if (f.nee && !f.equiangular) lines.push('                light_sample_direct_medium(s, med_mat, p_evt, wo_med);');
            lines.push('                kernel_sample_phase(s, med_mat, p_evt, wo_med);');
            // The INTERIOR rule (docs/fable-subsurface.md §6). The survival probability is asked
            // of the MEDIUM at the event point — not read off ms.weight, which carries the
            // channel-MIS ratio and (under GRIN) an eta^2 factor alongside the albedo.
            if (f.rr && f.weightedAbsorption) {
                lines.push('                if (!roulette_interior(s, bounce, medium_survival(med_mat, p_evt))) break;');
            }
            lines.push(
                '                continue;   // medium events COUNT toward the bounce budget (§7.2)',
                '            }',
            );
        }
        lines.push(
            '        }',
            '        if (!boundary) { kernel_score_miss(s); break; }',
            '',
            '        // §4.4 self-heal: a missed boundary event mistracks one segment and repairs here.',
            '        if (hit.region_from != s.current_medium) s.current_medium = hit.region_from;',
        );
    } else {
        lines.push('        if (!scene_intersect(s.ray, hit)) { kernel_score_miss(s); break; }');
    }

    lines.push('        int mat = material_of(hit.region_owner);   // §4.1: the boundary OWNER\'s BSDF shades');
    if (f.nulls) {
        lines.push(
            '        // §3.6 null interface: not an optical event — pass through, no bounce consumed.',
            '        if (is_null_interface(mat)) {',
            '            s.current_medium = hit.region_to;',
            '            s.ray = ray_spawn(hit, s.ray.direction);',
            '            s.null_crossings++;',
            '            if (s.null_crossings > MAX_NULL_CROSSINGS) break;',
            '            bounce--;',
            '            continue;',
            '        }',
        );
    }
    lines.push(
        '        MaterialProperties props = scene_material_properties(mat, hit.p, hit.uv, hit.element);',
        '        Direction wo = -s.ray.direction;',
        '',
        '        kernel_score_emitter_hit(s, hit, mat, wo, props);   // settle last bounce\'s deferred estimate',
        `        if (bounce == ${N}) break;   // budget reached: emission is the last term counted`,
    );
    if (f.nee) lines.push('        light_sample_direct(s, hit, mat, wo, props);        // NEE: sample + score locally');
    lines.push(
        '        InteractionSample bs;',
        '        if (!kernel_sample_continuation(s, hit, mat, wo, props, bs)) break;',
    );
    if (f.media) lines.push('        if ((bs.flags & LOBE_TRANSMISSION) != 0u) s.current_medium = hit.region_to;   // §4.4 tracking');
    if (f.transmission) {
        lines.push(
            '        // Accumulate the η² compression this crossing added (§7.2).',
            '        if ((bs.flags & LOBE_TRANSMISSION) != 0u) {',
            '            float r = ior_of(hit.region_to, hit.p) / ior_of(hit.region_from, hit.p);',
            '            s.eta_scale *= r * r;',
            '        }',
        );
    }
    if (f.rr) lines.push('        if (!roulette(s, bounce)) break;');
    lines.push(
        '        s.ray = ray_spawn(hit, bs.wi);   // escape wi\'s side along the geodesic',
        '    }',
        '    return s.radiance;',
        '}',
    );
    return { origin: 'generated:transport/walk', source: lines.join('\n') };
}
