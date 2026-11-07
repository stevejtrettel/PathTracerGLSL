// demos/photo/plazaScene.ts — an outdoor photograph at golden hour: a polished black granite
// trefoil knot on a stone plinth, on a paved waterfront in Venice at sunset (Poly Haven venice_sunset
// HDRI, large_grey_tiles paving).
//
// Meters. The paving is the plane y = 0 out to 200 m, ending at a stone curb on the water's edge;
// the HDRI supplies the sky, the low sun (about 3.6° above the horizon) and the distant buildings.
// The knot is 1.6 m across, standing upright on a 0.8 m plinth with rounded edges.

import type { SceneDescription, Vec3 } from '../../src/compiler/types.js';
import type { AsyncSceneSuiteEntry } from '../../tests/witnesses/types.js';
import { defineSDF } from '../../src/components/geometry/custom.js';
import { meshObject, tubeMesh } from './geometry.js';
import { distance, photoStrategy } from './camera.js';

// A box with rounded edges: the exact distance to the box of half-size `halfSize` − `radius`,
// minus `radius`. Its outer surface stays inside the box of half-size `halfSize`.
const roundedBox = defineSDF({
    name: 'roundedBox',
    params: [
        { name: 'halfSize', kind: 'length', shape: 'vec3', required: true, constraint: { kind: 'positive' } },
        { name: 'radius', kind: 'length', shape: 'number', required: true, constraint: { kind: 'positive' } },
    ],
    glsl: `
float roundedBox_sdf(vec3 p, RoundedBox b) {
    vec3 q = abs(p) - (b.halfSize - vec3(b.radius));
    return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0) - b.radius;
}
`,
    field: (p, v) => {
        const h = v.halfSize as number[], r = v.radius as number;
        const q = [0, 1, 2].map((i) => Math.abs(p[i]) - (h[i] - r));
        return Math.hypot(...q.map((x) => Math.max(x, 0))) + Math.min(Math.max(q[0], q[1], q[2]), 0) - r;
    },
    marchBound: { type: 'box', values: (v) => ({ halfSize: v.halfSize as number[] }) },
});

// The (2, 3) torus knot, symmetry axis along z (the knot stands in the xy plane).
const R = 0.52, A = 0.21, TUBE = 0.13;
const trefoil = (t: number): Vec3 => {
    const r = R + A * Math.cos(3 * t);
    return [r * Math.cos(2 * t), r * Math.sin(2 * t), A * Math.sin(3 * t)];
};
// The tube's lowest point is TUBE below the curve's lowest point (where the tangent is
// horizontal), found by sampling the curve; the knot sinks 3 cm into the plinth top, as if
// mounted on a pin. Turning the knot about y does not change heights.
const CURVE_LOW = Math.min(...Array.from({ length: 4096 }, (_, i) => trefoil((2 * Math.PI * i) / 4096)[1]));
const PLINTH_TOP = 0.8, PLINTH_ROUND = 0.012;
const KNOT_AT: Vec3 = [0, PLINTH_TOP - CURVE_LOW + TUBE - 0.03, 0];
const QUAY_EDGE = -36;

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
            // plinth, where the lagoon of the HDRI begins; the map spans 3 m. edge1 × edge2 points
            // −y; a quad is two-sided, so for a non-emitter the side does not matter.
            { type: 'quad', name: 'paving', parameters: { corner: [-200, 0, 200], edge1: [0, 0, QUAY_EDGE - 200], edge2: [400, 0, 0] }, material: 'paving' },
            // The curb along the water's edge: a 14 cm × 30 cm stone kerb.
            { type: 'box', name: 'curb', parameters: { halfSize: [200, 0.07, 0.15] }, material: 'curb', transform: { position: [0, 0.07, QUAY_EDGE + 0.15] } },
            // The plinth, its bottom sunk by the rounding radius so it meets the paving flat.
            {
                type: roundedBox, name: 'plinth', parameters: { halfSize: [0.42, (PLINTH_TOP + PLINTH_ROUND) / 2, 0.42], radius: PLINTH_ROUND },
                material: 'concrete',
                transform: { position: [0, (PLINTH_TOP - PLINTH_ROUND) / 2, 0], rotation: { axis: [0, 1, 0], angle: 0.25 } },
            },
            meshObject(tubeMesh(trefoil, TUBE, 900, 64), 'granite', 'trefoil', {
                transform: { position: KNOT_AT, rotation: { axis: [0, 1, 0], angle: 0.5 } },
            }),
        ],
        materials: {
            paving: { model: 'lambert', albedo: { texture: 'paving', uvScale: [236 / 3, 400 / 3] } },
            // Cast concrete, mottled in patches of a few tens of centimeters (|perlin_fbm| ≤ 2.1
            // for 4 octaves at gain 0.5, so the albedo stays in [0.23, 0.34]).
            concrete: {
                model: 'lambert',
                albedo: { kind: 'glsl', source: 'vec3(0.33, 0.32, 0.30) * (0.86 + 0.08 * perlin_fbm(2.5 * p, 0.5, 4))' },
                bump: { height: { kind: 'glsl', source: '0.0015 * perlin_fbm(40.0 * p, 0.5, 3)' }, step: 0.0005 },
            },
            // Istrian stone, the pale limestone of Venice's quays, weathered in streaks.
            curb: {
                model: 'lambert',
                albedo: { kind: 'glsl', source: 'vec3(0.50, 0.48, 0.45) * (0.85 + 0.07 * perlin_fbm(vec3(0.6, 4.0, 4.0) * p, 0.5, 3))' },
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

// Far enough back that the 85 mm frame holds the whole plinth: its base sits about 90 px above
// the bottom edge and the knot's top about 90 px below the top.
const CAMERA: Vec3 = [2.64, 1.45, 10.8];
const AIM: Vec3 = [0, 1.23, 0];

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
        + 'trefoil tube mesh on a rounded concrete plinth (defineSDF; Perlin mottle and bump), on Poly Haven '
        + 'large_grey_tiles paving ending at a stone curb, under '
        + 'the venice_sunset HDRI, the sun in frame just above the far shore. 85 mm, f/2.8. Needs fetched assets.',
    expected:
        'a black knot whose polish mirrors the pink dusk sky and the paving, the setting sun low on the '
        + 'right over the lagoon, the far shore slightly soft.',
};
