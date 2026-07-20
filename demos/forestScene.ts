// demos/forestScene.ts — the instancing + TLAS payoff (impl-plan-instancing / impl-plan-tlas): a
// DENSE forest of cacti, all ONE prototype BLAS + a placement texture, traversed by a per-batch
// TLAS. 300 cacti × ~1152 tris = ~350k triangles "in" the scene for the cost of one mesh upload +
// 300 placements — and the TLAS makes it ~log(300) per ray, not 300. Plus a row of instanced
// analytic spheres (the other backend, same machinery).

import type { SceneDescription, RenderStrategy } from '../src/compiler/types.js';
import { parseOBJ } from '../src/authoring/loadOBJ.js';
import { instance, scatter, grid } from '../src/authoring/instance.js';
import cactusObj from './models/cactus.obj?raw';

const cactus = parseOBJ(cactusObj, { material: 'cactus' });

export const forestScene: SceneDescription = {
    id: 'forest',
    name: 'Forest (instanced cacti + spheres)',
    ambientSpace: { type: 'euclidean' },
    objects: [
        { type: 'quad', parameters: { corner: [-20, 0, -20], edge1: [0, 0, 40], edge2: [40, 0, 0] }, material: 'sand' },
        // 300 cacti from ONE prototype BLAS — a random-Y-rotated, size-varied scatter, TLAS-traversed.
        instance(cactus, scatter(300, 16, { seed: 7, scaleMin: 0.6, scaleMax: 1.6 }), 'cacti'),
        // A back row of instanced analytic spheres (same placement machinery, analytic prototype).
        instance({ type: 'sphere', parameters: { radius: 0.6 }, material: 'stone' },
            grid([7, 1, 1], 2.6, [0, 0.6, -10]), 'stones'),
    ],
    materials: {
        sand: { model: 'lambert', albedo: [0.62, 0.55, 0.42] },
        cactus: { model: 'lambert', albedo: [0.18, 0.45, 0.22] },
        stone: { model: 'lambert', albedo: [0.5, 0.5, 0.55] },
    },
    lights: [{ kind: 'point', position: [6, 9, 5], emission: 180 }],
    environment: { type: 'constant', color: [0.30, 0.40, 0.60], intensity: 1.0 },
};

// Key 1 = TLAS, key 2 = linear — the instancing A/B (impl-plan-tlas), same image.
export const forestStrategy: RenderStrategy = {
    id: 'tlas',
    measurement: { camera: { type: 'pinhole', fov: 0.8 }, maxBounces: 5 },
    estimator: { directLighting: 'nee', russianRoulette: { startDepth: 4 }, instanceAccel: 'tlas', accumulation: { type: 'average' } },
    view: { tonemap: { type: 'reinhard' } },
};

export const forestLinearStrategy: RenderStrategy = {
    ...forestStrategy,
    id: 'linear',
    estimator: { ...forestStrategy.estimator, instanceAccel: 'linear' },
};
