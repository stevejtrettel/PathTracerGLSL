// compiler/generate/features/transport.ts
// Transport integrator: the path-trace loop + its #defines (bounce budget, NEE, RR).

import type { RenderPlan } from '../../plan/types.js';
import { emptyContribution, type FeatureContribution } from './types.js';

import pathTraceGLSL from '../glsl/path_trace.glsl?raw';

export function contributeTransport(plan: RenderPlan): FeatureContribution {
    const program = plan.program;

    // Flag defines carry an empty value → emitted as `#define NAME` (no value).
    const defines: Record<string, string> = {
        MAX_BOUNCES: String(program.transport.maxBounces),
    };
    if (program.lighting !== null) {
        defines['ENABLE_NEE'] = '';
    }
    if (program.transport.russianRoulette) {
        defines['ENABLE_RUSSIAN_ROULETTE'] = '';
        defines['RR_START_DEPTH'] = String(program.transport.russianRoulette.startDepth);
    }

    return {
        ...emptyContribution(),
        defines,
        blocks: [{ origin: 'glsl/path_trace.glsl', source: pathTraceGLSL }],
    };
}
