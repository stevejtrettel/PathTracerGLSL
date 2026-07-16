// witnesses/scenes/transformWitness.ts
// Stage-2 witnesses for the placement system (docs/fable-transforms.md §8):
//
//   transform-bake      — twin-bake: every object authored via `transform` (arm B) vs the
//                         SAME geometry hand-folded into primitive parameters (arm A).
//                         Covers the analytic translate fold, the analytic ROTATION fold
//                         through the sampleAsLight desugar (the lamp), the SDF scale
//                         tier (s·d correction), and the SDF translation tier.
//   conjugation         — the global-similarity witness: apply ONE similarity g to every
//                         object AND the camera; path tracing g·scene from g·camera is
//                         the same integral, so the converged images must match. One
//                         number tests fold + wrapper tiers + desugar + power CDF +
//                         sampler/pdf agreement at an arbitrary angle and scale.
//   regions-transformed — R-SUBMERGED-style nesting (glass sphere inside an absorbing
//                         water box) under rotation+scale+translation vs the hand-folded
//                         twin: innermost-wins classification, s·d signed distances, and
//                         the interface-epsilon discipline under a transformed field.
//
// All hand-folded values are derived IN COMMENTS from the plain rotation formulas —
// deliberately not computed with src/components/geometry/similarity.ts, so a fold bug
// cannot reproduce itself into the reference arm.

import type { SceneDescription, RenderStrategy, Transform } from '../../../src/compiler/types.js';

// ---------------------------------------------------------------------------
// Shared strategies
// ---------------------------------------------------------------------------

export const transformNeeStrategy: RenderStrategy = {
    id: 'pathtracer',
    measurement: {
        camera: { type: 'pinhole', fov: 0.8 },
        maxBounces: 8,
    },
    estimator: {
        directLighting: 'nee',
        russianRoulette: { startDepth: 3 },
        accumulation: { type: 'average' },
    },
    view: { tonemap: { type: 'reinhard' } },
};

// Dielectric nesting needs depth (enter water → enter glass → exit → exit).
export const regionsNeeStrategy: RenderStrategy = {
    id: 'pathtracer',
    measurement: {
        camera: { type: 'pinhole', fov: 0.8 },
        maxBounces: 12,
    },
    estimator: {
        directLighting: 'nee',
        russianRoulette: { startDepth: 4 },
        accumulation: { type: 'average' },
    },
    view: { tonemap: { type: 'reinhard' } },
};

// ---------------------------------------------------------------------------
// transform-bake — twin-bake pair
// ---------------------------------------------------------------------------
// Arm B authors placement via `transform`; arm A (the -ref partner) bakes the same
// world geometry into parameters by hand. Ry(π/2) maps (x,y,z) → (z, y, −x).

const bakeMaterials: SceneDescription['materials'] = {
    floor: { model: 'lambert', albedo: [0.55, 0.55, 0.55] },
    red: { model: 'lambert', albedo: [0.75, 0.25, 0.2] },
    blue: { model: 'lambert', albedo: [0.25, 0.4, 0.75] },
    green: { model: 'lambert', albedo: [0.3, 0.65, 0.3] },
    // sampleAsLight defaults TRUE for an emissive analytic quad — the lamp joins the
    // registry via the FOLDED parameters (the §5 ordering pin under test).
    lamp: { model: 'lambert', albedo: [0.0, 0.0, 0.0], emission: [10.0, 10.0, 10.0] },
};

const bakeEnv: SceneDescription['environment'] = { type: 'constant', color: [0.05, 0.07, 0.1], intensity: 1.0 };

/** Arm B: transform-authored. */
export const transformBake: SceneDescription = {
    id: 'transform-bake',
    name: 'Transform bake twin (transform-authored arm)',
    ambientSpace: { type: 'euclidean' },
    objects: [
        { kind: 'sdf', sdf: { type: 'plane', parameters: { normal: [0, 1, 0], offset: 1.0 } }, material: 'floor' },
        // SDF scale tier: radius 0.35 under scale 2 ⇒ world radius 0.7 (and s·d marching).
        {
            kind: 'sdf', sdf: { type: 'sphere', parameters: { radius: 0.35 } }, material: 'red',
            transform: { position: [-1.0, -0.3, 0], scale: 2 },
        },
        // SDF translation tier (the historical wrapper line).
        {
            kind: 'sdf', sdf: { type: 'box', parameters: { halfSize: [0.4, 0.4, 0.4] } }, material: 'green',
            transform: { position: [1.1, -0.6, -0.8] },
        },
        // Analytic translate fold.
        {
            kind: 'analytic', shape: { type: 'sphere', parameters: { center: [0.2, -0.4, 0], radius: 0.5 } }, material: 'blue',
            transform: { position: [0.5, 0, 0.3] },
        },
        // Analytic ROTATION fold on the samplable emitter: Ry(π/2) + translate.
        {
            kind: 'analytic',
            shape: { type: 'quad', parameters: { corner: [-0.5, 1.5, -0.5], edge1: [1, 0, 0], edge2: [0, 0, 1] } },
            material: 'lamp',
            transform: { position: [0.2, 0, 0], rotation: { axis: [0, 1, 0], angle: Math.PI / 2 } },
        },
    ],
    materials: bakeMaterials,
    lights: [],
    environment: bakeEnv,
};

/** Arm A: the same world geometry, hand-folded into parameters.
 *  Lamp fold, by hand: Ry(π/2)·(x,y,z) = (z, y, −x), then + (0.2, 0, 0):
 *    corner (−0.5, 1.5, −0.5) → (−0.5, 1.5, 0.5) → (−0.3, 1.5, 0.5)
 *    edge1  (1, 0, 0)         → (0, 0, −1)
 *    edge2  (0, 0, 1)         → (1, 0, 0)
 *  Emitting normal: cross(e1, e2) = (0, −1, 0) in BOTH arms (down-facing) — the
 *  one-sided pin must survive the fold. */
export const transformBakeRef: SceneDescription = {
    id: 'transform-bake-ref',
    name: 'Transform bake twin (hand-folded arm)',
    ambientSpace: { type: 'euclidean' },
    objects: [
        { kind: 'sdf', sdf: { type: 'plane', parameters: { normal: [0, 1, 0], offset: 1.0 } }, material: 'floor' },
        { kind: 'sdf', sdf: { type: 'sphere', parameters: { center: [-1.0, -0.3, 0], radius: 0.7 } }, material: 'red' },
        { kind: 'sdf', sdf: { type: 'box', parameters: { center: [1.1, -0.6, -0.8], halfSize: [0.4, 0.4, 0.4] } }, material: 'green' },
        { kind: 'analytic', shape: { type: 'sphere', parameters: { center: [0.7, -0.4, 0.3], radius: 0.5 } }, material: 'blue' },
        {
            kind: 'analytic',
            shape: { type: 'quad', parameters: { corner: [-0.3, 1.5, 0.5], edge1: [0, 0, -1], edge2: [1, 0, 0] } },
            material: 'lamp',
        },
    ],
    materials: bakeMaterials,
    lights: [],
    environment: bakeEnv,
};

// ---------------------------------------------------------------------------
// conjugation — the global-similarity witness
// ---------------------------------------------------------------------------
// g = translate(2, 0.5, −1) ∘ scale(1.6) ∘ Ry(0.7). Rotation is about +Y so the
// camera's world-up frame convention survives; radiance-based emitters (the quad
// lamp) are scale-invariant, so NO radiometric fixups are needed anywhere —
// deliberately no point lights (their intensity would need an s² correction).

const CONJ_ANGLE = 0.7;
const CONJ_SCALE = 1.6;
const CONJ_T: [number, number, number] = [2, 0.5, -1];
const conjTransform: Transform = { position: CONJ_T, rotation: { axis: [0, 1, 0], angle: CONJ_ANGLE }, scale: CONJ_SCALE };

/** g applied via plain trig (independent of similarity.ts): used ONLY for the camera pose. */
function conjPoint([x, y, z]: [number, number, number]): [number, number, number] {
    const c = Math.cos(CONJ_ANGLE), s = Math.sin(CONJ_ANGLE);
    return [
        CONJ_SCALE * (x * c + z * s) + CONJ_T[0],
        CONJ_SCALE * y + CONJ_T[1],
        CONJ_SCALE * (-x * s + z * c) + CONJ_T[2],
    ];
}

const conjObjects: SceneDescription['objects'] = [
    { kind: 'sdf', sdf: { type: 'plane', parameters: { normal: [0, 1, 0], offset: 1.0 } }, material: 'floor' },
    { kind: 'sdf', sdf: { type: 'box', parameters: { halfSize: [0.45, 0.7, 0.45] } }, material: 'red' },
    { kind: 'analytic', shape: { type: 'sphere', parameters: { center: [0.9, -0.5, 0.4], radius: 0.5 } }, material: 'blue' },
    {
        kind: 'analytic',
        shape: { type: 'quad', parameters: { corner: [-0.6, 2.0, -0.6], edge1: [1.2, 0, 0], edge2: [0, 0, 1.2] } },
        material: 'lamp',
    },
];

const conjMaterials: SceneDescription['materials'] = {
    floor: { model: 'lambert', albedo: [0.55, 0.55, 0.55] },
    red: { model: 'lambert', albedo: [0.75, 0.25, 0.2] },
    blue: { model: 'lambert', albedo: [0.25, 0.4, 0.75] },
    lamp: { model: 'lambert', albedo: [0.0, 0.0, 0.0], emission: [8.0, 8.0, 8.0] },
};

// Constant env is rotation-invariant — the miss branch agrees between the arms.
const conjEnv: SceneDescription['environment'] = { type: 'constant', color: [0.06, 0.08, 0.12], intensity: 1.0 };

export const conjugationBase: SceneDescription = {
    id: 'conjugation-base',
    name: 'Conjugation witness (untransformed arm)',
    ambientSpace: { type: 'euclidean' },
    objects: conjObjects,
    materials: conjMaterials,
    lights: [],
    environment: conjEnv,
};

export const conjugationScene: SceneDescription = {
    id: 'conjugation',
    name: 'Conjugation witness (g · everything)',
    ambientSpace: { type: 'euclidean' },
    // Every leaf carries the SAME g (params untouched): the box goes through the
    // mat3 similarity wrapper tier, the plane through s·d, the sphere and the lamp
    // through the analytic fold — the lamp's folded geometry feeds the power CDF
    // and the quad sampler.
    objects: conjObjects.map((o) => ({ ...o, transform: conjTransform })),
    materials: conjMaterials,
    lights: [],
    environment: conjEnv,
};

/** Camera poses: base, and g·base for the conjugated arm. */
export const CONJ_CAMERA_BASE = { position: [0, 1.3, 4.6] as [number, number, number], target: [0, -0.1, 0] as [number, number, number] };
export const CONJ_CAMERA_G = { position: conjPoint(CONJ_CAMERA_BASE.position), target: conjPoint(CONJ_CAMERA_BASE.target) };

// ---------------------------------------------------------------------------
// regions-transformed — nesting under a similarity
// ---------------------------------------------------------------------------
// gR = translate(0.3, −0.25, 0) ∘ scale(1.25) ∘ Ry(π/2). The glass sphere sits
// strictly inside the absorbing water box; both carry gR. The twin bakes the same
// world geometry by hand:
//   box: Ry(π/2) swaps the x/z extents → halfSize (0.4, 0.6, 0.8) ⇒ (0.5, 0.75, 1.0)
//        after ×1.25; center = the translation (0.3, −0.25, 0).
//   sphere: Ry(π/2)·(0.2, 0, 0.1) = (0.1, 0, −0.2); ×1.25 = (0.125, 0, −0.25);
//        + (0.3, −0.25, 0) = (0.425, −0.25, −0.25); radius 0.24 ⇒ 0.3.
// Interior media (σ per world unit) are material properties — identical in both arms.

const regionsTransform: Transform = { position: [0.3, -0.25, 0], rotation: { axis: [0, 1, 0], angle: Math.PI / 2 }, scale: 1.25 };

const regionsMaterials: SceneDescription['materials'] = {
    floor: { model: 'lambert', albedo: [0.6, 0.6, 0.6] },
    water: {
        model: 'dielectric', ior: 1.33,
        medium: { sigma_a: [0.35, 0.12, 0.08] },
    },
    glass: { model: 'dielectric', ior: 1.5 },
};

const regionsLights: SceneDescription['lights'] = [
    { kind: 'point', position: [2.5, 3.0, 2.0], intensity: 40.0, color: [1.0, 1.0, 1.0] },
];

const regionsEnv: SceneDescription['environment'] = { type: 'constant', color: [0.12, 0.14, 0.18], intensity: 1.0 };

export const regionsTransformed: SceneDescription = {
    id: 'regions-transformed',
    name: 'Regions under transform (transform-authored arm)',
    ambientSpace: { type: 'euclidean' },
    objects: [
        { kind: 'sdf', sdf: { type: 'plane', parameters: { normal: [0, 1, 0], offset: 1.0 } }, material: 'floor' },
        {
            kind: 'sdf', sdf: { type: 'box', parameters: { halfSize: [0.8, 0.6, 0.4] } }, material: 'water',
            transform: regionsTransform,
        },
        {
            kind: 'analytic', shape: { type: 'sphere', parameters: { center: [0.2, 0, 0.1], radius: 0.24 } }, material: 'glass',
            transform: regionsTransform,
        },
    ],
    materials: regionsMaterials,
    lights: regionsLights,
    environment: regionsEnv,
};

export const regionsTransformedRef: SceneDescription = {
    id: 'regions-transformed-ref',
    name: 'Regions under transform (hand-folded arm)',
    ambientSpace: { type: 'euclidean' },
    objects: [
        { kind: 'sdf', sdf: { type: 'plane', parameters: { normal: [0, 1, 0], offset: 1.0 } }, material: 'floor' },
        { kind: 'sdf', sdf: { type: 'box', parameters: { center: [0.3, -0.25, 0], halfSize: [0.5, 0.75, 1.0] } }, material: 'water' },
        { kind: 'analytic', shape: { type: 'sphere', parameters: { center: [0.425, -0.25, -0.25], radius: 0.3 } }, material: 'glass' },
    ],
    materials: regionsMaterials,
    lights: regionsLights,
    environment: regionsEnv,
};
