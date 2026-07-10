// compiler/scenes/analyticScenes.ts
// Scenes exercising the analytic intersection backend (closed-form sphere/plane), and the
// combined scene_intersect dispatcher — see docs/impl-plan-analytic-backend.md.

import type { SceneDescription, RenderStrategy } from '../types.js';

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
        { kind: 'analytic', shape: { type: 'plane', parameters: { normal: [0, 1, 0], offset: 1.0 } }, material: 'ground' },
        { kind: 'analytic', shape: { type: 'sphere', parameters: { center: [0, 0, 0], radius: 1.0 } }, material: 'sphere' },
    ],
    materials: {
        ground: { model: 'lambert', albedo: [0.6, 0.6, 0.6] },
        sphere: { model: 'lambert', albedo: [0.9, 0.2, 0.2] },
    },
    lights: [{ kind: 'point', position: [3, 4, 2], intensity: 30.0, color: [1.0, 1.0, 1.0] }],
    environment: { type: 'constant', color: [0.1, 0.2, 0.45], intensity: 1.0 },
};

// Both backends in ONE scene: an analytic floor with an SDF sphere and an analytic sphere on it,
// lit by a point light. Proves the dispatcher combines backends (nearest-hit across them) and that
// scene_intersect_any casts shadows ACROSS backends — the analytic floor receives shadows from both
// the SDF sphere and the analytic sphere.
export const mixedScene: SceneDescription = {
    id: 'mixed',
    name: 'Mixed backends (analytic floor + SDF & analytic spheres)',
    ambientSpace: { type: 'euclidean' },
    objects: [
        { kind: 'analytic', shape: { type: 'plane', parameters: { normal: [0, 1, 0], offset: 1.0 } }, material: 'ground' },
        { kind: 'sdf', sdf: { type: 'sphere', parameters: { center: [-1.2, 0, 0], radius: 1.0 } }, material: 'red' },
        { kind: 'analytic', shape: { type: 'sphere', parameters: { center: [1.2, 0, 0], radius: 1.0 } }, material: 'blue' },
    ],
    materials: {
        ground: { model: 'lambert', albedo: [0.6, 0.6, 0.6] },
        red: { model: 'lambert', albedo: [0.9, 0.2, 0.2] },   // SDF sphere
        blue: { model: 'lambert', albedo: [0.2, 0.3, 0.9] },  // analytic sphere
    },
    lights: [{ kind: 'point', position: [2, 5, 3], intensity: 40.0, color: [1.0, 1.0, 1.0] }],
    environment: { type: 'constant', color: [0.08, 0.12, 0.2], intensity: 1.0 },
};

export const analyticStrategy: RenderStrategy = {
    id: 'pathtracer',
    transport: {
        maxBounces: 8,
        directLighting: 'nee',
        russianRoulette: { enabled: true, startDepth: 3 },
        samplesPerFrame: 1,
    },
    camera: { type: 'pinhole', fov: 0.8 },
    accumulation: { type: 'average' },
    display: { type: 'reinhard' },
};
