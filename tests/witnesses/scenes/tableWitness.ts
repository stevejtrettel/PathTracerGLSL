// tests/witnesses/scenes/tableWitness.ts — the scene-table gate (fable-object-tables).
//
// `bazaar`: many UNIQUE objects — mixed spheres/quads/disks, a mesh, an instance batch —
// PLUS the residual-arm tenants (a plane floor = unbounded, a driven sphere = live
// placement) in ONE scene. Rendered under BOTH dispatch regimes: 'table' (the scene
// TLAS + typed records + residual arm) must equal 'unrolled' near-exactly — identical
// RNG stream, identical candidate sets, only the ADDRESSING differs (the bvh≡brute
// identical-stream discipline). Any gap is a real table bug: a mispacked record, a
// wrong kind code, a leaf-list reorder slip, a containment-loop miss.

import type { SceneDescription, RenderStrategy } from '../../../src/compiler/types.js';
import { instance } from '../../../src/authoring/instance.js';
import { withPose } from '../../../src/authoring/strategy.js';
import { boxMesh } from './meshWitness.js';

const cube = boxMesh(0.35, false);

function bazaarObjects(): SceneDescription['objects'] {
    let s = 424242 >>> 0;
    const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    const objects: SceneDescription['objects'] = [
        // RESIDUAL: the unbounded floor (a plane cannot join the tree — one honest test/ray).
        { type: 'plane', parameters: { normal: [0, 1, 0], offset: 0 }, material: 'ground', backend: 'analytic' },
        // RESIDUAL: a driven sphere (live placement — a static record cannot hold it).
        { type: 'sphere', parameters: { radius: 0.35 }, material: 'accent', transform: { position: { param: 'bazaar.orb', default: [0, 2.2, 0] } }, name: 'orb' },
        // A mesh (a table leaf dispatching into its BLAS wrapper).
        { kind: 'mesh', positions: cube.positions, indices: cube.indices, material: 'accent', transform: { position: [1.6, 0.35, -1.2] }, name: 'crate' },
        // An instance batch (a table leaf dispatching into the batch walk).
        instance({ type: 'sphere', parameters: { radius: 0.22 } , material: 'accent' },
            [{ position: [-2.2, 0.22, 1.4] }, { position: [-1.7, 0.22, 1.7] }, { position: [-2.6, 0.22, 1.9] }], 'pebbles'),
    ];
    // Many UNIQUE tabled objects (the point of the table): spheres, thin quads, disks.
    const mats = ['red', 'green', 'blue', 'gray'];
    for (let i = 0; i < 22; i++) {
        objects.push({
            type: 'sphere',
            parameters: { center: [(rnd() * 2 - 1) * 3.2, 0.15 + rnd() * 0.35, (rnd() * 2 - 1) * 3.2], radius: 0.12 + rnd() * 0.28 },
            material: mats[i % mats.length],
        });
    }
    for (let i = 0; i < 6; i++) {
        const x = (rnd() * 2 - 1) * 3.0, z = (rnd() * 2 - 1) * 3.0;
        objects.push({
            type: 'quad',
            parameters: { corner: [x, 0.9 + rnd() * 0.8, z], edge1: [0.5 + rnd() * 0.4, 0, 0], edge2: [0, 0, 0.5 + rnd() * 0.4] },
            material: mats[(i + 1) % mats.length],
        });
    }
    for (let i = 0; i < 4; i++) {
        objects.push({
            type: 'disk',
            parameters: { center: [(rnd() * 2 - 1) * 2.8, 0.6 + rnd() * 0.9, (rnd() * 2 - 1) * 2.8], radius: 0.25 + rnd() * 0.2, normal: [rnd() - 0.5, 1, rnd() - 0.5] },
            material: mats[(i + 2) % mats.length],
        });
    }
    return objects;
}

export const bazaarScene: SceneDescription = {
    id: 'bazaar',
    name: 'Bazaar (scene table ≡ unrolled)',
    ambientSpace: { type: 'euclidean' },
    objects: bazaarObjects(),
    materials: {
        ground: { model: 'lambert', albedo: [0.45, 0.44, 0.42] },
        accent: { model: 'lambert', albedo: [0.75, 0.6, 0.35] },
        red: { model: 'lambert', albedo: [0.75, 0.3, 0.25] },
        green: { model: 'lambert', albedo: [0.3, 0.65, 0.3] },
        blue: { model: 'lambert', albedo: [0.3, 0.4, 0.75] },
        gray: { model: 'lambert', albedo: [0.55, 0.55, 0.58] },
    },
    lights: [{ kind: 'point', position: [3, 6, 3], emission: 90 }],
    environment: { type: 'constant', color: [0.10, 0.13, 0.2], intensity: 1.0 },
};

const base: RenderStrategy = {
    id: 'table',
    measurement: { camera: { type: 'pinhole', fov: 0.85 }, maxBounces: 5 },
    estimator: { directLighting: 'nee', russianRoulette: { startDepth: 3 }, objectDispatch: 'table', accumulation: { type: 'average' } },
    view: { tonemap: { type: 'reinhard' } },
};
// Table FIRST (the default render = the interesting arm); unrolled is the reference.
export const bazaarTableStrategy: RenderStrategy = withPose(base, [0.5, 3.2, 6.2], [0, 0.5, 0]);
export const bazaarUnrolledStrategy: RenderStrategy = {
    ...bazaarTableStrategy,
    id: 'unrolled',
    estimator: { ...bazaarTableStrategy.estimator, objectDispatch: 'unrolled' },
};
