// compiler/generate/features/accumulation.ts
// Progressive accumulation: the main() that averages samples, + its uniforms.

import type { RenderPlan, ProgramDescription } from '../../plan/types.js';
import type { DiagnosticBag } from '../../../errors/core/DiagnosticBag.js';
import { emptyContribution, type FeatureContribution } from './types.js';

import mainAccumulateGLSL from '../../../components/accumulator/average/average.glsl?raw';
import mainVarianceGLSL from '../../../components/accumulator/variance/variance.glsl?raw';
import mainOneshotGLSL from '../../../components/accumulator/oneshot/oneshot.glsl?raw';

export function contributeAccumulation(plan: RenderPlan, bag: DiagnosticBag): FeatureContribution {
    const program = plan.program;
    const type = program.estimator.accumulation.type;

    // The occupant's ping-pong inputs, declared HERE because the occupant reads them
    // (exact linkage): average/variance read u_previous (variance also the second
    // moment, bound as pathtracer pass input 'accumulation_previous:1'); oneshot reads
    // neither and declares neither — its programs carry no dead sampler.
    const inputDecls: string[] = [];
    if (type !== 'oneshot') inputDecls.push('uniform sampler2D u_previous;');
    if (type === 'variance') inputDecls.push('uniform sampler2D u_previousMoment;');

    return {
        ...emptyContribution('accumulation'),
        blocks: [
            ...(inputDecls.length
                ? [{ origin: 'generated:accumulation-inputs', source: inputDecls.join('\n') }]
                : []),
            { origin: accumulationOrigin(program), source: buildAccumulationSource(program, bag) },
        ],
        // Engine builtins declared where READ (the core.ts discipline).
        uniforms: [
            { name: 'u_sampleCount', type: 'int', parameterPath: 'engine.sampleCount' },
            { name: 'u_pixelOffset', type: 'vec2', parameterPath: 'engine.pixelOffset', default: [0, 0] },
        ],
        requires: ['pixel_sample', 'camera_generateRay', 'transport_trace'],
    };
}

function accumulationOrigin(program: ProgramDescription): string {
    const type = program.estimator.accumulation.type;
    if (type === 'average') return 'components/accumulator/average/average.glsl';
    if (type === 'variance') return 'components/accumulator/variance/variance.glsl';
    if (type === 'oneshot') return 'components/accumulator/oneshot/oneshot.glsl';
    return `generated:main-${type}`;
}

function buildAccumulationSource(program: ProgramDescription, bag: DiagnosticBag): string {
    const type = program.estimator.accumulation.type;
    if (type === 'average') return mainAccumulateGLSL;
    if (type === 'variance') return mainVarianceGLSL;
    if (type === 'oneshot') return mainOneshotGLSL;
    bag.error('invalid-setting', `Accumulation type '${(program.estimator.accumulation as any).type}' not yet supported`).add();
    return '// unsupported accumulation';
}
