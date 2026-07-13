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
// PINNED: single-emitter invariants are now single generated FUNCTIONS — roulette()
// (both call sites), kernel_record() (both sampling sites, owned by kernel.ts).
// The static-file rule (target doc §1): static files touch only PathState's pinned
// core (ray/throughput/radiance); every program-dependent field is behind generated
// functions. The WALK is generated, so it may touch its own fields freely.

import type { RenderPlan, ProgramDescription } from '../../../compiler/plan/types.js';
import type { ShaderBlock } from '../../../compiler/generate/ShaderIR.js';
import type { FeatureContribution } from '../../../compiler/generate/features/types.js';
import { flags, type Flags } from '../flags.js';
import { combinerFns } from '../combiner.js';
import {
    kernelStateFields, kernelStateInit, kernelRecordFn, kernelBlocks, kernelRequires,
} from '../techniques/kernel.js';
import { lightBlocks, lightRequires } from '../techniques/light.js';

export function contributeTransport(plan: RenderPlan): FeatureContribution {
    const program = plan.program;
    const f = flags(program);

    const blocks: ShaderBlock[] = [
        pathState(f),
        combinerFns(f),
        kernelRecordFn(f),
    ];
    if (f.rr) blocks.push(roulette(f));
    blocks.push(...kernelBlocks(f), ...lightBlocks(f), walk(program, f));

    // Explicit literal (not ...emptyContribution): the purity rule — components import
    // no compiler VALUES, only contract types. tsc keeps this in sync with the type.
    return {
        feature: 'transport',
        blocks,
        defines: {},
        uniforms: [],
        parameters: {},
        textures: [],
        provides: [{ name: 'transport_trace', signature: 'Radiance transport_trace(Ray ray)' }],
        requires: [...walkRequires(f), ...kernelRequires(f), ...lightRequires(f)],
    };
}

/** The seams the walk itself calls (techniques declare theirs separately). */
function walkRequires(f: Flags): string[] {
    const req = ['scene_intersect', 'material_of', 'scene_material_properties'];
    if (f.media) req.push('material_has_medium', 'medium_sample', 'scene_region_at');
    if (f.scattering) req.push('scene_medium_properties');
    if (f.nulls) req.push('is_null_interface');
    if (f.transmission) req.push('ior_of');
    return req;
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
            `    float p_survive = min(0.95, ${metric}`,
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

function walk(p: ProgramDescription, f: Flags): ShaderBlock {
    const lines = [
        `// ── The walk (generated): pt${f.media ? ' over media' : ''} — the estimator's table of contents ──`,
        'Radiance transport_trace(Ray ray) {',
        '    PathState s = path_state_init(ray);',
        `    for (int bounce = 0; bounce < ${p.measurement.maxBounces}; bounce++) {`,
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
            '            MediumSample ms = medium_sample(med_mat, s.ray, boundary ? hit.t : MAX_DIST, random2());',
            '            s.throughput *= ms.weight;',
        );
        if (f.scattering) {
            lines.push(
                '            if (ms.scattered) {',
                '                // ---- MEDIUM EVENT ----',
                '                Point p_evt = ambient_geodesic(s.ray.origin, s.ray.direction, ms.t);',
                '                Direction wo_med = -s.ray.direction;',
            );
            if (f.nee) lines.push('                light_sample_direct_medium(s, med_mat, p_evt, wo_med);');
            lines.push('                kernel_sample_phase(s, med_mat, p_evt, wo_med);');
            if (f.rr) lines.push('                if (!roulette(s, bounce)) break;');
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
            '            if (s.null_crossings > 32) break;',
            '            bounce--;',
            '            continue;',
            '        }',
        );
    }
    lines.push(
        '        MaterialProperties props = scene_material_properties(mat, hit.p);',
        '        Direction wo = -s.ray.direction;',
        '',
        '        kernel_score_emitter_hit(s, hit, mat, wo, props);   // settle last bounce\'s deferred estimate',
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
            '            float r = ior_of(hit.region_to) / ior_of(hit.region_from);',
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
