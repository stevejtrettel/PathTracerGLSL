// demos/photo/pavilionScene.ts — architectural photography: an Apollonian gasket cast in white
// concrete as a walk-through pavilion, 5 m across, on a stone-paved square in a meadow at the edge
// of a forest (Poly Haven lilienstein HDRI, a hazy sun about 21° up). Shot with a 24 mm lens from
// eye level; the sun throws the lattice's shadow across the paving.
//
// Meters. The square is 30 × 30 m of paving at y = 0; beyond it the HDRI's own field and tree
// line take over. The pavilion's lowest arches are sunk into the paving, as a cast footing would be.

import type { SceneDescription, Vec3 } from '../../src/compiler/types.js';
import type { AsyncSceneSuiteEntry } from '../../tests/witnesses/types.js';
import { distance, photoStrategy } from './camera.js';

// apollonian half-extent = size·(1.6 + 0.8·morph) + thickness (its descriptor's fit).
const SIZE = 1.0, MORPH = 1.2, THICK = 0.035;
const HALF = SIZE * (1.6 + 0.8 * MORPH) + THICK;
const PAVILION_AT: Vec3 = [0, HALF - 0.55, 0];

async function pavilionScene(): Promise<SceneDescription> {
    return {
        id: 'photo-pavilion',
        name: 'Afternoon: an Apollonian pavilion in white concrete',
        ambientSpace: { type: 'euclidean' },
        textures: {
            paving: { url: '/trial/textures/large_grey_tiles/large_grey_tiles_diff_2k.jpg', colorspace: 'srgb' },
        },
        objects: [
            // The square, 30 × 30 m; the map spans 3 m. Normal +y (edge1 × edge2).
            { type: 'quad', name: 'paving', parameters: { corner: [-15, 0, 15], edge1: [0, 0, -30], edge2: [30, 0, 0] }, material: 'paving' },
            {
                type: 'apollonian', name: 'pavilion',
                parameters: { size: SIZE, morph: MORPH, thickness: THICK, iterations: 5 },
                material: 'concrete',
                transform: { position: PAVILION_AT, rotation: { axis: [0, 1, 0], angle: 0.3 } },
            },
        ],
        materials: {
            paving: { model: 'lambert', albedo: { texture: 'paving', uvScale: 10 } },
            // White cast concrete, lightly mottled, with a fine pitted surface (|perlin_fbm| ≤ 1.94
            // for 3 octaves at gain 0.5, so the albedo stays in [0.56, 0.68]).
            concrete: {
                model: 'lambert',
                albedo: { kind: 'glsl', source: 'vec3(0.63, 0.62, 0.60) * (1.0 + 0.05 * perlin_fbm(3.0 * p, 0.5, 3))' },
                bump: { height: { kind: 'glsl', source: '0.0008 * perlin_fbm(60.0 * p, 0.5, 3)' }, step: 0.0004 },
            },
        },
        lights: [],
        environment: {
            type: 'image',
            url: '/trial/hdri/lilienstein_4k.hdr',
            intensity: 1.0,
            rotation: -2.22,
        },
    };
}

const CAMERA: Vec3 = [2.4, 1.55, 10.5];
const AIM: Vec3 = [0, 1.9, 0];

export const photoPavilionEntry: AsyncSceneSuiteEntry = {
    scene: pavilionScene,
    name: 'Photo: Apollonian pavilion (needs fetched assets)',
    strategies: [
        photoStrategy({
            id: 'photo',
            focalLengthMm: 24, fNumber: 8, focusDistance: distance(CAMERA, AIM), blades: 9,
            position: CAMERA, target: AIM,
            exposure: 1.0,
        }),
    ],
    exercises:
        'PHOTO — architectural photography: an Apollonian gasket (marched SDF, thickened 3.5 cm) as a 5 m '
        + 'white concrete pavilion (lambert with Perlin mottling and bump) on Poly Haven large_grey_tiles '
        + 'paving in a meadow under the lilienstein HDRI. 24 mm, f/8. Needs fetched assets.',
    expected:
        'a white lattice of spherical voids before a tree line under a hazy sky, the lattice\'s sun shadow '
        + 'on the paving, the square ending in grass.',
};
