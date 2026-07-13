// compiler/generate/features/accumulation.ts
// Progressive accumulation: the main() that averages samples, + its uniforms.

import type { RenderPlan, ProgramDescription } from '../../plan/types.js';
import type { DiagnosticBag } from '../../../errors/core/DiagnosticBag.js';
import { emptyContribution, type FeatureContribution } from './types.js';

import mainAccumulateGLSL from '../../../components/film/accumulate_average/accumulate_average.glsl?raw';
import mainVarianceGLSL from '../../../components/film/accumulate_variance/accumulate_variance.glsl?raw';

export function contributeAccumulation(plan: RenderPlan, bag: DiagnosticBag): FeatureContribution {
    const program = plan.program;
    const type = program.estimator.accumulation.type;
    const contribution: FeatureContribution = {
        ...emptyContribution('accumulation'),
        blocks: [{ origin: accumulationOrigin(program), source: buildAccumulationSource(program, bag) }],
        requires: ['camera_generateRay', 'transport_trace'],
    };

    if (type === 'average' || type === 'variance') {
        contribution.uniforms = [
            { name: 'u_sampleCount', type: 'int', parameterPath: 'engine.sampleCount' },
            { name: 'u_pixelOffset', type: 'vec2', parameterPath: 'engine.pixelOffset', default: [0, 0] },
        ];
    }

    return contribution;
}

function accumulationOrigin(program: ProgramDescription): string {
    const type = program.estimator.accumulation.type;
    if (type === 'average') return 'components/film/accumulate_average/accumulate_average.glsl';
    if (type === 'variance') return 'components/film/accumulate_variance/accumulate_variance.glsl';
    return `generated:main-${type}`;
}

function buildAccumulationSource(program: ProgramDescription, bag: DiagnosticBag): string {
    const type = program.estimator.accumulation.type;
    if (type === 'average') return mainAccumulateGLSL;
    if (type === 'variance') return mainVarianceGLSL;
    bag.error('invalid-setting', `Accumulation type '${(program.estimator.accumulation as any).type}' not yet supported`).add();
    return '// unsupported accumulation';
}
