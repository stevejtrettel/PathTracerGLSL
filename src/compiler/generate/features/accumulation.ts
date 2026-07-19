// compiler/generate/features/accumulation.ts
// Progressive accumulation: the main() that folds samples in, + its uniforms.
// D3: fully registry-driven — the occupant, its origin, and its ping-pong input
// declarations all derive from ACCUMULATORS facts (the type→path if-chain is dead).

import type { RenderPlan } from '../../plan/types.js';
import type { DiagnosticBag } from '../../../errors/core/DiagnosticBag.js';
import { emptyContribution, type FeatureContribution } from './types.js';
import { ACCUMULATORS } from '../../../components/accumulator/index.js';

export function contributeAccumulation(plan: RenderPlan, bag: DiagnosticBag): FeatureContribution {
    const type = plan.program.estimator.accumulation.type;
    const d = ACCUMULATORS[type];
    if (d === undefined) {
        // Backstop — the Validator gates the type against the same registry.
        bag.error('invalid-setting', `Accumulation type '${type}' not yet supported`).add();
        return { ...emptyContribution('accumulation'), blocks: [{ origin: `generated:main-${type}`, source: '// unsupported accumulation' }] };
    }

    // The occupant's ping-pong inputs, declared HERE because the occupant reads them
    // (exact linkage, from the registry FACTS): oneshot reads neither and declares
    // neither — its programs carry no dead sampler. The moment texture binds as the
    // pathtracer pass input 'accumulation_previous:1'.
    const inputDecls: string[] = [];
    if (d.readsPrevious) inputDecls.push('uniform sampler2D u_previous;');
    if (d.readsMoment) inputDecls.push('uniform sampler2D u_previousMoment;');

    return {
        ...emptyContribution('accumulation'),
        blocks: [
            ...(inputDecls.length
                ? [{ origin: 'generated:accumulation-inputs', source: inputDecls.join('\n') }]
                : []),
            { origin: `components/accumulator/${d.type}/${d.type}.glsl`, source: d.glsl },
        ],
        // Engine builtins declared where READ (the core.ts discipline).
        uniforms: [
            { name: 'u_sampleCount', type: 'int', parameterPath: 'engine.sampleCount' },
            { name: 'u_pixelOffset', type: 'vec2', parameterPath: 'engine.pixelOffset', default: [0, 0] },
        ],
        requires: ['pixel_sample', 'camera_generateRay', 'transport_trace'],
    };
}
