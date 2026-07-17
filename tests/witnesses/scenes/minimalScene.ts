// tests/witnesses/scenes/minimalScene.ts
// Minimal test scene: sphere on a ground plane, one point light, Lambert materials

import type { SceneDescription, RenderStrategy } from '../../../src/compiler/types.js';

export const minimalScene: SceneDescription = {
    id: 'minimal',
    name: 'Minimal Scene',
    ambientSpace: { type: 'euclidean' },
    objects: [
        // backend PINNED 'sdf' (B1): minimal IS the marcher twin of analytic-minimal —
        // under auto both would resolve analytic and the cross-backend witness would
        // silently compare a scene with itself. The pin is the coverage tool doing its job.
        {
            type: 'plane', parameters: { normal: [0, 1, 0], offset: 1.0 },
            material: 'ground', backend: 'sdf',
        },
        {
            type: 'sphere', parameters: { center: [0, 0, 0], radius: 1.0 },
            material: 'sphere', backend: 'sdf',
        },
    ],
    materials: {
        ground: { model: 'lambert', albedo: [0.6, 0.6, 0.6] },
        sphere: { model: 'lambert', albedo: [0.9, 0.2, 0.2] },
    },
    lights: [
        { kind: 'point', position: [3, 4, 2], emission: 30 },
    ],
    // Constant sky — a live uniform color (§2.10 proving case c, analytic variant)
    environment: { type: 'constant', color: [0.1, 0.2, 0.45], intensity: 1.0 },
};

export const minimalStrategy: RenderStrategy = {
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

export const directOnlyStrategy: RenderStrategy = {
    id: 'direct',
    measurement: {
        camera: { type: 'pinhole', fov: 0.8 },
        maxBounces: 1,
    },
    estimator: {
        directLighting: 'nee',
        russianRoulette: null,
        accumulation: { type: 'average' },
    },
    view: { tonemap: { type: 'reinhard' } },
};
