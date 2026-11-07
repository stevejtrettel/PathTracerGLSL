// demos/photo/pavilionScene.ts — architectural photography: an Apollonian gasket cast in white
// concrete as a walk-through pavilion, 4.6 m across, on a stone-paved square in a meadow at the
// edge of a forest (Poly Haven lilienstein HDRI, a hazy sun about 21° up). Shot with a 24 mm lens
// from eye level. The haze makes the light soft: the sun gives about a sixth of the light on the
// ground, so the lattice casts only a faint shadow. A park bench beside it gives the scale.
//
// Meters. The square is 30 × 30 m of paving at y = 0; beyond it the HDRI's own field and tree
// line take over. The pavilion's lowest arches are sunk into the paving, as a cast footing would be.

import type { ObjectDescription, SceneDescription, Vec3 } from '../../src/compiler/types.js';
import type { AsyncSceneSuiteEntry } from '../../tests/witnesses/types.js';
import { distance, photoStrategy } from './camera.js';

// The gasket's half-extent at these values, measured with its TS twin (tests/components/
// fieldTwins.ts) as the lowest interior point on a 2 mm vertical scan: 2.306 at 4 and at 5
// iterations. The descriptor's bound, size·(1.6 + 0.8·morph) + thickness = 2.595, carries slack.
const SIZE = 1.0, MORPH = 1.2, THICK = 0.035;
const HALF = 2.306;
const SINK = 0.26;
const PAVILION_AT: Vec3 = [0, HALF - SINK, 0];

/** A park bench (a wooden seat on two concrete legs) centered at `at`, turned by `yaw` about y. */
function bench(at: Vec3, yaw: number): ObjectDescription[] {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const place = (x: number, y: number, z: number): Vec3 => [at[0] + c * x + s * z, at[1] + y, at[2] - s * x + c * z];
    const rotation = { axis: [0, 1, 0] as Vec3, angle: yaw };
    return [
        { type: 'box', name: 'bench_seat', parameters: { halfSize: [0.9, 0.03, 0.21] }, material: 'bench_wood', transform: { position: place(0, 0.43, 0), rotation } },
        { type: 'box', name: 'bench_leg_l', parameters: { halfSize: [0.06, 0.2, 0.19] }, material: 'concrete', transform: { position: place(-0.66, 0.2, 0), rotation } },
        { type: 'box', name: 'bench_leg_r', parameters: { halfSize: [0.06, 0.2, 0.19] }, material: 'concrete', transform: { position: place(0.66, 0.2, 0), rotation } },
    ];
}

async function pavilionScene(): Promise<SceneDescription> {
    return {
        id: 'photo-pavilion',
        name: 'Afternoon: an Apollonian pavilion in white concrete',
        ambientSpace: { type: 'euclidean' },
        textures: {
            paving: { url: '/trial/textures/large_grey_tiles/large_grey_tiles_diff_2k.jpg', colorspace: 'srgb' },
        },
        objects: [
            // The square, 30 × 30 m; the map spans 3 m. edge1 × edge2 points −y; a quad is
            // two-sided, so for a non-emitter the side does not matter.
            { type: 'quad', name: 'paving', parameters: { corner: [-15, 0, 15], edge1: [0, 0, -30], edge2: [30, 0, 0] }, material: 'paving' },
            {
                type: 'apollonian', name: 'pavilion',
                parameters: { size: SIZE, morph: MORPH, thickness: THICK, iterations: 5 },
                material: 'concrete',
                transform: { position: PAVILION_AT, rotation: { axis: [0, 1, 0], angle: 0.3 } },
            },
            ...bench([3.4, 0, 2.6], -0.35),
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
            // Weathered oak slats: gray-brown, streaked (the streaks run along world x, close to
            // the seat's length at this yaw).
            bench_wood: {
                model: 'lambert',
                albedo: { kind: 'glsl', source: 'vec3(0.30, 0.22, 0.15) * (1.0 + 0.12 * perlin_fbm(vec3(2.0, 40.0, 40.0) * p, 0.5, 3))' },
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
        'PHOTO — architectural photography: an Apollonian gasket (marched SDF, 5 iterations, thickened '
        + '3.5 cm) as a 4.6 m white concrete pavilion (lambert with Perlin mottling and bump) beside a park '
        + 'bench (boxes), on Poly Haven large_grey_tiles paving in a meadow under the lilienstein HDRI. '
        + '24 mm, f/8. Needs fetched assets.',
    expected:
        'a white lattice of spherical voids before a tree line under a hazy sky, softly lit with only a '
        + 'faint shadow on the paving, a bench in front giving the scale, the square ending in grass.',
};
