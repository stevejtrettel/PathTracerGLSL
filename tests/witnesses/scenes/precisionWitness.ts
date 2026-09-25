// witnesses/scenes/precisionWitness.ts
// Floating-point and far-clip gates from the Sep 25 2026 audit. Each has a closed-form answer
// and is placed where the old code failed outright.
//
//   tiny-sphere       — an emissive sphere of radius r at distance D on the camera axis, seen
//                       through a narrow pinhole. The image is a disk of radius
//                       (H/2)·tanα/tan(fov/2) pixels, tanα = r/√(D²−r²); with the box pixel
//                       filter every pixel's expected value is its covered fraction, so the
//                       frame mean is the disk's area over W·H. At r/D = 2.5e-4 the old
//                       discriminant b² − c (two numbers of size D² = 1600 against r² = 1e-4)
//                       decided hit/miss mostly by rounding; sphere_intersect's perpendicular
//                       form keeps it exact.
//   tiny-sphere-light — a Lambert wall (ρ = 0.5) under a sphere light of radius r at height d.
//                       On the axis L = ρ·Le·sin²α = ρ·Le·r²/d² exactly; off axis
//                       L(x) = ρ·Le·(r²/d²)·(1 + x²/d²)^(−3/2). At r/d = 1e-4 the old
//                       1 − sqrt(1 − sin²α) rounded to 0 in f32, the 1e-8 floor took over, and
//                       the light read exactly TWICE its value; the stable form
//                       sin²α/(1 + cosα) is exact.
//   sun-haze          — a Lambert wall facing a directional light through an absorbing ambient
//                       medium. The sun sits at the far clip (MAX_DIST, the declared truncation,
//                       like the environment), so L = (ρ/π)·E·e^{−σ_a·(MAX_DIST − SHADOW_BACKOFF)}
//                       ·e^{−σ_a·d_cam}. The old 1e20 distance made it exactly 0.

import type { SceneDescription, RenderStrategy } from '../../../src/compiler/types.js';

// ---------------------------------------------------------------------------
// tiny-sphere
// ---------------------------------------------------------------------------

export const TINY_SIZE: [number, number] = [64, 64];
const TINY_R = 0.01;
const TINY_D = 40;
const TINY_TAN_HALF = 8e-4;   // the disk comes out 10 px in radius

export const tinySphereScene: SceneDescription = {
    id: 'tiny-sphere',
    name: 'Tiny distant sphere (intersection precision)',
    ambientSpace: { type: 'euclidean' },
    objects: [
        { type: 'sphere', parameters: { center: [0, 0, -TINY_D], radius: TINY_R }, material: 'glow', name: 'dot' },
    ],
    materials: {
        glow: { model: 'lambert', albedo: [0, 0, 0], emission: [1, 1, 1] },
    },
    lights: [],
    environment: { type: 'none' },
};

export const tinySphereStrategy: RenderStrategy = {
    id: 'pt',
    measurement: { camera: { type: 'pinhole', fov: 2 * Math.atan(TINY_TAN_HALF) }, maxBounces: 0 },
    estimator: { directLighting: 'none', russianRoulette: null, accumulation: { type: 'average' } },
    view: { tonemap: { type: 'none' } },
};

/** Frame mean = π·ρ²/(W·H), ρ = (H/2)·tanα/tan(fov/2) the disk radius in pixels. */
export const TINY_SPHERE_MEAN = (() => {
    const [w, h] = TINY_SIZE;
    const tanAlpha = TINY_R / Math.sqrt(TINY_D * TINY_D - TINY_R * TINY_R);
    const rho = (h / 2) * tanAlpha / TINY_TAN_HALF;
    return Math.PI * rho * rho / (w * h);
})();

// ---------------------------------------------------------------------------
// tiny-sphere-light
// ---------------------------------------------------------------------------

const LIGHT_R = 0.0002;
const LIGHT_D = 2;
const LIGHT_LE = 1e8;         // ρ·Le·r²/d² = 0.5·1e8·1e-8 = 0.5 on the axis
const WALL_RHO = 0.5;
const CAM_H = 1;              // camera height above the wall
const CAM_FOV = 0.2;

export const tinySphereLightScene: SceneDescription = {
    id: 'tiny-sphere-light',
    name: 'Tiny sphere light over a wall (light-sampling precision)',
    ambientSpace: { type: 'euclidean' },
    objects: [
        { type: 'plane', parameters: { normal: [0, 0, 1], offset: 0 }, material: 'wall', name: 'wall' },
    ],
    materials: {
        wall: { model: 'lambert', albedo: [WALL_RHO, WALL_RHO, WALL_RHO] },
    },
    lights: [
        { kind: 'sphere', position: [0, 0, LIGHT_D], radius: LIGHT_R, emission: LIGHT_LE },
    ],
    environment: { type: 'none' },
};

export const tinySphereLightStrategy: RenderStrategy = {
    id: 'pt-nee',
    measurement: { camera: { type: 'pinhole', fov: CAM_FOV }, maxBounces: 1 },
    estimator: { directLighting: 'nee', russianRoulette: null, accumulation: { type: 'average' } },
    view: { tonemap: { type: 'none' } },
};

export const TINY_LIGHT_CAMERA: { position: [number, number, number]; target: [number, number, number] } = {
    position: [0, 0, CAM_H],
    target: [0, 0, 0],
};

/** The check's crop: the central half of the frame in each axis. */
export const TINY_LIGHT_REGION = { x: 0.25, y: 0.25, w: 0.5, h: 0.5 };

/** Mean of L(x, y) over the wall square the crop sees: |x|, |y| ≤ a, a = half the visible
 *  half-width. The camera looks straight down, so film coordinates map linearly to the wall. */
export const TINY_LIGHT_MEAN = (() => {
    const a = 0.5 * CAM_H * Math.tan(CAM_FOV / 2);
    const n = 200;
    let sum = 0;
    for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
            const x = -a + (2 * a * (i + 0.5)) / n;
            const y = -a + (2 * a * (j + 0.5)) / n;
            sum += Math.pow(1 + (x * x + y * y) / (LIGHT_D * LIGHT_D), -1.5);
        }
    }
    return WALL_RHO * LIGHT_LE * (LIGHT_R * LIGHT_R) / (LIGHT_D * LIGHT_D) * (sum / (n * n));
})();

// ---------------------------------------------------------------------------
// sun-haze
// ---------------------------------------------------------------------------

const SUN_SIGMA_A = 0.001;
const MAX_DIST = 1000;          // math.glsl
const SHADOW_BACKOFF = 0.002;   // math.glsl

export const sunHazeScene: SceneDescription = {
    id: 'sun-haze',
    name: 'Sun through ambient haze (far-clip truncation)',
    ambientSpace: { type: 'euclidean' },
    objects: [
        { type: 'plane', parameters: { normal: [0, 0, 1], offset: 0 }, material: 'wall', name: 'wall' },
    ],
    materials: {
        wall: { model: 'lambert', albedo: [WALL_RHO, WALL_RHO, WALL_RHO] },
        haze: { model: 'none', medium: { sigma_a: SUN_SIGMA_A } },
    },
    lights: [
        { kind: 'directional', direction: [0, 0, -1], emission: Math.PI },   // (ρ/π)·E = ρ head-on
    ],
    environment: { type: 'none' },
    ambientMedium: 'haze',
};

export const sunHazeStrategy: RenderStrategy = {
    id: 'pt-nee',
    measurement: { camera: { type: 'pinhole', fov: 0.4 }, maxBounces: 1 },
    estimator: { directLighting: 'nee', russianRoulette: null, accumulation: { type: 'average' } },
    view: { tonemap: { type: 'none' } },
};

export const SUN_HAZE_CAMERA = { position: [0, 0, 1] as [number, number, number], target: [0, 0, 0] as [number, number, number] };

/** The frame CENTER sees the wall at distance 1 (off-center pixels see it slightly farther). */
export const SUN_HAZE_CENTER = WALL_RHO * Math.exp(-SUN_SIGMA_A * (MAX_DIST - SHADOW_BACKOFF)) * Math.exp(-SUN_SIGMA_A * 1);
