// witnesses/scenes/analyticMinimal.ts
// The analytic-backend twin fixture (docs/impl-plan-analytic-backend.md).

import type { SceneDescription, RenderStrategy } from '../../../src/compiler/types.js';

// Cross-method twin of `minimalScene`: identical geometry/materials/lights, but every object is
// intersected ANALYTICALLY instead of by SDF marching. It must converge to the SAME image as the
// SDF `minimal` — the backends agree. (Not byte-identical per sample: the SDF march stops within
// MARCH_EPSILON of the surface while analytic is exact, so early-bounce points differ slightly and
// the RNG streams diverge — but the converged mean is the same. That equality IS the validation.)
export const analyticMinimal: SceneDescription = {
    id: 'analytic-minimal',
    name: 'Analytic Minimal (cross-method twin of minimal)',
    ambientSpace: { type: 'euclidean' },
    objects: [
        { type: 'plane', parameters: { normal: [0, 1, 0], offset: 1.0 }, material: 'ground' },
        { type: 'sphere', parameters: { center: [0, 0, 0], radius: 1.0 }, material: 'sphere' },
    ],
    materials: {
        ground: { model: 'lambert', albedo: [0.6, 0.6, 0.6] },
        sphere: { model: 'lambert', albedo: [0.9, 0.2, 0.2] },
    },
    lights: [{ kind: 'point', position: [3, 4, 2], emission: 30 }],
    environment: { type: 'constant', color: [0.1, 0.2, 0.45], intensity: 1.0 },
};

export const analyticStrategy: RenderStrategy = {
    id: 'pathtracer',
    measurement: {
        camera: { type: 'pinhole', fov: 0.8 },
        maxBounces: 8,
    },
    estimator: {
        directLighting: 'nee',
        russianRoulette: { startDepth: 3 },
        accumulation: { type: 'average' },
    },
    view: { tonemap: { type: 'reinhard' } },
};
