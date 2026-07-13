// components/transport/integrators/pt.ts
// The `pt` INTEGRATOR — the recursive path-tracing walk (fable-components §7, pinned
// July 2026: the technique-centric carve).
//
// An integrator is a walk skeleton: it owns path advance (intersect, medium segments,
// self-heal, null crossings), state, termination (RR, bounce budget), and ray spawning.
// It does NO sampling itself — at each scattering event it hands the estimator work to
// its technique roster: T1 kernel sampling (techniques/kernel.ts, with its deferred
// scoring sites at emitter-hit and miss) and T2 light sampling (techniques/light.ts,
// local scoring). The combiner (../combiner.ts) owns every weighting line, so
// pt/pt-nee/pt-mis are combiner configurations of this ONE walk. A new integrator
// (one-shot, Whitted, debug probe) is a new file here composing the same techniques
// with different walk rules — techniques and combiner untouched.
//
// The emitted program contains only the code that runs (no preprocessor conditionals;
// specialization happens HERE). Emitters are pure functions of ProgramDescription —
// never of scene data, which lives behind the seams the loop calls.
//
// PINNED (owner, July 2026): any invariant spanning emission sites has exactly ONE
// emitter — rr() below (both RR sites), prevBookkeeping in kernel.ts (both sampling
// sites). Emission quality bar: the output reads as a bespoke tracer for THIS program.

import type { RenderPlan, ProgramDescription } from '../../../compiler/plan/types.js';
import type { ShaderBlock } from '../../../compiler/generate/ShaderIR.js';
import type { FeatureContribution } from '../../../compiler/generate/features/types.js';
import { flags, type Flags } from '../flags.js';
import {
    kernelStateDecls, kernelSampleSurface, kernelSamplePhase,
    kernelScoreEmitterHit, kernelScoreMiss, kernelRequires,
} from '../techniques/kernel.js';
import { lightSurfaceSite, lightMediumSite, lightRequires } from '../techniques/light.js';

export function contributeTransport(plan: RenderPlan): FeatureContribution {
    const program = plan.program;
    const f = flags(program);

    // T4 seams: what the emitted code calls — each part declares its own, merged here.
    const requires = [...walkRequires(f), ...kernelRequires(f), ...lightRequires(f)];

    // Explicit literal (not ...emptyContribution): the purity rule — components import
    // no compiler VALUES, only contract types. tsc keeps this in sync with the type.
    return {
        feature: 'transport',
        blocks: emitTransportTrace(program, f),
        defines: {},
        uniforms: [],
        parameters: {},
        textures: [],
        provides: [{ name: 'transport_trace', signature: 'Radiance transport_trace(Ray ray)' }],
        requires,
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
// The walk — owns the skeleton; techniques fill the estimator sites.
// ============================================================================

function emitTransportTrace(p: ProgramDescription, f: Flags): ShaderBlock[] {
    const blocks: ShaderBlock[] = [];
    const seg = (name: string, lines: string[]) => {
        if (lines.length > 0) blocks.push({ origin: `generated:transport/${name}`, source: lines.join('\n') });
    };

    seg('init', [...stateInit(f), ...kernelStateDecls(f), '']);

    if (f.media) {
        // Media skeleton: one trace per iteration; the medium decides what happens on
        // the segment BEFORE the boundary is honored (fable-volumetric-component §2).
        seg('loop', [
            `    for (int bounce = 0; bounce < ${p.measurement.maxBounces}; bounce++) {`,
            '        Hit hit;',
            '        bool boundary = scene_intersect(current_ray, hit);',
            '',
        ]);
        seg('medium', [
            '        // The volumetric component\'s call site (fable-volumetric-component §2): one segment,',
            '        // ending at the boundary or the far clip. medium_sample never sees a boundary;',
            '        // entering/exiting is the interface machinery\'s job below.',
            '        int med_mat = material_of(current_medium);',
            '        if (material_has_medium(med_mat)) {',
            '            MediumSample ms = medium_sample(med_mat, current_ray, boundary ? hit.t : MAX_DIST, random2());',
            '            throughput *= ms.weight;',
        ]);
        if (f.scattering) {
            seg('medium', [
                '            if (ms.scattered) {',
                '                // ---- MEDIUM EVENT (§7.2 step 2) ----',
                '                Point p_evt = ambient_geodesic(current_ray.origin, current_ray.direction, ms.t);',
                '                Direction wo_med = -current_ray.direction;',
            ]);
            seg('light-medium', lightMediumSite(f));
            seg('kernel-phase', kernelSamplePhase(f));
            seg('rr', f.rr ? rr(f, 'medium') : []);
            seg('medium', [
                '                continue;   // loop-header bounce++: medium events COUNT toward the budget (§7.2)',
                '            }',
            ]);
        }
        seg('medium', ['        }']);
        seg('loop', ['        if (!boundary) {']);
    } else {
        seg('loop', [
            `    for (int bounce = 0; bounce < ${p.measurement.maxBounces}; bounce++) {`,
            '        Hit hit;',
            '        if (!scene_intersect(current_ray, hit)) {',
        ]);
    }
    seg('kernel-miss', kernelScoreMiss(f));
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
    seg('kernel-emitter', kernelScoreEmitterHit(f));
    seg('light-surface', lightSurfaceSite(f));
    seg('kernel-sample', kernelSampleSurface(f));
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

// ============================================================================
// Walk-owned segments — state, path advance, termination.
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
    return lines;
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
