// tests/witnesses/scenes/h2xrWitness.ts
// The H²×R witnesses (the product of the hyperbolic plane and the line; height y, the H² part on
// the hyperboloid). Every scene sits within about 1.5 of the world origin. The space is not
// isotropic, so the light falloff depends on the direction: a point light's irradiance is
// I·cos θ/J with J = d²·sinh(D_H)/D_H (D_H the H² distance), and the witnesses place their lights
// obliquely (about 45° from the vertical), where the isotropic candidates are far off.
//
//   h2xr-furnace     — a closed box of four vertical planes and two horizontal planes, each at
//                      distance 0.5 from o (2·tanh²0.5 < 1, so the H² square closes), holding an
//                      emissive ball and an emissive capped cylinder; every surface lambert ρ = 0.8,
//                      Le = 1, maxBounces 6, pt: every pixel Σ_{k≤6} 0.8^k = 3.951424, through a
//                      pinhole at o and a fisheye away from o. It checks bookkeeping (no ray escapes
//                      the box, no NaN, spawns stay inside), not where a surface is hit or its normal.
//   h2xr-disk-light  — a horizontal lambert disk receiver under a large horizontal disk light facing
//                      down, its center off to the side, maxBounces 1: pt, pt-nee and pt-mis against
//                      the closed form integrated over the window (h2xrTwins.ts).
//   h2xr-point-light — two oblique point lights on lambert receivers, each read in its own window:
//                      the horizontal disk, a vertical wall (a plane with a horizontal normal), a ball
//                      placed with a height and a rotated, offset center row, and a capped cylinder
//                      (its wall and its top cap); power nee, mis and uniform nee against the twin.
//   h2xr-sky         — black ball ({param}-driven placement), cylinder, vertical plane, floor plane
//                      and horizontal disk under the procedural sky 1 + key, seen from a camera
//                      displaced from o: the frame mean against the twin (every first hit by the fp64
//                      roots, the sky at its key otherwise), pinhole and fisheye.
//
// The expected values are computed by h2xrTwins.ts; tests/witnesses/h2xrTwins.test.ts recomputes
// them, checks the windows (covered by their object, unshadowed), and states what the isotropic
// densities, the Euclidean disk-radius map, the view direction in place of the sky key and a plain
// the ball's height shift dropped would read instead.

import type { SceneDescription, RenderStrategy, Vec3 } from '../../../src/compiler/types.js';
import type { SceneSuiteEntry, WitnessRegion } from '../types.js';
import { withPose } from '../../../src/authoring/strategy.js';

export const H2XR_SIZE: [number, number] = [160, 120];
/** A readout window in whole pixels of H2XR_SIZE (x0, y0 the bottom-left pixel, origin bottom-left). */
const px = (x0: number, y0: number, w: number, h: number): WitnessRegion => ({ x: x0 / 160, y: y0 / 120, w: w / 160, h: h / 120 });

// ---------------------------------------------------------------------------
// h2xr-furnace
// ---------------------------------------------------------------------------

export const H2XR_FURNACE_VALUE = (1 - 0.8 ** 7) / (1 - 0.8);   // Σ_{k=0}^{6} 0.8^k = 3.951424

export const h2xrFurnace: SceneDescription = {
    id: 'h2xr-furnace',
    name: 'H²×R Furnace (a box with a ball and a column)',
    ambientSpace: { type: 'h2xr' },
    // Inward normals: each plane's solid is the outside of the box, so a ray inside meets front faces
    // and receives their emission (emission keys on region_to). The ball and the column are solids
    // inside the box, met from outside.
    objects: [
        ...([[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]] as Vec3[]).map((normal) => ({
            type: 'plane' as const, parameters: { normal, offset: 0.5 }, material: 'furnace',
        })),
        { type: 'sphere', parameters: { center: [0.2, -0.2, -0.25] as Vec3, radius: 0.12 }, material: 'furnace' },
        { type: 'cylinder', parameters: { center: [-0.22, 0.05, -0.2] as Vec3, radius: 0.1, halfHeight: 0.2 }, material: 'furnace' },
    ],
    materials: { furnace: { model: 'lambert', albedo: [0.8, 0.8, 0.8], emission: [1, 1, 1] } },
    lights: [],
};

export const h2xrFurnaceStrategy: RenderStrategy = {
    id: 'pt',
    measurement: { camera: { type: 'pinhole', fov: 1.0 }, maxBounces: 6 },
    estimator: { directLighting: 'none', russianRoulette: null, accumulation: { type: 'average' } },
    view: { tonemap: { type: 'reinhard' } },
};
export const h2xrFurnaceFisheyeStrategy: RenderStrategy = {
    ...h2xrFurnaceStrategy, id: 'pt-fisheye',
    measurement: { ...h2xrFurnaceStrategy.measurement, camera: { type: 'fisheye', fov: 3.0, projection: 'equidistant' } },
};

// ---------------------------------------------------------------------------
// h2xr-disk-light — a lambert disk receiver of radius 0.5 about o in the plane y = 0 (normal +y),
// seen from 45° above, under a disk light of radius 1.2 at height 1 whose center is 0.6 off to the
// side. At this radius a wrong uniform-area radius map is visible (H³ measured +4.8% for the
// Euclidean map at radius 1.2, 0.44% at 0.6).
// ---------------------------------------------------------------------------

export const H2XR_RECEIVER = { rho: 0.5, albedo: 0.5 };
export const H2XR_DISK_CAMERA: { position: Vec3; target: Vec3 } = { position: [0, 0.8, 0.8], target: [0, 0, 0] };
export const H2XR_DISK_FOV = 0.8;
export const H2XR_DISK_WINDOW: WitnessRegion = { x: 0.375, y: 0.375, w: 0.25, h: 0.25 };
export const H2XR_DISK_LIGHT = { position: [0.6, 1, 0] as Vec3, normal: [0, -1, 0] as Vec3, radius: 1.2, emission: 2 };
/** The window mean of (albedo/π)·E (h2xrTwins.windowMean, 2×2 points per pixel). */
export const H2XR_DISK_WINDOW_MEAN = 0.4991630;

const receiverObject = {
    type: 'disk' as const, parameters: { center: [0, 0, 0] as Vec3, radius: H2XR_RECEIVER.rho, normal: [0, 1, 0] as Vec3 }, material: 'receiver',
};
const receiverMaterial = { model: 'lambert' as const, albedo: [0.5, 0.5, 0.5] as Vec3 };

export const h2xrDiskLight: SceneDescription = {
    id: 'h2xr-disk-light',
    name: 'H²×R Disk Light on a Disk',
    ambientSpace: { type: 'h2xr' },
    objects: [receiverObject],
    materials: { receiver: receiverMaterial },
    lights: [{ kind: 'disk', ...H2XR_DISK_LIGHT }],
};

/** maxBounces 1: each receiver's radiance is exactly its direct lighting. */
export const h2xrDirectNeeStrategy: RenderStrategy = {
    id: 'pt-nee',
    measurement: { camera: { type: 'pinhole', fov: H2XR_DISK_FOV }, maxBounces: 1 },
    estimator: { directLighting: 'nee', russianRoulette: null, accumulation: { type: 'average' } },
    view: { tonemap: { type: 'reinhard' } },
};
export const h2xrDirectMisStrategy: RenderStrategy = {
    ...h2xrDirectNeeStrategy, id: 'pt-mis', estimator: { ...h2xrDirectNeeStrategy.estimator, directLighting: 'mis' },
};
export const h2xrDirectPtStrategy: RenderStrategy = {
    ...h2xrDirectNeeStrategy, id: 'pt', estimator: { ...h2xrDirectNeeStrategy.estimator, directLighting: 'none' },
};

// ---------------------------------------------------------------------------
// h2xr-point-light — the receiver disk, a vertical wall 0.75 behind o (normal +z), a ball of radius
// 0.3 placed by T((0.42, 0.15, −0.3))·R(0.9 about y)·T((0.12, 0.1, 0)), and a capped cylinder of radius
// 0.25 and half-height 0.25 centered at exp_o((−0.5, 0, −0.3)); all lambert 0.5. Two point lights at
// about 45° from the vertical over the receiver. Each window is covered by its object and
// unshadowed from both lights (h2xrTwins.test.ts).
// ---------------------------------------------------------------------------

export const H2XR_POINT_CAMERA: { position: Vec3; target: Vec3 } = { position: [0, 0.95, 0.9], target: [0, 0.05, -0.3] };
export const H2XR_POINT_FOV = 1.3;
export const H2XR_POINT_LIGHTS = [
    { position: [0.6, 1, 0.45] as Vec3, emission: 1.5 },
    { position: [-0.35, 0.9, 0.55] as Vec3, emission: 0.8 },
];
export const H2XR_BALL = { center: [0.12, 0.1, 0] as Vec3, radius: 0.3, position: [0.42, 0.15, -0.3] as Vec3, angle: 0.9 };
export const H2XR_COLUMN = { center: [-0.5, 0, -0.3] as Vec3, radius: 0.25, halfHeight: 0.25 };
export const H2XR_WALL = { normal: [0, 0, 1] as Vec3, offset: 0.75 };
/** The windows, each on one surface: the disk, the wall, the ball, the cylinder's wall and top cap. */
export const H2XR_POINT_WINDOWS: Record<'disk' | 'wall' | 'ball' | 'column' | 'cap', WitnessRegion> = {
    disk: px(64, 20, 32, 31),
    wall: px(51, 83, 36, 36),
    ball: px(94, 67, 15, 16),
    column: px(54, 54, 10, 8),
    cap: px(53, 66, 10, 8),
};
/** The window means of (albedo/π)·Σ I·cos θ/J (h2xrTwins.windowMean, 2×2 points per pixel). */
export const H2XR_POINT_WINDOW_MEANS: Record<'disk' | 'wall' | 'ball' | 'column' | 'cap', number> = {
    disk: 0.2252589, wall: 0.0916891, ball: 0.2726837, column: 0.1287049, cap: 0.0998508,
};

const lambert = { model: 'lambert' as const, albedo: [0.5, 0.5, 0.5] as Vec3 };

export const h2xrPointLight: SceneDescription = {
    id: 'h2xr-point-light',
    name: 'H²×R Point Lights on a Disk, a Wall, a Ball and a Column',
    ambientSpace: { type: 'h2xr' },
    objects: [
        receiverObject,
        { type: 'plane', parameters: H2XR_WALL, material: 'wall' },
        {
            type: 'sphere', parameters: { center: H2XR_BALL.center, radius: H2XR_BALL.radius }, material: 'ball',
            transform: { position: H2XR_BALL.position, rotation: { axis: [0, 1, 0], angle: H2XR_BALL.angle } },
        },
        { type: 'cylinder', parameters: H2XR_COLUMN, material: 'column' },
    ],
    materials: { receiver: receiverMaterial, wall: lambert, ball: lambert, column: lambert },
    lights: H2XR_POINT_LIGHTS.map((l) => ({ kind: 'point' as const, ...l })),
};

const pointNee: RenderStrategy = { ...h2xrDirectNeeStrategy, measurement: { ...h2xrDirectNeeStrategy.measurement, camera: { type: 'pinhole', fov: H2XR_POINT_FOV } } };
export const h2xrPointNeeStrategy = pointNee;
export const h2xrPointMisStrategy: RenderStrategy = { ...pointNee, id: 'pt-mis', estimator: { ...pointNee.estimator, directLighting: 'mis' } };
export const h2xrPointUniformStrategy: RenderStrategy = { ...pointNee, id: 'pt-nee-uniform', estimator: { ...pointNee.estimator, lightSelection: 'uniform' } };

// ---------------------------------------------------------------------------
// h2xr-sky — black objects (albedo 0: a hit reads 0) under the procedural sky L(k) = 1 + k per channel
// at the sky key k. The camera is 1.2 from o horizontally, where the key differs from the view
// direction. The ball is placed by g = T(position)·R(angle about y)·T(center row), position and angle
// {param}-driven (the mat4 uniform), position and center row both with a height, so the decode of
// the height shift, the composition of shifts and the rotation all move it.
// ---------------------------------------------------------------------------

export const H2XR_SKY_CAMERA: { position: Vec3; target: Vec3 } = { position: [0.9, 0.3, 0.8], target: [-0.3, 0.1, -0.4] };
export const H2XR_SKY_PINHOLE_FOV = 1.0;
export const H2XR_SKY_FISHEYE_FOV = 3.0;
export const H2XR_SKY_BALL = { center: [0.25, 0.1, 0] as Vec3, radius: 0.25, position: [-0.2, 0.25, -0.3] as Vec3, angle: 1.1 };
export const H2XR_SKY_OBJECTS = {
    cylinder: { center: [0.3, 0, -0.7] as Vec3, radius: 0.2, halfHeight: 0.3 },
    wall: { normal: [1, 0, 0.3] as Vec3, offset: 1.3 },
    floor: { normal: [0, 1, 0] as Vec3, offset: 0.7 },
    disk: { center: [-0.5, 0.7, -0.2] as Vec3, radius: 0.3, normal: [0, 1, 0] as Vec3 },
};
/** Whole-frame means of the sky 1 + key where the camera ray misses everything, 0 where it hits
 *  (h2xrTwins.regionMean, 2×2 points per pixel). */
export const H2XR_SKY_PINHOLE_MEAN: [number, number, number] = [0.2869912, 0.3681798, 0.2098256];
export const H2XR_SKY_FISHEYE_MEAN: [number, number, number] = [0.6585553, 0.7000690, 0.6263860];

export const h2xrSky: SceneDescription = {
    id: 'h2xr-sky',
    name: 'H²×R Sky Key and Silhouettes',
    ambientSpace: { type: 'h2xr' },
    objects: [
        {
            type: 'sphere', parameters: { center: H2XR_SKY_BALL.center, radius: H2XR_SKY_BALL.radius }, material: 'black',
            transform: {
                position: { param: 'ball.position', default: H2XR_SKY_BALL.position },
                rotation: { axis: [0, 1, 0], angle: { param: 'ball.angle', default: H2XR_SKY_BALL.angle, min: 0, max: 6.3 } },
            },
        },
        { type: 'cylinder', parameters: H2XR_SKY_OBJECTS.cylinder, material: 'black' },
        { type: 'plane', parameters: H2XR_SKY_OBJECTS.wall, material: 'black' },
        { type: 'plane', parameters: H2XR_SKY_OBJECTS.floor, material: 'black' },
        { type: 'disk', parameters: H2XR_SKY_OBJECTS.disk, material: 'black' },
    ],
    materials: { black: { model: 'lambert', albedo: [0, 0, 0] } },
    lights: [],
    environment: { type: 'procedural', glsl: { kind: 'glsl', source: 'vec3(1.0) + dir' }, sampleAsLight: false },
};

export const h2xrSkyPinholeStrategy: RenderStrategy = {
    id: 'pt',
    measurement: { camera: { type: 'pinhole', fov: H2XR_SKY_PINHOLE_FOV }, maxBounces: 1 },
    estimator: { directLighting: 'none', russianRoulette: null, accumulation: { type: 'average' } },
    view: { tonemap: { type: 'reinhard' } },
};
export const h2xrSkyFisheyeStrategy: RenderStrategy = {
    ...h2xrSkyPinholeStrategy, id: 'pt-fisheye',
    measurement: { ...h2xrSkyPinholeStrategy.measurement, camera: { type: 'fisheye', fov: H2XR_SKY_FISHEYE_FOV, projection: 'equidistant' } },
};

// ---------------------------------------------------------------------------
// The registry entries (spread into witnessSuite by tests/witnesses/index.ts).
// ---------------------------------------------------------------------------

const posed = (position: Vec3, target: Vec3, ...strategies: RenderStrategy[]) => strategies.map((s) => withPose(s, position, target));
const W = H2XR_POINT_WINDOWS, M = H2XR_POINT_WINDOW_MEANS;

export const h2xrSuite: Record<string, SceneSuiteEntry> = {
    'h2xr-furnace': {
        scene: h2xrFurnace,
        strategies: [
            ...posed([0, 0, 0], [0, 0, -1], h2xrFurnaceStrategy),
            ...posed([0.15, 0.1, 0.2], [-0.3, 0.05, -1], h2xrFurnaceFisheyeStrategy),
        ],
        exercises: 'H²×R: a closed box of vertical and horizontal planes with a ball and a column inside, all emissive lambert — the geodesic flow, spawn, escapes and emission bookkeeping; the fisheye away from o',
        expected: `every pixel = Σ_{k≤6} 0.8^k = ${H2XR_FURNACE_VALUE.toFixed(6)} exactly, through the pinhole and the fisheye`,
        witness: {
            spp: 16,
            checks: [
                { kind: 'mean', value: H2XR_FURNACE_VALUE, tol: 0.004, strategy: 0, label: 'H²×R furnace Σ_{k≤6} 0.8^k (pinhole)' },
                { kind: 'mean', value: H2XR_FURNACE_VALUE, tol: 0.004, strategy: 1, label: 'H²×R furnace Σ_{k≤6} 0.8^k (fisheye)' },
            ],
        },
    },
    'h2xr-disk-light': {
        scene: h2xrDiskLight,
        strategies: posed(H2XR_DISK_CAMERA.position, H2XR_DISK_CAMERA.target, h2xrDirectNeeStrategy, h2xrDirectMisStrategy, h2xrDirectPtStrategy),
        exercises: 'H²×R horizontal disk light (radius 1.2, off to the side) on a lambert disk, direct light only: the area density d²·sinh(D_H)/D_H, the uniform-area sampler on the H² disk, the emitter cosine at the arrival direction, disk_light_pdf under MIS',
        expected: `window mean ${H2XR_DISK_WINDOW_MEAN} (the closed form integrated over the window, h2xrTwins.ts) under pt-nee, pt-mis and pt`,
        witness: {
            size: H2XR_SIZE,
            spp: 256,
            checks: [
                { kind: 'mean', value: H2XR_DISK_WINDOW_MEAN, tol: 0.002, region: H2XR_DISK_WINDOW, strategy: 0, label: 'H²×R disk light, pt-nee = closed form' },
                { kind: 'mean', value: H2XR_DISK_WINDOW_MEAN, tol: 0.002, region: H2XR_DISK_WINDOW, strategy: 1, label: 'H²×R disk light, pt-mis = closed form' },
                { kind: 'mean', value: H2XR_DISK_WINDOW_MEAN, tol: 0.003, region: H2XR_DISK_WINDOW, strategy: 2, label: 'H²×R disk light, pt = closed form' },
                { kind: 'equality', strategies: [0, 1], meanTol: 0.02, label: 'H²×R disk light nee ≡ mis' },
            ],
        },
    },
    'h2xr-point-light': {
        scene: h2xrPointLight,
        strategies: posed(H2XR_POINT_CAMERA.position, H2XR_POINT_CAMERA.target, h2xrPointNeeStrategy, h2xrPointMisStrategy, h2xrPointUniformStrategy),
        exercises: 'H²×R point lights on a horizontal disk, a vertical wall, a placed ball and a column (wall and cap): the I·cos/J falloff, the direction to the light, the vertical-plane, Newton ball and tube roots and their normals, the placement decode and isometry_direction, power and uniform selection',
        expected: `window means disk ${M.disk}, wall ${M.wall}, ball ${M.ball}, column ${M.column}, cap ${M.cap} (h2xrTwins.ts) under nee and mis (power) and nee (uniform)`,
        witness: {
            size: H2XR_SIZE,
            spp: 64,
            checks: (['disk', 'wall', 'ball', 'column', 'cap'] as const).flatMap((k) => [0, 1, 2].map((strategy) => ({
                kind: 'mean' as const, value: M[k], tol: 0.002, region: W[k], strategy,
                label: `H²×R point lights on the ${k}, ${['pt-nee (power)', 'pt-mis (power)', 'pt-nee (uniform)'][strategy]} = closed form`,
            }))),
        },
    },
    'h2xr-sky': {
        scene: h2xrSky,
        strategies: posed(H2XR_SKY_CAMERA.position, H2XR_SKY_CAMERA.target, h2xrSkyPinholeStrategy, h2xrSkyFisheyeStrategy),
        exercises: 'H²×R sky key (the ideal point of the H² part and the angle from the vertical) for camera rays away from o, and the silhouettes of every shape: the Newton ball under a {param}-driven placement with height shifts, the cylinder, a vertical plane, a floor plane, a horizontal disk',
        expected: `frame means ${H2XR_SKY_PINHOLE_MEAN.join(', ')} (pinhole) and ${H2XR_SKY_FISHEYE_MEAN.join(', ')} (fisheye) (h2xrTwins.ts)`,
        witness: {
            size: H2XR_SIZE,
            spp: 16,
            checks: [
                { kind: 'mean', value: H2XR_SKY_PINHOLE_MEAN, tol: 0.002, strategy: 0, label: 'H²×R sky key and silhouettes, pinhole' },
                { kind: 'mean', value: H2XR_SKY_FISHEYE_MEAN, tol: 0.002, strategy: 1, label: 'H²×R sky key and silhouettes, fisheye' },
            ],
        },
    },
};
