// demos/embersScene.ts — DEMO: the many-lights payoff at cloud scale (fable-light-bvh
// stage 2). TWO instanced batches in free space, no other light source anywhere:
//   embers — 3000 small emissive spheres (ONE light-eligible batch = 3000 tree lights;
//            the params placement records are the light rows, per-instance Φ ∝ r²),
//   rocks  — 2500 larger diffuse spheres lit ONLY by the embers (a non-eligible batch:
//            same machinery, no light identity — occluders and receivers).
// Selection at any rock's surface is dominated by the handful of embers nearby out of
// 3000 — exactly the regime the light tree exists for. Key 3 (plain pt, path-found
// glow) is the honest "before" picture.

import type { SceneDescription, RenderStrategy, Transform } from '../src/compiler/types.js';

function lcg(seed: number): () => number {
    let s = seed >>> 0;
    return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 0x100000000);
}

/** A flattened disk cloud: uniform areal density (r ∝ √u), height concentrated low. */
function diskCloud(count: number, seed: number, sMin: number, sMax: number): Transform[] {
    const rand = lcg(seed);
    const out: Transform[] = [];
    for (let i = 0; i < count; i++) {
        const r = 12 * Math.sqrt(rand());
        const th = 2 * Math.PI * rand();
        const y = 0.2 + 2.0 * Math.pow(rand(), 3);
        out.push({
            position: [r * Math.cos(th), y, r * Math.sin(th)],
            scale: sMin + (sMax - sMin) * rand(),
        });
    }
    return out;
}

export const embersScene: SceneDescription = {
    id: 'embers',
    name: 'Embers (3000 instance lights)',
    ambientSpace: { type: 'euclidean' },
    objects: [
        {
            kind: 'instanced',
            prototype: { type: 'sphere', parameters: { center: [0, 0, 0], radius: 0.06 }, material: 'ember' },
            placements: diskCloud(3000, 11, 0.5, 1.6),
            name: 'embers',
        },
        {
            kind: 'instanced',
            prototype: { type: 'sphere', parameters: { center: [0, 0, 0], radius: 0.2 }, material: 'rock' },
            placements: diskCloud(2500, 77, 0.5, 1.5),
            name: 'rocks',
        },
    ],
    materials: {
        ember: { model: 'lambert', albedo: [0, 0, 0], emission: [16, 7, 2.2] },
        rock: { model: 'lambert', albedo: [0.45, 0.42, 0.4] },
    },
    lights: [],
    environment: { type: 'none' },
};

const measurement = { camera: { type: 'pinhole' as const, fov: 0.9 }, maxBounces: 5 };
const view = { tonemap: { type: 'reinhard' as const } };

export const embersStrategy: RenderStrategy = {
    id: 'nee-bvh',
    measurement,
    estimator: { directLighting: 'nee', lightSelection: 'bvh', russianRoulette: { startDepth: 3 }, accumulation: { type: 'average' } },
    view,
};

export const embersMisStrategy: RenderStrategy = {
    id: 'mis-bvh',
    measurement,
    estimator: { directLighting: 'mis', lightSelection: 'bvh', russianRoulette: { startDepth: 3 }, accumulation: { type: 'average' } },
    view,
};

// The "before" picture: plain pt — 3000 glows found by chance bounces only.
export const embersPtStrategy: RenderStrategy = {
    id: 'pt',
    measurement,
    estimator: { directLighting: 'none', russianRoulette: { startDepth: 3 }, accumulation: { type: 'average' } },
    view,
};
