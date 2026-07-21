// tests/witnesses/scenes/instanceWitness.ts — instancing correctness (impl-plan-instancing).
//
// instance-twin ⇄ instance-twin-ref: three spheres authored as ONE instanced batch (a shared
// prototype + 3 placements, ray-into-local) must converge to the SAME image as the three spheres
// authored individually (each folding its transform into analytic params). Proves the instance
// loop's placement read + conjugation + region against the ordinary analytic path.

import type { SceneDescription, RenderStrategy, Transform } from '../../../src/compiler/types.js';
import { instance } from '../../../src/authoring/instance.js';
import { withPose } from '../../../src/authoring/strategy.js';
import { boxMesh } from './meshWitness.js';

const PLACEMENTS = [
    { position: [-1.2, 0.5, 0.0] as [number, number, number], scale: 1.0 },
    { position: [0.0, 0.7, 0.0] as [number, number, number], scale: 1.4 },
    { position: [1.3, 0.5, -0.3] as [number, number, number], scale: 0.9 },
];

const materials: SceneDescription['materials'] = {
    floor: { model: 'lambert', albedo: [0.55, 0.55, 0.58] },
    ball: { model: 'lambert', albedo: [0.85, 0.35, 0.25] },
};
const lights: SceneDescription['lights'] = [{ kind: 'point', position: [3, 5, 3], emission: 60 }];
const environment: SceneDescription['environment'] = { type: 'constant', color: [0.10, 0.14, 0.24], intensity: 1.0 };
const floor = { type: 'quad', parameters: { corner: [-6, 0, -6], edge1: [0, 0, 12], edge2: [12, 0, 0] }, material: 'floor' };

// The prototype is a unit-ish sphere at the origin (radius 0.5); placements position/scale it.
export const instanceTwin: SceneDescription = {
    id: 'instance-twin',
    name: 'Instance Twin (3 spheres as one batch)',
    ambientSpace: { type: 'euclidean' },
    objects: [
        { ...floor },
        instance({ type: 'sphere', parameters: { radius: 0.5 }, material: 'ball' }, PLACEMENTS),
    ],
    materials, lights, environment,
};

// Reference: the SAME three spheres as individual analytic objects (transform folds into params).
export const instanceTwinRef: SceneDescription = {
    id: 'instance-twin-ref',
    name: 'Instance Twin Ref (3 individual spheres)',
    ambientSpace: { type: 'euclidean' },
    objects: [
        { ...floor },
        ...PLACEMENTS.map((p) => ({ type: 'sphere' as const, parameters: { radius: 0.5 }, material: 'ball', transform: p })),
    ],
    materials, lights, environment,
};

const base: RenderStrategy = {
    id: 'pathtracer',
    measurement: { camera: { type: 'pinhole', fov: 0.8 }, maxBounces: 5 },
    estimator: { directLighting: 'nee', russianRoulette: { startDepth: 3 }, accumulation: { type: 'average' } },
    view: { tonemap: { type: 'reinhard' } },
};
export const instanceTwinStrategy: RenderStrategy = withPose(base, [0, 2.0, 5.0], [0, 0.6, 0]);

// The estimator-swap arm (impl-plan-tlas A/B): the TLAS walk and the linear scan visit
// the same placements with the same RNG stream — near-bit-exact agreement, so any gap
// is a real traversal bug (dropped subtrees, slab edge, wrong leaf range). Distinct id
// (renderer-ID namespacing — collisions silently clobber programs).
export const instanceTwinLinearStrategy: RenderStrategy = {
    ...instanceTwinStrategy,
    id: 'pathtracer-linear',
    estimator: { ...instanceTwinStrategy.estimator, instanceAccel: 'linear' },
};

// ---------------------------------------------------------------------------
// mesh-instance-twin ⇄ mesh-instance-ref — the MESH-prototype instancing gate.
//
// The instance loop's two backends use DIFFERENT ray-into-local conventions: the mesh
// arm divides the rigid-conjugated ray by s (Möller–Trumbore is non-unit-safe, BLAS
// unscaled), the analytic arm keeps a unit ray and scales the shape params. The ÷s
// convention bug (double-transformed instances) was found only by GPU render on
// scale≠1 instances — this twin is its durable guard: three rotated, SCALE-VARIED box
// meshes as ONE batch (shared BLAS) must match the same three authored as individual
// mesh objects (constant ray-into-local placement).
// ---------------------------------------------------------------------------

const MESH_PLACEMENTS: Transform[] = [
    { position: [-1.3, 0.55, 0.0], rotation: { axis: [0, 1, 0], angle: 0.6 }, scale: 1.3 },
    { position: [0.1, 0.35, -0.4], rotation: { axis: [1, 1, 0], angle: -0.8 }, scale: 0.8 },
    { position: [1.2, 0.45, 0.3], rotation: { axis: [0, 0, 1], angle: 0.35 }, scale: 1.0 },
];

// Outward-wound cube, half-size 0.4, flat geometric normals (no authored normals).
const cubeGeom = boxMesh(0.4, /*inward*/ false);
const cubeProto = { kind: 'mesh' as const, positions: cubeGeom.positions, indices: cubeGeom.indices, material: 'ball' };

export const meshInstanceTwin: SceneDescription = {
    id: 'mesh-instance-twin',
    name: 'Mesh Instance Twin (3 scaled cubes as one batch)',
    ambientSpace: { type: 'euclidean' },
    objects: [
        { ...floor },
        instance(cubeProto, MESH_PLACEMENTS, 'cubes'),
    ],
    materials, lights, environment,
};

export const meshInstanceRef: SceneDescription = {
    id: 'mesh-instance-ref',
    name: 'Mesh Instance Ref (3 individual mesh cubes)',
    ambientSpace: { type: 'euclidean' },
    objects: [
        { ...floor },
        ...MESH_PLACEMENTS.map((t) => ({ ...cubeProto, transform: t })),
    ],
    materials, lights, environment,
};

export const meshInstanceStrategy: RenderStrategy = withPose(base, [0, 2.2, 4.8], [0, 0.4, 0]);

// ---------------------------------------------------------------------------
// attr-twin ⇄ attr-twin-ref — per-instance material attributes (fable-instance-attributes).
//
// One batch, one lambert material, three DIFFERENT per-instance albedos via the attribute
// table (read by Hit.element) ≡ the same three spheres authored individually with three
// materials. Proves the whole chain: Validator → Planner slot minting → the generated
// element-indexed fetch → the TLAS-reordered attrs texture (leaf order ≠ scene order, so a
// reorder bug shows as swapped colors, caught by the rmse gate).
// ---------------------------------------------------------------------------

const ATTR_ALBEDOS: [number, number, number][] = [
    [0.85, 0.35, 0.25],
    [0.30, 0.78, 0.35],
    [0.30, 0.42, 0.85],
];

export const attrTwin: SceneDescription = {
    id: 'attr-twin',
    name: 'Attribute Twin (3 albedos, one batch)',
    ambientSpace: { type: 'euclidean' },
    objects: [
        { ...floor },
        instance(
            { type: 'sphere', parameters: { radius: 0.5 }, material: 'ball' },
            PLACEMENTS,
            { name: 'balls', attributes: { albedo: ATTR_ALBEDOS } },
        ),
    ],
    materials, lights, environment,
};

export const attrTwinRef: SceneDescription = {
    id: 'attr-twin-ref',
    name: 'Attribute Twin Ref (3 individual materials)',
    ambientSpace: { type: 'euclidean' },
    objects: [
        { ...floor },
        ...PLACEMENTS.map((p, i) => ({ type: 'sphere' as const, parameters: { radius: 0.5 }, material: `ball${i}`, transform: p })),
    ],
    materials: {
        floor: materials.floor,
        ball0: { model: 'lambert', albedo: ATTR_ALBEDOS[0] },
        ball1: { model: 'lambert', albedo: ATTR_ALBEDOS[1] },
        ball2: { model: 'lambert', albedo: ATTR_ALBEDOS[2] },
    },
    lights, environment,
};

export const attrTwinStrategy: RenderStrategy = instanceTwinStrategy;
