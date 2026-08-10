// tests/witnesses/scenes/directionalBeamWitness.ts
// The delta-direction light class witnesses (impl-plan-directional-beam §4).
//
//   sun       — F-SUN: tilted directional light on a lambert floor. The tilt is the
//               point: E is authored ⊥ to the propagation direction and the BSDF's
//               cosine supplies obliquity, so the floor reads
//                   L = ρ·E·cosθ/π = 0.5·1·0.8/π = 0.4/π ≈ 0.12732
//               everywhere (no occluders, no env, no indirect off an empty sky).
//               A missing-cosine bug reads 0.15915; any 1/d²-style fold reads ~0.
//   beam-wall — F-BEAM: beam ⊥ wall through vacuum, camera framed inside the spot.
//               Inside the disk L = ρ·E/π = 0.5·2/π ≈ 0.31831; outside the forward
//               cylinder EXACTLY 0 (pdf-0 invalid sample; delta → no chance hits).
//   beam-slab — F-BEAM-T: beam-wall with an absorbing ink slab (null interfaces)
//               across the beam, BEHIND the camera's view rays: only the SHADOW rays
//               cross it, and collimation makes every crossing exactly the slab
//               thickness 0.2, so the spot reads the F-SLAB triple scaled:
//                   L_c = ρ·E·e^{−σ_a,c·0.2}/π,  σ_a = (5,10,20)
//                       = 0.31831·(0.36788, 0.13534, 0.01832)
//                       = (0.117109, 0.043081, 0.005831)
//               — the walker-supplied beam transmittance with zero scattering confound.
//   beam-fog  — X-BEAM: THE visible-beam shot — beam crossing a bounded g=0 fog cube,
//               side view, terminating on a backwall. pt-nee ≡ pt-mis equality gates
//               the MIS bookkeeping over the new delta kind (weight 1 by LIGHT_DELTA);
//               the beam itself is lit by medium-vertex NEE landing inside the
//               cylinder — no new machinery. v1 noise ceiling declared (plan P7).
//
// Witness protocol: RR off; tonemap none where a number is read off screen.

import type { SceneDescription, RenderStrategy } from '../../../src/compiler/types.js';

// ---------------------------------------------------------------------------
// F-SUN — tilted directional light, infinite lambert floor.
// ---------------------------------------------------------------------------

export const sunScene: SceneDescription = {
    id: 'sun',
    name: 'Sun (F-SUN ρ·E·cosθ/π)',
    ambientSpace: { type: 'euclidean' },
    objects: [
        { type: 'plane', parameters: { normal: [0, 1, 0], offset: 0 }, material: 'floor' },
        // The occluder: a sphere casting the HARD PARALLEL shadow that is the
        // distant-light signature (a flat gray frame gates the same number but shows
        // nothing). Placed upper-right so the frame CENTER stays clean floor — the
        // gate region; its bounce contamination there is ~1e-3 (inside the tolerance).
        { type: 'sphere', parameters: { center: [1.4, 0.5, -1.6], radius: 0.5 }, material: 'clay', name: 'clay_ball' },
    ],
    materials: {
        floor: { model: 'lambert', albedo: [0.5, 0.5, 0.5] },
        clay: { model: 'lambert', albedo: [0.7, 0.35, 0.2] },
    },
    lights: [
        // (0.6, -0.8, 0) is exactly unit: cosθ against the floor normal = 0.8.
        { kind: 'directional', direction: [0.6, -0.8, 0], emission: 1 },
    ],
};

export const sunNeeStrategy: RenderStrategy = {
    id: 'pt-nee',
    measurement: {
        camera: { type: 'pinhole', fov: 0.8 },
        maxBounces: 4,
    },
    estimator: {
        directLighting: 'nee',
        russianRoulette: null,
        accumulation: { type: 'average' },
    },
    view: { tonemap: { type: 'none' } },   // on-screen radiance reads 0.4/π
};

// ---------------------------------------------------------------------------
// F-BEAM / F-BEAM-T — beam ⊥ wall; the slab variant adds the ink across the
// shadow path only (slab z ∈ [1.4, 1.6]; camera at z = 1.2 sees the wall through
// vacuum, aperture at z = 2 is behind the slab).
// ---------------------------------------------------------------------------

export const beamWallScene: SceneDescription = {
    id: 'beam-wall',
    name: 'Beam Wall (F-BEAM ρ·E/π)',
    ambientSpace: { type: 'euclidean' },
    objects: [
        { type: 'plane', parameters: { normal: [0, 0, 1], offset: 0 }, material: 'wall' },
    ],
    materials: {
        wall: { model: 'lambert', albedo: [0.5, 0.5, 0.5] },
    },
    lights: [
        { kind: 'beam', position: [0, 0, 2], direction: [0, 0, -1], radius: 0.5, emission: 2 },
    ],
};

export const beamSlabScene: SceneDescription = {
    id: 'beam-slab',
    name: 'Beam through Ink (F-BEAM-T)',
    ambientSpace: { type: 'euclidean' },
    objects: [
        { type: 'plane', parameters: { normal: [0, 0, 1], offset: 0 }, material: 'wall' },
        // The ink slab spans the beam; view rays (camera z=1.2 → wall z=0) never cross it.
        { type: 'box', parameters: { center: [0, 0, 1.5], halfSize: [4, 4, 0.1] }, material: 'ink' },
    ],
    materials: {
        wall: { model: 'lambert', albedo: [0.5, 0.5, 0.5] },
        ink: { model: 'none', medium: { sigma_a: [5.0, 10.0, 20.0] } },
    },
    lights: [
        { kind: 'beam', position: [0, 0, 2], direction: [0, 0, -1], radius: 0.5, emission: 2 },
    ],
};

export const beamNeeStrategy: RenderStrategy = {
    id: 'pt-nee',
    measurement: {
        camera: { type: 'pinhole', fov: 0.8 },
        maxBounces: 4,
    },
    estimator: {
        directLighting: 'nee',
        russianRoulette: null,
        accumulation: { type: 'average' },
    },
    view: { tonemap: { type: 'none' } },   // hotspot reads ρ·E/π (× the slab triple)
};

// ---------------------------------------------------------------------------
// X-BEAM — the visible beam: bounded isotropic fog cube, beam crossing it
// horizontally onto a backwall, camera side-on. Black surround makes the shaft
// the only structure; the wall spot glows at s = 4.7 through 2 units of fog.
// ---------------------------------------------------------------------------

export const beamFogScene: SceneDescription = {
    id: 'beam-fog',
    name: 'Laser in Fog (X-BEAM)',
    ambientSpace: { type: 'euclidean' },
    objects: [
        { type: 'box', parameters: { center: [0, 0, 0], halfSize: [1, 1, 1] }, material: 'fog' },
        { type: 'plane', parameters: { normal: [-1, 0, 0], offset: 2.2 }, material: 'backwall' },
    ],
    materials: {
        fog: { model: 'none', medium: { sigma_a: 0, sigma_s: 0.4, phase_g: 0.0 } },
        backwall: { model: 'lambert', albedo: [0.5, 0.5, 0.5] },
    },
    lights: [
        { kind: 'beam', position: [-2.5, 0, 0], direction: [1, 0, 0], radius: 0.15, emission: 30 },
    ],
};

const beamFogBase: Omit<RenderStrategy, 'id' | 'estimator'> = {
    measurement: {
        camera: { type: 'pinhole', fov: 0.8 },
        maxBounces: 8,   // medium events count (§7.2); fog is single-scatter dominated at σ_s 0.4
    },
    view: { tonemap: { type: 'reinhard' } },
};

export const beamFogNeeStrategy: RenderStrategy = {
    id: 'pt-nee',
    ...beamFogBase,
    estimator: {
        directLighting: 'nee',
        russianRoulette: null,
        accumulation: { type: 'average' },
    },
};

export const beamFogMisStrategy: RenderStrategy = {
    id: 'pt-mis',
    ...beamFogBase,
    estimator: {
        directLighting: 'mis',
        russianRoulette: null,
        accumulation: { type: 'average' },
    },
};
