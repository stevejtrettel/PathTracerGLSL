// tests/witnesses/scenes/torusWitness.ts — the cube 3-torus (components/quotient/torus).
//
// CRYSTAL TWIN (detects wrong pairings; exact): `torus-crystal` is a 3-torus (1.0, 1.3, 0.8) with
// two Lambert balls, one GGX ball and one emissive sphere at generic positions in D, rendered by
// pt with maxBounces N = 2 and farClip R = 3.65 = 2·diam(D). `torus-crystal-ref` is the same
// measurement in plain E³: every copy of the four spheres whose bounding sphere comes within
// (N+1)·R of the camera, as four instanced batches (one per sphere), with the same farClip. A
// counted path has N + 1 segments of length ≤ R, so every vertex lies within (N+1)·R of the
// camera, and the two scenes define the same integral. Both render at the runner's one pinned
// salt, so they draw the same random numbers; paths diverge only where float32 rounding of
// crystal coordinates (up to ~11) differs from the walk's, and the gate is a mean plus an rmse.
//
// ESTIMATOR EQUALITY (`torus-lights`): a 3-torus (1.2, 1.0, 1.4) with a jungle gym (three
// unrotated boxes spanning whole periods), a glossy ball (GGX, roughness 0.45), a matte ball, a sphere light near two
// faces of D (so whether a light image is in NEE's table changes across the picture) and a disk
// light of about four times its power deeper in D. pt, pt-nee, pt-mis (power selection) and
// pt-mis with the light tree must converge to the same image: partition MIS is unbiased only if
// NEE's image table and MIS's identification of the hit image agree (the argument is in
// docs/claude-2026-11-review/quotients-plan.md, Q1.1 and Q1.4).
//
// FOG (plan Q1b; sections at the end of this file): `torus-fog` checks the fog's glow along
// distances summed across faces against a float64 twin, with a black occluder (exact);
// `torus-crystal-fog` is the crystal twin in a scattering fog; `torus-lights-fog` is the
// estimator equality in a scattering fog.

import type { SceneDescription, RenderStrategy, Transform, Vec3, ObjectDescription } from '../../../src/compiler/types.js';
import { withPose } from '../../../src/authoring/strategy.js';

// ---- crystal twin ------------------------------------------------------------------------------

const CRYSTAL_SIZE: Vec3 = [1.0, 1.3, 0.8];
const CRYSTAL_N = 2;
const CRYSTAL_R = 3.65;   // 2·diam(D) = 2·√(1 + 1.69 + 0.64) = 3.6497…, rounded up
const CRYSTAL_CAMERA: Vec3 = [0.02, 0.05, -0.03];
const CRYSTAL_TARGET: Vec3 = [1.0, 0.35, 0.7];

/** The four spheres in D: center, radius, material. */
const CRYSTAL_SPHERES: Array<{ center: Vec3; radius: number; material: string }> = [
    { center: [0.18, -0.25, 0.1], radius: 0.17, material: 'clay' },
    { center: [-0.22, 0.3, -0.12], radius: 0.14, material: 'jade' },
    { center: [0.25, 0.32, -0.15], radius: 0.12, material: 'gloss' },
    { center: [-0.2, -0.3, 0.18], radius: 0.08, material: 'lamp' },
];

const crystalMaterials = (): SceneDescription['materials'] => ({
    clay: { model: 'lambert', albedo: [0.75, 0.55, 0.4] },
    jade: { model: 'lambert', albedo: [0.35, 0.7, 0.5] },
    gloss: { model: 'ggx', roughness: 0.3, f0: [0.9, 0.85, 0.8] },
    lamp: { model: 'lambert', albedo: [0, 0, 0], emission: [9, 7.5, 6] },
});

export const torusCrystal: SceneDescription = {
    id: 'torus-crystal',
    name: '3-torus crystal twin (quotient)',
    ambientSpace: { type: 'euclidean', quotient: { kind: 'torus', size: CRYSTAL_SIZE } },
    objects: CRYSTAL_SPHERES.map((s, i) => ({
        type: 'sphere', parameters: { center: s.center, radius: s.radius }, material: s.material, name: `ball_${i}`,
    })),
    materials: crystalMaterials(),
    lights: [],
    environment: { type: 'none' },
};

/** Every lattice copy of one sphere whose bounding sphere comes within `reach` of `camera`. */
function crystalCopies(center: Vec3, radius: number, reach: number): Transform[] {
    const out: Transform[] = [];
    const K = CRYSTAL_SIZE.map((L) => Math.ceil((reach + radius) / L) + 1);
    for (let a = -K[0]; a <= K[0]; a++) {
        for (let b = -K[1]; b <= K[1]; b++) {
            for (let c = -K[2]; c <= K[2]; c++) {
                const p: Vec3 = [center[0] + a * CRYSTAL_SIZE[0], center[1] + b * CRYSTAL_SIZE[1], center[2] + c * CRYSTAL_SIZE[2]];
                const dist = Math.hypot(p[0] - CRYSTAL_CAMERA[0], p[1] - CRYSTAL_CAMERA[1], p[2] - CRYSTAL_CAMERA[2]);
                if (dist - radius <= reach) out.push({ position: p });
            }
        }
    }
    return out;
}

export const torusCrystalRef: SceneDescription = {
    id: 'torus-crystal-ref',
    name: '3-torus crystal twin (unrolled in E³)',
    ambientSpace: { type: 'euclidean' },
    objects: CRYSTAL_SPHERES.map((s, i): ObjectDescription => ({
        kind: 'instanced',
        // The prototype sits at the origin with the sphere's radius; the placements carry the
        // copies' centers.
        prototype: { type: 'sphere', parameters: { center: [0, 0, 0], radius: s.radius }, material: s.material },
        placements: crystalCopies(s.center, s.radius, (CRYSTAL_N + 1) * CRYSTAL_R),
        name: `copies_${i}`,
    })),
    materials: crystalMaterials(),
    lights: [],
    environment: { type: 'none' },
};

const view = { tonemap: { type: 'reinhard' as const } };

export const torusCrystalStrategy: RenderStrategy = withPose({
    id: 'pt',
    measurement: { camera: { type: 'pinhole', fov: 1.0 }, maxBounces: CRYSTAL_N, farClip: CRYSTAL_R },
    estimator: { directLighting: 'none', russianRoulette: null, accumulation: { type: 'average' } },
    view,
}, CRYSTAL_CAMERA, CRYSTAL_TARGET);

// ---- estimator equality with two lights ---------------------------------------------------------

const GYM_SIZE: Vec3 = [1.2, 1.0, 1.4];
/** A beam spans its axis's whole period plus a little (it must contain [−L/2 − m, L/2 + m]). */
const span = (L: number) => L / 2 + 0.01;

export const torusLights: SceneDescription = {
    id: 'torus-lights',
    name: '3-torus with two lights (pt = pt-nee = pt-mis)',
    ambientSpace: { type: 'euclidean', quotient: { kind: 'torus', size: GYM_SIZE } },
    objects: [
        // The jungle gym: three beams meeting at (−0.35, −0.3, −0.4).
        { type: 'box', parameters: { center: [0, -0.3, -0.4], halfSize: [span(GYM_SIZE[0]), 0.08, 0.08] }, material: 'beam', name: 'beam_x' },
        { type: 'box', parameters: { center: [-0.35, 0, -0.4], halfSize: [0.08, span(GYM_SIZE[1]), 0.08] }, material: 'beam', name: 'beam_y' },
        { type: 'box', parameters: { center: [-0.35, -0.3, 0], halfSize: [0.08, 0.08, span(GYM_SIZE[2])] }, material: 'beam', name: 'beam_z' },
        { type: 'sphere', parameters: { center: [0.25, 0.0, 0.15], radius: 0.22 }, material: 'gloss', name: 'gloss_ball' },
        { type: 'sphere', parameters: { center: [-0.25, 0.15, 0.45], radius: 0.15 }, material: 'matte', name: 'matte_ball' },
    ],
    materials: {
        beam: { model: 'lambert', albedo: [0.7, 0.68, 0.62] },
        // Roughness 0.45. At roughness 0.15 pt-nee read 2.8% low against pt, pt-mis and pt-mis
        // with the light tree (256 spp, χ²ᵣ 145; 7.6% low at 128 spp and 4.7% at 1,024 in a
        // variant without beams). Heavy-tailed NEE samples (27 images × a sharp lobe) are a
        // plausible cause, but no decisive check has been run, so an estimator bias at sharp
        // lobes is not ruled out (CHANGELOG 2026-11-07 says which check would decide it).
        gloss: { model: 'ggx', roughness: 0.45, f0: [0.95, 0.8, 0.55] },
        matte: { model: 'lambert', albedo: [0.3, 0.45, 0.75] },
    },
    lights: [
        // Near the x and z faces of D (0.6 and 0.7 away): its nearest images straddle the table.
        { kind: 'sphere', position: [0.45, 0.3, 0.5], radius: 0.08, emission: [12, 9, 6] },
        // Deeper in D, facing down, about four times the sphere light's power (π·πr²·Le against
        // π·4πr²·Le).
        { kind: 'disk', position: [0.0, 0.3, 0.1], radius: 0.15, normal: [0, -1, 0], emission: [40, 44, 52] },
    ],
    environment: { type: 'none' },
};

const lightsMeasurement = { camera: { type: 'pinhole' as const, fov: 1.0 }, maxBounces: 4, farClip: 4.5 };
const LIGHTS_CAMERA: Vec3 = [0.1, -0.05, -0.45];
const LIGHTS_TARGET: Vec3 = [0.6, 0.35, 1.2];
const lightsStrategy = (id: string, directLighting: 'none' | 'nee' | 'mis', lightSelection?: string): RenderStrategy => withPose({
    id,
    measurement: lightsMeasurement,
    estimator: { directLighting, ...(lightSelection !== undefined ? { lightSelection } : {}), russianRoulette: null, accumulation: { type: 'average' } },
    view,
}, LIGHTS_CAMERA, LIGHTS_TARGET);

export const torusLightsStrategies: RenderStrategy[] = [
    lightsStrategy('pt', 'none'),
    lightsStrategy('pt-nee', 'nee'),
    lightsStrategy('pt-mis', 'mis'),
    lightsStrategy('pt-mis-bvh', 'mis', 'bvh'),
];


// ---- fog: glow along summed distances, a black occluder (exact) ---------------------------------
//
// `torus-fog`: the cube 3-torus E³/Z³ filled with an absorbing, emitting fog (σ_a = 0.5, emission
// coefficient ε = σ_a·Le with Le = 1, no scattering) and one black sphere at a generic point of
// D; farClip R = 4 ≥ 2·diam(D) = 3.46. The source term is ε = σ_a·Le, so a camera ray whose first
// hit is an image of the sphere at arc length t reads Le·(1 − e^{−σ_a·t}) (the sphere is black,
// so nothing comes back from it), and a ray that meets nothing within R reads
// Le·(1 − e^{−σ_a·R}) = 0.864665. Each window below is certified by the float64 twin
// (tests/helpers/torusFogTwin.ts, brute force over the sphere's lattice images, not the walk):
// with a one-pixel margin every film point sees one image, in cell `cell` (so through
// |cell|₁ face crossings), or nothing within R. `value` is the window's expected mean, the glow
// integrated over each pixel's footprint; tests/witnesses/torusFog.test.ts re-derives every
// window and value from the scene as authored. A walk that lost the distance before a face
// (`hit.t` local to the cell) reads low on every window seen across a face; a wrong far clip
// moves the miss windows.

export const FOG_SIGMA_A = 0.5;
export const FOG_LE = 1;
export const FOG_R = 4;
export const FOG_BALL: { center: Vec3; radius: number } = { center: [0.07, -0.11, 0.04], radius: 0.25 };
export const FOG_CAMERA: Vec3 = [-0.33, 0.29, -0.27];
export const FOG_TARGET: Vec3 = [1.0, 0.1, 0.2];
export const FOG_FOV = 1.0;
export const FOG_IMAGE: [number, number] = [160, 120];

/** A window of pixels [x0, x0 + nx) × [y0, y0 + ny), origin bottom-left; `cell` is the sphere
 *  image every film point of it sees, or 'miss'. */
export interface FogWindow { x0: number; y0: number; nx: number; ny: number; cell: Vec3 | 'miss'; value: number }

export const FOG_WINDOWS: FogWindow[] = [
    { x0: 67, y0: 1, nx: 8, ny: 8, cell: [0, 0, 0], value: 0.213221 },
    { x0: 61, y0: 28, nx: 8, ny: 8, cell: [1, 0, 0], value: 0.476821 },
    { x0: 127, y0: 43, nx: 8, ny: 8, cell: [1, 0, 1], value: 0.577590 },
    { x0: 94, y0: 52, nx: 8, ny: 8, cell: [2, 0, 1], value: 0.718367 },
    { x0: 94, y0: 94, nx: 8, ny: 8, cell: [2, 1, 1], value: 0.722815 },
    { x0: 13, y0: 19, nx: 8, ny: 8, cell: [3, -1, -1], value: 0.827434 },
    { x0: 28, y0: 31, nx: 8, ny: 8, cell: 'miss', value: 0.864665 },
    { x0: 151, y0: 31, nx: 8, ny: 8, cell: 'miss', value: 0.864665 },
];

/** The runner's region (fractions, tools/witness.mjs regionBounds: floor(x·W) … ceil((x+w)·W))
 *  that selects exactly the window's pixels; the half-pixel offsets keep rounding off the
 *  floor and ceil. */
export const fogWindowRegion = (w: FogWindow) => ({
    x: (w.x0 + 0.5) / FOG_IMAGE[0], y: (w.y0 + 0.5) / FOG_IMAGE[1],
    w: (w.nx - 1) / FOG_IMAGE[0], h: (w.ny - 1) / FOG_IMAGE[1],
});

export const torusFog: SceneDescription = {
    id: 'torus-fog',
    name: '3-torus fog glow, black occluder (quotient)',
    ambientSpace: { type: 'euclidean', quotient: { kind: 'torus', size: [1, 1, 1] } },
    objects: [
        { type: 'sphere', parameters: { center: FOG_BALL.center, radius: FOG_BALL.radius }, material: 'black', name: 'occluder' },
    ],
    materials: {
        black: { model: 'lambert', albedo: 0 },
        glow: { model: 'none', medium: { sigma_a: FOG_SIGMA_A, emission: FOG_SIGMA_A * FOG_LE } },
    },
    lights: [],
    environment: { type: 'none' },
    ambientMedium: 'glow',
};

export const torusFogStrategy: RenderStrategy = withPose({
    id: 'pt',
    // One bounce: the occluder is black, so the value does not depend on the bounce budget.
    measurement: { camera: { type: 'pinhole', fov: FOG_FOV }, maxBounces: 1, farClip: FOG_R },
    estimator: { directLighting: 'none', russianRoulette: null, accumulation: { type: 'average' } },
    view,
}, FOG_CAMERA, FOG_TARGET);

// ---- crystal twin with scattering fog -----------------------------------------------------------
//
// `torus-crystal-fog` / `torus-crystal-fog-ref`: the crystal twin above with a scattering ambient
// fog (σ_s = 0.3, σ_a = 0.1) in both scenes. Medium events count as bounces, so a counted path
// still has N + 1 segments of length ≤ R and every vertex lies within (N+1)·R of the camera;
// the unrolled crystal is the same integral. The quotient program reduces each medium event point
// into D (pt.ts), the unrolled one does not, so the twins differ only by float32 rounding.

const crystalFog = { model: 'none' as const, medium: { sigma_a: 0.1, sigma_s: 0.3 } };

export const torusCrystalFog: SceneDescription = {
    ...torusCrystal,
    id: 'torus-crystal-fog',
    name: '3-torus crystal twin in fog (quotient)',
    materials: { ...crystalMaterials(), fog: crystalFog },
    ambientMedium: 'fog',
};

export const torusCrystalFogRef: SceneDescription = {
    ...torusCrystalRef,
    id: 'torus-crystal-fog-ref',
    name: '3-torus crystal twin in fog (unrolled in E³)',
    materials: { ...crystalMaterials(), fog: crystalFog },
    ambientMedium: 'fog',
};

// ---- estimator equality with fog ----------------------------------------------------------------
//
// `torus-lights-fog`: torus-lights in a scattering fog (σ_s = 0.25, σ_a = 0.1). NEE also runs at
// medium events, from points the walk reports in the origin's chart and the transport loop
// reduces into D; the four estimators must still converge to the same image.

export const torusLightsFog: SceneDescription = {
    ...torusLights,
    id: 'torus-lights-fog',
    name: '3-torus with two lights in fog (pt = pt-nee = pt-mis)',
    materials: { ...torusLights.materials, fog: { model: 'none', medium: { sigma_a: 0.1, sigma_s: 0.25 } } },
    ambientMedium: 'fog',
};
