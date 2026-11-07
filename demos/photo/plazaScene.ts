// demos/photo/plazaScene.ts — an outdoor photograph at golden hour: a polished black granite
// trefoil knot on a stone plinth, on a paved waterfront in Venice at sunset (Poly Haven venice_sunset
// HDRI, large_grey_tiles paving).
//
// Meters. The paving is the plane y = 0 out to 200 m; the HDRI supplies the sky, the low sun
// (about 3.6° above the horizon) and the distant buildings. The knot is 1.6 m across, standing
// upright on a 0.8 m plinth.

import type { SceneDescription, Vec3 } from '../../src/compiler/types.js';
import type { AsyncSceneSuiteEntry } from '../../tests/witnesses/types.js';
import { meshObject, tubeMesh } from './geometry.js';
import { distance, photoStrategy } from './camera.js';

// The (2, 3) torus knot, symmetry axis along z (the knot stands in the xy plane).
const R = 0.52, A = 0.21, TUBE = 0.13;
const trefoil = (t: number): Vec3 => {
    const r = R + A * Math.cos(3 * t);
    return [r * Math.cos(2 * t), r * Math.sin(2 * t), A * Math.sin(3 * t)];
};
// The knot's lowest point is at y = −(R + A) − TUBE (t with cos 3t = 1 and sin 2t = −1 nearly);
// it rests 3 cm into the plinth top, as if mounted on a pin.
const PLINTH_TOP = 0.8;
const KNOT_AT: Vec3 = [0, PLINTH_TOP + R + A + TUBE - 0.08, 0];

async function plazaScene(): Promise<SceneDescription> {
    return {
        id: 'photo-plaza',
        name: 'Golden hour: granite trefoil on a Venice waterfront',
        ambientSpace: { type: 'euclidean' },
        textures: {
            paving: { url: '/trial/textures/large_grey_tiles/large_grey_tiles_diff_2k.jpg', colorspace: 'srgb' },
        },
        objects: [
            // The quay: 400 m wide, from 200 m behind the camera to its edge 36 m beyond the
            // plinth, where the lagoon of the HDRI begins; the map spans 3 m. Normal +y.
            { type: 'quad', name: 'paving', parameters: { corner: [-200, 0, 200], edge1: [0, 0, -236], edge2: [400, 0, 0] }, material: 'paving' },
            { type: 'box', name: 'plinth', parameters: { halfSize: [0.42, PLINTH_TOP / 2, 0.42] }, material: 'concrete', transform: { position: [0, PLINTH_TOP / 2, 0], rotation: { axis: [0, 1, 0], angle: 0.25 } } },
            meshObject(tubeMesh(trefoil, TUBE, 900, 64), 'granite', 'trefoil', {
                transform: { position: KNOT_AT, rotation: { axis: [0, 1, 0], angle: 0.5 } },
            }),
        ],
        materials: {
            paving: { model: 'lambert', albedo: { texture: 'paving', uvScale: [236 / 3, 400 / 3] } },
            // Cast concrete, lightly mottled (|perlin_fbm| ≤ 1.94 for 3 octaves at gain 0.5).
            concrete: {
                model: 'lambert',
                albedo: { kind: 'glsl', source: 'vec3(0.33, 0.32, 0.30) * (0.9 + 0.05 * perlin_fbm(9.0 * p, 0.5, 3))' },
                bump: { height: { kind: 'glsl', source: '0.0015 * perlin_fbm(40.0 * p, 0.5, 3)' }, step: 0.0005 },
            },
            // Polished black granite: a near-black body flecked with feldspar under the polish
            // (the plastic model's clear coat; a granite's index is about 1.55). The flecks are
            // where high-frequency noise exceeds a threshold; |perlin_noise| ≤ 1.
            granite: {
                model: 'plastic',
                coat_eta: 1.55,
                albedo: {
                    kind: 'glsl',
                    source: 'vec3(0.028, 0.027, 0.026) + vec3(0.16, 0.155, 0.15) * smoothstep(0.35, 0.6, perlin_noise(260.0 * p))',
                },
            },
        },
        lights: [],
        environment: {
            type: 'image',
            url: '/trial/hdri/venice_sunset_4k.hdr',
            intensity: 1.0,
            rotation: 2.32,
        },
    };
}

const CAMERA: Vec3 = [2.2, 1.45, 9.0];
const AIM: Vec3 = [0, 1.25, 0];

export const photoPlazaEntry: AsyncSceneSuiteEntry = {
    scene: plazaScene,
    name: 'Photo: golden hour sculpture (needs fetched assets)',
    strategies: [
        photoStrategy({
            id: 'photo',
            focalLengthMm: 85, fNumber: 2.8, focusDistance: distance(CAMERA, [0, 1.4, 0.3]), blades: 9,
            position: CAMERA, target: AIM,
            exposure: 1.0,
        }),
    ],
    exercises:
        'PHOTO — an outdoor sculpture at sunset: a polished black granite (plastic model, Perlin-flecked albedo) '
        + 'trefoil tube mesh on a concrete plinth (Perlin bump), on Poly Haven large_grey_tiles paving under '
        + 'the venice_sunset HDRI, the sun in frame just above the far shore. 85 mm, f/2.8. Needs fetched assets.',
    expected:
        'a black knot whose polish mirrors the pink dusk sky and the paving, the setting sun low on the '
        + 'right over the lagoon, the far shore slightly soft.',
};
