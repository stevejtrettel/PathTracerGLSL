// witnesses/scenes/mediaWitness.ts
// The media witness fixtures (impl-plan-media M1/M2; authority fable-volumetric-component.md):
//   slab            — F-SLAB (validation §2): exact Beer–Lambert through two null interfaces.
//                     Center pixel = e^{−σ_a·1} = (0.36788, 0.13534, 0.01832) ± 1%/channel.
//                     Catches null-BSDF leaks, double-attenuation (renders the SQUARE),
//                     spectral σ_a plumbing, current_medium across two null crossings.
//   furnace-scatter — F-BOX-M (validation §1b): the furnace + chromatic anisotropic ambient
//                     haze. Still EXACTLY 0.4/channel — catches the channel-MIS weights, HG
//                     normalization, medium-event weights, bounce starvation.
//   haze            — the HG-sign witness + the equiangular placement pair (§11.2 equality;
//                     medium NEE, shadow_media shafts, {param}-driven phase_g).
// (R-FOGCUBE, the eyeball-only sibling, stays in compiler/scenes/mediaScenes.ts.)

import type { SceneDescription, RenderStrategy } from '../../../src/compiler/types.js';

// ---------------------------------------------------------------------------
// F-SLAB — emissive backwall, absorbing-only ink slab (null interfaces), camera
// looking through perpendicular: path length through the slab is exactly 1.
// Derivation (validation §2): 1.0 · e^{−σ_a·1}, σ_a = (1, 2, 4).
// ---------------------------------------------------------------------------

export const slabScene: SceneDescription = {
    id: 'slab',
    name: 'F-SLAB (Beer–Lambert witness)',
    ambientSpace: { type: 'euclidean' },
    objects: [
        // Emissive backdrop: solid below z = -2 (sdf = p.z + 2)
        {
            type: 'plane', parameters: { normal: [0, 0, 1], offset: 2.0 },
            material: 'screen',
        },
        // The ink slab: z ∈ [-1, 0], spanning the view (null interfaces — model 'none')
        {
            type: 'box', parameters: { center: [0, 0, -0.5], halfSize: [4, 4, 0.5] },
            material: 'ink',
        },
    ],
    materials: {
        screen: { model: 'lambert', albedo: [0, 0, 0], emission: [1.0, 1.0, 1.0] },
        ink: { model: 'none', medium: { sigma_a: [1.0, 2.0, 4.0] } },
    },
    lights: [], // emission only; NEE off (M1 has no spectral shadow query anyway)
};

export const slabStrategy: RenderStrategy = {
    id: 'pathtracer',
    measurement: {
        camera: { type: 'pinhole', fov: 0.6 },
        maxBounces: 4, // one surface event; null crossings don't consume bounces
    },
    estimator: {
        directLighting: 'none',
        russianRoulette: null, // witness protocol: RR off
        accumulation: { type: 'average' },
    },
    view: { tonemap: { type: 'reinhard' } },
};

// ---------------------------------------------------------------------------
// F-BOX-M — the chromatic scattering furnace (validation §1b). The F-BOX furnace
// plus a NON-ABSORBING, chromatic, anisotropic ambient haze. A non-absorbing medium
// preserves the uniform equilibrium field per channel at ANY σ_s and ANY g, so the
// expected value is UNCHANGED: exactly (0.4, 0.4, 0.4), ± 0.004/channel at high spp.
// Scattering lengthens paths — maxBounces 48 (a low mean = bounce starvation, raise it).
// ---------------------------------------------------------------------------

export const furnaceScatterScene: SceneDescription = {
    id: 'furnace-scatter',
    name: 'Furnace + Haze (F-BOX-M)',
    ambientSpace: { type: 'euclidean' },
    objects: [
        { type: 'plane', parameters: { normal: [1, 0, 0], offset: 1.0 }, material: 'furnace' },
        { type: 'plane', parameters: { normal: [-1, 0, 0], offset: 1.0 }, material: 'furnace' },
        { type: 'plane', parameters: { normal: [0, 1, 0], offset: 1.0 }, material: 'furnace' },
        { type: 'plane', parameters: { normal: [0, -1, 0], offset: 1.0 }, material: 'furnace' },
        { type: 'plane', parameters: { normal: [0, 0, 1], offset: 1.0 }, material: 'furnace' },
        { type: 'plane', parameters: { normal: [0, 0, -1], offset: 1.0 }, material: 'furnace' },
    ],
    materials: {
        furnace: { model: 'lambert', albedo: [0.5, 0.5, 0.5], emission: [0.2, 0.2, 0.2] },
        haze: { model: 'none', medium: { sigma_a: 0, sigma_s: [0.5, 1.0, 2.0], phase_g: 0.7 } },
    },
    lights: [],
    environment: { type: 'none' },
    ambientMedium: 'haze',
};

export const furnaceScatterStrategy: RenderStrategy = {
    id: 'furnace-scatter',
    measurement: {
        camera: { type: 'pinhole', fov: 1.0 },
        maxBounces: 48, // medium events count (§7.2); truncation shows as mean < 0.4
    },
    estimator: {
        directLighting: 'none',
        russianRoulette: null, // witness protocol: RR off
        volumeSampling: 'analytic', // explicit (derived would say the same)
        accumulation: { type: 'average' },
    },
    view: { tonemap: { type: 'reinhard' } },
};

// ---------------------------------------------------------------------------
// haze — the HG-sign witness + medium-NEE/shadow_media summoning scene. A gray room
// filled with ambient haze; a point light near the ceiling drives medium-NEE (light
// shafts, hg_eval); a small emissive panel gives the NEE-less strategy (key 3)
// something phase/BSDF paths can find (delta lights are invisible to them).
// phase_g is {param}-driven: drag haze.g — positive g must brighten the glow around
// the light direction (forward scattering), negative must dim it. The audit-caught
// +2gc sign bug INVERTS this.
// ---------------------------------------------------------------------------

export const hazeScene: SceneDescription = {
    id: 'haze',
    name: 'Haze (HG-sign witness, light shafts)',
    ambientSpace: { type: 'euclidean' },
    objects: [
        { type: 'plane', parameters: { normal: [0, 1, 0], offset: 0.0 }, material: 'gray' },
        { type: 'plane', parameters: { normal: [0, -1, 0], offset: 2.5 }, material: 'gray' },
        { type: 'plane', parameters: { normal: [0, 0, 1], offset: 2.5 }, material: 'gray' },
        { type: 'plane', parameters: { normal: [1, 0, 0], offset: 2.5 }, material: 'gray' },
        { type: 'plane', parameters: { normal: [-1, 0, 0], offset: 2.5 }, material: 'gray' },
        { type: 'plane', parameters: { normal: [0, 0, -1], offset: 6.0 }, material: 'gray' },
        // Small emissive panel on the back wall — the path-only emitter key 3 can see.
        {
            type: 'box', parameters: { center: [-1.2, 1.2, -2.4], halfSize: [0.4, 0.4, 0.05] },
            material: 'panel',
        },
    ],
    materials: {
        gray: { model: 'lambert', albedo: [0.5, 0.5, 0.5] },
        panel: { model: 'lambert', albedo: [0, 0, 0], emission: [4.0, 4.0, 4.0] },
        fog: {
            model: 'none',
            medium: {
                sigma_a: [0.02, 0.02, 0.02],
                sigma_s: [0.4, 0.4, 0.4],
                phase_g: { param: 'haze.g', default: 0.7, min: -0.95, max: 0.95 },
            },
        },
    },
    lights: [{ kind: 'point', position: [0.8, 2.2, -1.0], emission: 10 }],
    ambientMedium: 'fog',
};

// Key 1: medium NEE + hg_eval + shadow_media (the shafts). Key 3: phase/BSDF transport
// only — sees the panel through the fog, not the point light. Key 1 ≥ key 3 everywhere
// by exactly the delta-light term.
export const hazeNeeStrategy: RenderStrategy = {
    id: 'pt-nee',
    measurement: {
        camera: { type: 'pinhole', fov: 0.9 },
        maxBounces: 24,
    },
    estimator: {
        directLighting: 'nee',
        russianRoulette: { startDepth: 4 },
        volumeSampling: 'analytic',
        accumulation: { type: 'average' },
    },
    view: { tonemap: { type: 'reinhard' } },
};

// The equiangular placement pair (impl-plan-equiangular): same integral, same NEE
// partition — ONLY the medium vertex placement differs (per-segment, ∝ 1/d²-to-light).
// Converged equality with pt-nee is the §11.2 witness; the visible win is the lamp
// halo losing its spike noise.
export const hazeEquiangularStrategy: RenderStrategy = {
    ...hazeNeeStrategy,
    id: 'pt-nee-eq',
    estimator: { ...hazeNeeStrategy.estimator, mediumLightSampling: 'equiangular' },
};

export const hazePtStrategy: RenderStrategy = {
    id: 'pt',
    measurement: {
        camera: { type: 'pinhole', fov: 0.9 },
        maxBounces: 24,
    },
    estimator: {
        directLighting: 'none',
        russianRoulette: { startDepth: 4 },
        volumeSampling: 'analytic',
        accumulation: { type: 'average' },
    },
    view: { tonemap: { type: 'reinhard' } },
};
