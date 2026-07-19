// demos/modelsScene.ts — the first OBJ-LOADED scene (impl-plan-meshes v0).
//
// Two real models parsed from .obj files through the authoring loader (parseOBJ), placed on a
// floor. This is the brute-force perf BASELINE for the BVH batch: ~7.5k triangles, all scanned
// linearly per ray — watch the StatsPanel's `pathtracer` ms/frame here, then again after the BVH
// lands on the SAME scene.
//
//   teapot — Martin Newell's Utah teapot (public domain), position-only OBJ (6320 tris) →
//            smooth normals synthesized by the loader.
//   cactus — owner-provided (594 verts / 576 quads → 1152 tris), ships its own per-corner normals.
//
// Assets: demos/models/*.obj, imported as ?raw text (no runtime fetch) and parsed at load.

import type { SceneDescription, RenderStrategy } from '../src/compiler/types.js';
import { parseOBJ } from '../src/authoring/loadOBJ.js';
import teapotObj from './models/teapot.obj?raw';
import cactusObj from './models/cactus.obj?raw';

// Parsed once at module load. The teapot has no normals in the file → synthesize smooth ones;
// the cactus carries its own (per-corner) normals, so the loader keeps them.
const teapot = parseOBJ(teapotObj, { material: 'ceramic', smoothNormals: true, name: 'teapot' });
const cactus = parseOBJ(cactusObj, { material: 'cactus', name: 'cactus' });

export const modelsScene: SceneDescription = {
    id: 'models',
    name: 'OBJ Models (teapot + cactus)',
    ambientSpace: { type: 'euclidean' },
    objects: [
        { type: 'quad', parameters: { corner: [-8, 0, -8], edge1: [0, 0, 16], edge2: [16, 0, 0] }, material: 'floor' },
        // Utah teapot, scaled down (~6.4 units wide in the file) and sat centre-left.
        { ...teapot, transform: { position: [-0.7, 0, 0], scale: 0.4 } },
        // Cactus, scaled up a touch, off to the right.
        { ...cactus, transform: { position: [1.9, 0, 0.2], scale: 1.2 } },
    ],
    materials: {
        floor: { model: 'lambert', albedo: [0.5, 0.5, 0.52] },
        ceramic: { model: 'lambert', albedo: [0.82, 0.80, 0.74] },
        cactus: { model: 'lambert', albedo: [0.18, 0.45, 0.22] },
    },
    lights: [
        { kind: 'point', position: [4, 6, 4], emission: 90 },
    ],
    environment: { type: 'constant', color: [0.14, 0.18, 0.30], intensity: 1.0 },
};

// Key 1 = BVH (default engine), key 2 = brute force — the live A/B: identical image, watch the
// StatsPanel `pathtracer` ms/frame collapse. Key 3 = pt (bvh) for the converged cross-check.
export const modelsBvhStrategy: RenderStrategy = {
    id: 'bvh',
    measurement: { camera: { type: 'pinhole', fov: 0.7 }, maxBounces: 6 },
    estimator: { directLighting: 'nee', russianRoulette: { startDepth: 4 }, meshTraversal: 'bvh', accumulation: { type: 'average' } },
    view: { tonemap: { type: 'reinhard' } },
};

export const modelsBruteStrategy: RenderStrategy = {
    ...modelsBvhStrategy,
    id: 'brute',
    estimator: { ...modelsBvhStrategy.estimator, meshTraversal: 'brute' },
};

export const modelsPtStrategy: RenderStrategy = {
    ...modelsBvhStrategy,
    id: 'pt',
    estimator: { ...modelsBvhStrategy.estimator, directLighting: 'none' },
};
