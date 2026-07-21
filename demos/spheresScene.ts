// demos/spheresScene.ts — an instancing stress/showcase (impl-plan-instancing +
// fable-instance-attributes): 500 spheres of varied size, position, AND COLOR, all from one
// analytic-sphere prototype + a 500-entry placement texture + a 500-entry per-instance albedo
// table (the fourth storage class — one region, ONE material, Hit.element picks the color).
// One point light, on a floor. Keys 1/2 = tlas/linear (same image, cost A/B).

import type { SceneDescription, RenderStrategy, Transform } from '../src/compiler/types.js';
import { instance } from '../src/authoring/instance.js';

/** hue [0,1) → pastel-ish RGB (fixed s/v — variation reads as one palette, not noise). */
function hueRGB(h: number, s: number, v: number): [number, number, number] {
    const f = (n: number) => {
        const k = (n + h * 6) % 6;
        return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
    };
    return [f(5), f(3), f(1)];
}

/** `count` spheres scattered in a box volume: random position + uniform scale + a palette
 *  color per instance, all from ONE seeded stream (reproducible; arrays stay parallel). */
function sphereCloud(count: number, seed: number): { placements: Transform[]; albedos: [number, number, number][] } {
    let s = seed >>> 0;
    const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    const placements: Transform[] = [];
    const albedos: [number, number, number][] = [];
    for (let i = 0; i < count; i++) {
        placements.push({
            position: [(rnd() * 2 - 1) * 4.5, 0.5 + rnd() * 4.0, (rnd() * 2 - 1) * 4.5],
            scale: 0.35 + rnd() * 0.75,
        });
        albedos.push(hueRGB(rnd(), 0.45 + rnd() * 0.3, 0.8));
    }
    return { placements, albedos };
}

const cloud = sphereCloud(500, 12345);

export const spheresScene: SceneDescription = {
    id: 'spheres',
    name: '500 Instanced Spheres',
    ambientSpace: { type: 'euclidean' },
    objects: [
        { type: 'quad', parameters: { corner: [-12, 0, -12], edge1: [0, 0, 24], edge2: [24, 0, 0] }, material: 'floor' },
        // 500 spheres from ONE prototype + a placement texture + a per-instance albedo
        // table — the whole cloud is one batch with ONE material.
        instance(
            { type: 'sphere', parameters: { radius: 1.0 }, material: 'orb' },
            cloud.placements,
            { name: 'cloud', attributes: { albedo: cloud.albedos } },
        ),
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
