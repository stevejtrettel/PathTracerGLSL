// compiler/generate/features/accumulation.ts
// Progressive accumulation: the main() that averages samples, + its uniforms.

import type { RenderPlan, ProgramDescription } from '../../plan/types.js';
import type { DiagnosticBag } from '../../../errors/core/DiagnosticBag.js';
import { emptyContribution, type FeatureContribution } from './types.js';

import mainAccumulateGLSL from '../../../components/film/accumulate_average.glsl?raw';

export function contributeAccumulation(plan: RenderPlan, bag: DiagnosticBag): FeatureContribution {
    const program = plan.program;
    const contribution: FeatureContribution = {
        ...emptyContribution('accumulation'),
        blocks: [{ origin: accumulationOrigin(program), source: buildAccumulationSource(program, bag) }],
        requires: ['camera_generateRay', 'transport_trace'],
    };

    if (program.estimator.accumulation.type === 'average') {
        contribution.uniforms = [
            { name: 'u_sampleCount', type: 'int', parameterPath: 'engine.sampleCount' },
            { name: 'u_pixelOffset', type: 'vec2', parameterPath: 'engine.pixelOffset', default: [0, 0] },
        ];
    }

    return contribution;
}

function accumulationOrigin(program: ProgramDescription): string {
    if (program.estimator.accumulation.type === 'average') return 'components/film/accumulate_average.glsl';
    return `generated:main-${program.estimator.accumulation.type}`;
}

function buildAccumulationSource(program: ProgramDescription, bag: DiagnosticBag): string {
    if (program.estimator.accumulation.type === 'average') {
        return mainAccumulateGLSL;
    }
    bag.error('invalid-setting', `Accumulation type '${(program.estimator.accumulation as any).type}' not yet supported`).add();
    return '// unsupported accumulation';
}
