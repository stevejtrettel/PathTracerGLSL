// tests/witnesses/scenes/h3Witness.ts
// The H³ witnesses (hyperbolic space, curvature −1, the hyperboloid model). Every scene sits within
// about 1.5 of the world origin (the working radius is about 3).
//
//   h3-furnace      — six emissive lambert planes, each at distance 0.5 from o, perpendicular to an
//                     axis: a compact "cube" (3·tanh²0.5 < 1, so its corners are finite points). With
//                     ρ = 0.8, Le = 1 and maxBounces 6 every path scores Σ_{k≤6} 0.8^k = 3.951424
//                     exactly, under pt (emissive objects are not light-sampled in curved spaces, so
//                     NEE would have nothing to sample), through a pinhole at o and through a wide
//                     equidistant fisheye away from o (every pixel, whatever its direction).
//   h3-disk-light   — a lambert disk receiver under a large downward disk light, maxBounces 1: pt,
//                     pt-nee and pt-mis against the closed form (A(r) = sinh² r, the curved area
//                     sampler, the emitter's arrival cosine), integrated over the readout window
//                     (h3Twins.ts).
//   h3-point-light  — the same receiver under two point lights: Σ I·cos θ/sinh² d, under power and
//                     uniform light selection (pt cannot hit a point light).
//   h3-medium       — a homogeneous scattering ball over a lambert floor disk, lit by a large disk
//                     light above and behind the camera (out of frame, so the frame mean is the ball
//                     and the floor): pt, pt-nee and pt-mis converge to one image.
//   h3-sky          — a procedural sky 1 + key (per channel), nothing in view: every pixel reads the sky at
//                     the ideal endpoint of its camera ray (ambient_sky_key), through a pinhole and a
//                     fisheye placed away from o, against h3Twins.ts.
//   h3-sky-ball     — a lambert ball under a constant sky L, placed by a {param}-driven isometry: a
//                     convex ball cannot see itself, so after one bounce every ball pixel reads ρ·L
//                     exactly; the frame mean (h3Twins.ts) pins where the ball is.
//
// The expected values below are computed by h3Twins.ts; tests/witnesses/h3Twins.test.ts recomputes
// them and checks the twin against the on-axis closed form, an independent Monte Carlo estimate and
// the limit that defines the sky key, so a stale constant fails vitest.

import type { SceneDescription, RenderStrategy, Vec3 } from '../../../src/compiler/types.js';
import type { SceneSuiteEntry, WitnessRegion } from '../types.js';
import { withPose } from '../../../src/authoring/strategy.js';

/** Witness framebuffer and readout window (fractions, origin bottom-left — the runner's convention). */
export const H3_SIZE: [number, number] = [160, 120];
export const H3_WINDOW: WitnessRegion = { x: 0.375, y: 0.375, w: 0.25, h: 0.25 };
export const H3_FOV = 0.8;

// ---------------------------------------------------------------------------
// h3-furnace
// ---------------------------------------------------------------------------

const FURNACE_H = 0.5;
export const H3_FURNACE_VALUE = (1 - 0.8 ** 7) / (1 - 0.8);   // Σ_{k=0}^{6} 0.8^k = 3.951424

export const h3Furnace: SceneDescription = {
    id: 'h3-furnace',
    name: 'H³ Furnace (six planes)',
    ambientSpace: { type: 'hyperbolic' },
    // Inward normals: each plane's solid is the outside of the cube, so the camera at o sees front
    // faces and receives the planes' emission (emission keys on region_to).
    objects: ([[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]] as Vec3[]).map((normal) => ({
        type: 'plane' as const, parameters: { normal, offset: FURNACE_H }, material: 'furnace',
    })),
    materials: { furnace: { model: 'lambert', albedo: [0.8, 0.8, 0.8], emission: [1, 1, 1] } },
    lights: [],
};

export const h3FurnaceStrategy: RenderStrategy = {
    id: 'pt',
    measurement: { camera: { type: 'pinhole', fov: 1.0 }, maxBounces: 6 },
    estimator: { directLighting: 'none', russianRoulette: null, accumulation: { type: 'average' } },
    view: { tonemap: { type: 'reinhard' } },
};
/** An equidistant fisheye whose 3-radian field (corners past 2 radians off axis) sees every wall. */
export const h3FurnaceFisheyeStrategy: RenderStrategy = {
    ...h3FurnaceStrategy, id: 'pt-fisheye',
    measurement: { ...h3FurnaceStrategy.measurement, camera: { type: 'fisheye', fov: 3.0, projection: 'equidistant' } },
};

// ---------------------------------------------------------------------------
// h3-disk-light / h3-point-light — a lambert disk receiver of radius 0.5 about o in the plane
// y = 0 (normal +y), seen from 45° above at distance 1.13. The readout window lies inside the
// receiver with margin (a window of 0.3 still misses no point of it).
// ---------------------------------------------------------------------------

export const H3_RECEIVER = { rho: 0.5, albedo: 0.5 };
export const H3_CAMERA: { position: Vec3; target: Vec3 } = { position: [0, 0.8, 0.8], target: [0, 0, 0] };
/** The disk light: center exp_o((0, 1, 0)), facing down, geodesic radius 1.2, radiance 2. At this
 *  radius the uniform-area radius map matters: the Euclidean map r = ρ√u in its place (with the
 *  curved pdf) raises E by 4.8% on axis and 4.2% at 0.35 off axis (fp64 Monte Carlo, 2·10⁶ samples),
 *  about 7× the tolerance below; at radius 0.6 the same error is 0.44%, inside it. */
export const H3_DISK_LIGHT = { position: [0, 1, 0] as Vec3, normal: [0, -1, 0] as Vec3, radius: 1.2, emission: 2 };
/** The point lights: exp_o((0, 1, 0)) of intensity 1.5 and exp_o((0.5, 0.8, −0.3)) of intensity 0.8. */
export const H3_POINT_LIGHTS = [
    { position: [0, 1, 0] as Vec3, emission: 1.5 },
    { position: [0.5, 0.8, -0.3] as Vec3, emission: 0.8 },
];

/** Window means of (albedo/π)·E over H3_WINDOW (h3Twins.windowMean with 4×4 points per pixel; 2×2
 *  points change them by 2e-6). For scale, the receiver's center reads albedo·Le·sin²β = 0.334756
 *  under the disk light (tan β = tanh 1.2/sinh 1). */
export const H3_DISK_WINDOW_MEAN = 0.3233549;
export const H3_POINT_WINDOW_MEAN = 0.2366519;

const receiverMaterials = {
    receiver: { model: 'lambert' as const, albedo: [H3_RECEIVER.albedo, H3_RECEIVER.albedo, H3_RECEIVER.albedo] as Vec3 },
};
const receiverObject = {
    type: 'disk' as const, parameters: { center: [0, 0, 0] as Vec3, radius: H3_RECEIVER.rho, normal: [0, 1, 0] as Vec3 }, material: 'receiver',
};

export const h3DiskLight: SceneDescription = {
    id: 'h3-disk-light',
    name: 'H³ Disk Light on a Disk',
    ambientSpace: { type: 'hyperbolic' },
    objects: [receiverObject],
    materials: receiverMaterials,
    lights: [{ kind: 'disk', ...H3_DISK_LIGHT }],
};

export const h3PointLight: SceneDescription = {
    id: 'h3-point-light',
    name: 'H³ Point Lights on a Disk',
    ambientSpace: { type: 'hyperbolic' },
    objects: [receiverObject],
    materials: receiverMaterials,
    lights: H3_POINT_LIGHTS.map((l) => ({ kind: 'point' as const, ...l })),
};

/** maxBounces 1: the receiver's radiance is exactly its direct lighting (the light's backing
 *  material is black, and nothing else is in the scene). */
export const h3DirectNeeStrategy: RenderStrategy = {
    id: 'pt-nee',
    measurement: { camera: { type: 'pinhole', fov: H3_FOV }, maxBounces: 1 },
    estimator: { directLighting: 'nee', russianRoulette: null, accumulation: { type: 'average' } },
    view: { tonemap: { type: 'reinhard' } },
};
export const h3DirectMisStrategy: RenderStrategy = {
    ...h3DirectNeeStrategy, id: 'pt-mis', estimator: { ...h3DirectNeeStrategy.estimator, directLighting: 'mis' },
};
export const h3DirectPtStrategy: RenderStrategy = {
    ...h3DirectNeeStrategy, id: 'pt', estimator: { ...h3DirectNeeStrategy.estimator, directLighting: 'none' },
};
export const h3DirectUniformStrategy: RenderStrategy = {
    ...h3DirectNeeStrategy, id: 'pt-nee-uniform', estimator: { ...h3DirectNeeStrategy.estimator, lightSelection: 'uniform' },
};

// ---------------------------------------------------------------------------
// h3-medium — a scattering ball (radius 0.5 about o; σ_s 1.5, σ_a 0.2, HG g = 0.3) over a lambert
// disk 0.7 below o, lit by a disk light of radius 1.5 above and behind the camera (its plane is
// 0.93 from o). No camera ray meets the light; a phase sample from the ball's center reaches it
// with probability about 0.12, from the ball's lit side about 0.26 (h3Twins geometry, 4·10⁴ uniform
// directions), so the MIS arm weighs many phase-sampled hits that the NEE arm does not have.
// ---------------------------------------------------------------------------

export const H3_MEDIUM_CAMERA: { position: Vec3; target: Vec3 } = { position: [0, 0.1, 1.1], target: [0, -0.25, 0] };

export const h3Medium: SceneDescription = {
    id: 'h3-medium',
    name: 'H³ Scattering Ball',
    ambientSpace: { type: 'hyperbolic' },
    objects: [
        { type: 'sphere', parameters: { radius: 0.5 }, material: 'fog' },
        { type: 'disk', parameters: { center: [0, -0.7, 0], radius: 1.0, normal: [0, 1, 0] }, material: 'floor' },
    ],
    materials: {
        fog: { model: 'none', medium: { sigma_a: [0.2, 0.2, 0.2], sigma_s: [1.5, 1.5, 1.5], phase_g: 0.3 } },
        floor: { model: 'lambert', albedo: [0.6, 0.6, 0.6] },
    },
    lights: [{ kind: 'disk', position: [0, 0.75, 0.55], normal: [0, -1, -0.6], radius: 1.5, emission: 2 }],
};

export const h3MediumNeeStrategy: RenderStrategy = {
    id: 'pt-nee',
    measurement: { camera: { type: 'pinhole', fov: 1.3 }, maxBounces: 8 },
    estimator: { directLighting: 'nee', volumeSampling: 'analytic', russianRoulette: null, accumulation: { type: 'average' } },
    view: { tonemap: { type: 'reinhard' } },
};
export const h3MediumMisStrategy: RenderStrategy = {
    ...h3MediumNeeStrategy, id: 'pt-mis', estimator: { ...h3MediumNeeStrategy.estimator, directLighting: 'mis' },
};
export const h3MediumPtStrategy: RenderStrategy = {
    ...h3MediumNeeStrategy, id: 'pt', estimator: { ...h3MediumNeeStrategy.estimator, directLighting: 'none' },
};

// ---------------------------------------------------------------------------
// h3-sky — the procedural sky L(k) = 1 + k per channel at the sky key k. The camera sits 1.24 from
// o, where the key of a ray differs from its direction by up to about 50°. A scene needs one
// object: a small ball 0.6 straight behind the camera, which no ray of either camera meets (the
// fisheye's corners reach 2.08 radians off axis; h3Twins.test.ts checks every sample point).
// ---------------------------------------------------------------------------

export const H3_SKY_HIDDEN_BALL = { center: [1.19, 0.4, 1.34] as Vec3, radius: 0.1 };

export const H3_SKY_CAMERA: { position: Vec3; target: Vec3 } = { position: [0.8, 0.3, 0.9], target: [-0.5, 0.2, -0.6] };
export const H3_SKY_PINHOLE_FOV = 0.9;
export const H3_SKY_FISHEYE_FOV = 3.0;
/** Whole-frame means of 1 + key (h3Twins.regionMean, 4×4 points per pixel). Reading the ray's own
 *  direction in place of the key gives (0.369, 0.828, 0.283) and (0.853, 0.967, 0.833). */
export const H3_SKY_PINHOLE_MEAN: [number, number, number] = [0.7703300, 1.1169558, 0.7248413];
export const H3_SKY_FISHEYE_MEAN: [number, number, number] = [1.4087884, 1.1606228, 1.4596808];

export const h3Sky: SceneDescription = {
    id: 'h3-sky',
    name: 'H³ Sky Key',
    ambientSpace: { type: 'hyperbolic' },
    objects: [{ type: 'sphere', parameters: H3_SKY_HIDDEN_BALL, material: 'hidden' }],
    materials: { hidden: { model: 'lambert', albedo: [0.5, 0.5, 0.5] } },
    lights: [],
    environment: { type: 'procedural', glsl: { kind: 'glsl', source: 'vec3(1.0) + dir' }, sampleAsLight: false },
};

export const h3SkyPinholeStrategy: RenderStrategy = {
    id: 'pt',
    measurement: { camera: { type: 'pinhole', fov: H3_SKY_PINHOLE_FOV }, maxBounces: 1 },
    estimator: { directLighting: 'none', russianRoulette: null, accumulation: { type: 'average' } },
    view: { tonemap: { type: 'reinhard' } },
};
export const h3SkyFisheyeStrategy: RenderStrategy = {
    ...h3SkyPinholeStrategy, id: 'pt-fisheye',
    measurement: { ...h3SkyPinholeStrategy.measurement, camera: { type: 'fisheye', fov: H3_SKY_FISHEYE_FOV, projection: 'equidistant' } },
};

// ---------------------------------------------------------------------------
// h3-sky-ball — a lambert ball (albedo 0.5, radius 0.45, center row (0.3, 0, 0)) under the constant
// sky 1, placed by g = T(position)·R(angle about z)·T(center), both fields {param}-driven, so the
// placement reaches the shader as the mat4 uniform u_object0Isometry. Its world center is
// exp_o((0.440, 0.281, 0)); read through the transpose of that matrix it would be at
// exp_o((0.405, −0.329, 0)), outside the window and with frame mean 0.97715.
// ---------------------------------------------------------------------------

export const H3_BALL = { center: [0.3, 0, 0] as Vec3, radius: 0.45, albedo: 0.5, position: [0.35, 0, 0] as Vec3, angle: 1.3 };
export const H3_BALL_CAMERA: { position: Vec3; target: Vec3 } = { position: [0, 0.2, 1.8], target: [0, 0, 0] };
export const H3_BALL_FOV = 0.9;
/** A window inside the ball's image (a window 0.01 wider on every side is still covered). */
export const H3_BALL_WINDOW: WitnessRegion = { x: 0.56, y: 0.57, w: 0.12, h: 0.1 };
/** Whole-frame mean: 1 − (1 − albedo)·(the ball's share of the frame) (h3Twins.regionMean, 8×8
 *  points per pixel; 4×4 points change it by 7e-6). */
export const H3_BALL_FRAME_MEAN = 0.9738639;

export const h3SkyBall: SceneDescription = {
    id: 'h3-sky-ball',
    name: 'H³ Ball under a Sky (driven placement)',
    ambientSpace: { type: 'hyperbolic' },
    objects: [{
        type: 'sphere', parameters: { center: H3_BALL.center, radius: H3_BALL.radius }, material: 'ball',
        transform: {
            position: { param: 'ball.position', default: H3_BALL.position },
            rotation: { axis: [0, 0, 1], angle: { param: 'ball.angle', default: H3_BALL.angle, min: 0, max: 6.3 } },
        },
    }],
    materials: { ball: { model: 'lambert', albedo: [H3_BALL.albedo, H3_BALL.albedo, H3_BALL.albedo] } },
    lights: [],
    environment: { type: 'constant', color: [1, 1, 1] },
};

export const h3SkyBallStrategy: RenderStrategy = {
    id: 'pt',
    measurement: { camera: { type: 'pinhole', fov: H3_BALL_FOV }, maxBounces: 1 },
    estimator: { directLighting: 'none', russianRoulette: null, accumulation: { type: 'average' } },
    view: { tonemap: { type: 'reinhard' } },
};

// ---------------------------------------------------------------------------
// The registry entries (spread into witnessSuite by tests/witnesses/index.ts).
// ---------------------------------------------------------------------------

const posed = (position: Vec3, target: Vec3, ...strategies: RenderStrategy[]) => strategies.map((s) => withPose(s, position, target));

export const h3Suite: Record<string, SceneSuiteEntry> = {
    'h3-furnace': {
        scene: h3Furnace,
        strategies: [
            ...posed([0, 0, 0], [0, 0, -1], h3FurnaceStrategy),
            ...posed([0.15, -0.1, 0.2], [-0.3, 0.2, -1], h3FurnaceFisheyeStrategy),
        ],
        exercises: 'H³ (hyperboloid model): six emissive lambert planes enclosing o — spawn, the plane intersection, escapes and emission bookkeeping in curved space; the fisheye camera away from o',
        expected: `every pixel = Σ_{k≤6} 0.8^k = ${H3_FURNACE_VALUE.toFixed(6)} exactly (every path scores the same number), through the pinhole and the fisheye`,
        witness: {
            spp: 16,
            checks: [
                { kind: 'mean', value: H3_FURNACE_VALUE, tol: 0.004, strategy: 0, label: 'H³ furnace Σ_{k≤6} 0.8^k (pinhole)' },
                { kind: 'mean', value: H3_FURNACE_VALUE, tol: 0.004, strategy: 1, label: 'H³ furnace Σ_{k≤6} 0.8^k (fisheye)' },
            ],
        },
    },
    'h3-disk-light': {
        scene: h3DiskLight,
        strategies: posed(H3_CAMERA.position, H3_CAMERA.target, h3DirectNeeStrategy, h3DirectMisStrategy, h3DirectPtStrategy),
        exercises: 'H³ disk light (geodesic radius 1.2) on a lambert disk, direct light only: the uniform-area sampler on a geodesic disk (its inverse-CDF radius, the 4π sinh²(ρ/2) area), the sinh² r area density, the emitter cosine at the arrival direction, disk_light_pdf under MIS, the plane and disk bodies',
        expected: `window mean ${H3_DISK_WINDOW_MEAN} (the closed form integrated over the window, h3Twins.ts) under pt-nee, pt-mis and pt`,
        witness: {
            size: H3_SIZE,
            spp: 256,
            checks: [
                { kind: 'mean', value: H3_DISK_WINDOW_MEAN, tol: 0.002, region: H3_WINDOW, strategy: 0, label: 'H³ disk light, pt-nee = closed form' },
                { kind: 'mean', value: H3_DISK_WINDOW_MEAN, tol: 0.002, region: H3_WINDOW, strategy: 1, label: 'H³ disk light, pt-mis = closed form' },
                { kind: 'mean', value: H3_DISK_WINDOW_MEAN, tol: 0.003, region: H3_WINDOW, strategy: 2, label: 'H³ disk light, pt = closed form' },
                { kind: 'equality', strategies: [0, 1], meanTol: 0.02, label: 'H³ disk light nee ≡ mis' },
            ],
        },
    },
    'h3-point-light': {
        scene: h3PointLight,
        strategies: posed(H3_CAMERA.position, H3_CAMERA.target, h3DirectNeeStrategy, h3DirectMisStrategy, h3DirectUniformStrategy),
        exercises: 'H³ point lights on a lambert disk: the I/sinh² d falloff and the direction to the light, with two lights chosen by power and by uniform selection',
        expected: `window mean ${H3_POINT_WINDOW_MEAN} (Σ I·cos θ/sinh² d integrated over the window, h3Twins.ts) under pt-nee and pt-mis (power selection) and pt-nee with uniform selection`,
        witness: {
            size: H3_SIZE,
            spp: 64,
            checks: [
                { kind: 'mean', value: H3_POINT_WINDOW_MEAN, tol: 0.002, region: H3_WINDOW, strategy: 0, label: 'H³ point lights, pt-nee (power) = closed form' },
                { kind: 'mean', value: H3_POINT_WINDOW_MEAN, tol: 0.002, region: H3_WINDOW, strategy: 1, label: 'H³ point lights, pt-mis (power) = closed form' },
                { kind: 'mean', value: H3_POINT_WINDOW_MEAN, tol: 0.002, region: H3_WINDOW, strategy: 2, label: 'H³ point lights, pt-nee (uniform) = closed form' },
            ],
        },
    },
    'h3-medium': {
        scene: h3Medium,
        strategies: posed(H3_MEDIUM_CAMERA.position, H3_MEDIUM_CAMERA.target, h3MediumNeeStrategy, h3MediumMisStrategy, h3MediumPtStrategy),
        exercises: 'H³ homogeneous scattering ball over a lambert disk, lit by a large disk light out of frame: hg at the event point (metric cosine, ambient_frame basis), the event arrival direction, medium NEE through the null boundary (the media shadow walker), the medium-side and surface MIS weights',
        expected: 'keys 1 (pt-nee), 2 (pt-mis), 3 (pt) converge to the same image (the frame holds only the ball and the floor)',
        witness: {
            spp: 256,
            checks: [
                { kind: 'equality', strategies: [0, 1], meanTol: 0.02, label: 'H³ medium nee ≡ mis' },
                { kind: 'equality', strategies: [0, 2], meanTol: 0.02, rmse: 0.65, label: 'H³ medium pt tripwire' },
            ],
        },
    },
    'h3-sky': {
        scene: h3Sky,
        strategies: posed(H3_SKY_CAMERA.position, H3_SKY_CAMERA.target, h3SkyPinholeStrategy, h3SkyFisheyeStrategy),
        exercises: 'H³ sky lookup at the ray\'s ideal endpoint (ambient_sky_key) for camera rays away from o, through the pinhole and the equidistant fisheye',
        expected: `frame means ${H3_SKY_PINHOLE_MEAN.join(', ')} (pinhole) and ${H3_SKY_FISHEYE_MEAN.join(', ')} (fisheye), the sky 1 + key averaged over the frame (h3Twins.ts)`,
        witness: {
            size: H3_SIZE,
            spp: 16,
            checks: [
                { kind: 'mean', value: H3_SKY_PINHOLE_MEAN, tol: 0.001, strategy: 0, label: 'H³ sky key, pinhole' },
                { kind: 'mean', value: H3_SKY_FISHEYE_MEAN, tol: 0.001, strategy: 1, label: 'H³ sky key, fisheye' },
            ],
        },
    },
    'h3-sky-ball': {
        scene: h3SkyBall,
        strategies: posed(H3_BALL_CAMERA.position, H3_BALL_CAMERA.target, h3SkyBallStrategy),
        exercises: 'H³ lambert ball under a constant sky, placed by a {param}-driven isometry (the mat4 uniform and its column-major upload); one bounce from a convex surface to the sky',
        expected: `window on the ball = ${H3_BALL.albedo} (ρ·L exactly: a convex ball cannot see itself); frame mean ${H3_BALL_FRAME_MEAN} (h3Twins.ts)`,
        witness: {
            size: H3_SIZE,
            spp: 16,
            checks: [
                { kind: 'mean', value: H3_BALL.albedo, tol: 0.001, region: H3_BALL_WINDOW, label: 'H³ sky ball reads ρ·L' },
                { kind: 'mean', value: H3_BALL_FRAME_MEAN, tol: 0.0005, label: 'H³ sky ball frame mean (where the driven ball is)' },
            ],
        },
    },
};
