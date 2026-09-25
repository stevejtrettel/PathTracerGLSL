// compiler/plan/measurement.ts
// The resolved measurement section (fable-strategy-taxonomy §2, §4): the authored fields with
// every default applied. The Planner records it in ProgramDescription.measurement, and the App
// writes it into export stamps, so a render's truncations are stated even where the author
// left them at their defaults.

import type { SceneDescription, RenderStrategy } from '../types.js';
import type { ProgramDescription } from './types.js';

/** Default for measurement.maxNullCrossings: paths may cross at most this many null interfaces. */
export const DEFAULT_MAX_NULL_CROSSINGS = 32;

export function resolveMeasurement(scene: SceneDescription, strategy: RenderStrategy): ProgramDescription['measurement'] {
    const m = strategy.measurement;
    return {
        // Straight-through: unregistered camera types are Validator-rejected upstream
        // (reject-not-remove), so the Planner never coerces — CameraDesc mirrors the
        // strategy's CameraDescription exactly.
        camera: m.camera,
        // Ambient space rides the SCENE (the geometry-of-space is part of the integral's
        // domain); non-registry types are Validator-rejected upstream.
        ambient: scene.ambientSpace?.type ?? 'euclidean',
        response: m.response ?? 'radiance',
        maxBounces: m.maxBounces,
        maxNullCrossings: m.maxNullCrossings ?? DEFAULT_MAX_NULL_CROSSINGS,
        scattering: m.scattering ?? 'full',
        shadows: m.shadows ?? 'opaque-dielectrics',
        color: 'rgb',   // 'spectral' is Validator-rejected (reserved, contracts §8)
    };
}
