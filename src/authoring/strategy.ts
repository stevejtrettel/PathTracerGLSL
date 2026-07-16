// authoring/strategy.ts — strategy-level authoring sugar.
//
// The camera POSE is measurement data (compiler/types.ts CameraPose): without it,
// (scene, strategy) does not determine the converged image. Strategy literals are
// shared across scenes, so the suite pattern is one shared strategy + a per-scene
// pose wrap at registry time.

import type { RenderStrategy, Vec3 } from '../compiler/types.js';

/** Copy of `strategy` whose camera carries the given look-at pose — the authored
 *  DEFAULTS of the always-live camera.position/camera.target parameters (orbiting
 *  overrides them through the ParameterStore; it never recompiles). */
export function withPose(strategy: RenderStrategy, position: Vec3, target: Vec3): RenderStrategy {
    return {
        ...strategy,
        measurement: {
            ...strategy.measurement,
            camera: { ...strategy.measurement.camera, position, target },
        },
    };
}
