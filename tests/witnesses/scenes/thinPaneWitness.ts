// witnesses/scenes/thinPaneWitness.ts
// thin_dielectric (a glass sheet of η = 1.5) in front of an emitter, seen by an orthographic
// camera looking down −z (film ±0.533 × ±0.4 at 160 × 120).
//
// The emitter is a quad at z = −1.5 covering [−1, 1]², facing the camera, with emission 1 and
// albedo 0 (so it re-reflects nothing the panes send back). The left half of the frame
// (x ∈ [−0.8, 0]) is covered by three panes in horizontal bands; the right half sees the emitter
// directly and reads 1. A pixel in a pane band reads T_tot(μ) exactly, μ being the camera ray's
// cosine: the ray either passes straight through (weight 1) and scores the emitter's 1, or is
// reflected (weight 1) into the empty scene. No environment, so the reflected rays score 0.
//   - top band (y > 0.133): the pane faces the camera, μ = 1:      T_tot = 0.923077.
//   - middle band:          the pane faces away (a back-face hit), μ = 1: T_tot = 0.923077.
//   - bottom band (y < −0.133): the pane is tilted about y with normal (−√3/2, 0, 1/2), μ = 0.5:
//                           T_tot = 0.836232. Its mirror rays go (−√3/2, 0, −1/2), keep their y,
//                           and meet the emitter's plane at x < −2.7, past its edge at −1.
// A single interface would read 0.96 in the upper bands; an inverted η is total internal
// reflection at μ = 0.5 and reads 0 in the bottom band.
// The emitter is reached only through a delta event (or directly), so every estimator scores it
// at full weight; NEE never runs at the panes (pure delta) and contributes 0 at the emitter
// (albedo 0). Values from thin_dielectric.test.ts.

import type { RenderStrategy, SceneDescription, Vec3 } from '../../../src/compiler/types.js';

/** T_tot for η = 1.5 at normal incidence and at cos 0.5. */
export const THIN_PANE_NORMAL = 0.923077;
export const THIN_PANE_TILTED = 0.836232;

const BAND = 0.4 / 3;              // film half-height 0.4 in three bands
const SIN60 = Math.sqrt(3) / 2;
const TILT_LENGTH = 0.8 / 0.5;     // the tilted pane's edge spans x ∈ [−0.8, 0]

export const thinPaneScene: SceneDescription = {
    id: 'thin-pane',
    name: 'Thin glass panes (η 1.5) over an emitter: facing, flipped and tilted to 60°',
    ambientSpace: { type: 'euclidean' },
    objects: [
        { type: 'quad', parameters: { corner: [-1, -1, -1.5], edge1: [2, 0, 0], edge2: [0, 2, 0] }, material: 'lamp', name: 'lamp' },
        // cross(edge1, edge2) = +z: faces the camera.
        { type: 'quad', parameters: { corner: [-0.8, BAND, 0], edge1: [0.8, 0, 0], edge2: [0, 0.6 - BAND, 0] }, material: 'pane', name: 'facing' },
        // cross(edge1, edge2) = −z: the camera sees its back.
        { type: 'quad', parameters: { corner: [-0.8, -BAND, 0], edge1: [0, 2 * BAND, 0], edge2: [0.8, 0, 0] }, material: 'pane', name: 'flipped' },
        // edge1 = TILT_LENGTH·(1/2, 0, √3/2): cross(edge1, edge2) ∝ (−√3/2, 0, 1/2), centered at z = 0.
        {
            type: 'quad',
            parameters: {
                corner: [-0.8, -0.6, -TILT_LENGTH * SIN60 / 2],
                edge1: [TILT_LENGTH * 0.5, 0, TILT_LENGTH * SIN60],
                edge2: [0, 0.6 - BAND, 0],
            },
            material: 'pane', name: 'tilted',
        },
    ],
    materials: {
        lamp: { model: 'lambert', albedo: 0, emission: 1 },
        pane: { model: 'thin_dielectric', sheet_eta: 1.5 },
    },
    lights: [],
    environment: { type: 'none' },
};

const strategy = (id: string, directLighting: 'none' | 'nee' | 'mis', color: 'rgb' | 'spectral' = 'rgb'): RenderStrategy => ({
    id,
    measurement: {
        camera: { type: 'orthographic', scale: 0.4 },
        maxBounces: 4,
        ...(color === 'spectral' ? { color } : {}),
    },
    estimator: { directLighting, russianRoulette: null, accumulation: { type: 'average' } },
    view: { tonemap: { type: 'reinhard' } },
});

/** pt-nee, pt-mis, pt, and spectral pt-mis. */
export const thinPaneStrategies = [
    strategy('pt-nee', 'nee'),
    strategy('pt-mis', 'mis'),
    strategy('pt', 'none'),
    strategy('spectral-pt-mis', 'mis', 'spectral'),
];
export const THIN_PANE_POSE: { position: Vec3; target: Vec3 } = { position: [0, 0, 2], target: [0, 0, -3] };

/** Frame regions (fractions, origin bottom-left), each inside one band and clear of the edges. */
export const THIN_PANE_REGIONS = {
    facing: { x: 0.1, y: 0.73, w: 0.3, h: 0.21 },
    flipped: { x: 0.1, y: 0.39, w: 0.3, h: 0.22 },
    tilted: { x: 0.1, y: 0.06, w: 0.3, h: 0.21 },
    direct: { x: 0.6, y: 0.1, w: 0.3, h: 0.8 },
};
