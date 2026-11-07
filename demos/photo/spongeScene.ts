// demos/photo/spongeScene.ts — a still life of a purely mathematical object: a level-4 Menger
// sponge in glazed white ceramic on a wooden table, window light from the front left, string
// lights far behind it melting into polygonal bokeh at f/2.8.
//
// Meters. The table top is the plane y = 0; the sponge is a 16 cm cube resting on it. The table
// runs back 2.4 m to a worn plaster wall; the string lights lie along the foot of the wall.

import type { LightDescription, SceneDescription, Vec3 } from '../../src/compiler/types.js';
import type { AsyncSceneSuiteEntry } from '../../tests/witnesses/types.js';
import { distance, photoStrategy } from './camera.js';

const HALF = 0.08;                       // the sponge's half-extent
const SPONGE_AT: Vec3 = [0, HALF, 0];

/** Small warm bulbs on a wire lying loosely along the foot of the wall: a gently wavy line at
 *  depth zWire, between heights y0 and y0 + rise. */
function stringLights(count: number, x0: number, x1: number, y0: number, rise: number, zWire: number): LightDescription[] {
    const out: LightDescription[] = [];
    for (let i = 0; i < count; i++) {
        const s = (i + 0.5) / count;
        const x = x0 + (x1 - x0) * s;
        // A hand-laid wire: two slow waves and a little irregularity (deterministic).
        const y = y0 + rise * (0.5 + 0.35 * Math.sin(5.1 * s + 0.4) + 0.15 * Math.sin(17.3 * s));
        out.push({
            kind: 'sphere',
            position: [x, y, zWire + 0.06 * Math.sin(9.7 * s)],
            radius: 0.007,
            emission: { blackbody: { kelvin: 2300, scale: 60 } },
        });
    }
    return out;
}

async function spongeScene(): Promise<SceneDescription> {
    return {
        id: 'photo-sponge',
        name: 'Still life: ceramic Menger sponge on a wooden table',
        ambientSpace: { type: 'euclidean' },
        textures: {
            wood: { url: '/trial/textures/wood_floor/wood_floor_diff_2k.jpg', colorspace: 'srgb' },
            plaster: { url: '/trial/textures/worn_plaster_wall/worn_plaster_wall_diff_2k.jpg', colorspace: 'srgb' },
        },
        objects: [
            // Table top, 2.4 × 2.9 m, running back to the wall; normal +y (edge1 × edge2). The wood
            // map spans about 2 m.
            { type: 'quad', name: 'table', parameters: { corner: [-1.2, 0, 0.5], edge1: [0, 0, -2.9], edge2: [2.4, 0, 0] }, material: 'wood' },
            // Back wall, normal +z. The plaster map spans about 2.5 m.
            { type: 'quad', name: 'wall', parameters: { corner: [-3, -1, -2.4], edge1: [6, 0, 0], edge2: [0, 4, 0] }, material: 'plaster' },
            {
                type: 'menger', name: 'sponge', parameters: { size: HALF, iterations: 4 }, material: 'ceramic',
                transform: { position: SPONGE_AT, rotation: { axis: [0, 1, 0], angle: -0.5 } },
            },
        ],
        materials: {
            // Oiled wood: matte.
            wood: { model: 'lambert', albedo: { texture: 'wood', uvScale: [1.45, 1.2] } },
            plaster: { model: 'lambert', albedo: { texture: 'plaster', uvScale: [2.4, 1.6] } },
            // Glazed white ceramic: a white body under a glossy glaze.
            ceramic: { model: 'plastic', albedo: [0.78, 0.77, 0.74], coat_eta: 1.5 },
        },
        lights: [
            // The window: 1.2 × 1.4 m of overcast daylight to the front left, its sill 0.2 m above
            // the table, facing (0.8, 0, −0.6) (edge1 × edge2).
            { kind: 'quad', corner: [-1.7, 0.2, 0.9], edge1: [-0.72, 0, -0.96], edge2: [0, 1.4, 0], emission: [9.5, 9.7, 10.0] },
            ...stringLights(26, -1.2, 1.2, 0.02, 0.22, -2.2),
        ],
        environment: { type: 'constant', color: [0.05, 0.05, 0.055], intensity: 1.0 },
    };
}

const CAMERA: Vec3 = [0.45, 0.27, 1.55];

export const photoSpongeEntry: AsyncSceneSuiteEntry = {
    scene: spongeScene,
    name: 'Photo: still life, Menger sponge (needs fetched assets)',
    strategies: [
        photoStrategy({
            id: 'photo',
            focalLengthMm: 100, fNumber: 2.8, focusDistance: distance(CAMERA, [0.06, 0.1, 0.07]), blades: 7,
            position: CAMERA, target: [0.07, 0.12, -0.05],
            exposure: 1.0,
        }),
    ],
    exercises:
        'PHOTO — still life of a level-4 Menger sponge (marched SDF) in glazed ceramic (plastic model) '
        + 'on a wood table (Poly Haven wood_floor under a clear coat) before a plaster wall, lit by a window '
        + '(quad light) with blackbody string lights behind. 100 mm, f/2.8, seven blades. Needs fetched assets.',
    expected:
        'a sharp white sponge with crisp shadows inside its holes, the table falling out of focus, and '
        + 'warm heptagonal bokeh discs from the string lights over a soft plaster wall.',
};
