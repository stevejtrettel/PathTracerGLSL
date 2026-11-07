// tests/witnesses/scenes/curvedShapesWitness.ts
// The witnesses of the curved box, cylinder and quad shapes and of the curved quad light (H³ and
// S³). Expected values come from the fp64 transcriptions in curvedShapeTwins.ts, which
// tests/components/curvedShapes.test.ts checks against marched membership and
// tests/witnesses/curvedShapesTwins.test.ts recomputes (a stale constant fails vitest).
//
//   h3-shapes, s3-shapes — a lambert box (rotated), cylinder (tilted) and quad under one point light,
//       pt-nee, maxBounces 1. Each readout window lies inside one lit face (checked by the twin test
//       with 4×4 points per pixel): a box face, the cylinder's tube, a cylinder cap, the quad; in S³
//       also the box face turned away from the light, lit only through the long arc. Expected: the
//       window mean of (ρ/π)·Σ_arcs I·max(0, cos θ)·visibility/S(d)² at the first hit. Catches the
//       roots (where each face is and what each pixel sees), the normals' directions (cos θ), each
//       shape's placement and struct. Not a normal's sign: the hit fill turns the normal toward the
//       arriving ray (the sign is the vitest outwardness check's).
//   h3-quad-light, s3-quad-light — the lambert disk receiver of the H³/S³ direct-lighting witnesses
//       under a quad light (in S³ facing away, so the receiver's top is lit only through the long
//       arc), pt-nee, pt-mis and pt against the window mean of the quadrature over the quad. Catches
//       the chart-uniform sampler and its pdf (NEE, and MIS through the weights), the quad body on
//       the hit side (pt), the one-sided normal and, in S³, the arc rule.

import type { SceneDescription, RenderStrategy, Vec3 } from '../../../src/compiler/types.js';
import type { SceneSuiteEntry, WitnessRegion } from '../types.js';
import { withPose } from '../../../src/authoring/strategy.js';
import {
    H3_CAMERA, H3_RECEIVER, H3_SIZE, H3_WINDOW,
    h3DirectNeeStrategy, h3DirectMisStrategy, h3DirectPtStrategy,
} from './h3Witness.js';
import {
    S3_CAMERA, S3_RECEIVER, S3_SIZE, S3_WINDOW,
    s3DirectNeeStrategy, s3DirectMisStrategy, s3DirectPtStrategy,
} from './s3Witness.js';

export const SHAPES_SIZE: [number, number] = [160, 120];

/** One shapes scene: the camera, the point light and the three shapes (in authored form), the
 *  readout windows with the face each lies on, and their expected means. */
export interface ShapesFixture {
    pose: { position: Vec3; target: Vec3 };
    fov: number;
    light: { position: Vec3; intensity: number };
    albedo: number;
    box: { halfSize: Vec3; position: Vec3; rotation: { axis: Vec3; angle: number } };
    cylinder: { radius: number; halfHeight: number; position: Vec3; rotation: { axis: Vec3; angle: number } };
    quad: { corner: Vec3; edge1: Vec3; edge2: Vec3 };
    windows: Array<{ label: string; face: string; region: WitnessRegion; mean: number }>;
}

const pixels = (px0: number, px1: number, py0: number, py1: number): WitnessRegion =>
    ({ x: px0 / SHAPES_SIZE[0], y: py0 / SHAPES_SIZE[1], w: (px1 - px0) / SHAPES_SIZE[0], h: (py1 - py0) / SHAPES_SIZE[1] });

/** A quad with the given center and orthogonal edges, authored by its corner. */
const centeredQuad = (center: Vec3, edge1: Vec3, edge2: Vec3) => ({
    corner: [center[0] - 0.5 * (edge1[0] + edge2[0]), center[1] - 0.5 * (edge1[1] + edge2[1]), center[2] - 0.5 * (edge1[2] + edge2[2])] as Vec3,
    edge1, edge2,
});

const SHAPES_COMMON = {
    light: { position: [0.4, 1.0, 1.0] as Vec3, intensity: 6 },
    albedo: 0.5,
    box: { halfSize: [0.25, 0.22, 0.25] as Vec3, position: [-0.6, 0, 0] as Vec3, rotation: { axis: [0, 1, 0] as Vec3, angle: 0.5 } },
    cylinder: { radius: 0.2, halfHeight: 0.3, position: [0.02, 0, -0.1] as Vec3, rotation: { axis: [1, 0, 0] as Vec3, angle: 0.35 } },
    quad: centeredQuad([0.62, 0, 0.05], [0.45, 0, 0.2], [0, 0.45, 0]),
};

/** Window means: shapesWindowMean (curvedShapeTwins.ts), 2×2 points per pixel (4×4 changes them by
 *  at most 9e-5 relative). */
export const H3_SHAPES: ShapesFixture = {
    ...SHAPES_COMMON,
    pose: { position: [0, 0.55, 1.0], target: [0, 0, 0] },
    fov: 1.2,
    windows: [
        { label: 'box face', face: 'box +z', region: pixels(30, 50, 52, 62), mean: 0.1182566 },
        { label: 'cylinder cap', face: 'cylinder cap', region: pixels(74, 88, 74, 79), mean: 0.2569326 },
        { label: 'cylinder tube', face: 'cylinder tube', region: pixels(76, 86, 55, 65), mean: 0.1083347 },
        { label: 'quad', face: 'quad', region: pixels(106, 120, 55, 65), mean: 0.1690319 },
    ],
};

export const S3_SHAPES: ShapesFixture = {
    ...SHAPES_COMMON,
    light: { position: [0.5, 1.1, 0.9], intensity: 6 },
    pose: { position: [0, 0.6, 1.2], target: [0, 0, 0] },
    fov: 1.7,
    windows: [
        { label: 'box face', face: 'box +z', region: pixels(34, 50, 49, 59), mean: 0.6585887 },
        { label: 'box face lit through the long arc', face: 'box -x', region: pixels(14, 22, 50, 60), mean: 0.0474942 },
        { label: 'cylinder cap', face: 'cylinder cap', region: pixels(72, 84, 72, 78), mean: 0.8917797 },
        { label: 'cylinder tube', face: 'cylinder tube', region: pixels(74, 84, 52, 62), mean: 0.2119552 },
        { label: 'quad', face: 'quad', region: pixels(108, 128, 55, 64), mean: 0.4805224 },
    ],
};

function shapesScene(id: string, name: string, space: 'hyperbolic' | 'spherical', f: ShapesFixture): SceneDescription {
    return {
        id, name,
        ambientSpace: { type: space },
        objects: [
            { type: 'box', parameters: { halfSize: f.box.halfSize }, transform: { position: f.box.position, rotation: f.box.rotation }, material: 'white' },
            { type: 'cylinder', parameters: { radius: f.cylinder.radius, halfHeight: f.cylinder.halfHeight }, transform: { position: f.cylinder.position, rotation: f.cylinder.rotation }, material: 'white' },
            { type: 'quad', parameters: f.quad, material: 'white' },
        ],
        materials: { white: { model: 'lambert', albedo: [f.albedo, f.albedo, f.albedo] } },
        lights: [{ kind: 'point', position: f.light.position, emission: f.light.intensity }],
    };
}

export const h3Shapes = shapesScene('h3-shapes', 'H³ Box, Cylinder and Quad', 'hyperbolic', H3_SHAPES);
export const s3Shapes = shapesScene('s3-shapes', 'S³ Box, Cylinder and Quad', 'spherical', S3_SHAPES);

const shapesStrategy = (fov: number): RenderStrategy => ({
    id: 'pt-nee',
    measurement: { camera: { type: 'pinhole', fov }, maxBounces: 1 },
    estimator: { directLighting: 'nee', russianRoulette: null, accumulation: { type: 'average' } },
    view: { tonemap: { type: 'reinhard' } },
});

// ---------------------------------------------------------------------------
// Quad lights over the direct-lighting receivers.
// ---------------------------------------------------------------------------

/** H³: centered 1 above the receiver, facing down (ê1×ê2 = x×z = −y), half-widths 0.6 and 0.5. */
export const H3_QUAD_LIGHT = { ...centeredQuad([0, 1, 0], [1.2, 0, 0], [0, 0, 1.0]), emission: 2 };
/** S³: centered 1 below the receiver, facing down (away from it), half-widths 0.8: the receiver's
 *  top is lit only through the long arc. */
export const S3_QUAD_LIGHT = { ...centeredQuad([0, -1, 0], [1.6, 0, 0], [0, 0, 1.6]), emission: 1 };

/** Window means of (albedo/π)·E over the receiver windows (quadIrradiance, 24×24 Gauss–Legendre
 *  points over the quad's chart; 2×2 points per pixel). */
export const H3_QUAD_WINDOW_MEAN = 0.1749918;
export const S3_QUAD_WINDOW_MEAN = 0.3237615;

const receiver = (rho: number, albedo: number) => ({
    objects: [{ type: 'disk' as const, parameters: { center: [0, 0, 0] as Vec3, radius: rho, normal: [0, 1, 0] as Vec3 }, material: 'receiver' }],
    materials: { receiver: { model: 'lambert' as const, albedo: [albedo, albedo, albedo] as Vec3 } },
});

export const h3QuadLight: SceneDescription = {
    id: 'h3-quad-light', name: 'H³ Quad Light',
    ambientSpace: { type: 'hyperbolic' },
    ...receiver(H3_RECEIVER.rho, H3_RECEIVER.albedo),
    lights: [{ kind: 'quad', ...H3_QUAD_LIGHT }],
};

export const s3QuadLight: SceneDescription = {
    id: 's3-quad-light', name: 'S³ Quad Light through the Long Arc',
    ambientSpace: { type: 'spherical' },
    ...receiver(S3_RECEIVER.rho, S3_RECEIVER.albedo),
    lights: [{ kind: 'quad', ...S3_QUAD_LIGHT }],
};

// ---------------------------------------------------------------------------
// The registry entries (spread into witnessSuite by tests/witnesses/index.ts).
// ---------------------------------------------------------------------------

const posed = (pose: { position: Vec3; target: Vec3 }, ...strategies: RenderStrategy[]) => strategies.map((s) => withPose(s, pose.position, pose.target));

/** Each window's mean within 0.5% (one sample per path is exact up to the pixel footprint). */
const windowChecks = (space: string, f: ShapesFixture) => f.windows.map((w) => ({
    kind: 'mean' as const, value: w.mean, tol: +(0.005 * w.mean).toPrecision(2), region: w.region, strategy: 0,
    label: `${space} ${w.label} = point-light closed form`,
}));

export const curvedShapesSuite: Record<string, SceneSuiteEntry> = {
    'h3-shapes': {
        scene: h3Shapes,
        strategies: posed(H3_SHAPES.pose, shapesStrategy(H3_SHAPES.fov)),
        exercises: 'H³ box (rotated), cylinder (tilted) and quad (centered rectangle) bodies: the X = e^{2t} interval roots, the tube discriminant, the chart test, the face normals, the isometry placements and curved structs, under a point light',
        expected: `window means ${H3_SHAPES.windows.map((w) => `${w.label} ${w.mean}`).join(', ')} (curvedShapeTwins.ts) under pt-nee`,
        witness: { size: SHAPES_SIZE, spp: 32, checks: windowChecks('H³', H3_SHAPES) },
    },
    's3-shapes': {
        scene: s3Shapes,
        strategies: posed(S3_SHAPES.pose, shapesStrategy(S3_SHAPES.fov)),
        exercises: 'S³ box (rotated), cylinder (tilted, not convex) and quad bodies: the T = tan(t − φ) interval roots and crossings, the tube quadratic, the chart test with the antipodal crossing, the face normals, the placements, and a face lit only through the long arc',
        expected: `window means ${S3_SHAPES.windows.map((w) => `${w.label} ${w.mean}`).join(', ')} (curvedShapeTwins.ts) under pt-nee`,
        witness: { size: SHAPES_SIZE, spp: 32, checks: windowChecks('S³', S3_SHAPES) },
    },
    'h3-quad-light': {
        scene: h3QuadLight,
        strategies: posed(H3_CAMERA, h3DirectNeeStrategy, h3DirectMisStrategy, h3DirectPtStrategy),
        exercises: 'H³ quad light (half-widths 0.6 and 0.5) over a lambert disk: the chart-uniform sampler and its exact w³ area density, the 4D-cross normal, the MIS pdf at the arrival direction, and the quad body on the hit side',
        expected: `window mean ${H3_QUAD_WINDOW_MEAN} (quadIrradiance integrated over the window) under pt-nee, pt-mis and pt`,
        witness: {
            size: H3_SIZE,
            spp: 256,
            checks: [
                { kind: 'mean', value: H3_QUAD_WINDOW_MEAN, tol: 0.002, region: H3_WINDOW, strategy: 0, label: 'H³ quad light, pt-nee = closed form' },
                { kind: 'mean', value: H3_QUAD_WINDOW_MEAN, tol: 0.002, region: H3_WINDOW, strategy: 1, label: 'H³ quad light, pt-mis = closed form' },
                { kind: 'mean', value: H3_QUAD_WINDOW_MEAN, tol: 0.003, region: H3_WINDOW, strategy: 2, label: 'H³ quad light, pt = closed form' },
                { kind: 'equality', strategies: [0, 1], meanTol: 0.02, label: 'H³ quad light nee ≡ mis' },
            ],
        },
    },
    's3-quad-light': {
        scene: s3QuadLight,
        strategies: posed(S3_CAMERA, s3DirectNeeStrategy, s3DirectMisStrategy, s3DirectPtStrategy),
        exercises: 'S³ quad light (half-widths 0.8) facing away from a lambert disk, lighting it only through the long arc: the chart-uniform sampler, its exact w³ area density, the arc rule, the 4D-cross normal, the MIS pdf at the arrival direction, the quad body\'s antipodal crossing on the hit side',
        expected: `window mean ${S3_QUAD_WINDOW_MEAN} (quadIrradiance over both arcs integrated over the window) under pt-nee, pt-mis and pt`,
        witness: {
            size: S3_SIZE,
            spp: 256,
            checks: [
                { kind: 'mean', value: S3_QUAD_WINDOW_MEAN, tol: 0.002, region: S3_WINDOW, strategy: 0, label: 'S³ quad light, pt-nee = closed form' },
                { kind: 'mean', value: S3_QUAD_WINDOW_MEAN, tol: 0.002, region: S3_WINDOW, strategy: 1, label: 'S³ quad light, pt-mis = closed form' },
                { kind: 'mean', value: S3_QUAD_WINDOW_MEAN, tol: 0.003, region: S3_WINDOW, strategy: 2, label: 'S³ quad light, pt = closed form' },
                { kind: 'equality', strategies: [0, 1], meanTol: 0.02, label: 'S³ quad light nee ≡ mis' },
            ],
        },
    },
};

