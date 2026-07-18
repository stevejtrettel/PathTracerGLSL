// tests/witnesses/scenes/mirrorWitness.ts
// F-MIRROR — the smooth-conductor delta witness (the mirror occupant's furnace):
// a convex mirror sphere floating in a constant samplable env L = 1. Convex ⇒ every
// camera ray reflects ONCE and escapes, so the sphere's center pixels read exactly
// F(cosθ≈1)·L = f0·L (Schlick's (1−cosθ)⁵ term is < 1e-9 across the center region);
// the rim rolls to F→1 (grazing) and blends into the sky — that gradient IS Schlick.
// pt-nee vs pt on the same fixture is the NEE-guard/delta-bookkeeping check: the
// mirror is pure delta, so NEE must contribute NOTHING (guard skips the shadow ray)
// and the miss-branch emission stays full-weight after the delta bounce — the two
// estimators must converge to the same near-deterministic image.
// RR OFF, tonemap NONE (on-screen radiance), same viewing geometry as furnace-sky.

import type { SceneDescription, RenderStrategy } from '../../../src/compiler/types.js';

export const mirrorScene: SceneDescription = {
    id: 'mirror',
    name: 'Mirror Sphere (F-MIRROR f0·L)',
    ambientSpace: { type: 'euclidean' },
    objects: [
        { type: 'sphere', parameters: { center: [0, 0, 0], radius: 1 }, material: 'chrome' },
    ],
    materials: {
        chrome: { model: 'mirror', f0: 0.5 },   // scalar broadcasts (§2.5)
    },
    lights: [],
    environment: { type: 'constant', color: [1, 1, 1], intensity: 1.0, sampleAsLight: true },
};

export const mirrorNeeStrategy: RenderStrategy = {
    id: 'pt-nee',
    measurement: {
        camera: { type: 'pinhole', fov: { param: 'camera.fov', default: 0.8, min: 0.3, max: 1.5 } },
        maxBounces: 4,
    },
    estimator: {
        directLighting: 'nee',
        russianRoulette: null,
        accumulation: { type: 'average' },
    },
    view: { tonemap: { type: 'none' } },   // §11 on-screen radiance: center reads 0.5 exactly
};

export const mirrorPtStrategy: RenderStrategy = {
    ...mirrorNeeStrategy,
    id: 'pt',
    estimator: { ...mirrorNeeStrategy.estimator, directLighting: 'none' },
};
