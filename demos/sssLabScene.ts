// demos/sssLabScene.ts — THE TRANSLUCENCY BENCH (brute-force random-walk subsurface
// scattering).
//
// There is NO subsurface material model in this renderer, and this scene needs none.
// An SSS object here is exactly what fable-volumetric-component.md §1 predicted it
// would be — "murky water with brutal coefficients and costs no new code":
//
//     a DIELECTRIC BOUNDARY  (Fresnel in, TIR at the exit — a real refractive interface)
//   + a SCATTERING MEDIUM    (material.medium: the same homogeneous σ_s/σ_a machinery fog uses)
//
// composed in ONE material. Light refracts in, random-walks off σ_s until it either
// absorbs (σ_a) or finds its way back out, and refracts out somewhere else. That IS
// subsurface scattering — no diffusion profile, no BSSRDF, no dipole, no fitted
// reflectance curve. The exit point is found by the walk, not by a kernel.
//
//   BACK ROW (5) — THE MATERIAL COMPARISON. Identical geometry, identical light,
//              identical estimator; the ONLY variable is the medium. Left to right the
//              optical thickness climbs: jade (4 free paths across — deep, glassy glow)
//              → skin (CHROMATIC free paths, 1.6 red to 8.0 blue: red walks far, blue
//              stops at the surface) → alabaster (5.8) → porcelain (9.1) → milk (12.8
//              at α ≈ 0.9997 — the honest cost arm, and the slowest bead for a reason).
//   FRONT LEFT — the SMOOTH-shell twin of the porcelain. Same interior, same size,
//              boundary roughness 0 instead of the row's dial. It is noisier, and that
//              is not an accident: see THE SHELL note below.
//   FRONT RIGHT — the OPAQUE control. White lambert, no interior at all. Everything the
//              row has that this sphere lacks is subsurface transport.
//
//   KEY 1 `sss`       — the full thing: mis, maxBounces 128.
//   KEY 2 `sss-8`     — IDENTICAL estimator at maxBounces 8. The beads go darker and
//              chalkier, worst on the thickest media, because the walk is being cut off
//              mid-flight: maxBounces is a MEASUREMENT truncation (taxonomy §4), so key 2
//              converges to a different, WRONG image — time never closes the gap. This is
//              the depth-budget cost of brute-force SSS in one keypress.
//   KEY 3 `noscatter` — measurement.scattering: 'ignored'. The same materials as
//              absorbing-only tinted glass. The difference between keys 1 and 3 is the
//              entire subsurface effect.
//   KEY 4 `sss-pt`    — directLighting 'none'. Path-found light only, which is the
//              regime a SMOOTH-shelled SSS object is stuck in permanently.
//
//   THE SHELL matters more than it looks. Shadow rays treat dielectric interfaces as
//   opaque (measurement.shadows: 'opaque-dielectrics'), so NEE can NEVER reach a vertex
//   inside one of these spheres — every interior shadow ray is blocked by the sphere's
//   own boundary. Illumination gets in only by refraction. That leaves the EXIT as the
//   one place direct lighting can re-enter the estimate, and it can do so only if the
//   exit lobe is non-delta: a `rough_dielectric` boundary lets NEE fire at the exit
//   vertex, a smooth `dielectric` one does not (its exiting ray has to chance-hit an
//   emitter). Hence the row is rough and the front-left control is smooth, on the same
//   interior — the noise difference between them is that structural fact, not a tuning
//   accident. The `sss.roughness` slider is live: turn it to 0 and the whole row joins
//   the smooth control.
//
// AUTHORING — nobody can author σ_s in inverse scene units and predict a colour, so every
// medium here is built by `subsurfaceMedium` (src/authoring/subsurface.ts): you state the
// colour the bead should READ as and how far light travels inside it, and the van de Hulst
// inversion hands back σ_s and σ_a. Two consequences worth knowing while reading the
// numbers below:
//
//   • `radius` IS the mean free path now — σ_t = 1/radius exactly. So "free paths across a
//     bead" is just diameter/radius, with no fit factor in between. (This file previously
//     used the Chiang/Burley pair, whose `distance` was scaled by an albedo-dependent s(A)
//     before becoming σ_t, so the radii here are not the old numbers even where the look is
//     the same. The two inversions agree to 0.17% in α at g = 0, so the appearance carries
//     over; the dials do not.)
//   • the inversion takes anisotropy, so a `g` on any of these would be COMPENSATED for
//     rather than shifting the colour. Nothing here uses one — see `porcelain-array` for
//     the card that does.

import type { SceneDescription, RenderStrategy, MediumDescription } from '../src/compiler/types.js';
import { subsurfaceMedium } from '../src/authoring/subsurface.js';

/** One bead of the comparison row: same shape, same size, only the material differs. */
const bead = (x: number, material: string): SceneDescription['objects'][number] => ({
    type: 'sphere',
    name: material,
    parameters: { radius: 0.32 },
    material,
    transform: { position: [x, 0.32, 0] },
});

/** A translucent material: rough refractive shell on the shared dial + a walked interior. */
const translucent = (medium: MediumDescription) => ({
    model: 'rough_dielectric',
    ior: 1.4,
    roughness: { param: 'sss.roughness', default: 0.18, min: 0.0, max: 0.7 },
    medium,
});

export const sssLabScene: SceneDescription = {
    id: 'sss-lab',
    name: 'Translucency bench (random-walk subsurface scattering)',
    ambientSpace: { type: 'euclidean' },
    objects: [
        {
            type: 'plane', name: 'ground',
            parameters: { normal: [0, 1, 0], offset: 0 },
            material: 'floor',
        },
        // The comparison row — thin to thick, left to right.
        bead(-1.70, 'jade'),
        bead(-0.85, 'skin'),
        bead(0.00, 'alabaster'),
        bead(0.85, 'porcelain'),
        bead(1.70, 'milk'),
        // Front left: the SMOOTH-boundary twin of the porcelain (same interior).
        {
            type: 'sphere', name: 'smooth_shell',
            parameters: { radius: 0.28 },
            material: 'porcelain_smooth',
            transform: { position: [-0.85, 0.28, 1.15] },
        },
        // Front right: the opaque control — no interior anywhere in its paths.
        {
            type: 'sphere', name: 'opaque_control',
            parameters: { radius: 0.28 },
            material: 'chalk',
            transform: { position: [0.85, 0.28, 1.15] },
        },
    ],
    materials: {
        floor: { model: 'lambert', albedo: [0.12, 0.115, 0.11] },
        chalk: { model: 'lambert', albedo: [0.85, 0.84, 0.82] },

        // ---- the row, translucent to dense. Values are chosen to DESCRIBE each material, not
        // to reproduce anything earlier: `color` is what the bead should read as and `radius` is
        // how far light travels inside it. Beads are 0.64 across, so the free-path count in each
        // comment is just 0.64/radius, and the α the inversion asked for is printed with it. ----
        //
        // JADE. Deep green with real absorption in red — the inversion gives red α 0.71 against
        // green's 0.96, so the colour is transport rather than a tint. Generously translucent at
        // 4 free paths across: long clear flights between scatters keep a glassy core instead of
        // turning it chalky.
        jade: translucent(subsurfaceMedium({ color: [0.26, 0.62, 0.40], radius: 0.16 })),
        // SKIN. The defining feature is that its three channels travel very different distances,
        // so the radius is authored per channel in roughly the ratio production uses: red crosses
        // only 1.6 free paths, green 4.6, blue 8.0. Red therefore carries furthest and bleeds
        // through shadow terminators while blue stays a surface effect.
        skin: translucent(subsurfaceMedium({ color: [0.85, 0.60, 0.50], radius: [0.40, 0.14, 0.08] })),
        // ALABASTER. Warm creamy stone, 5.8 free paths across — obviously translucent at the rim
        // and solid through the middle.
        alabaster: translucent(subsurfaceMedium({ color: [0.90, 0.80, 0.62], radius: 0.11 })),
        // PORCELAIN. Dense and near-white: 9.1 free paths across, with α ≈ 0.999. Light enters,
        // forgets its direction entirely, and leaves as glow — a solid white object lit from
        // inside rather than on its surface.
        porcelain: translucent(subsurfaceMedium({ color: [0.94, 0.92, 0.88], radius: 0.07 })),
        // MILK. The densest and most nearly lossless: 12.8 across at α ≈ 0.9997, which is
        // ~3000 collisions before absorption. This is the slow bead, and it is the one where
        // key 2's truncation shows first. Deliberately kept just under the inversion's clamp —
        // a pure-white target would ask for a medium that never absorbs at all.
        milk: translucent(subsurfaceMedium({ color: [0.95, 0.96, 0.97], radius: 0.05 })),

        // The smooth-shell control: identical interior to `porcelain`, delta boundary.
        porcelain_smooth: {
            model: 'dielectric',
            ior: 1.4,
            medium: subsurfaceMedium({ color: [0.94, 0.92, 0.88], radius: 0.07 }),
        },
    },
    lights: [
        // BOTH lights sit above the top of the frame and face straight down, so nothing
        // luminous is visible and the beads are the only bright thing in the picture.
        // That matters: translucency is a CONTRAST effect — light that entered somewhere
        // you cannot see and left somewhere you can. A visible light panel behind the row
        // (the first version of this scene) flattens every interior to the same grey.
        // Emitting normal is cross(edge1, edge2) — here (0, −1, 0).
        //
        // The KEY is behind the row: light enters the back of each bead and has to be
        // carried through the body to reach the camera. This is the arm the whole scene
        // is about.
        {
            kind: 'quad',
            corner: [-2.2, 2.9, -2.0], edge1: [4.4, 0, 0], edge2: [0, 0, 1.2],
            emission: 18.0,
        },
        // A dim FILL in front, so the near faces are not pure silhouette.
        {
            kind: 'quad',
            corner: [-1.6, 2.9, 0.5], edge1: [3.2, 0, 0], edge2: [0, 0, 1.0],
            emission: 3.0,
        },
    ],
    environment: { type: 'constant', color: [0.035, 0.04, 0.055], intensity: 1.0 },
};

// ---------------------------------------------------------------------------
// Strategies
// ---------------------------------------------------------------------------

const camera = { type: 'pinhole' as const, fov: 0.85 };

/**
 * maxSurvival 0.98, not the 0.95 default, and deliberately: RR survival is the path's
 * throughput capped by this ceiling, and a high-albedo walk barely dims (each collision
 * costs a factor α ≈ 0.99), so the CEILING — not the throughput — is what ends these
 * paths. Setting it below the medium's albedo kills walks that physically continue and
 * pays for the survivors with a 1/p boost every step; over hundreds of collisions that
 * compounds into fireflies. 0.98 is closer to α. (Both settings are unbiased; this is a
 * variance choice. The real fix is albedo-based termination AT the collision, which is
 * an integrator decision, not a knob.)
 */
const rr = { startDepth: 8, maxSurvival: 0.98 };

export const sssStrategy: RenderStrategy = {
    id: 'sss',
    measurement: { camera, maxBounces: 128 },
    estimator: {
        directLighting: 'mis',
        russianRoulette: rr,
        volumeSampling: 'analytic',
        accumulation: { type: 'average' },
    },
    view: { tonemap: { type: 'agx' } },
};

/**
 * The truncation A/B: the same estimator with the walk cut off at 8 events — the suite's
 * old general-purpose default, and hopelessly short for a medium whose paths collide tens
 * of times before they find their way out. It converges DARKER, not noisier: maxBounces
 * is a measurement truncation, so no amount of extra time closes the gap.
 */
export const sssShortStrategy: RenderStrategy = {
    ...sssStrategy,
    id: 'sss-8',
    measurement: { camera, maxBounces: 8 },
};

/** Scattering off — the same materials as absorbing-only tinted glass. */
export const sssNoScatterStrategy: RenderStrategy = {
    ...sssStrategy,
    id: 'noscatter',
    measurement: { camera, maxBounces: 128, scattering: 'ignored' },
};

/** No NEE anywhere: what a smooth-shelled SSS object gets even under key 1. */
export const sssPtStrategy: RenderStrategy = {
    ...sssStrategy,
    id: 'sss-pt',
    estimator: { ...sssStrategy.estimator, directLighting: 'none' },
};
