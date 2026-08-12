// demos/gyroidFieldScene.ts — 100 INSTANCED GYROIDS.
//
// The payoff scene for the whole SDF-contract arc: a SCENE-LOCAL field (defineSDF,
// zero registry ceremony) used as an INSTANCE PROTOTYPE — one prototype × 100
// frame-tier placement records, a batch TLAS over the instance world boxes, and the
// generated `gyroid_sdf_intersect` as the leaf body. A ray prunes the field of 100
// down to the few boxes it enters and marches only those intervals; the shape's
// declared sphere bound (rotation-invariant — free tightness under every placement)
// is what makes each leaf interval honest.

import type { SceneDescription, RenderStrategy, Transform } from '../src/compiler/types.js';
import { gyroid } from './customFieldsScene.js';

function lcg(seed: number): () => number {
    let s = seed >>> 0;
    return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 0x100000000);
}

const rand = lcg(20260811);
const placements: Transform[] = [];
// A loose ground-hugging drift of lattice balls: three size classes on a spiral
// scatter, denser near the middle, every one rotated so the lattice axes never align.
for (let i = 0; i < 100; i++) {
    const a = i * 2.399963;                        // golden-angle spiral
    const r = 0.9 + 7.5 * Math.sqrt(i / 100);
    const s = 0.55 + rand() * 1.1;
    placements.push({
        position: [r * Math.cos(a), 0.45 * s + rand() * 0.25, r * Math.sin(a)],
        rotation: { axis: [rand() - 0.5, 1, rand() - 0.5], angle: rand() * Math.PI },
        scale: s,
    });
}

export const gyroidFieldScene: SceneDescription = {
    id: 'gyroid-field',
    name: 'Gyroid field (100 instanced scene-local lattices)',
    ambientSpace: { type: 'euclidean' },
    objects: [
        {
            type: 'plane',
            name: 'ground',
            parameters: { normal: [0, 1, 0], offset: 0 },
            material: 'floor',
        },
        {
            kind: 'instanced',
            prototype: { type: gyroid, parameters: { radius: 0.45, cell: 0.3, thickness: 0.002 }, material: 'bronze' },
            placements,
            name: 'lattices',
        },
    ],
    materials: {
        floor: { model: 'lambert', albedo: [0.4, 0.39, 0.37] },
        bronze: { model: 'ggx', f0: [0.85, 0.6, 0.34], roughness: 0.32 },
    },
    lights: [
        {
            kind: 'quad',
            corner: [-3.5, 7.0, -3.5], edge1: [7, 0, 0], edge2: [0, 0, 7],
            emission: 7,
        },
        { kind: 'sphere', position: [9, 3.5, -6], radius: 0.8, emission: [4.5, 3.2, 2.0] },
    ],
    environment: { type: 'constant', color: [0.14, 0.16, 0.2], intensity: 1.0 },
};

export const gyroidFieldStrategy: RenderStrategy = {
    id: 'pathtracer',
    measurement: {
        camera: { type: 'pinhole', fov: 0.9 },
        maxBounces: 6,
    },
    estimator: {
        directLighting: 'mis',
        russianRoulette: { startDepth: 3 },
        accumulation: { type: 'average' },
    },
    view: { tonemap: { type: 'agx' } },
};
