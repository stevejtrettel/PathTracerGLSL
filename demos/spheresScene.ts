// demos/spheresScene.ts — an instancing stress/showcase (impl-plan-instancing): 500 spheres of
// varied size and position, ALL from one analytic-sphere prototype + a 500-entry placement texture.
// One region/material (v1 batch), one point light, on a floor. 500 instances × one intersect each
// per ray through the linear instance loop — the "before a TLAS" scale point.

import type { SceneDescription, RenderStrategy, Transform } from '../src/compiler/types.js';
import { instance } from '../src/authoring/instance.js';

/** `count` spheres scattered in a box volume with random position + uniform scale (seeded). */
function sphereCloud(count: number, seed: number): Transform[] {
    let s = seed >>> 0;
    const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    const out: Transform[] = [];
    for (let i = 0; i < count; i++) {
        out.push({
            position: [(rnd() * 2 - 1) * 4.5, 0.5 + rnd() * 4.0, (rnd() * 2 - 1) * 4.5],
            scale: 0.35 + rnd() * 0.75,
        });
    }
    return out;
}

export const spheresScene: SceneDescription = {
    id: 'spheres',
    name: '500 Instanced Spheres',
    ambientSpace: { type: 'euclidean' },
    objects: [
        { type: 'quad', parameters: { corner: [-12, 0, -12], edge1: [0, 0, 24], edge2: [24, 0, 0] }, material: 'floor' },
        // 500 spheres from ONE prototype + a placement texture — the whole cloud is one batch.
        instance({ type: 'sphere', parameters: { radius: 1.0 }, material: 'orb' }, sphereCloud(500, 12345), 'cloud'),
    ],
    materials: {
        floor: { model: 'lambert', albedo: [0.55, 0.55, 0.58] },
        orb: { model: 'lambert', albedo: [0.85, 0.42, 0.28] },
    },
    lights: [{ kind: 'point', position: [7, 11, 6], emission: 320 }],
    environment: { type: 'constant', color: [0.28, 0.38, 0.58], intensity: 1.0 },
};

// Comparison twin: the SAME 500 spheres authored as INDIVIDUAL analytic objects (each folds its
// transform into params → 500 unrolled sphere_intersect blocks + 500 regions). Same image as
// `spheres`; the point is the frame-time comparison (instanced loop vs unrolled objects, both O(N)
// with no TLAS). impl-plan-instancing perf note.
export const spheresIndividualScene: SceneDescription = {
    id: 'spheres-individual',
    name: '500 Individual Spheres (instancing A/B)',
    ambientSpace: { type: 'euclidean' },
    objects: [
        { type: 'quad', parameters: { corner: [-12, 0, -12], edge1: [0, 0, 24], edge2: [24, 0, 0] }, material: 'floor' },
        ...sphereCloud(500, 12345).map((t) => ({ type: 'sphere' as const, parameters: { radius: 1.0 }, material: 'orb', transform: t })),
    ],
    materials: {
        floor: { model: 'lambert', albedo: [0.55, 0.55, 0.58] },
        orb: { model: 'lambert', albedo: [0.85, 0.42, 0.28] },
    },
    lights: [{ kind: 'point', position: [7, 11, 6], emission: 320 }],
    environment: { type: 'constant', color: [0.28, 0.38, 0.58], intensity: 1.0 },
};

// Key 1 = TLAS (per-batch BVH over the 500 instance boxes), key 2 = linear scan — the live A/B.
// Same image; watch the StatsPanel pathtracer ms/frame collapse (500 → ~log 500).
export const spheresStrategy: RenderStrategy = {
    id: 'tlas',
    measurement: { camera: { type: 'pinhole', fov: 0.85 }, maxBounces: 5 },
    estimator: { directLighting: 'nee', russianRoulette: { startDepth: 4 }, instanceAccel: 'tlas', accumulation: { type: 'average' } },
    view: { tonemap: { type: 'reinhard' } },
};

export const spheresLinearStrategy: RenderStrategy = {
    ...spheresStrategy,
    id: 'linear',
    estimator: { ...spheresStrategy.estimator, instanceAccel: 'linear' },
};
