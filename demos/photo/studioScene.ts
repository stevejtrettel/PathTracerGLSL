// demos/photo/studioScene.ts — a studio product shot: a glossy plastic trefoil knot on a paper
// sweep, lit by a key softbox close up to the left and, as a weak fill, a photo studio's light
// (the Poly Haven studio_small_09 HDRI at 0.12), so the paper falls off into the background.
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
            // Photographic seamless paper, a light neutral gray with a faint mottle (±3%:
            // |perlin_fbm| ≤ 1.94 for 3 octaves at gain 0.5) and a fine tooth.
            paper: {
                model: 'lambert',
                albedo: { kind: 'glsl', source: 'vec3(0.62, 0.62, 0.60) * (1.0 + 0.015 * perlin_fbm(6.0 * p, 0.5, 3))' },
                bump: { height: { kind: 'glsl', source: '0.00002 * perlin_noise(1500.0 * p)' }, step: 0.00005 },
            },
            // Injection-molded red plastic: a dyed diffuse base under a clear coat of index 1.5.
            // The coat has orange peel: relief of wavelength 0.25 mm (below a pixel, 0.45 mm at
            // the knot) and slope about 0.01, which the pixel filter integrates into a slight
            // softening of the reflected softbox's edges.
            red_plastic: {
                model: 'plastic', albedo: [0.45, 0.025, 0.02], coat_eta: 1.5,
                bump: { height: { kind: 'glsl', source: '0.0000025 * perlin_noise(4000.0 * p)' }, step: 0.00003 },
            },
        },
        lights: [
            // Key: a 0.6 × 0.6 m softbox 0.75 m from the knot, up and to the camera's left, tilted
            // 45° toward it (edge1 × edge2 = (0.25, −0.25, 0): down and to the right). This close,
            // the inverse square darkens the paper toward the back.
            { kind: 'quad', corner: [-0.64, 0.46, -0.19], edge1: [0.42, 0.42, 0], edge2: [0, 0, 0.6], emission: 10 },
        ],
        environment: {
            type: 'image',
            url: '/trial/hdri/studio_small_09_4k.hdr',
            intensity: 0.12,
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
