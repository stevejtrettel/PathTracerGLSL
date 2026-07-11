// compiler/scenes/mediaScenes.ts
// The media witnesses (impl-plan-media M1/M2; authority fable-volumetric-component.md):
//   slab            — F-SLAB (validation §2): exact Beer–Lambert through two null interfaces.
//                     Center pixel = e^{−σ_a·1} = (0.36788, 0.13534, 0.01832) ± 1%/channel.
//                     Catches null-BSDF leaks, double-attenuation (renders the SQUARE),
//                     spectral σ_a plumbing, current_medium across two null crossings.
//   fogcube         — R-FOGCUBE (validation §5, absorbing variant): a gray absorber cube over
//                     an emissive checker floor. The silhouette edge must show NO Fresnel-like
//                     rim (a rim = the null interface leaked a BSDF).
//   furnace-scatter — F-BOX-M (validation §1b): the furnace + chromatic anisotropic ambient
//                     haze. Still EXACTLY 0.4/channel — catches the channel-MIS weights, HG
//                     normalization, medium-event weights, bounce starvation.
//   haze            — the HG-sign witness (volumetric-component §7.4; replaces the unbuildable
//                     pt/pt-nee equality pair — delta lights are invisible to phase paths):
//                     {param}-driven phase_g; dragging g positive must brighten the halo
//                     AROUND the light direction (the audit's +2gc bug inverts it).

import type { SceneDescription, RenderStrategy } from '../types.js';

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
            kind: 'sdf',
            sdf: { type: 'plane', parameters: { normal: [0, 0, 1], offset: 2.0 } },
            material: 'screen',
        },
        // The ink slab: z ∈ [-1, 0], spanning the view (null interfaces — model 'none')
        {
            kind: 'sdf',
            sdf: { type: 'box', parameters: { center: [0, 0, -0.5], halfSize: [4, 4, 0.5] } },
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
    transport: {
        maxBounces: 4, // one surface event; null crossings don't consume bounces
        directLighting: 'none',
        russianRoulette: { enabled: false, startDepth: 0 }, // witness protocol: RR off
    },
    camera: { type: 'pinhole', fov: 0.6 },
    accumulation: { type: 'average' },
    display: { type: 'reinhard' },
};

// ---------------------------------------------------------------------------
// R-FOGCUBE (absorbing variant) — gray absorber cube floating over an emissive
// checker floor. Eyeball invariant: the cube dims the checker behind it with NO
// bright rim at the silhouette (any Fresnel-like edge = a leaked BSDF at the null
// interface). Grazing rays have near-zero path length through the cube, so the
// silhouette should fade smoothly to the background.
// ---------------------------------------------------------------------------

export const fogcubeScene: SceneDescription = {
    id: 'fogcube',
    name: 'R-FOGCUBE (null-interface rim witness)',
    ambientSpace: { type: 'euclidean' },
    objects: [
        // Emissive checker floor: solid below y = 0
        {
            kind: 'sdf',
            sdf: { type: 'plane', parameters: { normal: [0, 1, 0], offset: 0.0 } },
            material: 'floor',
        },
        // The absorber cube, floating
        {
            kind: 'sdf',
            sdf: { type: 'box', parameters: { center: [0, 1.0, 0], halfSize: [0.5, 0.5, 0.5] } },
            material: 'mist',
        },
    ],
    materials: {
        floor: {
            model: 'lambert',
            albedo: [0, 0, 0],
            emission: {
                kind: 'glsl',
                source: 'mix(vec3(0.15), vec3(1.0), mod(floor(p.x * 2.0) + floor(p.z * 2.0), 2.0))',
            },
        },
        mist: { model: 'none', medium: { sigma_a: [1.5, 1.5, 1.5] } },
    },
    lights: [],
};

export const fogcubeStrategy: RenderStrategy = {
    id: 'pathtracer',
    transport: {
        maxBounces: 6,
        directLighting: 'none',
        russianRoulette: { enabled: false, startDepth: 0 },
    },
    camera: { type: 'pinhole', fov: 0.8 },
    accumulation: { type: 'average' },
    display: { type: 'reinhard' },
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
        { kind: 'sdf', sdf: { type: 'plane', parameters: { normal: [1, 0, 0], offset: 1.0 } }, material: 'furnace' },
        { kind: 'sdf', sdf: { type: 'plane', parameters: { normal: [-1, 0, 0], offset: 1.0 } }, material: 'furnace' },
        { kind: 'sdf', sdf: { type: 'plane', parameters: { normal: [0, 1, 0], offset: 1.0 } }, material: 'furnace' },
        { kind: 'sdf', sdf: { type: 'plane', parameters: { normal: [0, -1, 0], offset: 1.0 } }, material: 'furnace' },
        { kind: 'sdf', sdf: { type: 'plane', parameters: { normal: [0, 0, 1], offset: 1.0 } }, material: 'furnace' },
        { kind: 'sdf', sdf: { type: 'plane', parameters: { normal: [0, 0, -1], offset: 1.0 } }, material: 'furnace' },
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
    transport: {
        maxBounces: 48, // medium events count (§7.2); truncation shows as mean < 0.4
        directLighting: 'none',
        russianRoulette: { enabled: false, startDepth: 0 }, // witness protocol: RR off
        volumeIntegrator: 'analytic', // explicit (derived would say the same)
    },
    camera: { type: 'pinhole', fov: 1.0 },
    accumulation: { type: 'average' },
    display: { type: 'reinhard' },
};

// ---------------------------------------------------------------------------
// haze — the HG-sign witness + medium-NEE/shadow_media summoning scene. A gray room
// filled with ambient haze; a point light near the ceiling drives medium-NEE (light
// shafts, hg_eval); a small emissive panel gives the NEE-less strategy (key 2)
// something phase/BSDF paths can find (delta lights are invisible to them — that's
// WHY the pt/pt-nee equality witness needs area lights, X-FOG, deferred).
// phase_g is {param}-driven: drag haze.g — positive g must brighten the glow around
// the light direction (forward scattering), negative must dim it. The audit-caught
// +2gc sign bug INVERTS this. Spike-noise halos near the light are EXPECTED
// (Kulla–Fajardo: distance sampling is poor for point lights in media; equiangular
// placement is the deferred fix).
// ---------------------------------------------------------------------------

export const hazeScene: SceneDescription = {
    id: 'haze',
    name: 'Haze (HG-sign witness, light shafts)',
    ambientSpace: { type: 'euclidean' },
    objects: [
        { kind: 'sdf', sdf: { type: 'plane', parameters: { normal: [0, 1, 0], offset: 0.0 } }, material: 'gray' },
        { kind: 'sdf', sdf: { type: 'plane', parameters: { normal: [0, -1, 0], offset: 2.5 } }, material: 'gray' },
        { kind: 'sdf', sdf: { type: 'plane', parameters: { normal: [0, 0, 1], offset: 2.5 } }, material: 'gray' },
        { kind: 'sdf', sdf: { type: 'plane', parameters: { normal: [1, 0, 0], offset: 2.5 } }, material: 'gray' },
        { kind: 'sdf', sdf: { type: 'plane', parameters: { normal: [-1, 0, 0], offset: 2.5 } }, material: 'gray' },
        { kind: 'sdf', sdf: { type: 'plane', parameters: { normal: [0, 0, -1], offset: 6.0 } }, material: 'gray' },
        // Small emissive panel on the back wall — the path-only emitter key 2 can see.
        {
            kind: 'sdf',
            sdf: { type: 'box', parameters: { center: [-1.2, 1.2, -2.4], halfSize: [0.4, 0.4, 0.05] } },
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
    lights: [{ kind: 'point', position: [0.8, 2.2, -1.0], intensity: 10.0, color: [1.0, 1.0, 1.0] }],
    ambientMedium: 'fog',
};

// Key 1: medium NEE + hg_eval + shadow_media (the shafts). Key 2: phase/BSDF transport
// only — sees the panel through the fog, not the point light. Key 1 ≥ key 2 everywhere
// by exactly the delta-light term.
export const hazeNeeStrategy: RenderStrategy = {
    id: 'pt-nee',
    transport: {
        maxBounces: 24,
        directLighting: 'nee',
        russianRoulette: { enabled: true, startDepth: 4 },
        volumeIntegrator: 'analytic',
    },
    camera: { type: 'pinhole', fov: 0.9 },
    accumulation: { type: 'average' },
    display: { type: 'reinhard' },
};

export const hazePtStrategy: RenderStrategy = {
    id: 'pt',
    transport: {
        maxBounces: 24,
        directLighting: 'none',
        russianRoulette: { enabled: true, startDepth: 4 },
        volumeIntegrator: 'analytic',
    },
    camera: { type: 'pinhole', fov: 0.9 },
    accumulation: { type: 'average' },
    display: { type: 'reinhard' },
};
