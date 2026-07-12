// compiler/generate/features/core.ts
// Always-present library code + engine builtin uniforms.

import type { RenderPlan } from '../../plan/types.js';
import { emptyContribution, type FeatureContribution } from './types.js';

import structsGLSL from '../glsl/structs.glsl?raw';
import structsMediaGLSL from '../glsl/structs_media.glsl?raw';
import interactionGLSL from '../glsl/interaction.glsl?raw';
import rngGLSL from '../glsl/rng.glsl?raw';
import mathGLSL from '../glsl/math.glsl?raw';
import mathMediaGLSL from '../glsl/math_media.glsl?raw';
import mathMisGLSL from '../glsl/math_mis.glsl?raw';
import euclideanGLSL from '../glsl/euclidean.glsl?raw';
import rayGLSL from '../glsl/ray.glsl?raw';
import type { ShaderBlock } from '../ShaderIR.js';

export function contributeCore(plan: RenderPlan): FeatureContribution {
    // Conditional INCLUSION, not preprocessor gating (item-9 commit D): media-free
    // programs contain no media structs/helpers at all; non-MIS programs contain no
    // power_heuristic. The last structural defines died with this.
    const blocks: ShaderBlock[] = [{ origin: 'glsl/structs.glsl', source: structsGLSL }];
    if (plan.program.media.present) blocks.push({ origin: 'glsl/structs_media.glsl', source: structsMediaGLSL });
    blocks.push(
        { origin: 'glsl/interaction.glsl', source: interactionGLSL },
        { origin: 'glsl/rng.glsl', source: rngGLSL },
        { origin: 'glsl/math.glsl', source: mathGLSL },
    );
    if (plan.program.media.present) blocks.push({ origin: 'glsl/math_media.glsl', source: mathMediaGLSL });
    if (plan.program.estimator.lighting?.method === 'mis') blocks.push({ origin: 'glsl/math_mis.glsl', source: mathMisGLSL });
    blocks.push(
        { origin: 'glsl/euclidean.glsl', source: euclideanGLSL },
        { origin: 'glsl/ray.glsl', source: rayGLSL },
    );

    return {
        ...emptyContribution('core'),
        blocks,
        uniforms: [
            { name: 'u_resolution', type: 'vec2', parameterPath: 'engine.resolution' },
            { name: 'u_time', type: 'float', parameterPath: 'engine.time' },
            // RNG salt: bumped per accumulation reset so the seed doesn't replay (§2.11).
            { name: 'u_resetSalt', type: 'int', parameterPath: 'engine.resetSalt' },
        ],
    };
}
