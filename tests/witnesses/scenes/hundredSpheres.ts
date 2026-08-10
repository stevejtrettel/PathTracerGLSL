// tests/witnesses/scenes/hundredSpheres.ts — the many-lights witness (fable-light-bvh §7).
//
// A 10×10 grid of small emissive spheres (the sampleAsLight route — sphere OBJECTS with
// one shared emissive material become 100 registry lights, one per region) over a dark
// floor, powers varying ×16 across the grid. The camera sits low in one corner: shading
// points there are lit by a handful of nearby lamps, so position-blind power selection
// wastes almost every NEE sample on the far side of the grid — exactly the regime the
// light tree exists for.
//
// Arms: pt-nee power (key 1) vs pt-nee bvh (key 2) — equality (the estimator-swap gate)
// + the σ/µ NOISE WIN (the point of the batch); pt-mis power (key 3) vs pt-mis bvh
// (key 4) — equality, THE SHARPEST GATE: the bvh arm's emitter-hit MIS weight replays
// the stored bit trail, so any pick/pmf drift diverges here.
//
// objectDispatch 'table' on every arm: 100 sphere regions ride the scene table (the
// SCALE regime — the unrolled dispatcher at 100 objects is the O(n)-text wall the
// batch's storage half exists to avoid).

import type { SceneDescription, RenderStrategy, ObjectDescription } from '../../../src/compiler/types.js';

/** Deterministic LCG — fixture data must be reproducible, never Math.random. */
function lcg(seed: number): () => number {
    let s = seed >>> 0;
    return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 0x100000000);
}

const GRID = 10;
const rand = lcg(1234);
const lamps: ObjectDescription[] = [];
for (let i = 0; i < GRID; i++) {
    for (let j = 0; j < GRID; j++) {
        // 18×18 grid footprint, jittered; lamps float at y ≈ 1.2 over the floor.
        const x = -9 + (18 * i) / (GRID - 1) + (rand() - 0.5) * 0.6;
        const z = -9 + (18 * j) / (GRID - 1) + (rand() - 0.5) * 0.6;
        const y = 1.0 + rand() * 0.5;
        lamps.push({
            type: 'sphere',
            parameters: { center: [x, y, z], radius: 0.12 },
            material: `lamp${(i * GRID + j) % 4}`,   // four power tiers, ×16 spread
            name: `lamp_${i}_${j}`,
        });
    }
}

export const hundredSpheres: SceneDescription = {
    id: 'hundred-spheres',
    name: 'Hundred Spheres (many-lights)',
    ambientSpace: { type: 'euclidean' },
    objects: [
        { type: 'plane', parameters: { normal: [0, 1, 0], offset: 0.0 }, material: 'floor' },
        ...lamps,
    ],
    materials: {
        floor: { model: 'lambert', albedo: [0.55, 0.55, 0.55] },
        // Pure emitters (albedo 0), one material per power tier — regions carry light
        // identity, so 25 objects sharing lamp0 are 25 lights (§6.2).
        lamp0: { model: 'lambert', albedo: [0, 0, 0], emission: [4, 3.2, 2.4] },
        lamp1: { model: 'lambert', albedo: [0, 0, 0], emission: [12, 12, 12] },
        lamp2: { model: 'lambert', albedo: [0, 0, 0], emission: [24, 30, 40] },
        lamp3: { model: 'lambert', albedo: [0, 0, 0], emission: [64, 52, 36] },
    },
    lights: [],
    // No env: selection among the 100 finite lights is the whole lighting signal.
    environment: { type: 'none' },
};

const baseMeasurement = {
    camera: { type: 'pinhole' as const, fov: 0.9 },
    maxBounces: 4,
};

const baseEstimator = {
    russianRoulette: null,
    // The SCALE dispatch regime — 100 analytic regions ride the scene table.
    objectDispatch: 'table' as const,
    accumulation: { type: 'average' as const },
};

const view = { tonemap: { type: 'reinhard' as const } };

export const hundredNeePowerStrategy: RenderStrategy = {
    id: 'nee-power',
    measurement: baseMeasurement,
    estimator: { ...baseEstimator, directLighting: 'nee', lightSelection: 'power' },
    view,
};

export const hundredNeeBvhStrategy: RenderStrategy = {
    id: 'nee-bvh',
    measurement: baseMeasurement,
    estimator: { ...baseEstimator, directLighting: 'nee', lightSelection: 'bvh' },
    view,
};

export const hundredMisPowerStrategy: RenderStrategy = {
    id: 'mis-power',
    measurement: baseMeasurement,
    estimator: { ...baseEstimator, directLighting: 'mis', lightSelection: 'power' },
    view,
};

export const hundredMisBvhStrategy: RenderStrategy = {
    id: 'mis-bvh',
    measurement: baseMeasurement,
    estimator: { ...baseEstimator, directLighting: 'mis', lightSelection: 'bvh' },
    view,
};
