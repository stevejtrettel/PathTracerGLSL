// tests/witnesses/scenes/instanceWitness.ts — instancing correctness (impl-plan-instancing).
//
// instance-twin ⇄ instance-twin-ref: three spheres authored as ONE instanced batch (a shared
// prototype + 3 placements, ray-into-local) must converge to the SAME image as the three spheres
// authored individually (each folding its transform into analytic params). Proves the instance
// loop's placement read + conjugation + region against the ordinary analytic path.

import type { SceneDescription, RenderStrategy } from '../../../src/compiler/types.js';
import { instance } from '../../../src/authoring/instance.js';
import { withPose } from '../../../src/authoring/strategy.js';

const PLACEMENTS = [
    { position: [-1.2, 0.5, 0.0] as [number, number, number], scale: 1.0 },
    { position: [0.0, 0.7, 0.0] as [number, number, number], scale: 1.4 },
    { position: [1.3, 0.5, -0.3] as [number, number, number], scale: 0.9 },
];

const materials: SceneDescription['materials'] = {
    floor: { model: 'lambert', albedo: [0.55, 0.55, 0.58] },
    ball: { model: 'lambert', albedo: [0.85, 0.35, 0.25] },
};
const lights: SceneDescription['lights'] = [{ kind: 'point', position: [3, 5, 3], emission: 60 }];
const environment: SceneDescription['environment'] = { type: 'constant', color: [0.10, 0.14, 0.24], intensity: 1.0 };
const floor = { type: 'quad', parameters: { corner: [-6, 0, -6], edge1: [0, 0, 12], edge2: [12, 0, 0] }, material: 'floor' };

// The prototype is a unit-ish sphere at the origin (radius 0.5); placements position/scale it.
export const instanceTwin: SceneDescription = {
    id: 'instance-twin',
    name: 'Instance Twin (3 spheres as one batch)',
    ambientSpace: { type: 'euclidean' },
    objects: [
        { ...floor },
        instance({ type: 'sphere', parameters: { radius: 0.5 }, material: 'ball' }, PLACEMENTS),
    ],
    materials, lights, environment,
};

// Reference: the SAME three spheres as individual analytic objects (transform folds into params).
export const instanceTwinRef: SceneDescription = {
    id: 'instance-twin-ref',
    name: 'Instance Twin Ref (3 individual spheres)',
    ambientSpace: { type: 'euclidean' },
    objects: [
        { ...floor },
        ...PLACEMENTS.map((p) => ({ type: 'sphere' as const, parameters: { radius: 0.5 }, material: 'ball', transform: p })),
    ],
    materials, lights, environment,
};

const base: RenderStrategy = {
    id: 'pathtracer',
    measurement: { camera: { type: 'pinhole', fov: 0.8 }, maxBounces: 5 },
    estimator: { directLighting: 'nee', russianRoulette: { startDepth: 3 }, accumulation: { type: 'average' } },
    view: { tonemap: { type: 'reinhard' } },
};
export const instanceTwinStrategy: RenderStrategy = withPose(base, [0, 2.0, 5.0], [0, 0.6, 0]);
