// witnesses/scenes/nullBudgetWitness.ts
// measurement.maxNullCrossings — the path's null-interface budget, shared by its shadow rays.
//
//   null-budget-view — the exact gate. An orthographic camera looks straight at a quad light
//                      (radiance Le) through SLABS absorbing slabs, each a 'none'-walled box of
//                      thickness d and σ_a: 2·SLABS null crossings on every camera ray. With
//                      maxBounces 0 the pixel is the light seen through the stack, so
//                        maxNullCrossings ≥ 2·SLABS:  L = Le · e^{−SLABS·σ_a·d}  (every pixel)
//                        maxNullCrossings < 2·SLABS:  L = 0                      (the path is cut)
//                      No sampling noise: every ray crosses the same slabs perpendicularly.
//   null-budget      — the estimator gate. A floor lit through a stack of SLABS slabs (2·SLABS
//                      crossings between floor and light), half of it under a thin 'none'-walled
//                      "carpet" box, so floor points there have spent one crossing before their
//                      shadow ray starts, and spend a second leaving the carpet. At the default
//                      budget (32) every path is counted; at 2·SLABS + 1 the direct light through
//                      the stack is cut under the carpet (1 + 1 + 2·SLABS > 2·SLABS + 1) and kept
//                      elsewhere. nee ≡ mis and pt ≡ nee must hold at both budgets: if a shadow
//                      ray had a budget of its own, NEE would count light under the carpet that
//                      the BSDF side cannot reach. A shadow-ray limit below 2·SLABS (the former
//                      fixed 8-segment walker) fails the default-budget arms outright.

import type { SceneDescription, RenderStrategy, Vec3 } from '../../../src/compiler/types.js';

export const SLABS = 5;
const SLAB_HALF = 0.05;                 // thickness d = 0.1
const SLAB_SIGMA_A = 0.5;
export const NULL_VIEW_LE = 2.0;
/** Le · e^{−SLABS·σ_a·d} — the light seen through the whole stack. */
export const NULL_VIEW_THROUGH = NULL_VIEW_LE * Math.exp(-SLABS * SLAB_SIGMA_A * 2 * SLAB_HALF);

const slabMaterial = { model: 'none' as const, medium: { sigma_a: [SLAB_SIGMA_A, SLAB_SIGMA_A, SLAB_SIGMA_A] as Vec3 } };

// ---------------------------------------------------------------------------
// null-budget-view
// ---------------------------------------------------------------------------

export const nullBudgetViewScene: SceneDescription = {
    id: 'null-budget-view',
    name: 'A light seen through five null-walled slabs (maxNullCrossings, exact)',
    ambientSpace: { type: 'euclidean' },
    objects: Array.from({ length: SLABS }, (_, i) => ({
        type: 'box',
        parameters: { center: [0, 0, -2.4 + 0.4 * i], halfSize: [1.5, 1.5, SLAB_HALF] },
        material: 'slab', name: `slab${i}`,
    })),
    materials: { slab: slabMaterial },
    // cross(edge1, edge2) = +z: the light faces the camera.
    lights: [{ kind: 'quad', corner: [-1, -1, -3], edge1: [2, 0, 0], edge2: [0, 2, 0], emission: NULL_VIEW_LE }],
};

const viewStrategy = (id: string, maxNullCrossings?: number): RenderStrategy => ({
    id,
    measurement: {
        camera: { type: 'orthographic', scale: 0.4 },   // film ±0.53 × ±0.4: inside the light and every slab
        maxBounces: 0,
        ...(maxNullCrossings !== undefined ? { maxNullCrossings } : {}),
    },
    estimator: { directLighting: 'none', russianRoulette: null, accumulation: { type: 'average' } },
    view: { tonemap: { type: 'reinhard' } },
});

export const nullViewStrategies = [
    viewStrategy('budget-default'),
    viewStrategy('budget-exact', 2 * SLABS),
    viewStrategy('budget-short', 2 * SLABS - 1),
];
export const NULL_VIEW_POSE: { position: Vec3; target: Vec3 } = { position: [0, 0, 2], target: [0, 0, -3] };

// ---------------------------------------------------------------------------
// null-budget
// ---------------------------------------------------------------------------

export const nullBudgetScene: SceneDescription = {
    id: 'null-budget',
    name: 'A floor lit through five null-walled slabs, half under a carpet (maxNullCrossings, estimators)',
    ambientSpace: { type: 'euclidean' },
    objects: [
        { type: 'plane', parameters: { normal: [0, 1, 0], offset: 0 }, material: 'floor', name: 'floor' },
        // The carpet straddles the floor (y ∈ [−0.1, 0.2]) so the floor surface for x ∈ [0, 1.5]
        // lies inside it, with no coplanar faces.
        { type: 'box', parameters: { center: [0.75, 0.05, 0], halfSize: [0.75, 0.15, 1.5] }, material: 'carpet', name: 'carpet' },
        ...Array.from({ length: SLABS }, (_, i) => ({
            type: 'box',
            parameters: { center: [0, 1.0 + 0.3 * i, 0], halfSize: [1.5, SLAB_HALF, 1.5] },
            material: 'slab', name: `slab${i}`,
        })),
    ],
    materials: {
        floor: { model: 'lambert', albedo: [0.6, 0.6, 0.6] },
        carpet: { model: 'none', medium: { sigma_a: [0.2, 0.2, 0.2] } },
        slab: slabMaterial,
    },
    // cross(edge1, edge2) = −y: the light faces the floor.
    lights: [{ kind: 'quad', corner: [-0.5, 2.9, -0.5], edge1: [1, 0, 0], edge2: [0, 0, 1], emission: 10 }],
};

const litStrategy = (id: string, directLighting: 'none' | 'nee' | 'mis', maxNullCrossings?: number): RenderStrategy => ({
    id,
    measurement: {
        camera: { type: 'pinhole', fov: 0.9 },
        maxBounces: 3,
        ...(maxNullCrossings !== undefined ? { maxNullCrossings } : {}),
    },
    estimator: { directLighting, russianRoulette: null, accumulation: { type: 'average' } },
    view: { tonemap: { type: 'reinhard' } },
});

/** 0–2: nee / mis / pt at the default budget; 3–5: the same at 2·SLABS + 1. */
export const nullBudgetStrategies = [
    litStrategy('pt-nee', 'nee'),
    litStrategy('pt-mis', 'mis'),
    litStrategy('pt', 'none'),
    litStrategy('pt-nee-11', 'nee', 2 * SLABS + 1),
    litStrategy('pt-mis-11', 'mis', 2 * SLABS + 1),
    litStrategy('pt-11', 'none', 2 * SLABS + 1),
];
export const NULL_BUDGET_POSE: { position: Vec3; target: Vec3 } = { position: [0, 0.6, 3.4], target: [0, 0, 0] };
