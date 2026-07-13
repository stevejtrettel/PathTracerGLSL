// tests/witnesses/scenes/cornellBox.ts
// Cornell box: 5 walls (planes), tall box, sphere, ceiling point light

import type { SceneDescription, RenderStrategy } from '../../../src/compiler/types.js';

export const cornellBox: SceneDescription = {
    id: 'cornell',
    name: 'Cornell Box',
    ambientSpace: { type: 'euclidean' },
    objects: [
        // Floor
        {
            kind: 'sdf',
            sdf: { type: 'plane', parameters: { normal: [0, 1, 0], offset: 0.0 } },
            material: 'white',
        },
        // Ceiling at y=2
        {
            kind: 'sdf',
            sdf: { type: 'plane', parameters: { normal: [0, -1, 0], offset: 2.0 } },
            material: 'white',
        },
        // Back wall at z=-2
        {
            kind: 'sdf',
            sdf: { type: 'plane', parameters: { normal: [0, 0, 1], offset: 2.0 } },
            material: 'white',
        },
        // Left wall at x=-1.5 (red)
        {
            kind: 'sdf',
            sdf: { type: 'plane', parameters: { normal: [1, 0, 0], offset: 1.5 } },
            material: 'red',
        },
        // Right wall at x=1.5 (green)
        {
            kind: 'sdf',
            sdf: { type: 'plane', parameters: { normal: [-1, 0, 0], offset: 1.5 } },
            material: 'green',
        },
        // Front wall at z=5 (behind camera)
        {
            kind: 'sdf',
            sdf: { type: 'plane', parameters: { normal: [0, 0, -1], offset: 5.0 } },
            material: 'white',
        },
        // Tall box
        {
            kind: 'sdf',
            sdf: { type: 'box', parameters: { center: [-0.5, 0.6, -0.5], halfSize: [0.3, 0.6, 0.3] } },
            material: 'white',
        },
        // Sphere
        {
            kind: 'sdf',
            sdf: { type: 'sphere', parameters: { center: [0.5, 0.4, 0.3], radius: 0.4 } },
            material: 'clay',
        },
    ],
    materials: {
        white: { model: 'lambert', albedo: [0.73, 0.73, 0.73] },
        red: { model: 'lambert', albedo: [0.65, 0.05, 0.05] },
        green: { model: 'lambert', albedo: [0.12, 0.45, 0.15] },
        // Live albedo — a { param } material property (§2.8, proving case b)
        clay: { model: 'lambert', albedo: { param: 'clay.albedo', default: [0.8, 0.4, 0.2] } },
    },
    lights: [
        { kind: 'point', position: [0, 1.9, 0], intensity: 15.0, color: [1.0, 1.0, 1.0] },
    ],
};

export const cornellStrategy: RenderStrategy = {
    id: 'pathtracer',
    measurement: {
        camera: { type: 'pinhole', fov: { param: 'camera.fov', default: 0.8, min: 0.3, max: 1.5 } },
        maxBounces: 10,
    },
    estimator: {
        directLighting: 'nee',
        russianRoulette: { startDepth: 3 },
        accumulation: { type: 'average' },
    },
    view: { tonemap: { type: 'reinhard' } },
};
