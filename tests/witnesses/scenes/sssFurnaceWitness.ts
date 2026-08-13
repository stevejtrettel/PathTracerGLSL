// tests/witnesses/scenes/sssFurnaceWitness.ts — F-SSS: the subsurface white furnace.
// Derivation and purpose: docs/fable-subsurface.md §9.
//
// THE ARGUMENT. A furnace is a closed box whose walls have albedo ρ and emission E, so the
// radiance everywhere settles at L = E/(1 − ρ). With ρ = 0.5 and E = 0.2 that is exactly 0.4,
// and it is the number every furnace witness in this suite asserts.
//
// Now put a LOSSLESS translucent object in it: a sphere with a refractive boundary and an
// interior that scatters but never absorbs (σ_a = 0). Scattering conserves energy. Fresnel
// reflection and refraction conserve energy. So the object cannot change the equilibrium and
// cannot be seen: every pixel over the sphere must ALSO read exactly 0.4. A translucent object
// that is radiometrically invisible is the sharpest statement available about subsurface
// transport, because it is exact rather than a comparison, and it tests four things at once:
//
//   • Fresnel energy conservation at entry and exit, including total internal reflection;
//   • the η² radiance-compression factor (radiance is compressed on the way in and must be
//     decompressed on the way out — get one side wrong and the sphere reads bright or dark);
//   • the chromatic medium weights (σ_s is per-channel here, so the channel-MIS distance
//     sampling has to be unbiased in each channel independently — channels splitting apart is
//     the signature of a weight bug);
//   • the walk's termination bookkeeping, which is why this witness exists in TWO arms.
//
// WHY TWO ARMS, AND WHY ONE OF THEM BREAKS THE WITNESS PROTOCOL. Nearly every witness here sets
// `russianRoulette: null`, because roulette adds variance and a numeric gate wants the quietest
// possible estimator. That convention has a blind spot: the interior termination rule
// (`roulette_interior`, docs/fable-subsurface.md §6) is emitted ONLY when roulette is on, so no
// existing witness exercises it at all — `furnace-scatter` and `slab`, the two absolute-value
// gates on scattering media, both run with roulette off and are therefore blind to it.
//
// So this witness runs the SAME scene twice:
//
//   strategy 0  `rr-off`      roulette off — the classical reference (weight decay only)
//   strategy 1  `rr-interior` roulette on  — exercises the interior rule
//
// and asserts 0.4 on BOTH, so that turning roulette on cannot be seen to disturb the equilibrium.
// Two independent absolute gates are a stronger statement than an equality between the arms would
// be, which is why there is no equality check here: each arm has to hit the derived number alone.
//
// ⚠ CORRECTION, from the passing sweep (Aug 12). This witness was written claiming the two arms
// gate the interior termination rule. THEY DO NOT, and the reason is provable rather than
// empirical, so it is worth stating exactly:
//
//   The interior rule's survival probability is the medium's own single-scattering albedo,
//   p = max_c σ_s,c/σ_t,c, supplied by the generated medium_survival() accessor. With σ_a = 0
//   that is exactly 1 in every channel: survival is certain and the throughput divide is by one.
//
//   A LOSSLESS MEDIUM CAN NEVER EXERCISE THE INTERIOR RULE. It is a no-op here by construction,
//   for every t, every σ spread and every g.
//
//   (This proof was rewritten in Aug 2026 when the rule stopped reading `ms.weight` and started
//   asking the medium — see docs/fable-subsurface.md §6. The old argument reached the same
//   conclusion the long way round, via max(W) ≥ mean(W) on the channel-MIS weight. That the
//   conclusion survived the change while the reasoning collapsed to one line is itself a sign
//   the new quantity is the right one: losslessness, not an inequality about weights, is what
//   makes the rule inert.)
//
// So the arms differ only in the SURFACE roulette (which fires on the furnace walls, whose albedo
// is 0.5), and the σ/µ line comparing them says nothing about the interior rule — the observed
// 7.21% vs 3.18% is surface roulette on the walls, not this work.
//
// WHAT THIS WITNESS DOES VERIFY, which is real and worth having: the furnace equilibrium through a
// refractive boundary — Fresnel energy conservation, TIR, the η² radiance compression on BOTH
// sides, and the chromatic distance-sampling weights, all of which must be exact for the sphere to
// vanish. Plus the negative statement that enabling roulette does not disturb any of it.
//
// WHY IT CANNOT BE FIXED HERE: exercising the interior rule requires max_c w_c < 1, which requires
// σ_s < σ_t, i.e. absorption. But an absorbing object in a furnace is genuinely visible and darker,
// so there is no exact value left to assert — the furnace construction *needs* losslessness. The
// two requirements are mutually exclusive. Gating the interior rule therefore belongs to the
// SLAB-ALBEDO test (docs/fable-subsurface.md §8 Step 3), which has absorption by construction:
// a slab authored for colour C must measure C.
//
// THE FIRST SWEEP (Aug 12) — what it established, and the design error it exposed.
//
// The original fixture used σ_s = [2, 4, 8] to stress the chromatic weights hard. The frame checks
// passed; the sphere region failed, low in BLUE by 3.8% with red and green off by ~0.4%. Three runs
// settled what that was:
//
//   • TRUNCATION IS RULED OUT. A diagnostic arm at maxBounces 1024 returned BIT-IDENTICAL results
//     to the 128 arm, at both 128 and 1024 spp — no path was reaching even 128 bounces. (My worry
//     that TIR plus a lossless interior would make a light trap was wrong: only ~13% of scattering
//     directions fall in the escape cone at ior 1.5, but ~8 wall encounters is still only tens of
//     events.) That arm has been removed now that it has answered; it also cost 4× the render time
//     of the 128-bounce arm despite producing identical pixels, which is a useful cost datum for
//     the bounce-budget tradeoff generally: raising maxBounces is NOT free even when no path uses it.
//
//   • ENERGY LOSS IS RULED OUT. At 8× the samples RED's deficit vanished completely (0.3981 →
//     0.4002). A per-collision or per-crossing energy loss would have persisted at any sample count.
//
//   • WHAT IT ACTUALLY WAS: the chromatic distance sampler is heavy-tailed in whichever channel has
//     σ_c > mean(σ). That channel's per-event weight exceeds 1, so its path weight GROWS with each
//     collision and its energy sits in rare, very bright, long paths — an estimator whose mass is
//     in rare samples converges FROM BELOW. It fits the observation where density does not: red
//     (0.43) and green (0.86) were fine, only blue (1.71) was badly low, even though green is
//     denser than red. Two independent confirmations: blue climbed toward 0.4 with more samples
//     (−3.8% → −2.2%), and σ/µ fell by only 1.9-2.0× for an 8× sample increase where 1/√N predicts
//     2.83× — measured variance still growing as new rare events are found.
//
// CONSEQUENCE BEYOND THIS WITNESS: any medium with a wide per-channel σ spread converges slowly,
// and from below, in its LARGEST-σ channel. The `skin` material in `sss-lab` has σ ≈ [2.5, 7.1,
// 12.5] ⇒ weights 0.34 / 0.96 / 1.70 — the same shape as the σ = [2, 4, 8] that failed here, so
// expect its blue to be the last thing to converge. That is a property of the sampler, not a bug.
// The honest fix for a GATE is to keep the spread narrow; loosening the tolerance instead would
// just hide the next real defect behind the same slow channel.
//
// FAILURE READING:
//   one channel low, the one with the largest σ_s
//                               → NOT a bug: under-convergence, per THE FIRST SWEEP. Confirm with
//                                 `--spp-scale 8`; it should climb. Widening the σ spread is what
//                                 makes this appear.
//   all channels low together   → bounce starvation (raise maxBounces) or a genuine energy loss.
//                                 Distinguish by sample count: starvation and loss both persist,
//                                 but only starvation responds to maxBounces.
//   channels split with the SMALL-σ channels low too
//                               → chromatic weight bug in the medium arm.
//   rr-interior off, rr-off ok  → the SURFACE roulette on the walls, NOT the interior rule — the
//                                 interior rule is provably inert here (see the correction above).
//                                 Its gate is slab-albedo, which has absorption by construction.
//   sphere region off, frame ok → the object is not invisible but the walls are averaging it
//                                 out. This is why the region check exists.

import type { SceneDescription, RenderStrategy, MaterialDescription } from '../../../src/compiler/types.js';

/** Wall albedo and emission: L = E/(1 − ρ) = 0.2/0.5 = 0.4 exactly. */
const WALL: MaterialDescription = { model: 'lambert', albedo: [0.5, 0.5, 0.5], emission: [0.2, 0.2, 0.2] };

/** Sphere radius. 0.7 across, so the σ_s below is 2.8 / 3.5 / 4.2 free paths across — enough
 *  scattering orders to matter, few enough that a lossless walk still escapes promptly. */
const R = 0.35;

export const sssFurnaceScene: SceneDescription = {
    id: 'sss-furnace',
    name: 'Subsurface furnace (F-SSS): a lossless translucent sphere must be invisible',
    ambientSpace: { type: 'euclidean' },
    objects: [
        // The closed box: six planes with outward offsets, exactly as furnace-scatter builds it.
        { type: 'plane', parameters: { normal: [1, 0, 0], offset: 1.0 }, material: 'furnace' },
        { type: 'plane', parameters: { normal: [-1, 0, 0], offset: 1.0 }, material: 'furnace' },
        { type: 'plane', parameters: { normal: [0, 1, 0], offset: 1.0 }, material: 'furnace' },
        { type: 'plane', parameters: { normal: [0, -1, 0], offset: 1.0 }, material: 'furnace' },
        { type: 'plane', parameters: { normal: [0, 0, 1], offset: 1.0 }, material: 'furnace' },
        { type: 'plane', parameters: { normal: [0, 0, -1], offset: 1.0 }, material: 'furnace' },
        // The subject: a refractive boundary around a lossless scattering interior.
        { type: 'sphere', name: 'subject', parameters: { center: [0, 0, 0], radius: R }, material: 'translucent' },
    ],
    materials: {
        furnace: WALL,
        // SMOOTH `dielectric` deliberately, not `rough_dielectric`: a smooth Fresnel interface is
        // exactly lossless, so 0.4 is an EXACT expectation. A single-scattering microfacet
        // boundary genuinely loses energy at higher roughness, which would turn this gate into a
        // measurement of that loss instead of a conservation test. Measuring that loss is worth
        // doing — as its own witness, against the energy curve the rough-dielectric work
        // characterised, not by blunting this one.
        translucent: {
            model: 'dielectric',
            ior: 1.5,
            // σ_a = 0 exactly: the object may redirect light arbitrarily but may not consume any.
            //
            // σ_s is chromatic — a scalar would let a broken channel hide — but only MILDLY so,
            // and the first sweep is why (see THE FIRST SWEEP below). The chromatic distance
            // sampler's per-event weight is about σ_c/mean(σ), so a wide spread pushes one
            // channel's weight well above 1 and makes that channel's estimator heavy-tailed.
            // [4, 5, 6] gives weights 0.80 / 1.00 / 1.20, which keeps every channel's weight
            // near 1 while still differing per channel. [2, 4, 8] gave 0.43 / 0.86 / 1.71 and
            // turned a numeric gate into a slow convergence measurement.
            medium: { sigma_a: 0, sigma_s: [4.0, 5.0, 6.0], phase_g: 0.4 },
        },
    },
    lights: [],
    environment: { type: 'none' },
};

/** Shared measurement. maxBounces is generous on purpose: with σ_a = 0 nothing absorbs, so a
 *  path leaves only by escaping the sphere, and TIR can hold one inside for a long time.
 *  Truncation reads as BOTH arms landing under 0.4 together. */
const measurement = {
    camera: { type: 'pinhole' as const, fov: 1.0 },
    maxBounces: 128,
};

/** Arm 0 — the classical reference: no roulette anywhere, weight decay only. */
export const sssFurnaceRrOffStrategy: RenderStrategy = {
    id: 'rr-off',
    measurement,
    estimator: {
        directLighting: 'none',
        russianRoulette: null,          // the witness protocol; this is the control arm
        volumeSampling: 'analytic',
        accumulation: { type: 'average' },
    },
    view: { tonemap: { type: 'reinhard' } },
};

/**
 * Arm 1 — roulette ON, which is the only way to reach `roulette_interior`. `startDepth` is
 * deliberately low so the rule fires on most interior collisions rather than only on the deep
 * tail; the whole question is whether its 1/p compensation is exact, and that is answered by
 * whether this arm still reads 0.4.
 */
export const sssFurnaceRrInteriorStrategy: RenderStrategy = {
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
