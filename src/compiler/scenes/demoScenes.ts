// compiler/scenes/demoScenes.ts
// Photorealistic demos from simple primitives (spheres/boxes/planes) + the media features.
// These are AESTHETIC scenes, not witnesses — their `expected` describes the look, and each
// is designed around the v1 physics constraints rather than against them:
//
//   marble — "Storm marble on a light table." A glass sphere with a SCATTERING INTERIOR
//   (dielectric surface + medium block in one material — the multi-material composition the
//   region machinery exists for). Lit by an EMISSIVE panel, deliberately: shadow rays are
//   dielectric-opaque (§6.3), so a point light cannot NEE-light a glass-shelled volume — but
//   BSDF/phase paths refract in, scatter, exit, and hit a big emitter just fine. Key 2 runs
//   measurement.scattering 'ignored': the same marble with scattering switched off
//   (absorbing-only) — a live A/B truncation (taxonomy §8) of what scattering adds.
//
//   mist — "Standing stones in morning mist." A ground-hugging fog LAYER (bounded null-
//   interface box — an unbounded scattering ambient would extinguish the sky over MAX_DIST),
//   axis-aligned monoliths receding to the horizon, a warm low sun (point light ABOVE the
//   fog top, so shafts stay crisp) throwing crepuscular shadow-lanes through the mist, and a
//   cool constant sky. Aerial perspective fades the far stones. The camera sits INSIDE the
//   fog volume — the scene that gave §4.4's classification-init its reader.

import type { SceneDescription, RenderStrategy } from '../types.js';

// ---------------------------------------------------------------------------
// marble — storm marble on a light table
// ---------------------------------------------------------------------------

export const marbleScene: SceneDescription = {
    id: 'marble',
    name: 'Storm Marble (light table)',
    ambientSpace: { type: 'euclidean' },
    objects: [
        // Dark context floor under everything
        {
            kind: 'sdf',
            sdf: { type: 'plane', parameters: { normal: [0, 1, 0], offset: 0.1 } },
            material: 'dark',
        },
        // The light table: a thin glowing slab the marble sits on
        {
            kind: 'sdf',
            sdf: { type: 'box', parameters: { center: [0, -0.05, 0], halfSize: [2.2, 0.05, 2.2] } },
            material: 'panel',
        },
        // The hero: glass shell + smoke interior, ONE material (surface + medium compose)
        {
            kind: 'sdf',
            sdf: { type: 'sphere', parameters: { center: [0, 0.62, 0], radius: 0.6 } },
            material: 'stormglass',
        },
        // Clear-glass companion for material contrast (and a second Fresnel rim)
        {
            kind: 'analytic',
            shape: { type: 'sphere', parameters: { center: [1.05, 0.22, 0.7], radius: 0.22 } },
            material: 'clearglass',
        },
        // Matte companion — shows the panel's soft falloff
        {
            kind: 'sdf',
            sdf: { type: 'sphere', parameters: { center: [-1.0, 0.18, 0.55], radius: 0.18 } },
            material: 'clay',
        },
    ],
    materials: {
        dark: { model: 'lambert', albedo: [0.04, 0.04, 0.045] },
        panel: { model: 'lambert', albedo: [0, 0, 0], emission: [2.6, 2.55, 2.4] },
        stormglass: {
            model: 'dielectric',
            ior: 1.5,
            medium: {
                // Warm smoke: scatters red-forward, absorbs a little blue → ember tones.
                sigma_s: { param: 'marble.smoke', default: [6.0, 3.0, 1.4] },
                sigma_a: [0.02, 0.06, 0.14],
                phase_g: { param: 'marble.g', default: 0.3, min: -0.9, max: 0.9 },
            },
        },
        clearglass: { model: 'dielectric', ior: 1.5 },
        clay: { model: 'lambert', albedo: [0.55, 0.32, 0.22] },
    },
    lights: [], // deliberate: emissive panel only (point lights can't reach the interior, §6.3)
    environment: { type: 'constant', color: [0.05, 0.055, 0.075], intensity: 1.0 }, // faint cool fill
};

// Key 1: the full thing. Interior scattering needs depth (medium events count, §7.2).
export const marbleStrategy: RenderStrategy = {
    id: 'pt',
    measurement: {
        camera: { type: 'pinhole', fov: 0.7 },
        maxBounces: 32,
    },
    estimator: {
        directLighting: 'none', // no explicit lights; the panel is a path-only emitter
        russianRoulette: { startDepth: 4 },
        volumeSampling: 'analytic',
        accumulation: { type: 'average' },
    },
    view: { tonemap: { type: 'reinhard' } },
};

// Key 2: scattering OFF — the same marble as absorbing-only tinted glass. What the volume
// integrator adds, as a single keypress A/B.
export const marbleNoScatterStrategy: RenderStrategy = {
    ...marbleStrategy,
    id: 'pt-noscatter',
    measurement: { ...marbleStrategy.measurement, scattering: 'ignored' },
};

// ---------------------------------------------------------------------------
// mist — standing stones in morning mist
// ---------------------------------------------------------------------------

/** Axis-aligned basalt monolith (no rotations in v1 — Kubrick, not Stonehenge). */
function monolith(x: number, z: number, h: number): SceneDescription['objects'][number] {
    return {
        kind: 'sdf',
        sdf: { type: 'box', parameters: { center: [x, h, z], halfSize: [0.55, h, 0.4] } },
        material: 'basalt',
    };
}

export const mistScene: SceneDescription = {
    id: 'mist',
    name: 'Standing Stones (morning mist)',
    ambientSpace: { type: 'euclidean' },
    objects: [
        // Ground
        {
            kind: 'sdf',
            sdf: { type: 'plane', parameters: { normal: [0, 1, 0], offset: 0.0 } },
            material: 'earth',
        },
        // The avenue of stones, receding — repetition + fading is the aerial-perspective cue
        monolith(-1.8, -3, 1.9),
        monolith(2.1, -7, 2.3),
        monolith(-2.4, -12, 2.0),
        monolith(1.7, -18, 2.6),
        monolith(-2.0, -26, 2.2),
        monolith(2.3, -36, 2.8),
        monolith(-2.6, -48, 2.4),
        // A fallen boulder near camera for foreground interest
        {
            kind: 'sdf',
            sdf: { type: 'sphere', parameters: { center: [1.1, 0.45, 1.2], radius: 0.5 } },
            material: 'basalt',
        },
        // The mist LAYER: ground fog from y=0 to y=12, bounded so sky rays escape it.
        // Null interface (model 'none') — its boundary must not exist optically.
        {
            kind: 'sdf',
            sdf: { type: 'box', parameters: { center: [0, 6, -20], halfSize: [90, 6, 90] } },
            material: 'mist',
        },
    ],
    materials: {
        earth: { model: 'lambert', albedo: [0.30, 0.27, 0.22] },
        basalt: { model: 'lambert', albedo: [0.38, 0.37, 0.36] },
        mist: {
            model: 'none',
            medium: {
                // Slightly blue-biased scatter (cool mist); trace absorption keeps depth.
                sigma_s: { param: 'mist.density', default: [0.030, 0.034, 0.040] },
                sigma_a: [0.002, 0.002, 0.002],
                phase_g: 0.55, // forward: the glow blooms around the sun direction
            },
        },
    },
    // The sun: ABOVE the fog top (y > 12) and behind the stones — backlit mist, long
    // shadow-lanes toward the camera. Warm dawn color; 1/d² folded by the sampler.
    lights: [{ kind: 'point', position: [14, 18, -60], intensity: 22000.0, color: [1.0, 0.82, 0.6] }],
    environment: { type: 'constant', color: [0.42, 0.52, 0.68], intensity: 1.0 }, // cool sky
};

export const mistStrategy: RenderStrategy = {
    id: 'pt-nee',
    measurement: {
        camera: { type: 'pinhole', fov: 1.0 },
        maxBounces: 12, // shafts are 1–2 scatter events; ground bounce adds a few
    },
    estimator: {
        directLighting: 'nee',
        russianRoulette: { startDepth: 3 },
        volumeSampling: 'analytic',
        accumulation: { type: 'average' },
    },
    view: { tonemap: { type: 'reinhard' } },
};
