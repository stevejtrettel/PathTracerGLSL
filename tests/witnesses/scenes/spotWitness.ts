// tests/witnesses/scenes/spotWitness.ts
// F-SPOT — the spot-light witness: a spot 2 units above a lambert floor, aimed straight
// down. Directly under the axis (inside falloffStart, cosθ ≈ 1 on every factor) the
// floor's NEE radiance has a closed form:
//     L = ρ/π · I/d² = (0.6/π)·(8/4) = 1.2/π ≈ 0.38197
// and OUTSIDE the cone the floor receives nothing at all (no env, delta light → no
// BSDF-path contribution either): corner pixels are exactly 0. The smooth ring between
// falloffStart and angle is the smoothstep band — visible on the card, not gated.
// RR OFF, tonemap NONE (on-screen radiance). pt-nee only: a DELTA light is invisible
// to chance-hit pt (never hittable) — there is no pt arm to compare.

import type { SceneDescription, RenderStrategy } from '../../../src/compiler/types.js';

export const spotScene: SceneDescription = {
    id: 'spot',
    name: 'Spot Light (F-SPOT ρ/π·I/d²)',
    ambientSpace: { type: 'euclidean' },
    objects: [
        { type: 'plane', parameters: { normal: [0, 1, 0], offset: 0 }, material: 'floor' },
    ],
    materials: {
        floor: { model: 'lambert', albedo: [0.6, 0.6, 0.6] },
    },
    lights: [
        {
            kind: 'spot',
            position: [0, 2, 0],
            direction: [0, -1, 0],
            angle: 0.5236,          // 30° outer half-angle → lit radius ≈ 1.155 on the floor
            falloffStart: 0.42,     // smooth band 0.42..0.5236 rad
            emission: 8,            // on-axis I (W/sr); scalar broadcasts
        },
    ],
};

export const spotNeeStrategy: RenderStrategy = {
    id: 'pt-nee',
    measurement: {
        camera: { type: 'pinhole', fov: { param: 'camera.fov', default: 0.8, min: 0.3, max: 1.5 } },
        maxBounces: 4,
    },
    estimator: {
        directLighting: 'nee',
        russianRoulette: null,
        accumulation: { type: 'average' },
    },
    view: { tonemap: { type: 'none' } },   // §11 on-screen radiance: hotspot reads 1.2/π
};
