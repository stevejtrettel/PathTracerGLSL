// compiler/scenes/minimalScene.ts
// Minimal test scene: sphere on a ground plane, one point light, Lambert materials

import type { SceneDescription, RenderStrategy } from '../types.js';

export const minimalScene: SceneDescription = {
    id: 'minimal',
    name: 'Minimal Scene',
    ambientSpace: { type: 'euclidean' },
    objects: [
        {
            kind: 'sdf',
            sdf: { type: 'plane', parameters: { normal: [0, 1, 0], offset: 1.0 } },
            material: 'ground',
        },
        {
            kind: 'sdf',
            sdf: { type: 'sphere', parameters: { center: [0, 0, 0], radius: 1.0 } },
            material: 'sphere',
        },
    ],
    materials: {
        ground: { model: 'lambert', albedo: [0.6, 0.6, 0.6] },
        sphere: { model: 'lambert', albedo: [0.9, 0.2, 0.2] },
    },
    lights: [
        { kind: 'point', position: [3, 4, 2], intensity: 30.0, color: [1.0, 1.0, 1.0] },
    ],
};

export const minimalStrategy: RenderStrategy = {
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

export const directOnlyStrategy: RenderStrategy = {
    id: 'direct',
    transport: {
        maxBounces: 1,
        directLighting: 'nee',
        russianRoulette: { enabled: false, startDepth: 0 },
        samplesPerFrame: 1,
    },
    camera: { type: 'pinhole', fov: 0.8 },
    accumulation: { type: 'average' },
    display: { type: 'reinhard' },
};
