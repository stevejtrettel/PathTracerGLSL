// compiler/scenes/furnaceBox.ts
// The analytic furnace — F-BOX from docs/fable-validation-scenes.md §1.
//
// "The single most valuable test in this document." A closed box whose every face has
// albedo ρ and uniform emission Le reaches thermal equilibrium: at every pixel the
// radiance converges to
//
//     L = Le · (1 + ρ + ρ² + …) = Le / (1 − ρ)
//
// With ρ = 0.5 and Le = 0.2 that is EXACTLY 0.4 in every channel, everywhere. There are
// NO lights and NO environment: emission is the only source, found by BSDF bounces
// (directLighting: 'none'). A closed box means every bounce lands on an emitter, so the
// series converges fast — ρ^17 truncation at 16 bounces is ~3e-6.
//
// What it catches: any energy gain/loss in Lambert eval/sample/weight, cosine
// double-counting (§2.2 violations land near 0.36 or 0.44), emission bookkeeping, and
// accumulation-weighting errors. The expected value is exact, so this is a NUMBER test —
// read linear HDR (pre-tonemap) and check per-channel mean ≈ 0.4. Visually it is a flat
// gray field; its worth is the number, not the picture.
//
// Plane convention (matches cornellBox.ts): sdf = dot(p, normal) + offset, normals point
// INWARD, so the interior is the intersection of six half-spaces — here the cube [-1,1]³.

import type { SceneDescription, RenderStrategy } from '../types.js';

export const furnaceBox: SceneDescription = {
    id: 'furnace',
    name: 'Furnace Box (F-BOX)',
    ambientSpace: { type: 'euclidean' },
    objects: [
        // -x face at x=-1 (inward normal +x)
        { kind: 'sdf', sdf: { type: 'plane', parameters: { normal: [1, 0, 0], offset: 1.0 } }, material: 'furnace' },
        // +x face at x=+1 (inward normal -x)
        { kind: 'sdf', sdf: { type: 'plane', parameters: { normal: [-1, 0, 0], offset: 1.0 } }, material: 'furnace' },
        // -y face at y=-1 (inward normal +y)
        { kind: 'sdf', sdf: { type: 'plane', parameters: { normal: [0, 1, 0], offset: 1.0 } }, material: 'furnace' },
        // +y face at y=+1 (inward normal -y)
        { kind: 'sdf', sdf: { type: 'plane', parameters: { normal: [0, -1, 0], offset: 1.0 } }, material: 'furnace' },
        // -z face at z=-1 (inward normal +z)
        { kind: 'sdf', sdf: { type: 'plane', parameters: { normal: [0, 0, 1], offset: 1.0 } }, material: 'furnace' },
        // +z face at z=+1 (inward normal -z)
        { kind: 'sdf', sdf: { type: 'plane', parameters: { normal: [0, 0, -1], offset: 1.0 } }, material: 'furnace' },
    ],
    materials: {
        // ρ = 0.5, Le = 0.2  →  L = 0.2 / (1 − 0.5) = 0.4 exactly.
        furnace: { model: 'lambert', albedo: [0.5, 0.5, 0.5], emission: [0.2, 0.2, 0.2] },
    },
    lights: [],
    environment: { type: 'none' },
};

export const furnaceStrategy: RenderStrategy = {
    id: 'furnace',
    measurement: {
        // Camera INSIDE the box at the origin, looking down -z. Any interior pose works.
        camera: { type: 'pinhole', fov: 1.0 },
        maxBounces: 16, // ρ^17 truncation ~3e-6 — negligible vs the ±0.002 tolerance
    },
    estimator: {
        directLighting: 'none', // emission is found by BSDF bounces; no NEE, no lights
        russianRoulette: null, // unbiased: RR adds variance the tolerance can't absorb
        accumulation: { type: 'average' },
    },
    view: { tonemap: { type: 'reinhard' } },
};
