// tests/witnesses/scenes/accelTriple.ts — the accel COMPOSITION witness (the Aug 10
// review's coverage gap): mesh BLAS × instance TLAS × light tree in ONE program.
//
// Every accel subsystem is gated in isolation elsewhere (mesh-quad-twin, instance-twin,
// hundred-spheres, instance-lights); no witness rendered them TOGETHER. This scene
// composes all three: a standalone EMISSIVE mesh (BLAS walk + a MESH row in the light
// tree — mesh treeBounds), an instanced MESH batch (frame-tier records, BLAS-under-TLAS
// conjugation), and an instanced emissive SPHERE batch (params tier — 24 instance
// lights). All illumination rides the light tree, whose leaves MIX the registry mesh
// light with the batch window. NEE shadow rays from the floor thread the mesh any-hit
// AND the batch TLAS any-hit walks; emitter chance-hits exercise light_of + the mis
// trail replay across BOTH arm families in one program.
//
// Gates: nee-bvh ≡ mis-bvh (χ² — the trail-pmf replay with the full backend
// composition; the arm that would catch a light-identity mixup between coexisting accel
// structures) + a pt anchor arm (chance-hit coverage → RMSE tripwire, pre-calibration).

import type { SceneDescription, RenderStrategy, Transform } from '../../../src/compiler/types.js';
import { boxMesh } from './meshWitness.js';

function lcg(seed: number): () => number {
    let s = seed >>> 0;
    return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 0x100000000);
}

const rand = lcg(20260810);

// The instanced mesh batch: 6 rotated cubes scattered on the floor (frame tier — mesh
// prototypes always carry the 2-texel rigid record; rotations make the conjugation real).
const cube = boxMesh(0.45, /*inward*/ false);
const cubePlacements: Transform[] = [];
for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    cubePlacements.push({
        position: [3.1 * Math.cos(a), 0.45, 3.1 * Math.sin(a)],
        rotation: { axis: [0, 1, 0], angle: rand() * Math.PI },
        scale: 0.7 + rand() * 0.5,
    });
}

// The emissive sphere batch: 24 lamps on a ring above the cubes — params tier; the
// tree's batch window (the registry mesh light sits at global index 0 ahead of it).
const lampPlacements: Transform[] = [];
for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    const r = 2.2 + rand() * 2.6;
    lampPlacements.push({
        position: [r * Math.cos(a), 1.6 + rand() * 1.2, r * Math.sin(a)],
        scale: 0.6 + rand() * 0.8,
    });
}

export const accelTriple: SceneDescription = {
    id: 'accel-triple',
    name: 'Accel Triple (mesh BLAS × instance TLAS × light tree)',
    ambientSpace: { type: 'euclidean' },
    objects: [
        { type: 'plane', parameters: { normal: [0, 1, 0], offset: 0.0 }, material: 'floor' },
        // Standalone EMISSIVE mesh — its own BLAS walk, and a MESH ROW in the light
        // tree (mesh treeBounds, Aug 10 2026): the tree mixes one mesh light with 24
        // instance lights, so the descent, the mis trail replay, and light_of all run
        // across BOTH arm families in one program.
        { kind: 'mesh', positions: boxMesh(0.6, false).positions, indices: boxMesh(0.6, false).indices, material: 'glowcube', name: 'center_cube' },
        {
            kind: 'instanced',
            prototype: { kind: 'mesh', positions: cube.positions, indices: cube.indices, material: 'cube' },
            placements: cubePlacements,
            name: 'cubes',
        },
        {
            kind: 'instanced',
            prototype: { type: 'sphere', parameters: { center: [0, 0, 0], radius: 0.1 }, material: 'lamp' },
            placements: lampPlacements,
            name: 'lamps',
        },
    ],
    materials: {
        floor: { model: 'lambert', albedo: [0.5, 0.5, 0.5] },
        cube: { model: 'lambert', albedo: [0.6, 0.45, 0.3] },
        glowcube: { model: 'lambert', albedo: [0, 0, 0], emission: [6, 5, 4] },
        lamp: { model: 'lambert', albedo: [0, 0, 0], emission: [16, 13, 9] },
    },
    lights: [],
    environment: { type: 'none' },
};

const measurement = { camera: { type: 'pinhole' as const, fov: 0.95 }, maxBounces: 4 };
const view = { tonemap: { type: 'reinhard' as const } };

// The path-found anchor arm. A nee-POWER arm would be coverage-mismatched here (the
// mesh light samples via the CDF but the batch emitters are path-found under 'power'),
// so the absolute-truth cross-check is plain pt — chance-hit coverage, hence a
// display-space RMSE tripwire (the pt-arm policy), never χ².
export const accelTriplePtStrategy: RenderStrategy = {
    id: 'pt-found',
    measurement,
    estimator: { directLighting: 'none', russianRoulette: null, accumulation: { type: 'average' } },
    view,
};

export const accelTripleNeeStrategy: RenderStrategy = {
    id: 'nee-bvh',
    measurement,
    estimator: { directLighting: 'nee', lightSelection: 'bvh', russianRoulette: null, accumulation: { type: 'average' } },
    view,
};

export const accelTripleMisStrategy: RenderStrategy = {
    id: 'mis-bvh',
    measurement,
    estimator: { directLighting: 'mis', lightSelection: 'bvh', russianRoulette: null, accumulation: { type: 'average' } },
    view,
};
