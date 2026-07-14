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
    const contribution: FeatureContribution = {
        ...emptyContribution('accumulation'),
        blocks: [{ origin: accumulationOrigin(program), source: buildAccumulationSource(program, bag) }],
        requires: ['pixel_sample', 'camera_generateRay', 'transport_trace'],
    };

    if (type === 'average' || type === 'variance' || type === 'oneshot') {
        contribution.uniforms = [
            { name: 'u_sampleCount', type: 'int', parameterPath: 'engine.sampleCount' },
            { name: 'u_pixelOffset', type: 'vec2', parameterPath: 'engine.pixelOffset', default: [0, 0] },
        ];
    }

    return contribution;
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
