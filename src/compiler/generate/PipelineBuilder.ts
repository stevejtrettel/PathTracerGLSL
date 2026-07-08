// compiler/generate/PipelineBuilder.ts

import type { RenderPipeline, CompiledRenderer } from '../types.js';
import type { RenderPlan, PlannedUniform } from '../plan/types.js';
import type { UniformBinding } from '../../engine/types.js';

export function buildPipeline(rendererId: string, plan: RenderPlan): RenderPipeline {
    const planned = plan.pipeline;

    // Map pass roles to shader IDs
    const roleToShader: Record<string, string> = {
        'pathtracer': `${rendererId}-main`,
        'display': `${rendererId}-display`,
    };

    return {
        framebuffers: planned.framebuffers.map(fb => ({
            id: fb.id,
            type: fb.type,
            format: fb.format,
        })),
        passes: planned.passes.map(pass => ({
            id: `${pass.role}-pass`,
            shader: roleToShader[pass.role] ?? `${rendererId}-${pass.role}`,
            inputs: { textures: pass.inputs },
            output: pass.output,
            execution: { type: 'once' as const },
        })),
        postFrame: {
            swaps: planned.swaps.map(s => ({
                type: 'swap' as const,
                buffers: s.buffers,
            })),
        },
    };
}

export function buildUniforms(uniforms: PlannedUniform[]): UniformBinding[] {
    const bindings: UniformBinding[] = [];

    for (const u of uniforms) {
        bindings.push({
            uniform: u.name,
            parameters: [u.parameterPath],
            type: u.type as UniformBinding['type'],
            // A uniform may be a transform of its parameter (e.g. u_tanFov = tan(fov/2)).
            compute: u.compute ?? ((params) => params[u.parameterPath] ?? u.default),
        });
    }

    return bindings;
}

export function buildExportTargets(): CompiledRenderer['exportTargets'] {
    return {
        // 'previous', not 'current': exports run after renderFrame(), and the postFrame
        // swap has already flipped the ping-pong index — post-swap, the freshly written
        // frame lives in 'accumulation_previous'. Reading 'current' exports frame N-1.
        'hdr': { bufferId: 'accumulation_previous', format: 'float' },
    };
}
