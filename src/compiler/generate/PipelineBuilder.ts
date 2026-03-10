// compiler/generate/PipelineBuilder.ts

import type { RenderPipeline, CompiledRenderer } from '../types.js';
import type { RenderPlan } from '../plan/types.js';
import type { UniformBinding, ParameterMetadata } from '../../engine/types.js';

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

export function buildUniforms(plan: RenderPlan): UniformBinding[] {
    const bindings: UniformBinding[] = [];

    for (const u of plan.uniforms) {
        bindings.push({
            uniform: u.name,
            parameters: [u.parameterPath],
            type: u.type as UniformBinding['type'],
            compute: (params) => params[u.parameterPath] ?? u.default,
        });
    }

    return bindings;
}

export function buildParameters(plan: RenderPlan): Record<string, ParameterMetadata> {
    const params: Record<string, ParameterMetadata> = {};

    // Camera parameters based on type
    const cam = plan.program.camera;
    if (cam.type === 'pinhole') {
        params['camera.position'] = {
            type: 'vec3',
            default: [0, 0, 8],
            name: 'Position',
            group: 'Camera',
            triggersReset: true,
        };
        params['camera.target'] = {
            type: 'vec3',
            default: [0, 0, 0],
            name: 'Target',
            group: 'Camera',
            triggersReset: true,
        };
    }

    return params;
}

export function buildExportTargets(): CompiledRenderer['exportTargets'] {
    return {
        'hdr': { bufferId: 'accumulation_current', format: 'float' },
    };
}
