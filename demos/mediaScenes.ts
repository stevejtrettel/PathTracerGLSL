// demos/mediaScenes.ts
// R-FOGCUBE (validation §5, absorbing variant): a gray absorber cube over an emissive
// checker floor. The silhouette edge must show NO Fresnel-like rim (a rim = the null
// interface leaked a BSDF). Eyeball-only — the numeric media witnesses (F-SLAB,
// F-BOX-M, haze) live in src/witnesses/scenes/mediaWitness.ts.

import type { SceneDescription, RenderStrategy } from '../src/compiler/types.js';
import { cornellBox } from '../tests/witnesses/scenes/cornellBox.js';

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
            type: 'plane', parameters: { normal: [0, 1, 0], offset: 0.0 },
            material: 'floor',
        },
        // The absorber cube, floating
        {
            type: 'box', parameters: { center: [0, 1.0, 0], halfSize: [0.5, 0.5, 0.5] },
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
    measurement: {
        camera: { type: 'pinhole', fov: 0.8 },
        maxBounces: 6,
    },
    estimator: {
        directLighting: 'none',
        russianRoulette: null,
        accumulation: { type: 'average' },
    },
    view: { tonemap: { type: 'reinhard' } },
};

// ---------------------------------------------------------------------------
// Two scattering fog boxes over the emissive checker — LEFT rayleigh, RIGHT hg —
// exercising the multi-model medium dispatch (interaction_medium_* over mp.model). The
// rayleigh box has a wavelength-shaped σ_s (more blue) so it scatters a cool haze; the hg
// box is forward-scattering neutral. Same extinction otherwise. (glslang coverage for
// the rayleigh occupant + the 2-arm dispatch; the look is the owner's GPU check.)
// ---------------------------------------------------------------------------

export const rayleighScene: SceneDescription = {
    id: 'rayleigh',
    name: 'Volume scattering models: rayleigh · hg',
    ambientSpace: { type: 'euclidean' },
    objects: [
        {
            type: 'plane', parameters: { normal: [0, 1, 0], offset: 0.0 },
            material: 'floor',
        },
        {
            type: 'box', parameters: { center: [-0.65, 1.0, 0], halfSize: [0.45, 0.45, 0.45] },
            material: 'rayleigh_fog',
        },
        {
            type: 'box', parameters: { center: [0.65, 1.0, 0], halfSize: [0.45, 0.45, 0.45] },
            material: 'hg_fog',
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
        // Rayleigh: λ⁻⁴ color lives in σ_s (bluer), not the (parameter-free) phase.
        rayleigh_fog: { model: 'none', medium: { sigma_a: [0.1, 0.1, 0.1], sigma_s: [0.7, 1.0, 1.6], model: 'rayleigh' } },
        // HG: neutral σ_s, forward-scattering (g = 0.6).
        hg_fog: { model: 'none', medium: { sigma_a: [0.1, 0.1, 0.1], sigma_s: [1.1, 1.1, 1.1], model: 'hg', phase_g: 0.6 } },
    },
    lights: [],
};

export const rayleighStrategy: RenderStrategy = {
    id: 'pathtracer',
    measurement: { camera: { type: 'pinhole', fov: 0.8 }, maxBounces: 8 },
    estimator: { directLighting: 'none', russianRoulette: { startDepth: 4 }, accumulation: { type: 'average' } },
    view: { tonemap: { type: 'reinhard' } },
};

// ---------------------------------------------------------------------------
// groundfog — the heterogeneous-media PLAYGROUND (fable-heterogeneous-media.md).
// This card exists to be EDITED: the fog is a formula of position `p` plus two
// declared sliders, running on the delta-tracking arms. Change the source string,
// reload, drag the sliders — density and falloff move live (zero recompiles), and
// the majorant ceiling (D1) means no slider position or formula spike can break
// correctness: the field saturates at σ̄ instead.
//   σ_s(p) = gain · exp(−falloff · p.y) · (0.6 + 0.4·sin(2x)·sin(2z))
// — exponential ground fog with a gentle patchiness swirl. Ideas to try: swap the
// sin-product for mod() bands; make it a vec3 for colored fog; add a third slider.
// Keep majorant ≥ the biggest value your formula (× slider max) can reach where
// rays travel — a too-small ceiling doesn't break anything, it just flattens peaks.
// ---------------------------------------------------------------------------

export const groundfogScene: SceneDescription = {
    id: 'groundfog',
    name: 'Ground Fog (heterogeneous playground)',
    ambientSpace: { type: 'euclidean' },
    objects: [
        { type: 'plane', parameters: { normal: [0, 1, 0], offset: 0.0 }, material: 'floor', name: 'floor' },
        { type: 'sphere', parameters: { center: [-1.2, 0.7, 0], radius: 0.7 }, material: 'chrome', name: 'orb' },
        { type: 'box', parameters: { center: [0.9, 0.75, -0.9], halfSize: [0.5, 0.75, 0.5] }, material: 'red', name: 'pillar' },
        { type: 'sphere', parameters: { center: [0.6, 0.35, 1.1], radius: 0.35 }, material: 'clay', name: 'pebble' },
    ],
    materials: {
        floor: { model: 'lambert', albedo: [0.45, 0.45, 0.45] },
        chrome: { model: 'mirror', f0: [0.9, 0.9, 0.9] },
        red: { model: 'lambert', albedo: [0.6, 0.15, 0.12] },
        clay: { model: 'lambert', albedo: [0.55, 0.45, 0.35] },
        fog: {
            model: 'none',
            medium: {
                sigma_a: [0.01, 0.01, 0.01],
                sigma_s: {
                    kind: 'glsl',
                    source: 'u_fog_gain * exp(-u_fog_falloff * p.y) * (0.6 + 0.4 * sin(2.0 * p.x) * sin(2.0 * p.z))',
                    params: [
                        { param: 'fog.gain', default: 1.2, min: 0.0, max: 4.0 },
                        { param: 'fog.falloff', default: 1.5, min: 0.0, max: 5.0 },
                    ],
                },
                majorant: 4.2,   // ≥ gain_max · 1.0 at y = 0 — the D1 ceiling
                phase_g: 0.4,
            },
        },
    },
    lights: [{ kind: 'point', position: [1.5, 3.2, 1.5], emission: 25 }],
    ambientMedium: 'fog',
};

export const groundfogStrategy: RenderStrategy = {
    id: 'pt-nee-het',
    measurement: { camera: { type: 'pinhole', fov: 0.9 }, maxBounces: 24 },
    estimator: {
        directLighting: 'nee',
        volumeSampling: 'delta-tracking',
        russianRoulette: { startDepth: 4 },
        accumulation: { type: 'average' },
    },
    view: { tonemap: { type: 'reinhard' } },
};

// ---------------------------------------------------------------------------
// fogblobs — MATHEMATICAL DENSITY FIELDS in a Cornell room (the blob demo).
// The medium is a sum of smooth fields, one term per shape — the metaball idea
// applied to DENSITY instead of a surface. Starting form: TWO nearby Gaussians,
//   density(p) = gain · ( exp(−sharp·|p − c₁|²) + exp(−sharp·|p − c₂|²) )
// Terms ADD, so the blobs merge smoothly where they overlap: drag `sharp` down and
// they fuse into one form, up and they separate into crisp puffs. Sculpt by editing
// the source — move centers, add terms (any distance field d(p) works as
// exp(−sharp·d²): rings, segments, curves), or go vec3 for colored fog.
// The ceiling quad drives NEE through the blobs — self-shadowing via ratio-tracked
// shadow segments; the delta-tracking arm renders the volume itself.
// Majorant 8.2 bounds the field at typical slider positions; extreme corner cases
// (max gain × fully fused blobs ≈ 10.8) saturate against the D1 ceiling — flattened
// peaks, never misrendering.
// ---------------------------------------------------------------------------

export const fogblobsScene: SceneDescription = {
    ...cornellBox,
    id: 'fogblobs',
    name: 'Fog Blobs (mathematical density field)',
    // Walls only — the blobs are the subject.
    objects: cornellBox.objects.filter((o) => 'type' in o && o.type === 'plane'),
    materials: {
        white: { model: 'lambert', albedo: [0.73, 0.73, 0.73] },
        red: { model: 'lambert', albedo: [0.65, 0.05, 0.05] },
        green: { model: 'lambert', albedo: [0.12, 0.45, 0.15] },
        fog: {
            model: 'none',
            medium: {
                sigma_a: [0.02, 0.02, 0.02],
                sigma_s: {
                    kind: 'glsl',
                    // Two Gaussians close enough to merge at low sharpness — drag
                    // blob.sharp down and they fuse into one form, up and they separate.
                    source: 'u_blob_gain * ('
                        + 'exp(-u_blob_sharp * dot(p - vec3(-0.35, 1.1, -0.5), p - vec3(-0.35, 1.1, -0.5)))'
                        + ' + exp(-u_blob_sharp * dot(p - vec3(0.35, 0.9, -0.5), p - vec3(0.35, 0.9, -0.5)))'
                        + ')',
                    params: [
                        { param: 'blob.gain', default: 6.0, min: 0.0, max: 8.0 },
                        { param: 'blob.sharp', default: 14.0, min: 2.0, max: 40.0 },
                    ],
                },
                majorant: 8.2,
                phase_g: 0.3,
            },
        },
    },
    lights: [
        {
            kind: 'quad',
            corner: [-0.5, 1.98, -0.5],
            edge1: [1.0, 0.0, 0.0],
            edge2: [0.0, 0.0, 1.0],
            emission: 15.0,
        },
    ],
    ambientMedium: 'fog',
};

export const fogblobsStrategy: RenderStrategy = {
    id: 'pt-nee-het',
    measurement: { camera: { type: 'pinhole', fov: 0.9 }, maxBounces: 24 },
    estimator: {
        directLighting: 'nee',
        volumeSampling: 'delta-tracking',
        russianRoulette: { startDepth: 4 },
        accumulation: { type: 'average' },
    },
    view: { tonemap: { type: 'reinhard' } },
};

// ---------------------------------------------------------------------------
// glowblobs — EMISSIVE density fields (impl-plan-medium-emission): the fogblobs
// Gaussians, now GLOWING. `emission` is ε, the volume emission coefficient
// (radiance per unit length, P1) — here each blob gets its own color: one warm,
// one cool, sharing the σ_s field's shape. glow.heat scales brightness live;
// blob.sharp tightens BOTH density and glow (the params are shared across the two
// expressions — one slider, two fields). Deep-core brightness saturates toward
// ε/σ_t (the source function); the D1 ceiling scales ε with the density (P2), so
// clamped peaks dim consistently instead of blowing out.
// ---------------------------------------------------------------------------

const GLOW_C1 = 'vec3(-0.35, 1.1, -0.5)';
const GLOW_C2 = 'vec3(0.35, 0.9, -0.5)';
const GLOW_G1 = `exp(-u_blob_sharp * dot(p - ${GLOW_C1}, p - ${GLOW_C1}))`;
const GLOW_G2 = `exp(-u_blob_sharp * dot(p - ${GLOW_C2}, p - ${GLOW_C2}))`;

export const glowblobsScene: SceneDescription = {
    ...cornellBox,
    id: 'glowblobs',
    name: 'Glow Blobs (emissive density field)',
    objects: [
        ...cornellBox.objects.filter((o) => 'type' in o && o.type === 'plane'),
    ],
    // The ceiling panel is now an EXPLICIT quad light with DRIVEN emission (driven-lights
    // Stage A): NEE samples it directly, so lamp.power dials a real, low-noise room light —
    // and still slides to 0 (the light ships zero selection mass, never picked) for pure glow.
    lights: [{
        kind: 'quad',
        corner: [-0.5, 1.98, -0.5], edge1: [1.0, 0.0, 0.0], edge2: [0.0, 0.0, 1.0],  // emits DOWN
        emission: { param: 'lamp.power', default: 8.0, min: 0.0, max: 20.0 },
    }],
    materials: {
        white: { model: 'lambert', albedo: [0.73, 0.73, 0.73] },
        red: { model: 'lambert', albedo: [0.65, 0.05, 0.05] },
        green: { model: 'lambert', albedo: [0.12, 0.45, 0.15] },
        fog: {
            model: 'none',
            medium: {
                sigma_a: [0.05, 0.05, 0.05],
                sigma_s: {
                    kind: 'glsl',
                    source: `u_blob_gain * (${GLOW_G1} + ${GLOW_G2})`,
                    params: [
                        { param: 'blob.gain', default: 6.0, min: 0.0, max: 8.0 },
                        { param: 'blob.sharp', default: 14.0, min: 2.0, max: 40.0 },
                    ],
                },
                emission: {
                    kind: 'glsl',
                    // One warm blob, one cool blob — per-term ε colors (vec3-weighted).
                    source: `u_glow_heat * (vec3(1.0, 0.35, 0.08) * ${GLOW_G1} + vec3(0.15, 0.4, 1.0) * ${GLOW_G2})`,
                    params: [
                        { param: 'glow.heat', default: 3.0, min: 0.0, max: 10.0 },
                        { param: 'blob.sharp', default: 14.0, min: 2.0, max: 40.0 },
                    ],
                },
                majorant: 8.2,
                phase_g: 0.3,
            },
        },
    },
    ambientMedium: 'fog',
};

// key 1: NEE — the driven quad light is sampled directly (shadow rays walk the fog via
// shadow_media); key 2: pt — the same scene chance-hitting the panel (grainier), the
// before/after of the graduation.
export const glowblobsStrategy: RenderStrategy = {
    id: 'pt-nee-het',
    measurement: { camera: { type: 'pinhole', fov: 0.9 }, maxBounces: 24 },
    estimator: {
        directLighting: 'nee',
        volumeSampling: 'delta-tracking',
        russianRoulette: { startDepth: 4 },
        accumulation: { type: 'average' },
    },
    view: { tonemap: { type: 'reinhard' } },
};

export const glowblobsPtStrategy: RenderStrategy = {
    ...glowblobsStrategy,
    id: 'pt-het',
    estimator: { ...glowblobsStrategy.estimator, directLighting: 'none' },
};
