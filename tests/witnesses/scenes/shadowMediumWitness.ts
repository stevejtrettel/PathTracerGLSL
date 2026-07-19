// witnesses/scenes/shadowMediumWitness.ts
// Regression witness for the shadow-ray-through-a-BOUNDED-medium bug (fixed by the
// shadow_transmittance light-POINT signature; docs/trace-loop-contract.md).
//
// THE BUG (was): shadow_media walked to the light on a decremented scalar `remaining` and
// re-spawned the ray (+EPSILON) at every null-interface crossing without subtracting that
// offset. After ≥2 crossings the accumulated drift exceeded the fixed 2·EPSILON light back-off,
// so the AREA LIGHT'S OWN surface fell inside `remaining`, was hit, and blocked the shadow ray →
// NEE went dark through any bounded medium (an SDF fog box blocked 100% of shadow rays). pt
// (emitter-hit, no shadow ray) stayed correct, so pt-nee read ~7% dark vs pt on emit-scatter.
//
// THE GATE: a bounded ABSORBING fog box (σ_s = 0, no emission) sits between a gray room and a
// ceiling quad light; every NEE shadow ray must cross the box boundary to reach the light.
// Absorbing (no phase scatter, no path-found glow) keeps pt low-variance, so nee ≡ pt is a
// TIGHT equality — the two independent estimators (shadow ray vs emitter-hit) must agree, and
// the pre-fix bug drove them ~orders apart. This isolates the shadow-vs-medium interaction from
// emit-scatter's emission+scattering.

import type { SceneDescription, RenderStrategy } from '../../../src/compiler/types.js';

export const shadowMediumScene: SceneDescription = {
    id: 'shadow-medium',
    name: 'NEE shadow ray through a bounded absorbing medium',
    ambientSpace: { type: 'euclidean' },
    objects: [
        { type: 'plane', parameters: { normal: [0, 1, 0], offset: 0.0 }, material: 'gray', name: 'floor' },
        { type: 'plane', parameters: { normal: [0, -1, 0], offset: 2.5 }, material: 'gray', name: 'ceiling' },
        { type: 'plane', parameters: { normal: [0, 0, 1], offset: 3.0 }, material: 'gray', name: 'backwall' },
        // Bounded absorbing fog (null-interface box). Its boundary is what the shadow ray must
        // cross to reach the quad — the crossing that used to drift the light back-off.
        { type: 'box', parameters: { center: [0, 1, -0.5], halfSize: [1, 1, 1] }, material: 'absfog', name: 'fogbox' },
    ],
    materials: {
        gray: { model: 'lambert', albedo: [0.6, 0.6, 0.6] },
        absfog: { model: 'none', medium: { sigma_a: [0.5, 0.5, 0.5], sigma_s: [0, 0, 0] } },
    },
    lights: [
        { kind: 'quad', corner: [-0.5, 2.48, -1.0], edge1: [1.0, 0.0, 0.0], edge2: [0.0, 0.0, 1.0], emission: 12.0 },
    ],
};

const base = {
    measurement: { camera: { type: 'pinhole' as const, fov: 0.9 }, maxBounces: 12 },
    view: { tonemap: { type: 'reinhard' as const } },
};

export const shadowMediumNeeStrategy: RenderStrategy = {
    ...base,
    id: 'pt-nee',
    estimator: { directLighting: 'nee', russianRoulette: { startDepth: 4 }, accumulation: { type: 'average' } },
};

export const shadowMediumPtStrategy: RenderStrategy = {
    ...base,
    id: 'pt',
    estimator: { directLighting: 'none', russianRoulette: { startDepth: 4 }, accumulation: { type: 'average' } },
};
