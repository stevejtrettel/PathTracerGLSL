// tests/witnesses/scenes/curvedMaterialWitness.ts
// The curved-space witnesses of the materials beyond lambert (mirror, dielectric, ggx,
// rough_dielectric) and of the sphere light, in H³ and S³. Most scenes are one construction in both
// spaces; each sits within about 1.2 of the world origin.
//
//   e3-specular, h3-specular,
//   s3-specular                     — a closed box of six walls (planes at distance 0.5 from o) that
//                                     emit six different colors and reflect nothing, holding a mirror
//                                     ball (f0 per channel 0.9, 0.5, 0.05) and a glass ball (ior 1.5);
//                                     pt, maxBounces 6. Every pixel's expected value is a finite sum
//                                     over the delta choices (curvedMaterialTwins.specularRadiance): the
//                                     reflected and refracted directions, Fresnel at metric cosines, the
//                                     region classification that gives n_i/n_t, the far-side spawn.
//                                     e3-specular is the same scene and twin in E³, the control.
//   h3-ggx, s3-ggx                  — a ggx disk receiver (f0 0.5, roughness 0.5) under a disk light of
//                                     radius 0.5 placed in the receiver's mirror direction (in S³ facing
//                                     away from it: lit only through the long arc), maxBounces 1: pt,
//                                     pt-nee and pt-mis against the twin's quadrature of f·cos·cos/A.
//   h3-rough-glass, s3-rough-glass  — a rough glass ball (roughness 0.6, ior 1.5), lit from out of frame;
//                                     pt = pt-nee = pt-mis at 1024 spp. In H³ the h3-medium layout (a
//                                     floor, one disk light); in S³ a disk light facing the ball and a
//                                     sphere light (the two-sided query: each arc with probability ½).
//                                     At roughness 0.3 the check is firefly-dominated: the H³ layout
//                                     fails it in E³ too.
//   h3-sphere-light, s3-sphere-light — a lambert disk receiver and a sphere light: in H³ above it, in
//                                     S³ below it, where only the backward cone (geodesics that pass
//                                     −x and reach the ball's far side) lights the receiver's top. pt,
//                                     pt-nee and pt-mis against Le·∫ over the cap (the twin).
//   h3-sphere-light-blocker         — the H³ one with an opaque ball about the light's center, holding it:
//                                     0. A light distance that stops short of the light's surface
//                                     would not see the blocker.
//   s3-sphere-light-blocker         — the S³ one with an opaque ball about −o on every backward-cone
//                                     geodesic from the window: 0. A light distance that stops short of
//                                     the ball's far side would not see the blocker.
//   s3-sphere-light-antipodal       — the receiver with −x inside a large ball: every geodesic from x
//                                     meets the ball, the forward cone is the hemisphere, and the window
//                                     reads albedo·Le exactly.
//
// The expected values are computed by curvedMaterialTwins.ts; tests/witnesses/curvedMaterialTwins.test.ts
// recomputes them and checks the twins against independent estimates, so a stale constant fails vitest.

import type { SceneDescription, RenderStrategy, Vec3 } from '../../../src/compiler/types.js';
import type { SceneSuiteEntry, WitnessRegion } from '../types.js';
import type { SpecularScene, RGB } from './curvedMaterialTwins.js';
import { withPose } from '../../../src/authoring/strategy.js';

type Space = 'hyperbolic' | 'spherical';
const tag = (space: Space | 'euclidean') => (space === 'hyperbolic' ? 'h3' : space === 'spherical' ? 's3' : 'e3');
const label = (space: Space | 'euclidean') => (space === 'hyperbolic' ? 'H³' : space === 'spherical' ? 'S³' : 'E³');

export const CM_SIZE: [number, number] = [160, 120];
const posed = (pose: { position: Vec3; target: Vec3 }, ...strategies: RenderStrategy[]) =>
    strategies.map((s) => withPose(s, pose.position, pose.target));

const strategy = (id: string, directLighting: 'none' | 'nee' | 'mis', fov: number, maxBounces: number): RenderStrategy => ({
    id,
    measurement: { camera: { type: 'pinhole', fov }, maxBounces },
    estimator: { directLighting, russianRoulette: null, accumulation: { type: 'average' } },
    view: { tonemap: { type: 'reinhard' } },
});
const threeEstimators = (fov: number, maxBounces: number) => [
    strategy('pt-nee', 'nee', fov, maxBounces), strategy('pt-mis', 'mis', fov, maxBounces), strategy('pt', 'none', fov, maxBounces),
];

// ---------------------------------------------------------------------------
// specular — the box, the mirror ball and the glass ball (identical in both spaces)
// ---------------------------------------------------------------------------

/** The scene the twin traces. Wall normals point into the box (each plane's solid is beyond it, as in
 *  the furnaces), so the camera sees front faces and receives their emission. */
export const SPECULAR: SpecularScene = {
    walls: [
        { normal: [1, 0, 0], offset: 0.5, emission: [1, 0.25, 0.25] },
        { normal: [-1, 0, 0], offset: 0.5, emission: [0.25, 1, 0.25] },
        { normal: [0, 1, 0], offset: 0.5, emission: [0.25, 0.25, 1] },
        { normal: [0, -1, 0], offset: 0.5, emission: [1, 1, 0.25] },
        { normal: [0, 0, 1], offset: 0.5, emission: [0.25, 1, 1] },
        { normal: [0, 0, -1], offset: 0.5, emission: [1, 0.25, 1] },
    ],
    // f0 0.05 in blue: there the angle-dependent Schlick term is about half the reflected signal.
    mirror: { center: [-0.2, 0, -0.1], radius: 0.17, f0: [0.9, 0.5, 0.05] },
    glass: { center: [0.2, 0, -0.1], radius: 0.17, ior: 1.5 },
    maxBounces: 6,
};
export const SPECULAR_CAMERA: { position: Vec3; target: Vec3 } = { position: [0, 0.05, 0.4], target: [0, 0, -0.1] };
export const SPECULAR_FOV = 1.3;
/** Windows inside each ball's image, in both spaces (a window 0.01 wider on every side is covered too). */
export const SPECULAR_MIRROR_WINDOW: WitnessRegion = { x: 0.19, y: 0.37, w: 0.2, h: 0.26 };
export const SPECULAR_GLASS_WINDOW: WitnessRegion = { x: 0.61, y: 0.37, w: 0.2, h: 0.26 };

/** Twin window means (curvedMaterialTwins.specularRadiance, 4×4 points per pixel; 8×8 change them by
 *  less than 2e-4, curvedMaterialTwins.test.ts). */
export const SPECULAR_MEANS: Record<Space | 'euclidean', { mirror: RGB; glass: RGB }> = {
    euclidean: { mirror: [0.7621130, 0.2305780, 0.0361585], glass: [0.3044441, 0.9502499, 0.9797997] },
    hyperbolic: { mirror: [0.7759749, 0.2204886, 0.0344712], glass: [0.3013123, 0.9534038, 0.9724440] },
    spherical: { mirror: [0.7470813, 0.2413738, 0.0376624], glass: [0.3066522, 0.9464925, 0.9870994] },
};

function specularScene(space: Space | 'euclidean'): SceneDescription {
    const materials: SceneDescription['materials'] = {
        mirror: { model: 'mirror', f0: SPECULAR.mirror.f0 },
        glass: { model: 'dielectric', ior: SPECULAR.glass.ior },
    };
    SPECULAR.walls.forEach((w, i) => { materials[`wall${i}`] = { model: 'lambert', albedo: [0, 0, 0], emission: w.emission }; });
    return {
        id: `${tag(space)}-specular`,
        name: `${label(space)} Mirror and Glass Balls in a Colored Box`,
        ambientSpace: { type: space },
        objects: [
            ...SPECULAR.walls.map((w, i) => ({ type: 'plane' as const, parameters: { normal: w.normal, offset: w.offset }, material: `wall${i}` })),
            { type: 'sphere', parameters: { center: SPECULAR.mirror.center, radius: SPECULAR.mirror.radius }, material: 'mirror' },
            { type: 'sphere', parameters: { center: SPECULAR.glass.center, radius: SPECULAR.glass.radius }, material: 'glass' },
        ],
        materials,
        lights: [],
    };
}

function specularEntry(space: Space | 'euclidean'): SceneSuiteEntry {
    const m = SPECULAR_MEANS[space];
    const L = label(space);
    return {
        scene: specularScene(space),
        strategies: posed(SPECULAR_CAMERA, strategy('pt', 'none', SPECULAR_FOV, SPECULAR.maxBounces)),
        exercises: `${L} mirror and smooth dielectric: delta reflection and refraction at metric cosines, Schlick and exact Fresnel, the region classification (n_i/n_t on entry and exit), the far-side spawn and the walk inside the glass, against an exact per-ray twin`,
        expected: `mirror window ${m.mirror.join(', ')}; glass window ${m.glass.join(', ')} (curvedMaterialTwins.ts)`,
        witness: {
            size: CM_SIZE,
            spp: 64,
            checks: [
                { kind: 'mean', value: m.mirror, tol: 0.002, region: SPECULAR_MIRROR_WINDOW, label: `${L} mirror ball = twin` },
                { kind: 'mean', value: m.glass, tol: 0.002, region: SPECULAR_GLASS_WINDOW, label: `${L} glass ball = twin` },
            ],
        },
    };
}

// ---------------------------------------------------------------------------
// The receiver (ggx and sphere-light witnesses): a disk of radius 0.5 about o in the plane y = 0
// (normal +y), seen from 45° above at distance 1.13 — the h3-disk-light / s3-long-arc receiver.
// ---------------------------------------------------------------------------

export const RECEIVER_RHO = 0.5;
export const RECEIVER_CAMERA: { position: Vec3; target: Vec3 } = { position: [0, 0.8, 0.8], target: [0, 0, 0] };
export const RECEIVER_FOV = 0.8;
export const RECEIVER_WINDOW: WitnessRegion = { x: 0.375, y: 0.375, w: 0.25, h: 0.25 };
const receiverObject = {
    type: 'disk' as const, parameters: { center: [0, 0, 0] as Vec3, radius: RECEIVER_RHO, normal: [0, 1, 0] as Vec3 }, material: 'receiver',
};

// ---------------------------------------------------------------------------
// ggx
// ---------------------------------------------------------------------------

export const GGX = { f0: 0.5, roughness: 0.5 };
const R2 = Math.SQRT1_2;
/** The disk light, at distance 1 from o in the receiver's mirror direction of the camera, (0, 1, −1)/√2:
 *  in H³ facing o; in S³ at distance 1 the other way, facing away from o, so that only the long arc —
 *  which leaves o along the mirror direction — reaches its emitting face. */
export const GGX_LIGHT: Record<Space, { position: Vec3; normal: Vec3; radius: number; emission: number }> = {
    hyperbolic: { position: [0, R2, -R2], normal: [0, -R2, R2], radius: 0.5, emission: 2 },
    spherical: { position: [0, -R2, R2], normal: [0, -R2, R2], radius: 0.5, emission: 2 },
};
/** Twin window means (curvedMaterialTwins.diskRadiance with ggxEval, 2×2 points per pixel). */
export const GGX_MEANS: Record<Space, number> = { hyperbolic: 0.2935841, spherical: 0.6377883 };

function ggxEntry(space: Space): SceneSuiteEntry {
    const L = label(space);
    const value = GGX_MEANS[space];
    return {
        scene: {
            id: `${tag(space)}-ggx`,
            name: `${L} GGX Receiver`,
            ambientSpace: { type: space },
            objects: [receiverObject],
            materials: { receiver: { model: 'ggx', f0: [GGX.f0, GGX.f0, GGX.f0], roughness: GGX.roughness } },
            lights: [{ kind: 'disk', ...GGX_LIGHT[space] }],
        },
        strategies: posed(RECEIVER_CAMERA, ...threeEstimators(RECEIVER_FOV, 1)),
        exercises: `${L} ggx receiver under a disk light in its mirror direction${space === 'spherical' ? ', reached only through the long arc' : ''}: the microfacet frame maps in the metric (ambient_frame, microfacet_to_local/_from_local), eval/sample/pdf agreement under NEE and MIS`,
        expected: `window mean ${value} (curvedMaterialTwins.ts) under pt-nee, pt-mis and pt`,
        witness: {
            size: CM_SIZE,
            spp: 256,
            checks: [
                { kind: 'mean', value, tol: 0.003, region: RECEIVER_WINDOW, strategy: 0, label: `${L} ggx, pt-nee = twin` },
                { kind: 'mean', value, tol: 0.003, region: RECEIVER_WINDOW, strategy: 1, label: `${L} ggx, pt-mis = twin` },
                { kind: 'mean', value, tol: 0.004, region: RECEIVER_WINDOW, strategy: 2, label: `${L} ggx, pt = twin` },
            ],
        },
    };
}

// ---------------------------------------------------------------------------
// rough glass (estimator equality)
// ---------------------------------------------------------------------------

// Roughness 0.6: at 0.3 the caustics through the ball make nee ≡ mis firefly-dominated (χ²ᵣ 3.6 for
// this layout in E³ at 1024 spp).
const roughGlass = { model: 'rough_dielectric' as const, ior: 1.5, roughness: 0.6 };

export const ROUGH_GLASS_CAMERA: Record<Space, { position: Vec3; target: Vec3 }> = {
    hyperbolic: { position: [0, 0.1, 1.1], target: [0, -0.25, 0] },
    spherical: { position: [0, 0.1, 1.2], target: [0, 0, 0] },
};

const roughGlassScenes: Record<Space, SceneDescription> = {
    // The h3-medium layout with the scattering ball made of rough glass.
    hyperbolic: {
        id: 'h3-rough-glass',
        name: 'H³ Rough Glass Ball',
        ambientSpace: { type: 'hyperbolic' },
        objects: [
            { type: 'sphere', parameters: { radius: 0.5 }, material: 'glass' },
            { type: 'disk', parameters: { center: [0, -0.7, 0], radius: 1.0, normal: [0, 1, 0] }, material: 'floor' },
        ],
        materials: { glass: roughGlass, floor: { model: 'lambert', albedo: [0.6, 0.6, 0.6] } },
        lights: [{ kind: 'disk', position: [0, 0.75, 0.55], normal: [0, -1, -0.6], radius: 1.5, emission: 2 }],
    },
    // The s3-medium layout: a disk light at +x facing the ball, and a sphere light at +y, about 90°
    // off the view axis, which the ball sees in both cones.
    spherical: {
        id: 's3-rough-glass',
        name: 'S³ Rough Glass Ball',
        ambientSpace: { type: 'spherical' },
        objects: [{ type: 'sphere', parameters: { radius: 0.5 }, material: 'glass' }],
        materials: { glass: roughGlass },
        lights: [
            { kind: 'disk', position: [1.1, 0, 0], normal: [-1, 0, 0], radius: 0.6, emission: 2 },
            { kind: 'sphere', position: [0, 1.1, 0], radius: 0.3, emission: 3 },
        ],
    },
};

function roughGlassEntry(space: Space): SceneSuiteEntry {
    const L = label(space);
    return {
        scene: roughGlassScenes[space],
        strategies: posed(ROUGH_GLASS_CAMERA[space], ...threeEstimators(space === 'hyperbolic' ? 1.3 : 1.0, 8)),
        exercises: `${L} rough dielectric ball lit from out of frame: the two-lobe eval/pdf/sample in curved frames, NEE at a transmissive non-delta surface (the two-sided query${space === 'spherical' ? ': each arc with probability ½, for a disk light and a sphere light' : ''}), the MIS weights`,
        expected: 'keys 1 (pt-nee), 2 (pt-mis), 3 (pt) converge to the same image',
        witness: {
            spp: 1024,
            checks: [
                { kind: 'equality', strategies: [0, 1], meanTol: 0.02, label: `${L} rough glass nee ≡ mis` },
                { kind: 'equality', strategies: [0, 2], meanTol: 0.02, rmse: 0.65, label: `${L} rough glass pt tripwire` },
            ],
        },
    };
}

// ---------------------------------------------------------------------------
// sphere lights
// ---------------------------------------------------------------------------

export const RECEIVER_ALBEDO = 0.5;
/** The sphere lights: H³ above the receiver; S³ below it (only the backward cone reaches the top);
 *  the S³ antipodal ball, whose antipodal image covers every window point's −x. */
export const SPHERE_LIGHTS = {
    h3: { position: [0, 1, 0] as Vec3, radius: 0.4, emission: 2 },
    s3: { position: [0, -1, 0] as Vec3, radius: 0.4, emission: 2 },
    s3Antipodal: { position: [0, -2.3, 0] as Vec3, radius: 1.3, emission: 1 },
};
/** The blocker: the s3-long-arc-blocker ball, radius 0.8 about −o. Every backward-cone geodesic from
 *  a window point x passes −x, within 0.4 of −o, at arc length π, before it reaches the light. */
export const SPHERE_BLOCKER = { center: [0, Math.PI, 0] as Vec3, radius: 0.8 };
/** The H³ blocker: an opaque ball of radius 0.5 about the H³ light's center, so it holds the light and
 *  every geodesic from the receiver to the light's near side crosses it first, about 0.1 before the
 *  light. A light distance that stops short of the light's surface (by more than that) misses it. */
export const H3_SPHERE_BLOCKER = { center: SPHERE_LIGHTS.h3.position, radius: 0.5 };
/** Twin window means ((albedo/π)·E, curvedMaterialTwins.sphereIrradiance, 2×2 points per pixel). */
export const SPHERE_MEANS = { h3: 0.1136093, s3: 0.2126745 };

const sphereReceiver = { receiver: { model: 'lambert' as const, albedo: [RECEIVER_ALBEDO, RECEIVER_ALBEDO, RECEIVER_ALBEDO] as Vec3 } };

function sphereEntry(id: string, space: Space, light: { position: Vec3; radius: number; emission: number }, value: number,
    exercises: string, extra: Pick<SceneDescription, 'objects' | 'materials'> = { objects: [], materials: {} }): SceneSuiteEntry {
    const L = label(space);
    const tol = value === 0 ? 1e-6 : 0.002;
    return {
        scene: {
            id,
            name: `${L} Sphere Light (${id})`,
            ambientSpace: { type: space },
            objects: [receiverObject, ...extra.objects],
            materials: { ...sphereReceiver, ...extra.materials },
            lights: [{ kind: 'sphere', ...light }],
        },
        strategies: posed(RECEIVER_CAMERA, ...threeEstimators(RECEIVER_FOV, 1)),
        exercises,
        expected: `window mean ${value} under pt-nee, pt-mis and pt`,
        witness: {
            size: CM_SIZE,
            spp: 256,
            checks: [
                { kind: 'mean', value, tol, region: RECEIVER_WINDOW, strategy: 0, label: `${L} ${id}, pt-nee` },
                { kind: 'mean', value, tol, region: RECEIVER_WINDOW, strategy: 1, label: `${L} ${id}, pt-mis` },
                { kind: 'mean', value, tol: value === 0 ? tol : 0.003, region: RECEIVER_WINDOW, strategy: 2, label: `${L} ${id}, pt` },
            ],
        },
    };
}

// ---------------------------------------------------------------------------
// The registry entries (spread into witnessSuite by tests/witnesses/index.ts).
// ---------------------------------------------------------------------------

export const curvedMaterialSuite: Record<string, SceneSuiteEntry> = {
    'e3-specular': specularEntry('euclidean'),
    'h3-specular': specularEntry('hyperbolic'),
    's3-specular': specularEntry('spherical'),
    'h3-ggx': ggxEntry('hyperbolic'),
    's3-ggx': ggxEntry('spherical'),
    'h3-rough-glass': roughGlassEntry('hyperbolic'),
    's3-rough-glass': roughGlassEntry('spherical'),
    'h3-sphere-light': sphereEntry('h3-sphere-light', 'hyperbolic', SPHERE_LIGHTS.h3, SPHERE_MEANS.h3,
        'H³ sphere light above a lambert disk: the cone sin α = sinh R/sinh d and its pdf, the backing ball placed by the light\'s isometry (h3-sphere-light-blocker pins the distance)'),
    'h3-sphere-light-blocker': sphereEntry('h3-sphere-light-blocker', 'hyperbolic', SPHERE_LIGHTS.h3, 0,
        'H³ sphere-light distance: an opaque ball about the light\'s center holds it, so every shadow ray to the light crosses the blocker just before it — a light distance that stops short of the light\'s surface would not see it',
        { objects: [{ type: 'sphere', parameters: H3_SPHERE_BLOCKER, material: 'blocker' }], materials: { blocker: { model: 'lambert', albedo: [0.5, 0.5, 0.5] } } }),
    's3-sphere-light': sphereEntry('s3-sphere-light', 'spherical', SPHERE_LIGHTS.s3, SPHERE_MEANS.s3,
        'S³ sphere light below a lambert disk, which only the backward cone lights: the flip rule for a one-sided receiver, the cone sin α = sin R/sin d, the entry root reached the other way round'),
    's3-sphere-light-blocker': sphereEntry('s3-sphere-light-blocker', 'spherical', SPHERE_LIGHTS.s3, 0,
        'S³ backward-cone shadow rays: an opaque ball about −o on every backward-cone geodesic from the window — the light distance runs to the ball\'s far side, past the blocker',
        { objects: [{ type: 'sphere', parameters: SPHERE_BLOCKER, material: 'blocker' }], materials: { blocker: { model: 'lambert', albedo: [0.5, 0.5, 0.5] } } }),
    's3-sphere-light-antipodal': sphereEntry('s3-sphere-light-antipodal', 'spherical', SPHERE_LIGHTS.s3Antipodal, RECEIVER_ALBEDO * SPHERE_LIGHTS.s3Antipodal.emission,
        'S³ sphere light whose ball holds −x for every window point x: the forward cone clamped to the hemisphere, the flip covering the other half, light distances that stop at the ball\'s near side'),
};
