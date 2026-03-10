// compiler/scenes/cornellBox.ts
// Cornell box: 5 walls (planes), tall box, sphere, ceiling point light

import type { SceneDescription, RenderStrategy } from '../types.js';

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
            material: 'white',
        },
    ],
    materials: {
        white: { model: 'lambert', albedo: [0.73, 0.73, 0.73] },
        red: { model: 'lambert', albedo: [0.65, 0.05, 0.05] },
        green: { model: 'lambert', albedo: [0.12, 0.45, 0.15] },
    },
    lights: [
        { kind: 'point', position: [0, 1.9, 0], intensity: 15.0, color: [1.0, 1.0, 1.0] },
    ],
};

export const cornellStrategy: RenderStrategy = {
    id: 'pathtracer',
    transport: {
        maxBounces: 10,
        directLighting: 'nee',
        russianRoulette: { enabled: true, startDepth: 3 },
        samplesPerFrame: 1,
    },
    camera: { type: 'pinhole', fov: 0.8 },
    accumulation: { type: 'average' },
    display: { type: 'reinhard' },
};
