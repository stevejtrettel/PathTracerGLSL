// demos/mediaScenes.ts
// R-FOGCUBE (validation §5, absorbing variant): a gray absorber cube over an emissive
// checker floor. The silhouette edge must show NO Fresnel-like rim (a rim = the null
// interface leaked a BSDF). Eyeball-only — the numeric media witnesses (F-SLAB,
// F-BOX-M, haze) live in src/witnesses/scenes/mediaWitness.ts.

import type { SceneDescription, RenderStrategy } from '../src/compiler/types.js';

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
    name: 'Volume scattering models: rayleigh · hg · draine',
    ambientSpace: { type: 'euclidean' },
    objects: [
        {
            kind: 'sdf',
            sdf: { type: 'plane', parameters: { normal: [0, 1, 0], offset: 0.0 } },
            material: 'floor',
        },
        {
            kind: 'sdf',
            sdf: { type: 'box', parameters: { center: [-1.3, 1.0, 0], halfSize: [0.45, 0.45, 0.45] } },
            material: 'rayleigh_fog',
        },
        {
            kind: 'sdf',
            sdf: { type: 'box', parameters: { center: [0.0, 1.0, 0], halfSize: [0.45, 0.45, 0.45] } },
            material: 'hg_fog',
        },
        {
            kind: 'sdf',
            sdf: { type: 'box', parameters: { center: [1.3, 1.0, 0], halfSize: [0.45, 0.45, 0.45] } },
            material: 'draine_fog',
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
        // Draine (approx-Mie): 10µm water droplets — strong physical forward peak.
        draine_fog: { model: 'none', medium: { sigma_a: [0.1, 0.1, 0.1], sigma_s: [1.1, 1.1, 1.1], model: 'draine', draine_d: 10.0 } },
    },
    lights: [],
};

export const rayleighStrategy: RenderStrategy = {
    id: 'pathtracer',
    measurement: { camera: { type: 'pinhole', fov: 0.8 }, maxBounces: 8 },
    estimator: { directLighting: 'none', russianRoulette: { startDepth: 4 }, accumulation: { type: 'average' } },
    view: { tonemap: { type: 'reinhard' } },
};
