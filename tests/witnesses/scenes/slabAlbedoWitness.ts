// tests/witnesses/scenes/slabAlbedoWitness.ts — F-SLAB-A: does our renderer reproduce the exact
// albedo of a semi-infinite scattering halfspace? Derivation: docs/fable-subsurface.md §4, §8
// Step 3; reference implementation: tests/helpers/halfspace.ts.
//
// ⚠ THIS WITNESS WAS REBUILT (Aug 2026) AFTER MEASURING THE WRONG THING. The first version
// asserted that a slab authored for colour C reads C, and failed by 5-17% — with no bug anywhere.
// The reason is worth stating precisely, because it is the whole design of this file:
//
//   `subsurfaceMedium` inverts van de Hulst's fit, and that fit is to the SPHERICAL albedo — the
//   hemispherically-integrated reflectance of a halfspace lit uniformly from every direction. A
//   CAMERA measures the PLANE albedo A_p(µ): reflectance in ONE exit direction. Those agree only
//   for a Lambertian reflector, and a scattering halfspace is emphatically not one — it is
//   brighter at grazing than at normal, most so at low albedo where single scattering dominates.
//
//   No sample count closes that gap. It was never noise.
//
// So the two claims are now gated separately, each against the right quantity:
//
//   THE PARAMETERIZATION  →  tests/authoring/subsurface.test.ts, on the CPU, against the exact
//                            SPHERICAL albedo. (Result: the fit is good to 0.0021 absolute
//                            everywhere — van de Hulst's own claimed accuracy, reproduced.)
//   THE TRANSPORT         →  THIS FILE, on the GPU, against the exact PLANE albedo.
//
// WHAT THIS WITNESS ASSERTS NOW, and why it is far sharper than what it replaced. For isotropic
// scattering the halfspace has a classical closed-form solution (Chandrasekhar):
//
//     A_p(µ) = 1 − √(1−ω)·H(µ)
//
// where H is defined implicitly and evaluated to ~1e-14 by tests/helpers/halfspace.ts (itself
// gated, in halfspace.test.ts, against single-scattering limits derived on paper, Chandrasekhar's
// moment identity, and the conservative constants). That is EXACT mathematics, so this is an
// exact-tier gate: a miss is a renderer bug. The old design could never be tighter than the fit's
// ~1% error; this one is limited only by render noise.
//
// FOUR DESIGN CHOICES:
//
//   1. ORTHOGRAPHIC CAMERA, not pinhole. Two reasons, both fatal to the pinhole version.
//      (a) A_p is a function of µ, so a perspective camera smears a whole RANGE of µ across the
//          frame and the expected value becomes a frame-weighted integral nobody can state
//          exactly. Parallel rays give every pixel the SAME µ, so one exact number per channel.
//      (b) The pinhole grazing arm put 27% of its frame ABOVE THE HORIZON, reading environment
//          radiance 1.0 — it failed for a reason having nothing to do with what it measured, and
//          so did its Lambertian control. Orthographic rays cannot see the horizon at all.
//
//   2. NO REFRACTIVE BOUNDARY. The slab's material is `model: 'none'` — a null interface, so
//      light enters without refraction. The H-function solution is a property of the MEDIUM;
//      adding Fresnel mixes the surface's own reflectance in (OpenPBR's own composition rule
//      E_multi = (1 − E_spec)·C says exactly this). The boundary is gated by `sss-furnace`.
//
//   3. SCALAR radius, CHROMATIC colour. σ_t equal across channels, σ_s differing, so the
//      chromatic distance-sampling weight reduces to exactly α_c per channel — keeping every
//      channel's per-event weight below 1 and out of the heavy-tailed regime the first
//      `sss-furnace` sweep fell into. One frame, three independent points on the curve.
//
//   4. maxBounces DERIVED, not guessed. With roulette off a path's weight decays as α^n, so
//      truncation loss is bounded by α^n at the bounce cap. The isotropic scene's worst channel
//      is α = 0.976, and 0.976^384 = 8.9e-5 — two orders below the tolerance. The ANISOTROPIC
//      scene needs far more: α = 0.9903 there, and 0.9903^384 is 0.023, which would read as a
//      real failure. 0.9903^1024 = 4.3e-5, hence its own (expensive, deliberate) budget.
//
// FAILURE READING:
//   all channels low together, all angles → truncation (raise maxBounces) or an energy loss per
//                                 collision. Distinguish by sample count: only noise responds.
//   one channel off                → a per-channel weight bug in the medium arm; compare against
//                                 the α values in the table below.
//   arm 1 off, arm 0 fine          → the INTERIOR TERMINATION RULE — the 1/p compensation in
//                                 roulette_interior, or medium_survival answering wrongly.
//                                 The arms-equal check is the sharp form of this.
//   the µ = 1 arm fine, grazing off → the angular structure of the exit distribution is wrong,
//                                 which no previous witness could have seen.
//   the LAMBERTIAN CONTROL off     → nothing here is about media; the instrument is broken.

import type { SceneDescription, RenderStrategy, Vec3 } from '../../../src/compiler/types.js';
import { subsurfaceMedium } from '../../../src/authoring/subsurface.js';

/** The authored target — three points on the inversion's curve, measured in one frame. */
export const SLAB_TARGET: Vec3 = [0.3, 0.5, 0.7];

/** Scalar on purpose (design note 3): equal σ_t per channel ⇒ per-event weight is exactly α_c. */
const RADIUS = 0.05;              // σ_t = 20, so the 4-unit-thick slab is 80 free paths

/** The scale-invariance arm's density: ten times sparser, ten times deeper. See
 *  `slabAlbedoSparseScene` for why the pair is a measuring instrument and not just a second gate. */
export const SPARSE_RADIUS = 0.5;   // σ_t = 2, over a 40-unit slab — the same 80 free paths

/**
 * THE EXPECTED VALUES — exact plane albedos, `planeAlbedo(alphaFromColor(C, g), µ)` from
 * tests/helpers/halfspace.ts. Written as literals rather than imported so the witness registry
 * (which the browser loads) never pulls in a fixed-point solver; `slabAlbedo.test.ts` asserts
 * these constants against the twin, so they are derived AND pinned.
 *
 * The single-scattering albedos behind them, for the failure reading above:
 *   isotropic (g = 0)     α = 0.757527 / 0.911709 / 0.976001
 *   anisotropic (g = 0.6) α = 0.886498 / 0.962708 / 0.990260
 */
export const SLAB_PLANE_ALBEDO = {
    /** µ = 1: straight down the surface normal. */
    normal: [0.248771, 0.437506, 0.646588] as Vec3,
    /** µ = 0.6: 53° from the normal. */
    oblique: [0.306597, 0.508846, 0.708598] as Vec3,
    /** µ = 0.3: 72.5° from the normal — a 50% brighter reading than normal, in the red. */
    grazing: [0.374065, 0.582443, 0.765417] as Vec3,
};

/**
 * The anisotropic expectation — CROSS-CHECK TIER (tests/witnesses/README.md). Henyey-Greenstein
 * scattering has no closed-form halfspace solution, so this comes from the independent CPU random
 * walk in tests/helpers/halfspace.ts at 2M samples (σ ≈ 0.00035, zero truncated walks). It is a
 * genuinely independent implementation — no shared code with the GLSL — but it is a second
 * simulation, not mathematics, and the runner reports it as such.
 */
export const SLAB_PLANE_ALBEDO_ANISO: Vec3 = [0.21762, 0.41548, 0.63669];
/** One standard error of the reference above, rounded up: 3σ ≈ 0.0011. */
export const SLAB_ANISO_REF_TOL = 0.0011;

/** A slab thick enough to be semi-infinite, wide enough that no edge enters any frame. */
function slab(material: string): SceneDescription['objects'][number] {
    return {
        type: 'box', name: 'slab',
        // Top face at y = 0; 12 × 12 wide and 4 deep (80 mean free paths).
        parameters: { center: [0, -2, 0], halfSize: [6, 2, 6] },
        material,
    };
}

const environment = { type: 'constant' as const, color: [1, 1, 1] as Vec3, intensity: 1.0 };

export const slabAlbedoScene: SceneDescription = {
    id: 'slab-albedo',
    name: 'Slab albedo (F-SLAB-A): the exact plane albedo of a scattering halfspace',
    ambientSpace: { type: 'euclidean' },
    objects: [slab('authored')],
    materials: {
        // `model: 'none'` = a null interface: no refraction, no Fresnel, so what the camera sees
        // is the medium's own albedo and nothing else.
        authored: { model: 'none', medium: subsurfaceMedium({ color: SLAB_TARGET, radius: RADIUS }) },
    },
    lights: [],
    environment,
};

/**
 * The anisotropic sibling: SAME authored colour, forward-scattering phase function.
 *
 * What it gates is the PHASE FUNCTION, not the inversion. The inversion's `g` term — that
 * changing anisotropy holds the observed colour fixed — is a statement about the HEMISPHERICAL
 * albedo, and is gated on the CPU in tests/authoring/subsurface.test.ts (measured: within 0.0064
 * across g ∈ [−0.5, 0.9]). It is NOT true of the directional reading, and expecting it to be was
 * the first version's second mistake: at C = 0.3 the isotropic slab reads 0.2488 head-on and this
 * one reads 0.2176, a 13% difference that is real physics. Forward scattering sends less light
 * straight back out; the raised α compensates in the hemispherical total, not per-direction.
 */
export const slabAlbedoAnisoScene: SceneDescription = {
    id: 'slab-albedo-aniso',
    name: 'Slab albedo, anisotropic (F-SLAB-A/g): HG transport against an independent walk',
    ambientSpace: { type: 'euclidean' },
    objects: [slab('authored')],
    materials: {
        authored: {
            model: 'none',
            medium: subsurfaceMedium({ color: SLAB_TARGET, radius: RADIUS, anisotropy: 0.6 }),
        },
    },
    lights: [],
    environment,
};

/**
 * THE SCALE-INVARIANCE ARM (added Aug 12 2026 after the first sweep, and it is a measuring
 * instrument as much as a gate).
 *
 * `A_p(µ)` depends on `α` and `µ` and NOTHING ELSE. It is scale-invariant in σ_t: make the medium
 * ten times less dense and the halfspace returns the identical number, because the only length in
 * the problem is the mean free path and the answer is dimensionless. That is not an approximation
 * — it is a property of the transport equation, and it makes this scene an exact controlled
 * experiment with only one variable moved.
 *
 * WHY IT EXISTS. The first sweep of `slab-albedo` came in low by 2.7 / 1.9 / 1.1% at µ = 1, rising
 * toward grazing. Three signatures identified the cause as a near-surface effect at the world-space
 * epsilon scale, and a CPU walk mirroring the renderer's exact algorithm (Aug 12 2026) pinned it
 * quantitatively: TWO mechanisms, both `EPSILON = 0.001` world = 0.02 optical depths at this
 * fixture's σ_t = 20, each roughly half the deficit —
 *
 *   J1  `ray_spawn` offsets the origin EPSILON along the NORMAL, so entry skips the shallowest
 *       0.02 optical depths of medium, exactly where a low-albedo medium's return lives;
 *   J2  the primitives' `t > EPSILON` acceptance floor refuses exit roots of scattering events
 *       within EPSILON of the boundary, and the walk then samples the medium over [0, MAX_DIST]
 *       with no repair — the path continues in a fictitious medium extending past the surface.
 *
 *   The mechanisms INTERACT (J1's offset moves scatter origins away from the surface, masking
 *   part of J2), so they must be fixed together. The renderer-twin with both reproduces all nine
 *   dense measurements to ~1σ. Analysis: docs/fable-epsilon-discipline.md.
 *
 * So this scene is the SAME medium at σ_t = 2 instead of 20 (and ten times deeper, so it is still
 * 80 free paths and still semi-infinite). It must read the same numbers as `slab-albedo`, and the
 * artifact must shrink by ten — to ~0.0007, comfortably inside tolerance. The PAIR is the
 * measurement: the difference between the two scenes' deficits IS the interface-epsilon bias, as a
 * function of density, and it will keep being that after somebody changes the epsilon.
 * CONFIRMED on GPU (Aug 12 sweep): R/G deficits shrank tenfold on cue (−0.0007/+0.0008 at µ = 1).
 *
 * ⚠ THE FIRST VERSION OF THIS SCENE HAD ITS OWN BUG, and the sweep that confirmed the epsilon
 * mechanism found it: it scaled the slab's DEPTH ×10 but kept the WIDTH at 12, so the lateral
 * margin measured in FREE PATHS shrank tenfold — and BLUE (α = 0.976, ~42 scatters at mfp 0.5)
 * read HIGH by +0.019: its long walks reached the SIDES, exited into vacuum, and scored the
 * environment at radiance 1 where a true halfspace would have absorbed most of them. (The
 * overshoot ratio between the grazing and normal arms, 0.66, equals the (1−A_p) headroom ratio —
 * a leak proportional to the paths otherwise absorbed.) A halfspace is semi-infinite in EVERY
 * direction: all dimensions must scale with 1/σ_t, not just depth. The 3D renderer-twin
 * reproduced the overshoot to four decimals and confirmed halfSize 60 removes it;
 * slabAlbedo.test.ts now asserts the lateral margin in free paths so the trap stays closed.
 *
 * It is also the right gate to keep permanently regardless of how that bug is resolved: an albedo
 * that depends on the density it was authored with is wrong, and nothing else in the suite would
 * notice.
 */
export const slabAlbedoSparseScene: SceneDescription = {
    id: 'slab-albedo-sparse',
    name: 'Slab albedo, sparse (F-SLAB-A/σ): the albedo must not depend on the density',
    ambientSpace: { type: 'euclidean' },
    objects: [{
        type: 'box', name: 'slab',
        // σ_t = 2 here, so EVERY dimension is scaled ×10 — the same 80 free paths deep AND the
        // same ~120 free paths of lateral margin as the dense scene. The first version scaled
        // depth only (width 12 = 24 free paths) and blue leaked out the sides for +0.019; see the
        // warning block above. Lateral extent is a first-passage question, not an endpoint-spread
        // one: the walk only has to touch a side ONCE to escape.
        parameters: { center: [0, -20, 0], halfSize: [60, 20, 60] },
        material: 'authored',
    }],
    materials: {
        authored: { model: 'none', medium: subsurfaceMedium({ color: SLAB_TARGET, radius: SPARSE_RADIUS }) },
    },
    lights: [],
    environment,
};

/**
 * THE LAMBERTIAN CONTROL. Identical geometry, camera and environment; the only difference is that
 * the slab is an ordinary Lambertian surface whose albedo IS the target colour.
 *
 * A Lambertian surface under uniform illumination of radiance 1 returns exactly its albedo, in
 * every direction, with no approximation of any kind. So this scene has a known answer that
 * touches no medium code — and, run at all three viewing angles, it is also the control for the
 * angular arms: it must read the SAME number at every µ, where the medium must not. If this reads
 * anything but [0.3, 0.5, 0.7] everywhere, nothing else in this file means anything.
 */
export const slabAlbedoRefScene: SceneDescription = {
    id: 'slab-albedo-ref',
    name: 'Slab albedo REFERENCE: a Lambertian surface of the same albedo (the control)',
    ambientSpace: { type: 'euclidean' },
    objects: [slab('reference')],
    materials: { reference: { model: 'lambert', albedo: SLAB_TARGET } },
    lights: [],
    environment,
};

// ── Cameras ───────────────────────────────────────────────────────────────────────────────────
//
// Orthographic, one arm per exit cosine. The camera sits at distance 3 along the direction whose
// cosine with +Y is µ, so the view direction has d·(−Y) = µ and every ray shares it. `scale` is
// the film half-height: 0.5 gives a surface footprint of 0.5/µ × 0.67, at most 1.7 units at
// µ = 0.3 — far inside the 12 × 12 slab, so no ray misses and no frame sees the environment.
// Every ray origin also stays above y = 0 (the lowest is y ≈ 0.42 at the grazing arm).
export const SLAB_VIEWS = {
    normal: { mu: 1.0, position: [0, 3, 0] as Vec3 },
    oblique: { mu: 0.6, position: [0, 1.8, 2.4] as Vec3 },
    grazing: { mu: 0.3, position: [0, 0.9, 2.8618] as Vec3 },
};

/** Shared measurement. The bounce budget is derived in design note 4 — do not round it down. */
const measurement = {
    camera: { type: 'orthographic' as const, scale: 0.5 },
    maxBounces: 384,
};

/** Arm A — the reference estimator: no roulette, so nothing but the medium ends a path. */
export const slabRrOffStrategy: RenderStrategy = {
    id: 'rr-off',
    measurement,
    estimator: {
        directLighting: 'none',       // the environment is the only source; no emitters to sample
        russianRoulette: null,
        volumeSampling: 'analytic',
        accumulation: { type: 'average' },
    },
    view: { tonemap: { type: 'reinhard' } },
};

/**
 * Arm B — THE INTERIOR-TERMINATION GATE. Roulette on, so `roulette_interior` runs at every
 * interior collision past `startDepth`. Unlike the furnace, the rule genuinely fires here:
 * `medium_survival` answers σ_s/σ_t = α, and max_c α_c = 0.976 < 1.
 *
 * This scene has NO surface events at all — a null interface is not an optical event — so every
 * difference between this arm and arm A is the interior rule and nothing else. That is what makes
 * both the arms-equal check and the noise comparison meaningful here, where the furnace's were not.
 */
export const slabRrInteriorStrategy: RenderStrategy = {
    id: 'rr-interior',
    measurement,
    estimator: {
        directLighting: 'none',
        russianRoulette: { startDepth: 2 },
        volumeSampling: 'analytic',
        accumulation: { type: 'average' },
    },
    view: { tonemap: { type: 'reinhard' } },
};

// The two angular arms. IDENTICAL estimators to `rr-off` — only the id and (at the registry) the
// pose differ. The ids must differ: renderer ids are `${strategy.id}-${scene.id}`, so two arms
// sharing one id would silently clobber each other's compiled program (CLAUDE.md, shader-ID
// namespacing), and the sweep would compare a frame against itself.
export const slabObliqueStrategy: RenderStrategy = { ...slabRrOffStrategy, id: 'oblique' };
export const slabGrazingStrategy: RenderStrategy = { ...slabRrOffStrategy, id: 'grazing' };

/** The anisotropic scene's own strategy: same estimator, a bounce budget sized for α = 0.9903. */
export const slabAnisoStrategy: RenderStrategy = {
    id: 'rr-off',
    measurement: { camera: { type: 'orthographic' as const, scale: 0.5 }, maxBounces: 1024 },
    estimator: {
        directLighting: 'none',
        russianRoulette: null,
        volumeSampling: 'analytic',
        accumulation: { type: 'average' },
    },
    view: { tonemap: { type: 'reinhard' } },
};
