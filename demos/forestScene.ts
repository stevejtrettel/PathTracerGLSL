// demos/forestScene.ts — the instancing payoff (impl-plan-instancing): a forest of cacti, all
// ONE prototype BLAS + a placement texture. 20 cacti × ~1152 tris = ~23k triangles "in" the scene
// for the cost of one mesh upload + 20 placements. Also a row of instanced analytic spheres to
// show the other backend through the same machinery.

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
        { type: 'quad', parameters: { corner: [-12, 0, -12], edge1: [0, 0, 24], edge2: [24, 0, 0] }, material: 'sand' },
        // 20 cacti from ONE prototype BLAS — a random-Y-rotated, size-varied scatter.
        instance(cactus, scatter(20, 6, { seed: 7, scaleMin: 0.7, scaleMax: 1.5 }), 'cacti'),
        // A back row of instanced analytic spheres (same placement machinery, analytic prototype).
        instance({ type: 'sphere', parameters: { radius: 0.6 }, material: 'stone' },
            grid([5, 1, 1], 2.2, [0, 0.6, -6]), 'stones'),
    ],
    materials: {
        sand: { model: 'lambert', albedo: [0.62, 0.55, 0.42] },
        cactus: { model: 'lambert', albedo: [0.18, 0.45, 0.22] },
        stone: { model: 'lambert', albedo: [0.5, 0.5, 0.55] },
    },
    lights: [{ kind: 'point', position: [6, 9, 5], emission: 180 }],
    environment: { type: 'constant', color: [0.30, 0.40, 0.60], intensity: 1.0 },
};

export const forestStrategy: RenderStrategy = {
    id: 'pathtracer',
    measurement: { camera: { type: 'pinhole', fov: 0.8 }, maxBounces: 5 },
    estimator: { directLighting: 'nee', russianRoulette: { startDepth: 4 }, accumulation: { type: 'average' } },
    view: { tonemap: { type: 'reinhard' } },
};
