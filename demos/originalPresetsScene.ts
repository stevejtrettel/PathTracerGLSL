// demos/originalPresetsScene.ts — THE ORIGINAL PATHTRACER'S SUBSURFACE PRESETS, ported.
//
// PURPOSE: bring back the subsurface look from ~/Code/PathTracer. This card is ADDITIVE and
// self-contained — it changes no model, no component, no other scene. It reads the original's
// numbers and restates them in this renderer's existing medium fields. Nothing here is derived;
// everything is transcribed, with provenance on every line (the house rule).
//
// SOURCES (read Aug 2026):
//   js/presets/materials.js      §subsurface — the five presets
//   glsl/tracer/3Materials/material.glsl:104  absorbFor()
//   glsl/tracer/6Trace/mediumWalk.glsl:65     walkInterior() — the phase step and the budget
//   js/presets/studio.js:26      sphereLight() — emit = power * colour, as RADIANCE
//   scenes/subsurface/src/scene.js            the nested core-in-shell pair and its knob values
//
// ============================================================================
// THE ORIGINAL'S MODEL, exactly
// ============================================================================
//
//     σ_s = 1/mfp                             an exponential flight of mean `mfp`; the walk
//                                             ALWAYS scatters, so mfp alone sets σ_s
//     σ_a = −ln(tint)/depth                   absorbFor(tint, depth): "this colour after
//                                             travelling `depth` through the medium" (Beer)
//     phase: normalize(mix(d, random, blur²))  the direction is lerped toward a uniform random
//                                             one by blur²; "0 = forward, 1 = isotropic"
//     termination: Beer's-law roulette only, under a cap of 1000 scatter steps
//
// This is a DIFFERENT KIND of parameterization from the Chiang/Burley inversion used by
// `sss-lab` — direct ("this colour at this depth, this dense") versus inverse ("make it read as
// this albedo"). Both end in the same three fields. Neither replaces the other, and this file
// deliberately does not touch the other one.
//
// ============================================================================
// THE ONE APPROXIMATION IN THIS PORT — declared, not hidden
// ============================================================================
//
// The original's phase function is a lerp toward a random direction. That is NOT
// Henyey–Greenstein and not a reparameterization of it, and this renderer's
// volume_scattering registry has HG and Rayleigh only. So this port matches the MEAN COSINE:
// `gFromBlur` integrates E[d·d′] for the original's construction exactly, and HG is used with
// that g.
//
//   blur 1.00 → g 0      EXACT: isotropic is isotropic, no approximation at all
//   blur 0.90 → g 0.156  approximated (wax)
//   blur 0.80 → g 0.375  approximated (jade)
//
// Three of the five presets are blur = 1, so three are exact. The two that are not share only
// their first moment with the original; the lobe SHAPES differ. That is defensible here on
// similarity-theory grounds — at these optical depths (22-130 free paths) a many-scattering
// medium only sees σ_s(1 − g) — but it IS an approximation, and the faithful alternative is a
// new `volume_scattering` occupant (one folder + one registry line, the door this repo made
// cheap). That occupant is NOT built and is not proposed here.
//
// ============================================================================
// WHAT THIS CARD COSTS, and why that is the finding rather than a defect
// ============================================================================
//
// The presets' mfp values are absolute lengths, and the original's balls were radius 1.3. This
// scene keeps BOTH, so the free-path ratios are the original's exactly:
//
//     porcelain  mfp 0.02  →  130 free paths across a ball    α ≈ 0.997  ⇒ ~400 collisions
//     milk       mfp 0.03  →   87                             α ≈ 0.999  ⇒ ~1400
//     marble     mfp 0.06  →   43
//     jade       mfp 0.10  →   26                             α ≈ 0.82   ⇒ ~6  (cheap)
//     wax        mfp 0.12  →   22                             α ≈ 0.87   ⇒ ~8  (cheap)
//
// Those are not tuning choices, they are what the original's look IS, and reproducing it needs
// a path budget in the high hundreds. Key 2 exists to measure whether key 1's 256 is enough.
// Two structural notes belong with that, both already on the ledger and NEITHER addressed here:
//
//   • Our walk calls `scene_intersect` per collision to find t_max. The original asked
//     `insideOf(region, p)` — a point-in-region test — and bisected only at the crossing. For a
//     path known to be inside one region that is a large constant-factor difference, and it is
//     most of why the original felt fast.
//   • MILK'S BLUE CHANNEL HAS σ_a = 0 EXACTLY (its tint is 1.0). Blue never absorbs, so a blue
//     path's throughput never dims and nothing but the bounce budget can end it. The original
//     had the same property behind its 1000-step cap. This is the sharpest illustration in the
//     suite of why a high-albedo walk wants albedo-based termination at the collision rather
//     than a throughput-driven roulette. Transcribed as-is on purpose.
//
// SURFACE FINISH is part of each preset and is transcribed too: the original's smooth presets
// (jade, porcelain, milk) are `dielectric` here, its rough ones (wax 0.45, marble 0.08) are
// `rough_dielectric`. That is not cosmetic — shadow rays treat a dielectric interface as opaque,
// so NEE can only re-enter the estimate at a NON-DELTA exit lobe, and the three smooth presets
// are therefore path-found-only and converge slowly. Faithful, and slow for a reason we
// understand.
//
//   KEY 1 `presets`      — mis, maxBounces 256.
//   KEY 2 `presets-1024` — the original's own budget (its walk capped at 1000 scatter steps).
//              If the dense balls (porcelain, milk) BRIGHTEN versus key 1, then key 1 is
//              truncating them and 256 is not enough for this look. This is the card's own
//              validity check and the measurement the termination plan needs.
//   KEY 3 `noscatter`    — scattering 'ignored'. All five collapse to tinted glass; the
//              difference between keys 1 and 3 is the entire random walk.
//
// LAYOUT AND LIGHTING are MINE (the original's room/knob rig does not port one-to-one); the
// light's radiance is the original's convention, transcribed: `emit = power * colour`, i.e. a
// radius-1.5 sphere at power 100 × [0.9,0.9,0.9] is radiance 90, NOT a power-to-area conversion.

import type {
    SceneDescription, RenderStrategy, MaterialDescription, MediumDescription, Vec3,
} from '../src/compiler/types.js';

// ---------------------------------------------------------------------------
// The original's two conversions
// ---------------------------------------------------------------------------

/** absorbFor verbatim (material.glsl:104): the extinction that shows `tint` after `depth`. */
const absorbFor = (tint: Vec3, depth: number): Vec3 =>
    tint.map((c) => -Math.log(Math.max(c, 1e-4)) / depth) as Vec3;

/**
 * Mean cosine of the original's phase step (mediumWalk.glsl:75-86). With
 * d′ = normalize((1−r)·d + r·u), u uniform on the sphere and r = blur², taking d = e_z and
 * μ = u_z (uniform on [−1,1]):
 *
 *     d·d′ = ((1−r) + rμ) / sqrt((1−r)² + 2r(1−r)μ + r²)
 *
 * and g = E[d·d′]. Simpson over a fine grid — definition-time CPU arithmetic, run once per
 * material, in the checkable form rather than the closed form. Endpoints exact: blur 0 is
 * perfectly forward (g = 1), blur 1 is isotropic (g = 0).
 *
 * The original could not express BACKSCATTERING: blur ∈ [0,1] maps onto g ∈ [0,1]. g < 0 is
 * reachable in this renderer and simply was not there.
 */
function gFromBlur(blur: number): number {
    if (blur <= 0) return 1;
    if (blur >= 1) return 0;
    const r = blur * blur;
    const a = 1 - r;
    const f = (mu: number) => (a + r * mu) / Math.sqrt(a * a + 2 * r * a * mu + r * r);
    const N = 20000;                        // even ⇒ Simpson is well-formed
    const h = 2 / N;
    let s = f(-1) + f(1);
    for (let i = 1; i < N; i++) s += f(-1 + i * h) * (i % 2 ? 4 : 2);
    return (s * h / 3) / 2;                 // ÷2 = averaging over the interval [−1, 1]
}

interface Spec {
    tint: Vec3; depth: number; mfp: number; blur: number; ior: number; roughness: number;
}

/** The original's `subsurface({absorb, ior, mfp, blur})` as a material in this renderer. */
function preset(s: Spec): MaterialDescription {
    const sigma_s = 1 / s.mfp;
    const medium: MediumDescription = {
        sigma_s: [sigma_s, sigma_s, sigma_s],
        sigma_a: absorbFor(s.tint, s.depth),
        phase_g: gFromBlur(s.blur),
    };
    return s.roughness > 0
        ? { model: 'rough_dielectric', ior: s.ior, roughness: s.roughness, medium }
        : { model: 'dielectric', ior: s.ior, medium };
}

// ---------------------------------------------------------------------------
// The five presets — js/presets/materials.js §subsurface, number for number
// ---------------------------------------------------------------------------
//   "interior mfp (dense -> dilute) x surface finish (rough = waxy, smooth = stone)"
//
// Tints: porcelain's and milk's are the original's own defaults. jade's and wax's are the values
// the original's `scenes/subsurface` scene put on its knobs (coreTint, waxTint) — it required a
// tint from the caller. Marble's tint is OURS: the original never fixed one.

/** "polished stone, deep colored glow" — smooth, mildly forward (blur 0.8). */
const JADE: Spec =
    { tint: [0.22, 0.68, 0.52], depth: 0.3, mfp: 0.10, blur: 0.8, ior: 1.5, roughness: 0 };

/** "dense, barely translucent, Fresnel-glazed by its own index" — smooth, isotropic. */
const PORCELAIN: Spec =
    { tint: [0.94, 0.92, 0.87], depth: 0.5, mfp: 0.02, blur: 1.0, ior: 1.5, roughness: 0 };

/** "matte finish over a scattering interior (the rough exit is what makes it wax)". */
const WAX: Spec =
    { tint: [0.95, 0.55, 0.28], depth: 0.5, mfp: 0.12, blur: 0.9, ior: 1.5, roughness: 0.45 };

/** Dilute, near-lossless, ior 1.35 — and the σ_a = 0 blue channel noted in the header. */
const MILK: Spec =
    { tint: [0.93, 0.95, 1.00], depth: 3.0, mfp: 0.03, blur: 1.0, ior: 1.35, roughness: 0 };

/** "lightly polished stone: subtle veiny glow at edges". Tint OURS. */
const MARBLE: Spec =
    { tint: [0.93, 0.91, 0.86], depth: 1.0, mfp: 0.06, blur: 1.0, ior: 1.5, roughness: 0.08 };

// ---------------------------------------------------------------------------
// The scene
// ---------------------------------------------------------------------------

const R = 1.3;                              // the original's ball radius — keeps its free-path ratios
const SPACING = 3.0;                        // the original spaced its balls 3.0 apart
const slot = (i: number): Vec3 => [(i - 2) * SPACING, R, 0];
const ball = (i: number, material: string): SceneDescription['objects'][number] => ({
    type: 'sphere',
    name: material,
    parameters: { radius: R },
    material,
    transform: { position: slot(i) },
});

/** The nested pair's shared centre: the row's sixth slot, on the same line as the five. */
const NESTED_AT = slot(5);

export const originalPresetsScene: SceneDescription = {
    id: 'sss-presets',
    name: "The original PathTracer's subsurface presets (ported)",
    ambientSpace: { type: 'euclidean' },
    objects: [
        {
            type: 'plane', name: 'ground',
            parameters: { normal: [0, 1, 0], offset: 0 },
            material: 'slate',
        },
        // Dense → dilute, left to right, in the original's own ordering of the preset list.
        ball(0, 'porcelain'),
        ball(1, 'milk'),
        ball(2, 'marble'),
        ball(3, 'jade'),
        ball(4, 'wax'),

        // THE NESTED PAIR, transcribed from scenes/subsurface/src/scene.js: a scattering CORE
        // inside a clear glass SHELL — a non-air/non-air interface, and a walk that has to stop
        // at the core's own wall. The original had to declare `nestedIn: 'shell'` by hand; here
        // the generated innermost-wins `scene_region_at` resolves it from the geometry, so
        // nesting is just one sphere inside another.
        // Same radius as the five, so it takes the row's SIXTH slot exactly: `ball(5)` would be
        // x = 9, y = R, z = 0. The two spheres must stay CONCENTRIC — nesting is what this pair
        // demonstrates — so the position is shared, not computed twice.
        {
            type: 'sphere', name: 'core',
            parameters: { radius: 0.8 },
            material: 'core',
            transform: { position: NESTED_AT },
        },
        {
            type: 'sphere', name: 'shell',
            parameters: { radius: R },
            material: 'shell_glass',
            transform: { position: NESTED_AT },
        },
    ],
    materials: {
        // The original's default wall colour (studio.js:45 `slate`), used here for the ground.
        slate: { model: 'lambert', albedo: [0.1006, 0.1194, 0.1412] },

        porcelain: preset(PORCELAIN),
        milk: preset(MILK),
        marble: preset(MARBLE),
        jade: preset(JADE),
        wax: preset(WAX),

        // The nested pair's own two materials, from the original's scene knobs:
        //   core:  subsurface({absorb: absorbFor(coreTint, coreDepth), ior: 1.4, mfp: 0.12, blur: 1.0})
        //   shell: glass({absorb: absorbFor([0.9, 0.93, 0.96], 3.0), ior: 1.5})
        core: preset({
            tint: [0.22, 0.68, 0.52], depth: 0.4, mfp: 0.12, blur: 1.0, ior: 1.4, roughness: 0,
        }),
        shell_glass: {
            model: 'dielectric',
            ior: 1.5,
            medium: { sigma_a: absorbFor([0.9, 0.93, 0.96], 3.0) },
        },
    },
    lights: [
        // sphereLight({at, radius: 1.5, color: [0.9,0.9,0.9], power: 100}) — the original's
        // convention is emit = power * colour as RADIANCE (studio.js:30), so 100 × 0.9 = 90.
        // Position is ours, moved to suit this row.
        {
            kind: 'sphere',
            position: [-9.0, 7.5, 7.0], radius: 1.5,
            emission: [90, 90, 90],
        },
    ],
    // A dim sky so the smooth presets (path-found-only) have something to find besides the
    // one lamp. Ours, not the original's — its rig used a closed room instead.
    environment: { type: 'constant', color: [0.05, 0.055, 0.07], intensity: 1.0 },
};

// ---------------------------------------------------------------------------
// Strategies
// ---------------------------------------------------------------------------

const camera = { type: 'pinhole' as const, fov: 0.75 };

/**
 * The original terminated its interior walk by Beer's-law roulette alone, under a 1000-step cap.
 * `maxSurvival: 0.999` reproduces that rule here: survival is effectively the path's own
 * throughput, and the ceiling does not bind before absorption does. A ceiling BELOW the medium's
 * per-collision survival would make roulette (not the medium) the terminator and pay each
 * survivor a compounding 1/p boost — fireflies. Unbiased at any setting; this is a variance
 * choice, and it is a per-scene authored one, not a change to anything shared.
 */
const walkRoulette = { startDepth: 12, maxSurvival: 0.999 };

export const originalPresetsStrategy: RenderStrategy = {
    id: 'presets',
    measurement: { camera, maxBounces: 256 },
    estimator: {
        directLighting: 'mis',
        russianRoulette: walkRoulette,
        volumeSampling: 'analytic',
        accumulation: { type: 'average' },
    },
    view: { tonemap: { type: 'agx' } },
};

/** The original's own budget. If the dense balls brighten against key 1, key 1 truncates them. */
export const originalPresetsDeepStrategy: RenderStrategy = {
    ...originalPresetsStrategy,
    id: 'presets-1024',
    measurement: { camera, maxBounces: 1024 },
};

/** Scattering off — the same five as absorbing-only tinted glass. */
export const originalPresetsNoScatterStrategy: RenderStrategy = {
    ...originalPresetsStrategy,
    id: 'noscatter',
    measurement: { camera, maxBounces: 256, scattering: 'ignored' },
};
