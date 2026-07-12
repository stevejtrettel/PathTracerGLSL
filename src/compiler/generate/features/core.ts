// compiler/generate/features/core.ts
// Always-present library code + engine builtin uniforms.

import type { RenderPlan } from '../../plan/types.js';
import { emptyContribution, type FeatureContribution } from './types.js';

import structsGLSL from '../glsl/structs.glsl?raw';
import interactionGLSL from '../glsl/interaction.glsl?raw';
import rngGLSL from '../glsl/rng.glsl?raw';
import mathGLSL from '../glsl/math.glsl?raw';
import euclideanGLSL from '../glsl/euclidean.glsl?raw';
import rayGLSL from '../glsl/ray.glsl?raw';

export function contributeCore(_plan: RenderPlan): FeatureContribution {
    return {
        ...emptyContribution('core'),
        blocks: [
            { origin: 'glsl/structs.glsl', source: structsGLSL },
            { origin: 'glsl/interaction.glsl', source: interactionGLSL },
            { origin: 'glsl/rng.glsl', source: rngGLSL },
            { origin: 'glsl/math.glsl', source: mathGLSL },
            { origin: 'glsl/euclidean.glsl', source: euclideanGLSL },
            { origin: 'glsl/ray.glsl', source: rayGLSL },
        ],
        uniforms: [
            { name: 'u_resolution', type: 'vec2', parameterPath: 'engine.resolution' },
            { name: 'u_time', type: 'float', parameterPath: 'engine.time' },
            // RNG salt: bumped per accumulation reset so the seed doesn't replay (§2.11).
            { name: 'u_resetSalt', type: 'int', parameterPath: 'engine.resetSalt' },
        ],
    };
}
