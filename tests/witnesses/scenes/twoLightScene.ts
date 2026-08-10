// tests/witnesses/scenes/twoLightScene.ts
// Two point lights (warm + cool) over a floor with two diffuse spheres.
//
// Purpose: the FIRST scene to exercise the multi-light path (§10.1 item 3). With two
// lights the generated `lighting_sample` dispatcher takes its `lights.length > 1` branch —
// a compile-time CDF over the lights, then a per-light sampler call. Until this scene,
// that branch was dead code.
//
// The `lightSelection` strategy axis becomes observable here: `power` weights the CDF by
// each light's average radiance, `uniform` splits 50/50. Both are unbiased importance
// sampling, so they CONVERGE TO THE SAME IMAGE — the difference is variance (noise at low
// spp). Load both strategies and A/B them with keys 1 (power) / 2 (uniform); with unequal
// light powers, `power` should be visibly cleaner at equal sample count.

import type { SceneDescription, RenderStrategy } from '../../../src/compiler/types.js';

export const twoLightScene: SceneDescription = {
    id: 'two-light',
    name: 'Two Lights (warm + cool)',
    ambientSpace: { type: 'euclidean' },
    objects: [
        // Floor at y=0
        {
            type: 'plane', parameters: { normal: [0, 1, 0], offset: 0.0 },
            material: 'floor',
        },
        // Back wall at z=-3 (normal points inward, +z)
        {
            type: 'plane', parameters: { normal: [0, 0, 1], offset: 3.0 },
            material: 'floor',
        },
        // Left sphere
        {
            type: 'sphere', parameters: { center: [-0.75, 0.5, 0], radius: 0.5 },
            material: 'ivory',
        },
        // Right sphere
        {
            type: 'sphere', parameters: { center: [0.75, 0.5, 0], radius: 0.5 },
            material: 'ivory',
        },
    ],
    materials: {
        floor: { model: 'lambert', albedo: [0.6, 0.6, 0.6] },
        ivory: { model: 'lambert', albedo: [0.82, 0.78, 0.68] },
    },
    lights: [
        // Warm key light (higher power) — the `power` metric weights the CDF toward this one.
        { kind: 'point', position: [-2.5, 3.0, 1.5], emission: [26, 14.3, 6.5] },
        // Cool fill light (lower power).
        { kind: 'point', position: [2.5, 2.5, 1.5], emission: [4.9, 7.7, 14] },
    ],
    // Pure two-light NEE story: no ambient, so the CDF is the whole lighting signal.
    environment: { type: 'none' },
};

// Shared settings; the two strategies differ ONLY in `lightSelection`, so any
// image difference between them is attributable to the selection metric alone.
const baseMeasurement = {
    camera: { type: 'pinhole' as const, fov: 0.9 },
    maxBounces: 6,
};

const baseEstimator = {
    directLighting: 'nee' as const,
    // RR off: keeps the power-vs-uniform variance comparison a fair, unbiased A/B.
    russianRoulette: null,
    accumulation: { type: 'average' as const },
};

const baseViewSection = {
    tonemap: { type: 'reinhard' as const },
};

export const twoLightPowerStrategy: RenderStrategy = {
    id: 'power',
    measurement: baseMeasurement,
    estimator: { ...baseEstimator, lightSelection: 'power' },
    view: baseViewSection,
};

export const twoLightUniformStrategy: RenderStrategy = {
    id: 'uniform',
    measurement: baseMeasurement,
    estimator: { ...baseEstimator, lightSelection: 'uniform' },
    view: baseViewSection,
};

// The light tree at n = 2 (fable-light-bvh): the SMALL-N sanity arm — two DELTA lights
// through the table-resident rows + the one-level descent. The hundred-spheres witness
// owns the many-lights story; this pins the degenerate end of the same machinery.
export const twoLightBvhStrategy: RenderStrategy = {
    id: 'bvh',
    measurement: baseMeasurement,
    estimator: { ...baseEstimator, lightSelection: 'bvh' },
    view: baseViewSection,
};
