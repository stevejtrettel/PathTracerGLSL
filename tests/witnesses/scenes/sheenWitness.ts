// witnesses/scenes/sheenWitness.ts
// The sheen occupant (OpenPBR fuzz over a Lambertian base) under a constant samplable sky L = 1.
// Every scattered ray escapes, so a pixel reads the directional albedo of the material at the
// camera ray's cosine μ_o:  A(μ_o) = W·c·E(μ_o, r) + (1 − W·E(μ_o, r))·ρ  (sheen.md).
//
// sheen-furnace: the open furnace (furnace-sky's sphere and camera) with c = ρ = 0.4, W = 1,
// r = 0.5, so A ≡ 0.4 at every μ_o whatever D and E are. It checks the layering: each scattered
// path carries exactly ρ under pt, and NEE/MIS integrate eval over the sky.
//
// sheen-fuzz: the fuzz alone (ρ = 0), so a pixel reads W·c·E(μ_o, r), which depends on the lobe
// D being normalized (NEE, MIS) and on the sampler drawing D (pt). An orthographic camera looks
// down −z (film ±0.533 × ±0.4 at 160 × 120) at a convex roof with its ridge along y at x = 0:
//   - left slope, normal (−0.9798, 0, 0.2): μ_o = 0.2 over the whole slope;
//   - right slope, normal (0.8660, 0, 0.5): μ_o = 0.5.
// Each slope is two coplanar quads (y > 0 and y < 0) of different materials. A slope's scattered
// rays leave above its own plane, which the other slope lies below, so nothing is seen twice.
//   left top:     W 1,   c 1,                r 0.5: E(0.2, 0.5) = 0.429541
//   left bottom:  W 0.5, c (1, 0.5, 0.25),   r 1:   0.5·E(0.2, 1) = 0.321617 × c
//   right top:    W 1,   c 1,                r 1:   E(0.5, 1) = 0.495697
//   right bottom: W 1,   c 1,                r 0.7: E(0.5, 0.7) = 0.307095
// Values from sheen.test.ts. Gray c is not lifted through the RGB table, so the spectral key reads
// the same values in the gray bands.

import type { RenderStrategy, SceneDescription, Vec3 } from '../../../src/compiler/types.js';
import { furnaceSkyScene } from './envScenes.js';

export const sheenFurnaceScene: SceneDescription = {
    ...furnaceSkyScene,
    id: 'sheen-furnace',
    name: 'Sheen furnace (fuzz color = base albedo = 0.4: A ≡ 0.4)',
    materials: { gray: { model: 'sheen', albedo: 0.4, sheen_color: 0.4, sheen_weight: 1, sheen_roughness: 0.5 } },
};

/** The sphere's inscribed rectangle under furnace-sky's camera (corners at 0.92 of the
 *  silhouette radius): grazing μ_o included. */
export const SHEEN_FURNACE_SPHERE = { x: 0.33, y: 0.27, w: 0.34, h: 0.46 };

const MU_LEFT = 0.2, MU_RIGHT = 0.5;
const S_LEFT = Math.sqrt(1 - MU_LEFT * MU_LEFT), S_RIGHT = Math.sqrt(1 - MU_RIGHT * MU_RIGHT);
const HALF = 0.6;   // each slope spans |x| ≤ 0.6 and each band |y| ≤ 0.6, past the film's edges
/** Up-slope edge of the left slope (from x = −0.6 to the ridge) and down-slope edge of the right. */
const LEFT_EDGE: Vec3 = [HALF, 0, HALF * S_LEFT / MU_LEFT];
const RIGHT_EDGE: Vec3 = [HALF, 0, -HALF * S_RIGHT / MU_RIGHT];

const quad = (corner: Vec3, edge1: Vec3, material: string) => ({
    // cross(edge1, edge2) with edge2 = +y: (−0.9798, 0, 0.2) on the left, (0.8660, 0, 0.5) on the right.
    type: 'quad' as const, parameters: { corner, edge1, edge2: [0, HALF, 0] as Vec3 }, material, name: material,
});

export const sheenFuzzScene: SceneDescription = {
    id: 'sheen-fuzz',
    name: 'Sheen fuzz alone on a roof at μ_o = 0.2 and 0.5 (orthographic, unit sky)',
    ambientSpace: { type: 'euclidean' },
    objects: [
        quad([-HALF, 0, -LEFT_EDGE[2]], LEFT_EDGE, 'left_top'),
        quad([-HALF, -HALF, -LEFT_EDGE[2]], LEFT_EDGE, 'left_bottom'),
        quad([0, 0, 0], RIGHT_EDGE, 'right_top'),
        quad([0, -HALF, 0], RIGHT_EDGE, 'right_bottom'),
    ],
    materials: {
        left_top: { model: 'sheen', albedo: 0, sheen_color: 1, sheen_weight: 1, sheen_roughness: 0.5 },
        left_bottom: { model: 'sheen', albedo: 0, sheen_color: [1, 0.5, 0.25], sheen_weight: 0.5, sheen_roughness: 1 },
        right_top: { model: 'sheen', albedo: 0, sheen_color: 1, sheen_weight: 1, sheen_roughness: 1 },
        right_bottom: { model: 'sheen', albedo: 0, sheen_color: 1, sheen_weight: 1, sheen_roughness: 0.7 },
    },
    lights: [],
    environment: { type: 'constant', color: [1, 1, 1], intensity: 1.0, sampleAsLight: true },
};

/** The expected radiance per band (W·c·E(μ_o, r)). */
export const SHEEN_FUZZ_VALUES = {
    leftTop: 0.429541,
    leftBottom: [0.321617, 0.160809, 0.080404] as [number, number, number],
    rightTop: 0.495697,
    rightBottom: 0.307095,
};

/** Frame regions (fractions, origin bottom-left), each inside one quad and clear of its edges. */
export const SHEEN_FUZZ_REGIONS = {
    leftTop: { x: 0.05, y: 0.56, w: 0.37, h: 0.38 },
    leftBottom: { x: 0.05, y: 0.06, w: 0.37, h: 0.38 },
    rightTop: { x: 0.58, y: 0.56, w: 0.37, h: 0.38 },
    rightBottom: { x: 0.58, y: 0.06, w: 0.37, h: 0.38 },
};

const fuzzStrategy = (id: string, directLighting: 'none' | 'nee' | 'mis', color: 'rgb' | 'spectral' = 'rgb'): RenderStrategy => ({
    id,
    measurement: {
        camera: { type: 'orthographic', scale: 0.4 },
        maxBounces: 4,
        ...(color === 'spectral' ? { color } : {}),
    },
    estimator: { directLighting, russianRoulette: null, accumulation: { type: 'average' } },
    view: { tonemap: { type: 'none' } },
});

/** pt-nee, pt-mis, pt, and spectral pt-mis. */
export const sheenFuzzStrategies = [
    fuzzStrategy('pt-nee', 'nee'),
    fuzzStrategy('pt-mis', 'mis'),
    fuzzStrategy('pt', 'none'),
    fuzzStrategy('spectral-pt-mis', 'mis', 'spectral'),
];
export const SHEEN_FUZZ_POSE: { position: Vec3; target: Vec3 } = { position: [0, 0, 2], target: [0, 0, -3] };
