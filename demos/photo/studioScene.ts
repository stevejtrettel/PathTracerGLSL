// demos/photo/studioScene.ts — a studio product shot: a glossy plastic trefoil knot on a paper
// sweep, lit by a key softbox up to the left and, as fill, a photo studio's light (the Poly Haven
// studio_small_09 HDRI at 0.4).
//
// Meters. The sweep is 3 m wide; the knot is about 0.26 m across, lying flat on the paper.

import type { SceneDescription, Vec3 } from '../../src/compiler/types.js';
import type { AsyncSceneSuiteEntry } from '../../tests/witnesses/types.js';
import { meshObject, paperSweep, tubeMesh } from './geometry.js';
import { distance, photoStrategy } from './camera.js';

// The (2, 3) torus knot with its symmetry axis vertical: ring radius R, wobble A, tube radius TUBE.
// It rests on its three lowest points, where sin 3t = −1.
const R = 0.085, A = 0.034, TUBE = 0.021;
const trefoil = (t: number): Vec3 => {
    const r = R + A * Math.cos(3 * t);
    return [r * Math.cos(2 * t), A * Math.sin(3 * t), r * Math.sin(2 * t)];
};
const KNOT_AT: Vec3 = [0, A + TUBE, 0.05];

async function studioScene(): Promise<SceneDescription> {
    return {
        id: 'photo-studio',
        name: 'Studio product shot (plastic trefoil on a paper sweep)',
        ambientSpace: { type: 'euclidean' },
        objects: [
            meshObject(paperSweep(3, 1.6, 0.5, 2.2), 'paper', 'sweep', { transform: { position: [0, 0, -0.6] } }),
            meshObject(tubeMesh(trefoil, TUBE, 720, 48), 'red_plastic', 'trefoil', {
                transform: { position: KNOT_AT, rotation: { axis: [0, 1, 0], angle: 0.35 } },
            }),
        ],
        materials: {
            // Photographic seamless paper, a light neutral gray.
            paper: { model: 'lambert', albedo: [0.62, 0.62, 0.6] },
            // Injection-molded red plastic: a dyed diffuse base under a clear coat of index 1.5.
            red_plastic: { model: 'plastic', albedo: [0.45, 0.025, 0.02], coat_eta: 1.5 },
        },
        lights: [
            // Key: a 0.6 × 0.6 m softbox up and to the camera's left, tilted 45° toward the knot
            // (edge1 × edge2 = (0.25, −0.25, 0): down and to the right).
            { kind: 'quad', corner: [-0.95, 0.9, -0.15], edge1: [0.42, 0.42, 0], edge2: [0, 0, 0.6], emission: 26 },
        ],
        environment: {
            type: 'image',
            url: '/trial/hdri/studio_small_09_4k.hdr',
            intensity: 0.4,
            rotation: -1.73,
        },
    };
}

const CAMERA: Vec3 = [0.12, 0.3, 1.6];

export const photoStudioEntry: AsyncSceneSuiteEntry = {
    scene: studioScene,
    name: 'Photo: studio product shot (needs fetched assets)',
    strategies: [
        photoStrategy({
            id: 'photo',
            focalLengthMm: 100, fNumber: 8, focusDistance: distance(CAMERA, KNOT_AT), blades: 7,
            position: CAMERA, target: [0, 0.07, 0.02],
            exposure: 0.75,
        }),
    ],
    exercises:
        'PHOTO — a product shot: a red plastic (clear coat over a dyed base) trefoil knot, a tube mesh '
        + 'around the (2,3) torus knot, on a paper sweep lit by a key softbox (quad light) with the '
        + 'studio_small_09 HDRI as fill. 100 mm, f/8, full-frame 3:2. Needs `node tools/fetch-trial-assets.mjs`.',
    expected:
        'a glossy red knot with sharp softbox highlights and a shadow falling to the right, the gray paper '
        + 'curving seamlessly into the background.',
};
