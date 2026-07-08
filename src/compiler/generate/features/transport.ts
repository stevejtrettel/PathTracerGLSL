// compiler/generate/features/transport.ts
// Transport integrator: the path-trace loop. Its #defines (MAX_BOUNCES, ENABLE_NEE,
// Russian roulette) stay in ShaderBuilder.buildHeader for step i-a and consolidate
// here once fov leaves buildHeader (proving case a) — see the impl plan.

import type { RenderPlan } from '../../plan/types.js';
import { emptyContribution, type FeatureContribution } from './types.js';

import pathTraceGLSL from '../glsl/path_trace.glsl?raw';

export function contributeTransport(_plan: RenderPlan): FeatureContribution {
    return {
        ...emptyContribution(),
        blocks: [{ origin: 'glsl/path_trace.glsl', source: pathTraceGLSL }],
    };
}
