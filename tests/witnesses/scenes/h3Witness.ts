// tests/witnesses/scenes/h3Witness.ts
// The H³ witnesses (hyperbolic space, curvature −1, the hyperboloid model). Every scene sits within
// about 1.5 of the world origin (the working radius is about 3) and has no sky, so nothing but the
// scene's own emitters lights it.
//
//   h3-furnace      — six emissive lambert planes, each at distance 0.5 from o, perpendicular to an
//                     axis: a compact "cube" (3·tanh²0.5 < 1, so its corners are finite points). With
//                     ρ = 0.8, Le = 1 and maxBounces 6 every path scores Σ_{k≤6} 0.8^k = 3.951424
//                     exactly, under pt (emissive objects are not light-sampled in curved spaces, so
//                     NEE would have nothing to sample). Catches spawn, the plane intersection,
//                     escapes and emission bookkeeping.
//   h3-disk-light   — a lambert disk receiver under a downward disk light, maxBounces 1: pt, pt-nee and
//                     pt-mis against the closed form (A(r) = sinh² r, the curved area sampler, the
//                     emitter's arrival cosine), integrated over the readout window (h3Twins.ts).
//   h3-point-light  — the same receiver under a point light: I·cos θ/sinh² d (pt-nee and pt-mis; pt
//                     cannot hit a point light).
//   h3-medium       — a homogeneous scattering ball lit by an outside disk light, over a lambert disk
//                     that catches its shadow: pt, pt-nee and pt-mis converge to one image (the phase
//                     function's metric and frame, the event's arrival direction, the medium shadow
//                     walker across the ball's null boundary).
//
// The expected window means below are computed by h3Twins.ts; tests/witnesses/h3Twins.test.ts
// recomputes them and checks them against the on-axis closed form and an independent Monte Carlo
// estimate, so a stale constant fails vitest.

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

// ---------------------------------------------------------------------------
// h3-disk-light / h3-point-light — a lambert disk receiver of radius 0.5 about o in the plane
// y = 0 (normal +y), seen from 45° above at distance 1.13. The readout window lies inside the
// receiver with margin (a window of 0.3 still misses no point of it).
// ---------------------------------------------------------------------------

export const H3_RECEIVER = { rho: 0.5, albedo: 0.5 };
export const H3_CAMERA: { position: Vec3; target: Vec3 } = { position: [0, 0.8, 0.8], target: [0, 0, 0] };
/** The disk light: center exp_o((0, 1, 0)), facing down, geodesic radius 0.6, radiance 2. */
export const H3_DISK_LIGHT = { position: [0, 1, 0] as Vec3, normal: [0, -1, 0] as Vec3, radius: 0.6, emission: 2 };
/** The point light: exp_o((0, 1, 0)), intensity 1.5. */
export const H3_POINT_LIGHT = { position: [0, 1, 0] as Vec3, emission: 1.5 };

/** Window means of (albedo/π)·E over H3_WINDOW (h3Twins.windowMean with 4×4 points per pixel; 2×2
 *  points change them by 2e-6). For scale, the receiver's center reads 0.172758 under the disk
 *  light (Le·π·sin²β, tan β = tanh 0.6/sinh 1) and 0.172857 under the point light (I/sinh² 1). */
export const H3_DISK_WINDOW_MEAN = 0.1633994;
export const H3_POINT_WINDOW_MEAN = 0.1607533;

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
    name: 'H³ Point Light on a Disk',
    ambientSpace: { type: 'hyperbolic' },
    objects: [receiverObject],
    materials: receiverMaterials,
    lights: [{ kind: 'point', ...H3_POINT_LIGHT }],
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

// ---------------------------------------------------------------------------
// h3-medium — a scattering ball (radius 0.5 about o; σ_s 1.5, σ_a 0.2, HG g = 0.3) under a disk
// light, over a lambert disk 0.7 below o that catches its shadow.
// ---------------------------------------------------------------------------

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
    lights: [{ kind: 'disk', position: [0.3, 1.1, 0], normal: [0, -1, 0], radius: 0.5, emission: 4 }],
};

export const h3MediumNeeStrategy: RenderStrategy = {
    id: 'pt-nee',
    measurement: { camera: { type: 'pinhole', fov: 1.0 }, maxBounces: 8 },
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
// The registry entries (spread into witnessSuite by tests/witnesses/index.ts).
// ---------------------------------------------------------------------------

const posed = (position: Vec3, target: Vec3, ...strategies: RenderStrategy[]) => strategies.map((s) => withPose(s, position, target));

export const h3Suite: Record<string, SceneSuiteEntry> = {
    'h3-furnace': {
        scene: h3Furnace,
        strategies: posed([0, 0, 0], [0, 0, -1], h3FurnaceStrategy),
        exercises: 'H³ (hyperboloid model): six emissive lambert planes enclosing o — spawn, the plane intersection, escapes and emission bookkeeping in curved space',
        expected: `every pixel = Σ_{k≤6} 0.8^k = ${H3_FURNACE_VALUE.toFixed(6)} exactly (every path scores the same number)`,
        witness: {
            spp: 16,
            checks: [{ kind: 'mean', value: H3_FURNACE_VALUE, tol: 0.004, label: 'H³ furnace Σ_{k≤6} 0.8^k' }],
        },
    },
    'h3-disk-light': {
        scene: h3DiskLight,
        strategies: posed(H3_CAMERA.position, H3_CAMERA.target, h3DirectNeeStrategy, h3DirectMisStrategy, h3DirectPtStrategy),
        exercises: 'H³ disk light on a lambert disk, direct light only: the uniform-area sampler on a geodesic disk, the sinh² r area density, the emitter cosine at the arrival direction, disk_light_pdf under MIS, the plane and disk bodies',
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
        strategies: posed(H3_CAMERA.position, H3_CAMERA.target, h3DirectNeeStrategy, h3DirectMisStrategy),
        exercises: 'H³ point light on a lambert disk: the I/sinh² d falloff and the direction to the light',
        expected: `window mean ${H3_POINT_WINDOW_MEAN} (I·cos θ/sinh² d integrated over the window, h3Twins.ts) under pt-nee and pt-mis`,
        witness: {
            size: H3_SIZE,
            spp: 64,
            checks: [
                { kind: 'mean', value: H3_POINT_WINDOW_MEAN, tol: 0.002, region: H3_WINDOW, strategy: 0, label: 'H³ point light, pt-nee = closed form' },
                { kind: 'mean', value: H3_POINT_WINDOW_MEAN, tol: 0.002, region: H3_WINDOW, strategy: 1, label: 'H³ point light, pt-mis = closed form' },
            ],
        },
    },
    'h3-medium': {
        scene: h3Medium,
        strategies: posed([0, 0.3, 1.6], [0, 0, 0], h3MediumNeeStrategy, h3MediumMisStrategy, h3MediumPtStrategy),
        exercises: 'H³ homogeneous scattering ball under a disk light, over a disk that catches its shadow: hg at the event point (metric cosine, ambient_frame basis), the event arrival direction, medium NEE through the null boundary (the media shadow walker), the medium-side MIS weight',
        expected: 'keys 1 (pt-nee), 2 (pt-mis), 3 (pt) converge to the same image',
        witness: {
            spp: 256,
            checks: [
                { kind: 'equality', strategies: [0, 1], meanTol: 0.02, label: 'H³ medium nee ≡ mis' },
                { kind: 'equality', strategies: [0, 2], meanTol: 0.02, rmse: 0.65, label: 'H³ medium pt tripwire' },
            ],
        },
    },
};
