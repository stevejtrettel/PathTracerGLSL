// tests/witnesses/scenes/seifertWeberWitness.ts — the Seifert–Weber space H³/Γ
// (components/quotient/seifert-weber; docs/claude-2026-11-review/quotients-plan.md, Q2.6).
//
// FIRST-HIT WINDOWS (`seifert-weber-windows`; detects wrong pairings; exact): three emissive
// spheres of different colors at generic positions in the dodecahedral domain D (no symmetry of
// D preserves the scene, so a wrong twist or face order cannot render the same picture), seen by
// a pinhole camera in D with maxBounces 0 and farClip R = 6. A camera ray reads the emission of
// the first sphere image it meets within R, or 0. Each window below is certified by the float64
// twin (tests/helpers/seifertWeberTwin.ts: brute force over the sphere images γ·S in the cover,
// not the walk): with a one-pixel margin every film point sees one image of sphere `sphere`
// through `crossings` face crossings, or nothing within R. So the window's mean is exactly that
// sphere's emission (or 0), whatever the samples. tests/witnesses/seifertWeberWindows.test.ts
// re-derives every window from the scene as authored and shows that a twist of 1/10 turn in place
// of 3/10 changes every window seen across a face.
//
// ESTIMATOR EQUALITY (`seifert-weber-lights`): three lambert balls and a disk light near face 0 of
// D (so whether a light image is in NEE's 13-image table changes across the picture), maxBounces
// 3, farClip 8. pt, pt-nee and pt-mis must converge to the same image: NEE samples the 13 images
// of S13 and MIS names a BSDF hit's image by its crossing count, and partition MIS is unbiased
// only if the two agree (quotients-plan.md, Q2.2 and Q2.3).
//
// WALK COUNTER (report only): both scenes also count, on the GPU, the walk's capped segments,
// the most faces one segment crossed and the largest constraint drift after a crossing (the
// runner's `walk-counter` check), since the float32 twin does not model GLSL builtins.

import type { SceneDescription, RenderStrategy, Vec3 } from '../../../src/compiler/types.js';
import { withPose } from '../../../src/authoring/strategy.js';
import { swMaxCrossings } from '../../../src/components/quotient/seifert-weber/seifert-weber.js';
import { pixelWindowRegion } from '../types.js';

const view = { tonemap: { type: 'reinhard' as const } };
const space = { type: 'hyperbolic' as const, quotient: { kind: 'seifert-weber' as const } };

// ---- first-hit windows -------------------------------------------------------------------------

export const SW_WINDOWS_R = 6;
export const SW_WINDOWS_FOV = 0.5;
export const SW_WINDOWS_IMAGE: [number, number] = [160, 120];
export const SW_WINDOWS_CAMERA: { position: Vec3; target: Vec3 } = { position: [-0.12, -0.08, 0.5], target: [0.3, 0.1, -1] };

/** The spheres in D (centers in exp coordinates at o), each a black lambert emitter. */
export const SW_WINDOWS_SPHERES: Array<{ center: Vec3; radius: number; emission: Vec3 }> = [
    { center: [0.42, 0.18, -0.25], radius: 0.3, emission: [4, 0.6, 0.3] },
    { center: [-0.35, 0.4, 0.15], radius: 0.26, emission: [0.4, 3, 0.8] },
    { center: [0.05, -0.45, -0.38], radius: 0.33, emission: [0.5, 0.9, 4] },
];

/** A window of pixels [x0, x0 + nx) × [y0, y0 + ny), origin bottom-left: every film point of it
 *  (and of a one-pixel margin) sees one image of sphere `sphere` through `crossings` face
 *  crossings, or nothing within R ('miss'). */
export interface SwWindow { x0: number; y0: number; nx: number; ny: number; sphere: number | 'miss'; crossings?: number }

export const SW_WINDOWS: SwWindow[] = [
    { x0: 23, y0: 2, nx: 8, ny: 8, sphere: 2, crossings: 0 },
    { x0: 147, y0: 30, nx: 8, ny: 8, sphere: 0, crossings: 0 },
    { x0: 28, y0: 106, nx: 8, ny: 8, sphere: 1, crossings: 1 },
    { x0: 35, y0: 62, nx: 8, ny: 8, sphere: 0, crossings: 2 },
    { x0: 141, y0: 16, nx: 6, ny: 6, sphere: 2, crossings: 2 },
    { x0: 29, y0: 18, nx: 3, ny: 3, sphere: 1, crossings: 2 },
    { x0: 11, y0: 28, nx: 3, ny: 3, sphere: 0, crossings: 3 },
    { x0: 5, y0: 20, nx: 2, ny: 2, sphere: 2, crossings: 3 },
    { x0: 67, y0: 33, nx: 2, ny: 2, sphere: 1, crossings: 3 },
    { x0: 141, y0: 8, nx: 2, ny: 2, sphere: 'miss' },
    { x0: 118, y0: 26, nx: 2, ny: 2, sphere: 'miss' },
];

/** The window's expected mean: its sphere's emission, or 0. */
export const swWindowValue = (w: SwWindow): Vec3 => (w.sphere === 'miss' ? [0, 0, 0] : SW_WINDOWS_SPHERES[w.sphere].emission);
export const swWindowRegion = (w: SwWindow) => pixelWindowRegion(w, SW_WINDOWS_IMAGE);

export const seifertWeberWindows: SceneDescription = {
    id: 'seifert-weber-windows',
    name: 'Seifert–Weber first-hit windows (quotient)',
    ambientSpace: space,
    objects: SW_WINDOWS_SPHERES.map((s, i) => ({
        type: 'sphere' as const, parameters: { center: s.center, radius: s.radius }, material: `lamp_${i}`, name: `lamp_${i}`,
    })),
    materials: Object.fromEntries(SW_WINDOWS_SPHERES.map((s, i) => [`lamp_${i}`, { model: 'lambert' as const, albedo: 0, emission: s.emission }])),
    lights: [],
};

export const seifertWeberWindowsStrategy: RenderStrategy = withPose({
    id: 'pt',
    measurement: { camera: { type: 'pinhole', fov: SW_WINDOWS_FOV }, maxBounces: 0, farClip: SW_WINDOWS_R },
    estimator: { directLighting: 'none', russianRoulette: null, accumulation: { type: 'average' } },
    view,
}, SW_WINDOWS_CAMERA.position, SW_WINDOWS_CAMERA.target);

// ---- estimator equality with a disk light near a face --------------------------------------------

export const SW_LIGHTS_R = 8;
const PHI = (1 + Math.sqrt(5)) / 2;
/** Face 0's unit direction at o, (0, 1, φ) normalized; the face is r_in = 0.996 away. */
const FACE0: Vec3 = [0, 1 / Math.hypot(1, PHI), PHI / Math.hypot(1, PHI)];

export const seifertWeberLights: SceneDescription = {
    id: 'seifert-weber-lights',
    name: 'Seifert–Weber disk light near a face (pt = pt-nee = pt-mis)',
    ambientSpace: space,
    objects: [
        { type: 'sphere', parameters: { center: [-0.35, -0.3, 0.1], radius: 0.3 }, material: 'bone', name: 'bone_ball' },
        { type: 'sphere', parameters: { center: [0.4, -0.25, -0.3], radius: 0.28 }, material: 'slate', name: 'slate_ball' },
        { type: 'sphere', parameters: { center: [-0.1, 0.35, -0.45], radius: 0.25 }, material: 'rust', name: 'rust_ball' },
    ],
    materials: {
        bone: { model: 'lambert', albedo: [0.75, 0.7, 0.65] },
        slate: { model: 'lambert', albedo: [0.3, 0.55, 0.75] },
        rust: { model: 'lambert', albedo: [0.8, 0.45, 0.3] },
    },
    lights: [
        // 0.62 along face 0's direction (0.38 from the face), facing the face: its light leaves D
        // through face 0 and its neighbors, so D is lit mostly by its copies in the cells across
        // the faces — the copy across face 1 (one crossing, image 2 of the table) faces into D
        // through face 1. A BSDF ray that hits it must be named image 2 for MIS to weight it.
        { kind: 'disk', position: [0, 0.62 * FACE0[1], 0.62 * FACE0[2]], normal: FACE0, radius: 0.3, emission: [20, 18, 15] },
    ],
};

const lightsStrategy = (id: string, directLighting: 'none' | 'nee' | 'mis'): RenderStrategy => withPose({
    id,
    measurement: { camera: { type: 'pinhole', fov: 1.1 }, maxBounces: 3, farClip: SW_LIGHTS_R },
    estimator: { directLighting, russianRoulette: null, accumulation: { type: 'average' } },
    view,
}, [0.15, -0.1, -0.7], [0, 0.3, 1]);

export const seifertWeberLightsStrategies: RenderStrategy[] = [
    lightsStrategy('pt', 'none'),
    lightsStrategy('pt-nee', 'nee'),
    lightsStrategy('pt-mis', 'mis'),
];

/** The walks' crossing caps, QUOTIENT_MAX_CROSSINGS = ⌈4·farClip⌉ + 32, for the counter's report. */
export const SW_WINDOWS_CAP = swMaxCrossings(SW_WINDOWS_R);
export const SW_LIGHTS_CAP = swMaxCrossings(SW_LIGHTS_R);
