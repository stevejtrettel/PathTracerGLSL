// demos/torusScene.ts — a room inside the cube 3-torus E³/(2Z)³ (components/quotient/torus).
// One cell holds three beams through its center (each spans its period, so the lattice of cells
// is a jungle gym), a matte terracotta ball, a glass ball, a gold ball and two sphere lamps; the
// camera sits in a room between the beams. Every ray that leaves the cell comes back in
// through the opposite face, so the same room repeats in every direction, lit by every image of
// the two lamps (a warm one and a smaller cool one). The camera looks across its room into the
// lattice.

import type { SceneDescription, RenderStrategy } from '../src/compiler/types.js';

const L = 2;
/** Beams span the whole period plus a little, as the Validator requires of a spanning box. */
const SPAN = L / 2 + 0.01;
const T = 0.07;   // beam half-thickness

export const torusRoomScene: SceneDescription = {
    id: 'torus-room',
    name: '3-torus room (E³/Z³)',
    ambientSpace: { type: 'euclidean', quotient: { kind: 'torus', size: [L, L, L] } },
    objects: [
        { type: 'box', parameters: { center: [0, 0, 0], halfSize: [SPAN, T, T] }, material: 'beam', name: 'beam_x' },
        { type: 'box', parameters: { center: [0, 0, 0], halfSize: [T, SPAN, T] }, material: 'beam', name: 'beam_y' },
        { type: 'box', parameters: { center: [0, 0, 0], halfSize: [T, T, SPAN] }, material: 'beam', name: 'beam_z' },
        { type: 'sphere', parameters: { center: [0.55, -0.5, -0.5], radius: 0.36 }, material: 'terracotta', name: 'terracotta_ball' },
        { type: 'sphere', parameters: { center: [-0.5, 0.5, 0.52], radius: 0.32 }, material: 'glass', name: 'glass_ball' },
        { type: 'sphere', parameters: { center: [0.5, 0.55, -0.5], radius: 0.26 }, material: 'gold', name: 'gold_ball' },
    ],
    materials: {
        beam: { model: 'lambert', albedo: [0.36, 0.34, 0.31] },
        terracotta: { model: 'lambert', albedo: [0.75, 0.33, 0.2] },
        glass: { model: 'dielectric', ior: 1.5 },
        gold: { model: 'ggx', f0: [1.0, 0.71, 0.29], roughness: 0.2 },
    },
    lights: [
        // The warm lamp floats in the room diagonal to the camera's.
        { kind: 'sphere', position: [-0.5, -0.5, -0.45], radius: 0.13, emission: [14, 9.5, 5.5] },
        // A smaller cool lamp in the room beside the terracotta ball's.
        { kind: 'sphere', position: [0.5, -0.55, 0.55], radius: 0.09, emission: [3.5, 5.5, 10] },
    ],
    environment: { type: 'none' },
};

export const torusRoomStrategy: RenderStrategy = {
    id: 'pt-mis',
    measurement: {
        camera: { type: 'pinhole', fov: { param: 'camera.fov', default: 1.1, min: 0.4, max: 1.6 } },
        maxBounces: 12,
        // Nothing escapes a closed manifold: a segment that meets nothing within 16 (eight
        // periods) carries 0. The jungle gym hides most long lines of sight well before that.
        farClip: 16,
    },
    estimator: { directLighting: 'mis', russianRoulette: { startDepth: 3 }, accumulation: { type: 'average' } },
    view: { tonemap: { type: 'agx' } },
};

export const torusRoomPtStrategy: RenderStrategy = {
    ...torusRoomStrategy,
    id: 'pt',
    estimator: { ...torusRoomStrategy.estimator, directLighting: 'none' },
};
