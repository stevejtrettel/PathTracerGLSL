// compiler/generate/features/transport.ts
// Transport integrator: the path-trace loop + its #defines (bounce budget, NEE, RR).

import type { RenderPlan } from '../../plan/types.js';
import { emptyContribution, type FeatureContribution } from './types.js';

import pathTraceGLSL from '../glsl/path_trace.glsl?raw';

export function contributeTransport(plan: RenderPlan): FeatureContribution {
    const program = plan.program;

    // Flag defines carry an empty value → emitted as `#define NAME` (no value).
    const defines: Record<string, string> = {
        MAX_BOUNCES: String(program.measurement.maxBounces),
    };
    if (program.estimator.lighting !== null) {
        defines['ENABLE_NEE'] = '';
        // MIS = NEE + the reference-§8 weights; both estimators share every other line (§11.2's
        // premise — anything else differing between the generated loops is a bug).
        if (program.estimator.lighting.method === 'mis') defines['ENABLE_MIS'] = '';
    }
    if (program.estimator.russianRoulette) {
        defines['ENABLE_RUSSIAN_ROULETTE'] = '';
        defines['RR_START_DEPTH'] = String(program.estimator.russianRoulette.startDepth);
    }

    return {
        ...emptyContribution(),
        defines,
        blocks: [{ origin: 'glsl/path_trace.glsl', source: pathTraceGLSL }],
    };
}
