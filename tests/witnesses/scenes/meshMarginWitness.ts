// witnesses/scenes/meshMarginWitness.ts
// Does the mesh tier's self-intersection handling change what the renderer computes? Triangle
// hits search t > 0 and a spawned ray escapes by the hit's fp-relative margin along Hit.ng; any
// margin fixed in world units would show up in one of these two exact gates:
//
//   mesh-slab-albedo — slab-albedo (the exact Chandrasekhar plane albedo of a scattering
//                      halfspace) with the slab built as a CLOSED MESH. At the slab's σ_t = 20
//                      a world-space margin of 1e-3 is 0.02 optical depths: enough to skip
//                      medium on entry and refuse shallow exits, which reads 1–3% low. Must
//                      read the same exact values as slab-albedo.
//   mesh-scale-twin  — a mesh floor and block under a uniform sky (no lights, so no other
//                      world-space constant enters), rendered at unit scale and shrunk 100×
//                      about the origin with the camera shrunk with it. Transport is
//                      scale-invariant, so the two must agree; the arms share one sample
//                      stream, so they agree to fp noise, and the tolerances are set to catch
//                      a world-space margin (1e-3 gave Δmean 0.28%, rmse 1.0%).

import type { SceneDescription, RenderStrategy, Vec3 } from '../../../src/compiler/types.js';
import { boxMesh, pushQuad } from './meshWitness.js';
import { slabAlbedoScene } from './slabAlbedoWitness.js';

// ---------------------------------------------------------------------------
// mesh-slab-albedo
// ---------------------------------------------------------------------------

const slabBox = boxMesh([6, 2, 6], false);   // 12 × 4 × 12, outward winding

export const meshSlabAlbedoScene: SceneDescription = {
    ...slabAlbedoScene,
    id: 'mesh-slab-albedo',
    name: 'Slab albedo through a closed mesh (the mesh margin gate)',
    objects: [{
        kind: 'mesh', positions: slabBox.positions, indices: slabBox.indices, closed: true,
        material: 'authored', name: 'slab', transform: { position: [0, -2, 0] },   // top face at y = 0
    }],
};

// ---------------------------------------------------------------------------
// mesh-scale-twin
// ---------------------------------------------------------------------------

const floor = (() => {
    const pos: number[] = [];
    const idx: number[] = [];
    pushQuad(pos, idx, [-4, 0, 4], [8, 0, 0], [0, 0, -8]);   // cross(e1, e2) = +y
    return { positions: new Float32Array(pos), indices: new Uint32Array(idx) };
})();
const block = boxMesh(0.5, false);

/** SCALE = 1 is the reference; the twin is the same scene shrunk about the origin. */
export const MESH_TWIN_SCALE = 0.01;

function scaleScene(id: string, s: number): SceneDescription {
    return {
        id,
        name: s === 1 ? 'Mesh scale twin (unit scale)' : `Mesh scale twin (shrunk ×${s})`,
        ambientSpace: { type: 'euclidean' },
        objects: [
            { kind: 'mesh', positions: floor.positions, indices: floor.indices, material: 'floor', name: 'floor', transform: { scale: s } },
            // The block rests on the floor: its contact edges are where a margin shows first.
            { kind: 'mesh', positions: block.positions, indices: block.indices, material: 'block', name: 'block',
              transform: { position: [0.3 * s, 0.5 * s, 0], rotation: { axis: [0, 1, 0], angle: 0.6 }, scale: s } },
        ],
        materials: {
            floor: { model: 'lambert', albedo: [0.6, 0.6, 0.6] },
            block: { model: 'lambert', albedo: [0.75, 0.4, 0.25] },
        },
        lights: [],
        environment: { type: 'constant', color: [1, 1, 1], intensity: 1 },
    };
}

export const meshScaleTwinRef = scaleScene('mesh-scale-twin-ref', 1);
export const meshScaleTwin = scaleScene('mesh-scale-twin', MESH_TWIN_SCALE);

export const meshScaleStrategy: RenderStrategy = {
    id: 'pt',
    measurement: { camera: { type: 'pinhole', fov: 0.8 }, maxBounces: 6 },
    estimator: { directLighting: 'none', russianRoulette: null, accumulation: { type: 'average' } },
    view: { tonemap: { type: 'reinhard' } },
};

export const MESH_TWIN_POSE: { position: Vec3; target: Vec3 } = { position: [0, 1.6, 3.2], target: [0.2, 0.35, 0] };
