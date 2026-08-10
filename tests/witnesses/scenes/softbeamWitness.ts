// tests/witnesses/scenes/softbeamWitness.ts
// F-SOFTBEAM — the finite-divergence beam witness (fable-emitter-profiles v0).
//
// Aperture (r = 0.5) at z = 2 firing −z into a lambert wall at z = 0, δ = 0.05 rad.
// The derivation that makes this gateable: a wall point within r − d·tanδ ≈ 0.4 of
// the axis sees the FULL emission cone from a sub-disk of the aperture, so its
// irradiance is the exact solid-angle integral E = Le·π·sin²δ — independent of r and
// d in the core (the near-field plateau). With ρ = 0.5, Le = 800, δ = 0.05:
//     L = ρ·Le·sin²δ = 0.5·800·0.00249792 = 0.99917
// Outside r + d·tanδ ≈ 0.6 the wall is EXACTLY black (no aperture point can reach
// it inside the cone). Between them: the penumbra annulus — the visible signature
// separating this kind from the delta beam's hard edge.
// The nee ≡ mis equality is the load-bearing arm: softbeam is HITTABLE (the whole
// point of the kind), so mis adds real BSDF-side aperture hits through the cone-gated
// emission dispatch — divergence gates the sampler and the hit side sharing one truth.

import type { SceneDescription, RenderStrategy } from '../../../src/compiler/types.js';

export const softbeamWallScene: SceneDescription = {
    id: 'softbeam-wall',
    name: 'Soft Beam Wall (F-SOFTBEAM ρ·Le·sin²δ)',
    ambientSpace: { type: 'euclidean' },
    objects: [
        { type: 'plane', parameters: { normal: [0, 0, 1], offset: 0 }, material: 'wall' },
    ],
    materials: {
        wall: { model: 'lambert', albedo: [0.5, 0.5, 0.5] },
    },
    lights: [
        { kind: 'softbeam', position: [0, 0, 2], direction: [0, 0, -1], radius: 0.5, divergence: 0.05, emission: 800 },
    ],
};

const softbeamBase: Omit<RenderStrategy, 'id' | 'estimator'> = {
    measurement: {
        camera: { type: 'pinhole', fov: 0.8 },
        maxBounces: 4,
    },
    view: { tonemap: { type: 'none' } },   // on-screen radiance reads ρ·Le·sin²δ
};

export const softbeamNeeStrategy: RenderStrategy = {
    id: 'pt-nee',
    ...softbeamBase,
    estimator: {
        directLighting: 'nee',
        russianRoulette: null,
        accumulation: { type: 'average' },
    },
};

export const softbeamMisStrategy: RenderStrategy = {
    id: 'pt-mis',
    ...softbeamBase,
    estimator: {
        directLighting: 'mis',
        russianRoulette: null,
        accumulation: { type: 'average' },
    },
};
