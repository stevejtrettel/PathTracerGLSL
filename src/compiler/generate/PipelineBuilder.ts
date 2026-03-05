// compiler/generate/PipelineBuilder.ts

import type { RenderPipeline, CompiledRenderer } from '../types.js';
import type { RenderPlan } from '../plan/types.js';
import type { UniformBinding, ParameterMetadata } from '../../engine/types.js';

export function buildPipeline(rendererId: string): RenderPipeline {
    return {
        framebuffers: [
            { id: 'accumulation', type: 'double_buffer', format: 'rgba32f' },
            { id: 'rgb', type: 'texture', format: 'rgba8' },
            { id: 'screen', type: 'screen' },
        ],
        passes: [
            {
                id: 'main-pass',
                shader: `${rendererId}-main`,
                inputs: { textures: { 'u_previous': 'accumulation_previous' } },
                output: 'accumulation_current',
                execution: { type: 'once' },
            },
            {
                id: 'display-pass',
                shader: `${rendererId}-display`,
                inputs: { textures: { 'u_radiance': 'accumulation_current' } },
                output: 'rgb',
                execution: { type: 'once' },
            },
            {
                id: 'composite-pass',
                shader: `${rendererId}-composite`,
                inputs: { textures: { 'u_rgb': 'rgb' } },
                output: 'screen',
                execution: { type: 'once' },
            },
        ],
        postFrame: {
            swaps: [{ type: 'swap', buffers: ['accumulation'] }],
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

export function buildParameters(_plan: RenderPlan): Record<string, ParameterMetadata> {
    return {
        'camera.position': {
            type: 'vec3',
            default: [0, 0, 8],
            name: 'Position',
            group: 'Camera',
            triggersReset: true,
        },
        'camera.target': {
            type: 'vec3',
            default: [0, 0, 0],
            name: 'Target',
            group: 'Camera',
            triggersReset: true,
        },
    };
}

export function buildExportTargets(): CompiledRenderer['exportTargets'] {
    return {
        'hdr': { bufferId: 'accumulation_current', format: 'float' },
        'ldr': { bufferId: 'rgb', format: 'byte' },
    };
}
