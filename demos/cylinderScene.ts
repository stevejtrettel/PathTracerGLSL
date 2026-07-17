// demos/cylinderScene.ts
// The cylinder door test: the first primitive through the descriptor front door
// (folder + registry line + union word). Three cylinders, three placement tiers —
// the shape is CANONICAL Y-axis (no axis parameter; orientation is placement, box's
// twin): translation · constant rotation+scale (similarity wrapper, s·d correction)
// · {param}-driven rotation+scale (rigid-frame uniforms, radius/halfHeight absorb s).

import type { SceneDescription, RenderStrategy } from '../src/compiler/types.js';

export const cylinderScene: SceneDescription = {
    id: 'cylinders',
    name: 'Cylinders (door test)',
    ambientSpace: { type: 'euclidean' },
    objects: [
        {
            kind: 'sdf',
            sdf: { type: 'plane', parameters: { normal: [0, 1, 0], offset: 0 } },
            material: 'floor',
        },
        // Upright: canonical shape, translation tier.
        {
            kind: 'sdf',
            sdf: { type: 'cylinder', parameters: { radius: 0.3, halfHeight: 0.5 } },
            material: 'clay',
            transform: { position: [-0.9, 0.5, 0] },
        },
        // Tilted: constant rotation + scale → the similarity wrapper tier (folded
        // mat3/s query + s·d world-distance correction). Orientation via PLACEMENT.
        {
            kind: 'sdf',
            sdf: { type: 'cylinder', parameters: { radius: 0.25, halfHeight: 0.45 } },
            material: 'green',
            transform: { position: [0.1, 0.5, 0.35], rotation: { axis: [0, 0, 1], angle: Math.PI / 5 }, scale: 1.2 },
        },
        // Driven: live rotation + scale → rigid-frame uniform pair; the struct's
        // length params (radius, halfHeight) absorb s in-shader, world-exact.
        {
            kind: 'sdf',
            sdf: { type: 'cylinder', parameters: { radius: 0.2, halfHeight: 0.4 } },
            material: 'red',
            transform: {
                position: [1.0, 0.5, -0.25],
                rotation: { axis: [1, 0, 0], angle: { param: 'spin.angle', default: 0.6, min: 0, max: 6.283 } },
                scale: { param: 'spin.scale', default: 1.0, min: 0.5, max: 2.0 },
            },
        },
    ],
    materials: {
        floor: { model: 'lambert', albedo: [0.6, 0.6, 0.6] },
        clay: { model: 'lambert', albedo: [0.75, 0.55, 0.4] },
        green: { model: 'lambert', albedo: [0.15, 0.5, 0.2] },
        red: { model: 'lambert', albedo: [0.7, 0.12, 0.12] },
    },
    lights: [
        { kind: 'point', position: [2.5, 4, 2.5], intensity: 40.0, color: [1.0, 1.0, 1.0] },
    ],
    environment: { type: 'constant', color: [0.12, 0.18, 0.32], intensity: 1.0 },
};

export const cylinderStrategy: RenderStrategy = {
    id: 'pathtracer',
    measurement: {
        camera: { type: 'pinhole', fov: 0.8 },
        maxBounces: 6,
    },
    estimator: {
        directLighting: 'nee',
        russianRoulette: { startDepth: 3 },
        accumulation: { type: 'average' },
    },
    view: { tonemap: { type: 'reinhard' } },
};
