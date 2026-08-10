// components/transport/techniques/kernel.ts
// T1 — KERNEL SAMPLING: the descriptor/glue side (fable-transport-glsl-target.md).
// The MATH lives in kernel.glsl / kernel_phase.glsl (static, conditionally included);
// this file owns T1's declared facts: the state fields of its carried record, the
// generated writer of that record (the ONE emitter of the MIS state writes — the
// pinned single-emitter rule, now a single generated FUNCTION), the file inclusions,
// and the seams T1's emitted code calls.

import type { ShaderBlock } from '../../../../compiler/generate/ShaderIR.js';
import type { Flags } from '../../flags.js';
import kernelGLSL from './kernel.glsl?raw';
import kernelPhaseGLSL from './kernel_phase.glsl?raw';

/** T1's carried sampling record — field declarations for the generated PathState.
 *  T1 cannot score where it samples (the MIS weight is a function of the path EDGE,
 *  whose far endpoint doesn't exist yet) — these fields carry the record forward. */
export function kernelStateFields(f: Flags): string[] {
    const fields = [
        '    bool prev_was_delta;     // kernel\'s record: camera "bounce" counts as delta (§6.2)',
    ];
    if (f.mis) {
        fields.push(
            '    float prev_bsdf_pdf;     // kernel\'s record, MIS: the BSDF side of the power heuristic',
            '    LightQuery prev_query;   //   (reference §8) — the STORED selection context (fable-light-bvh',
            '                             //   §3.2 v1.5): the pmf replays exactly what the sampler saw.',
        );
    }
    return fields;
}

/** Init lines for the record (inside path_state_init). */
export function kernelStateInit(f: Flags): string[] {
    const lines = ['    s.prev_was_delta = true;'];
    if (f.mis) {
        lines.push('    s.prev_bsdf_pdf = 0.0;', '    s.prev_query = LightQuery(ray.origin, vec3(0.0));');
    }
    return lines;
}

/** The generated record writer — both sampling sites (surface, phase) call this ONE
 *  function, so the MIS state writes agree by construction. */
export function kernelRecordFn(f: Flags): ShaderBlock {
    const lines = [
        '// ── Kernel record (generated): the ONE writer of T1\'s carried state ──',
        '// The query arrives from the SAME generated constructor the NEE call used at',
        '// this vertex — stored-context replay (fable-light-bvh §3.2 v1.5).',
        'void kernel_record(inout PathState s, float pdf, LightQuery q, bool is_delta) {',
        '    s.prev_was_delta = is_delta;',
    ];
    if (f.mis) {
        lines.push('    s.prev_bsdf_pdf = pdf;', '    s.prev_query = q;');
    }
    lines.push('}');
    return { origin: 'generated:transport/kernel-record', source: lines.join('\n') };
}

/** T1's static math files, included per program shape. */
export function kernelBlocks(f: Flags): ShaderBlock[] {
    const blocks: ShaderBlock[] = [
        { origin: 'components/transport/techniques/kernel/kernel.glsl', source: kernelGLSL },
    ];
    if (f.scattering) {
        blocks.push({ origin: 'components/transport/techniques/kernel/kernel_phase.glsl', source: kernelPhaseGLSL });
    }
    return blocks;
}

/** The seams T1's emitted code calls under these flags. */
export function kernelRequires(f: Flags): string[] {
    const req = ['interaction_surface_sample', 'interaction_surface_emission', 'material_is_emissive', 'environment_radiance', 'light_query_surface'];
    if (f.nee && f.emitters) req.push('light_of');
    if (f.emittersPdf) req.push('lighting_pdf');
    if (f.scattering) req.push('interaction_medium_sample', 'light_query_medium');
    if (f.envSamplable && f.mis) req.push('environment_pdf');
    return req;
}
