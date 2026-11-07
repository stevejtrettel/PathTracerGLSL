// tests/witnesses/scenes/s3Witness.ts
// The S³ witnesses (spherical space, curvature +1, the unit-sphere model). Two geodesics join any
// two points, of lengths d and 2π − d, leaving and arriving in opposite directions; both carry
// light. S³ has no sky, and every geodesic closes after 2π, so a ray that meets nothing reads 0.
//
//   s3-furnace          — six emissive lambert planes (great spheres) at distance 0.5 from o: a
//                         compact "cube". With ρ = 0.8, Le = 1 and maxBounces 6 every path scores
//                         Σ_{k≤6} 0.8^k = 3.951424 exactly, under pt, through a pinhole at o and a
//                         wide fisheye away from o.
//   s3-long-arc         — a lambert disk receiver above a one-sided disk light that faces AWAY from
//                         it: the receiver's top is lit only through the long arc (it leaves
//                         upward, passes the antipode −x and reaches the light's emitting face from
//                         below). pt, pt-nee and pt-mis against the closed form integrated over the
//                         window (s3Twins.ts): the arc rule for a one-sided receiver, the long-arc
//                         shadow ray, the S³ disk sampler and its MIS pdf at the arrival direction.
//   s3-long-arc-blocker — the same with an opaque ball about −o: it lies on every long arc from the
//                         window, beyond the short-arc distance d, so the expected value is 0. A
//                         shadow ray searched only to d (the short arc's length) would miss it.
//   s3-point-light      — the receiver under a point light above and one below (the one below lights
//                         the top through the long arc): Σ I·|cos θ|/sin² d, under power and
//                         uniform selection.
//   s3-medium           — a homogeneous scattering ball lit by two disk lights out of frame, one
//                         facing it and one facing away (reached only through the long arc): a
//                         medium event has no orientation, so each arc is taken with probability ½.
//                         pt, pt-nee and pt-mis converge to one image.
//
// The expected values below are computed by s3Twins.ts; tests/witnesses/s3Twins.test.ts recomputes
// them and checks the twin against the on-axis closed form and an independent Monte Carlo estimate,
// so a stale constant fails vitest.

import type { SceneDescription, RenderStrategy, Vec3 } from '../../../src/compiler/types.js';
import type { SceneSuiteEntry, WitnessRegion } from '../types.js';
import { withPose } from '../../../src/authoring/strategy.js';

/** Witness framebuffer and readout window (fractions, origin bottom-left — the runner's convention). */
export const S3_SIZE: [number, number] = [160, 120];
export const S3_WINDOW: WitnessRegion = { x: 0.375, y: 0.375, w: 0.25, h: 0.25 };
export const S3_FOV = 0.8;

// ---------------------------------------------------------------------------
// s3-furnace
// ---------------------------------------------------------------------------

const FURNACE_H = 0.5;
export const S3_FURNACE_VALUE = (1 - 0.8 ** 7) / (1 - 0.8);   // Σ_{k=0}^{6} 0.8^k = 3.951424

export const s3Furnace: SceneDescription = {
    id: 's3-furnace',
    name: 'S³ Furnace (six planes)',
    ambientSpace: { type: 'spherical' },
    // Inward normals: each plane's solid is the hemisphere beyond it, so the camera at o sees front
    // faces and receives the planes' emission (emission keys on region_to).
    objects: ([[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]] as Vec3[]).map((normal) => ({
        type: 'plane' as const, parameters: { normal, offset: FURNACE_H }, material: 'furnace',
    })),
    materials: { furnace: { model: 'lambert', albedo: [0.8, 0.8, 0.8], emission: [1, 1, 1] } },
    lights: [],
};

export const s3FurnaceStrategy: RenderStrategy = {
    id: 'pt',
    measurement: { camera: { type: 'pinhole', fov: 1.0 }, maxBounces: 6 },
    estimator: { directLighting: 'none', russianRoulette: null, accumulation: { type: 'average' } },
    view: { tonemap: { type: 'reinhard' } },
};
/** An equidistant fisheye whose 3-radian field (corners past 2 radians off axis) sees every wall. */
export const s3FurnaceFisheyeStrategy: RenderStrategy = {
    ...s3FurnaceStrategy, id: 'pt-fisheye',
    measurement: { ...s3FurnaceStrategy.measurement, camera: { type: 'fisheye', fov: 3.0, projection: 'equidistant' } },
};

// ---------------------------------------------------------------------------
// The receiver — a lambert disk of radius 0.5 about o in the great sphere y = 0 (normal +y), seen
// from 45° above at distance 1.13. The readout window lies inside it with margin (a window of 0.3
// still misses no point of it). maxBounces 1: its radiance is exactly its direct lighting.
// ---------------------------------------------------------------------------

export const S3_RECEIVER = { rho: 0.5, albedo: 0.5 };
export const S3_CAMERA: { position: Vec3; target: Vec3 } = { position: [0, 0.8, 0.8], target: [0, 0, 0] };
/** The disk light: center exp_o((0, −1, 0)), facing down (away from the receiver), geodesic
 *  radius 1.2, radiance 1. At this radius the uniform-area radius map matters: the Euclidean map
 *  r = ρ√u in its place (with the curved pdf) lowers E by 3.1% on axis and 2.7% at 0.35 off axis
 *  (s3Twins.test.ts), about 6× the tolerance below. */
export const S3_DISK_LIGHT = { position: [0, -1, 0] as Vec3, normal: [0, -1, 0] as Vec3, radius: 1.2, emission: 1 };
/** The blocker: a ball of radius 0.8 about −o = exp_o((0, π, 0)). Every long arc from a window
 *  point x passes −x, within 0.4 of −o, at arc length π, before it reaches the light (at 2π − d). */
export const S3_BLOCKER = { center: [0, Math.PI, 0] as Vec3, radius: 0.8 };
/** The point lights: exp_o((0, 1, 0)) of intensity 1.5 above the receiver and
 *  exp_o((0.4, −0.9, −0.2)) of intensity 0.8 below it. */
export const S3_POINT_LIGHTS = [
    { position: [0, 1, 0] as Vec3, emission: 1.5 },
    { position: [0.4, -0.9, -0.2] as Vec3, emission: 0.8 },
];

/** Window means of (albedo/π)·E over S3_WINDOW (s3Twins.windowMean, 2×2 points per pixel; 4×4
 *  points change them by 5e-8). For scale, the receiver's center reads albedo·Le·sin²β = 0.451661
 *  under the disk light (tan β = tan 1.2/sin 1); the point light below gives 0.160 of the 0.495. */
export const S3_DISK_WINDOW_MEAN = 0.4513685;
export const S3_POINT_WINDOW_MEAN = 0.4946112;

const receiverMaterials = {
    receiver: { model: 'lambert' as const, albedo: [S3_RECEIVER.albedo, S3_RECEIVER.albedo, S3_RECEIVER.albedo] as Vec3 },
};
const receiverObject = {
    type: 'disk' as const, parameters: { center: [0, 0, 0] as Vec3, radius: S3_RECEIVER.rho, normal: [0, 1, 0] as Vec3 }, material: 'receiver',
};

export const s3LongArc: SceneDescription = {
    id: 's3-long-arc',
    name: 'S³ Disk Light through the Long Arc',
    ambientSpace: { type: 'spherical' },
    objects: [receiverObject],
    materials: receiverMaterials,
    lights: [{ kind: 'disk', ...S3_DISK_LIGHT }],
};

export const s3LongArcBlocker: SceneDescription = {
    id: 's3-long-arc-blocker',
    name: 'S³ Long Arc, Blocked beyond d',
    ambientSpace: { type: 'spherical' },
    objects: [receiverObject, { type: 'sphere', parameters: S3_BLOCKER, material: 'blocker' }],
    materials: { ...receiverMaterials, blocker: { model: 'lambert', albedo: [0.5, 0.5, 0.5] } },
    lights: [{ kind: 'disk', ...S3_DISK_LIGHT }],
};

export const s3PointLight: SceneDescription = {
    id: 's3-point-light',
    name: 'S³ Point Lights above and below a Disk',
    ambientSpace: { type: 'spherical' },
    objects: [receiverObject],
    materials: receiverMaterials,
    lights: S3_POINT_LIGHTS.map((l) => ({ kind: 'point' as const, ...l })),
};

export const s3DirectNeeStrategy: RenderStrategy = {
    id: 'pt-nee',
    measurement: { camera: { type: 'pinhole', fov: S3_FOV }, maxBounces: 1 },
    estimator: { directLighting: 'nee', russianRoulette: null, accumulation: { type: 'average' } },
    view: { tonemap: { type: 'reinhard' } },
};
export const s3DirectMisStrategy: RenderStrategy = {
    ...s3DirectNeeStrategy, id: 'pt-mis', estimator: { ...s3DirectNeeStrategy.estimator, directLighting: 'mis' },
};
export const s3DirectPtStrategy: RenderStrategy = {
    ...s3DirectNeeStrategy, id: 'pt', estimator: { ...s3DirectNeeStrategy.estimator, directLighting: 'none' },
};
export const s3DirectUniformStrategy: RenderStrategy = {
    ...s3DirectNeeStrategy, id: 'pt-nee-uniform', estimator: { ...s3DirectNeeStrategy.estimator, lightSelection: 'uniform' },
};

// ---------------------------------------------------------------------------
// s3-medium — a scattering ball (radius 0.5 about o; σ_s 1.5, σ_a 0.2, HG g = 0.3) lit by two disk
// lights of radius 0.6, 1.1 from o: one at +x facing the ball (reached through short arcs), one at
// +y facing away from it (reached only through long arcs, which leave the ball downward). Seen from
// the camera, both lie about 90° off the view axis, outside the frame along either arc. A medium
// event takes each arc with probability ½: taking the one-sided rule there (n = 0) would always
// take the short arc and lose the +y light under NEE; dropping the ½ from the pdf would double NEE.
// ---------------------------------------------------------------------------

export const S3_MEDIUM_CAMERA: { position: Vec3; target: Vec3 } = { position: [0, 0.1, 1.2], target: [0, 0, 0] };

export const s3Medium: SceneDescription = {
    id: 's3-medium',
    name: 'S³ Scattering Ball',
    ambientSpace: { type: 'spherical' },
    objects: [{ type: 'sphere', parameters: { radius: 0.5 }, material: 'fog' }],
    materials: {
        fog: { model: 'none', medium: { sigma_a: [0.2, 0.2, 0.2], sigma_s: [1.5, 1.5, 1.5], phase_g: 0.3 } },
    },
    lights: [
        { kind: 'disk', position: [1.1, 0, 0], normal: [-1, 0, 0], radius: 0.6, emission: 2 },
        { kind: 'disk', position: [0, 1.1, 0], normal: [0, 1, 0], radius: 0.6, emission: 2 },
    ],
};

export const s3MediumNeeStrategy: RenderStrategy = {
    id: 'pt-nee',
    measurement: { camera: { type: 'pinhole', fov: 1.0 }, maxBounces: 8 },
    estimator: { directLighting: 'nee', volumeSampling: 'analytic', russianRoulette: null, accumulation: { type: 'average' } },
    view: { tonemap: { type: 'reinhard' } },
};
export const s3MediumMisStrategy: RenderStrategy = {
    ...s3MediumNeeStrategy, id: 'pt-mis', estimator: { ...s3MediumNeeStrategy.estimator, directLighting: 'mis' },
};
export const s3MediumPtStrategy: RenderStrategy = {
    ...s3MediumNeeStrategy, id: 'pt', estimator: { ...s3MediumNeeStrategy.estimator, directLighting: 'none' },
};

// ---------------------------------------------------------------------------
// The registry entries (spread into witnessSuite by tests/witnesses/index.ts).
// ---------------------------------------------------------------------------

const posed = (position: Vec3, target: Vec3, ...strategies: RenderStrategy[]) => strategies.map((s) => withPose(s, position, target));
const direct = (...strategies: RenderStrategy[]) => posed(S3_CAMERA.position, S3_CAMERA.target, ...strategies);

export const s3Suite: Record<string, SceneSuiteEntry> = {
    's3-furnace': {
        scene: s3Furnace,
        strategies: [
            ...posed([0, 0, 0], [0, 0, -1], s3FurnaceStrategy),
            ...posed([0.15, -0.1, 0.2], [-0.3, 0.2, -1], s3FurnaceFisheyeStrategy),
        ],
        exercises: 'S³ (unit-sphere model): six emissive lambert planes (great spheres) enclosing o — spawn, the plane intersection, escapes and emission bookkeeping in spherical space; the fisheye camera away from o',
        expected: `every pixel = Σ_{k≤6} 0.8^k = ${S3_FURNACE_VALUE.toFixed(6)} exactly (every path scores the same number), through the pinhole and the fisheye`,
        witness: {
            spp: 16,
            checks: [
                { kind: 'mean', value: S3_FURNACE_VALUE, tol: 0.004, strategy: 0, label: 'S³ furnace Σ_{k≤6} 0.8^k (pinhole)' },
                { kind: 'mean', value: S3_FURNACE_VALUE, tol: 0.004, strategy: 1, label: 'S³ furnace Σ_{k≤6} 0.8^k (fisheye)' },
            ],
        },
    },
    's3-long-arc': {
        scene: s3LongArc,
        strategies: direct(s3DirectNeeStrategy, s3DirectMisStrategy, s3DirectPtStrategy),
        exercises: 'S³ disk light (geodesic radius 1.2) facing away from a lambert disk receiver, which it lights only through the long arc: the arc rule for a one-sided receiver, the long-arc shadow ray, the uniform-area sampler on a geodesic disk, the sin² r area density, the emitter cosine at the arrival direction, disk_light_pdf under MIS at the arrival direction, the disk body\'s second plane crossing',
        expected: `window mean ${S3_DISK_WINDOW_MEAN} (the closed form integrated over the window, s3Twins.ts) under pt-nee, pt-mis and pt`,
        witness: {
            size: S3_SIZE,
            spp: 256,
            checks: [
                { kind: 'mean', value: S3_DISK_WINDOW_MEAN, tol: 0.002, region: S3_WINDOW, strategy: 0, label: 'S³ long arc, pt-nee = closed form' },
                { kind: 'mean', value: S3_DISK_WINDOW_MEAN, tol: 0.002, region: S3_WINDOW, strategy: 1, label: 'S³ long arc, pt-mis = closed form' },
                { kind: 'mean', value: S3_DISK_WINDOW_MEAN, tol: 0.003, region: S3_WINDOW, strategy: 2, label: 'S³ long arc, pt = closed form' },
                { kind: 'equality', strategies: [0, 1], meanTol: 0.02, label: 'S³ long arc nee ≡ mis' },
            ],
        },
    },
    's3-long-arc-blocker': {
        scene: s3LongArcBlocker,
        strategies: direct(s3DirectNeeStrategy, s3DirectMisStrategy, s3DirectPtStrategy),
        exercises: 'S³ long-arc shadow rays: an opaque ball on every long arc from the window, beyond the short-arc distance — the arc-aware shadow distance (ambient_aim) and the sphere body',
        expected: 'window mean 0 under pt-nee, pt-mis and pt (all light reaching the window passes the ball)',
        witness: {
            size: S3_SIZE,
            spp: 64,
            checks: [
                { kind: 'mean', value: 0, tol: 1e-6, region: S3_WINDOW, strategy: 0, label: 'S³ blocked long arc, pt-nee = 0' },
                { kind: 'mean', value: 0, tol: 1e-6, region: S3_WINDOW, strategy: 1, label: 'S³ blocked long arc, pt-mis = 0' },
                { kind: 'mean', value: 0, tol: 1e-6, region: S3_WINDOW, strategy: 2, label: 'S³ blocked long arc, pt = 0' },
            ],
        },
    },
    's3-point-light': {
        scene: s3PointLight,
        strategies: direct(s3DirectNeeStrategy, s3DirectMisStrategy, s3DirectUniformStrategy),
        exercises: 'S³ point lights above and below a lambert disk: the I/sin² d falloff, the arc rule (the light below reaches the top through the long arc), two lights chosen by power and by uniform selection',
        expected: `window mean ${S3_POINT_WINDOW_MEAN} (Σ I·|cos θ|/sin² d integrated over the window, s3Twins.ts) under pt-nee and pt-mis (power selection) and pt-nee with uniform selection`,
        witness: {
            size: S3_SIZE,
            spp: 64,
            checks: [
                { kind: 'mean', value: S3_POINT_WINDOW_MEAN, tol: 0.002, region: S3_WINDOW, strategy: 0, label: 'S³ point lights, pt-nee (power) = closed form' },
                { kind: 'mean', value: S3_POINT_WINDOW_MEAN, tol: 0.002, region: S3_WINDOW, strategy: 1, label: 'S³ point lights, pt-mis (power) = closed form' },
                { kind: 'mean', value: S3_POINT_WINDOW_MEAN, tol: 0.002, region: S3_WINDOW, strategy: 2, label: 'S³ point lights, pt-nee (uniform) = closed form' },
            ],
        },
    },
    's3-medium': {
        scene: s3Medium,
        strategies: posed(S3_MEDIUM_CAMERA.position, S3_MEDIUM_CAMERA.target, s3MediumNeeStrategy, s3MediumMisStrategy, s3MediumPtStrategy),
        exercises: 'S³ homogeneous scattering ball lit by two disk lights out of frame, one reached only through the long arc: the ½ arc rule at medium events, hg at the event point, the event arrival direction, medium NEE through the null boundary (the media shadow walker on both arcs), the medium-side and surface MIS weights',
        expected: 'keys 1 (pt-nee), 2 (pt-mis), 3 (pt) converge to the same image (the frame holds only the ball)',
        witness: {
            spp: 256,
            checks: [
                { kind: 'equality', strategies: [0, 1], meanTol: 0.02, label: 'S³ medium nee ≡ mis' },
                { kind: 'equality', strategies: [0, 2], meanTol: 0.02, rmse: 0.65, label: 'S³ medium pt tripwire' },
            ],
        },
    },
};

