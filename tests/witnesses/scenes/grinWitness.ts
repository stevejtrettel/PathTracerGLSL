// witnesses/scenes/grinWitness.ts
// The variable-IOR (GRIN) witness fixtures (fable-variable-ior.md §6):
//   grin-vacuum / grin-vacuum-ref — constant-n ≡ vacuum: an `ior: 1` lens bends NOTHING, so the
//                     scene must converge to the SAME image as its lens-free twin. Pure plumbing
//                     gate: the GRIN arm's exit-ray spawn, boundary refinement, the inside-exit
//                     handoff, and the delta record must all be transport-neutral at n ≡ 1.
//                     The scene ALSO carries a constant absorbing-only fog box, so the program
//                     contains the dispatcher's INLINE absorbing arm alongside the GRIN arm —
//                     the coexistence configuration where an unassigned ms.deflected would read
//                     garbage (the Jul 21 dispatcher bug's exact trigger).
//   grin-furnace    — F-BOX-M plus a REAL Luneburg lens inside the haze: a LOSSLESS deflector
//                     (weight ≡ 1) redirects rays but cannot change the uniform equilibrium
//                     field, so the mean stays EXACTLY 0.4/channel. Catches broken GRIN weights,
//                     absorption where none is authored, bounce-budget starvation (each lens
//                     traversal consumes a bounce), and GRIN × scattering-arm coexistence.
//                     DELIBERATELY BLIND to wrong bending (a sign-flipped force is still
//                     lossless): trajectory GEOMETRY is pinned by grin.test.ts (exact parabola +
//                     Bouguer); the end-to-end GPU geometry gate (F-LUNEBURG focal point) waits
//                     on the measurement bench's deferred probe checks (crop/peak, not a frame
//                     mean) and stays the owner's converged check on the Luneburg demo until then.

import type { SceneDescription, RenderStrategy } from '../../../src/compiler/types.js';

// ---------------------------------------------------------------------------
// grin-vacuum — floor + red backdrop sphere seen THROUGH an ior:1 lens, fog box
// at the left, quad light overhead (desugared emissive region — pt-findable).
// The ref twin is byte-identical minus the lens object + material.
// ---------------------------------------------------------------------------

const vacuumBase = (withLens: boolean): SceneDescription => ({
    id: withLens ? 'grin-vacuum' : 'grin-vacuum-ref',
    name: withLens ? 'GRIN vacuum lens (ior 1 ≡ no lens)' : 'GRIN vacuum twin reference (no lens)',
    ambientSpace: { type: 'euclidean' },
    objects: [
        { type: 'plane', parameters: { normal: [0, 1, 0], offset: 0 }, material: 'floor', name: 'floor' },
        // The backdrop the lens pixels look at — any exit-ray error shifts its image.
        { type: 'sphere', parameters: { center: [0, 1, -2.5], radius: 0.8 }, material: 'red', name: 'backdrop' },
        // Constant absorbing-only fog: routes through the dispatcher's INLINE arm (no
        // scattering, no expression, no emission) — the ms.deflected coexistence config.
        { type: 'box', parameters: { center: [-2.2, 0.75, -1], halfSize: [0.6, 0.75, 0.6] }, material: 'fog', name: 'fogbox' },
        ...(withLens
            ? [{ type: 'sphere', parameters: { center: [0, 1, 0], radius: 0.75 }, material: 'lens', name: 'lens' } satisfies SceneDescription['objects'][number]]
            : []),
    ],
    materials: {
        floor: { model: 'lambert', albedo: [0.6, 0.6, 0.6] },
        red: { model: 'lambert', albedo: [0.7, 0.15, 0.1] },
        fog: { model: 'none', medium: { sigma_a: [0.4, 0.8, 1.6] } },
        ...(withLens
            ? { lens: { model: 'none', medium: { ior: 1.0 } } }   // constant n = 1: the degenerate deflector
            : {}),
    },
    lights: [
        { kind: 'quad', corner: [-2, 4, -2], edge1: [4, 0, 0], edge2: [0, 0, 4], emission: [5, 5, 5] },
    ],
    environment: { type: 'constant', color: [0.18, 0.2, 0.28], intensity: 1.0 },
});

export const grinVacuum = vacuumBase(true);
export const grinVacuumRef = vacuumBase(false);

// pt (chance-hit) on purpose: no shadow walker, so THE GLASS RULE (deflecting regions
// opaque to NEE) cannot make the arms differ by policy — the twin isolates GRIN
// geometry/plumbing alone. RR off per the witness protocol.
export const grinVacuumStrategy: RenderStrategy = {
    id: 'pt',
    measurement: {
        camera: { type: 'pinhole', fov: 0.9 },
        maxBounces: 8, // each lens traversal consumes one bounce (the orbit budget)
    },
    estimator: {
        directLighting: 'none',
        russianRoulette: null,
        accumulation: { type: 'average' },
    },
    view: { tonemap: { type: 'agx' } },
};

// ---------------------------------------------------------------------------
// grin-furnace — F-BOX-M's chromatic scattering furnace + a Luneburg lens
// (n(r) = √(2 − (r/R)²), n → 1 at the wall) floating inside the haze.
// Equilibrium: walls ρ = 0.5, Le = 0.2 ⇒ L = Le/(1−ρ) = 0.4 uniform, per channel.
// A weight-1 deflector and a non-absorbing scatterer both preserve it exactly.
// ---------------------------------------------------------------------------

const LENS_C: [number, number, number] = [-0.35, 0, -0.55];
const LENS_R = 0.35;
const lensDot = `dot(p - vec3(${LENS_C[0].toFixed(3)}, ${LENS_C[1].toFixed(3)}, ${LENS_C[2].toFixed(3)}), p - vec3(${LENS_C[0].toFixed(3)}, ${LENS_C[1].toFixed(3)}, ${LENS_C[2].toFixed(3)}))`;

export const grinFurnaceScene: SceneDescription = {
    id: 'grin-furnace',
    name: 'GRIN furnace (Luneburg lens in F-BOX-M)',
    ambientSpace: { type: 'euclidean' },
    objects: [
        { type: 'plane', parameters: { normal: [1, 0, 0], offset: 1.0 }, material: 'furnace' },
        { type: 'plane', parameters: { normal: [-1, 0, 0], offset: 1.0 }, material: 'furnace' },
        { type: 'plane', parameters: { normal: [0, 1, 0], offset: 1.0 }, material: 'furnace' },
        { type: 'plane', parameters: { normal: [0, -1, 0], offset: 1.0 }, material: 'furnace' },
        { type: 'plane', parameters: { normal: [0, 0, 1], offset: 1.0 }, material: 'furnace' },
        { type: 'plane', parameters: { normal: [0, 0, -1], offset: 1.0 }, material: 'furnace' },
        { type: 'sphere', parameters: { center: LENS_C, radius: LENS_R }, material: 'lens', name: 'lens' },
    ],
    materials: {
        furnace: { model: 'lambert', albedo: [0.5, 0.5, 0.5], emission: [0.2, 0.2, 0.2] },
        haze: { model: 'none', medium: { sigma_a: 0, sigma_s: [0.5, 1.0, 2.0], phase_g: 0.7 } },
        lens: {
            model: 'none',
            medium: {
                // Luneburg: √2 at the center, exactly 1 at the boundary (continuous entry).
                ior: { kind: 'glsl', source: `sqrt(max(2.0 - ${lensDot} / ${(LENS_R * LENS_R).toFixed(6)}, 0.0))` },
            },
        },
    },
    lights: [],
    environment: { type: 'none' },
    ambientMedium: 'haze',
};

export const grinFurnaceStrategy: RenderStrategy = {
    id: 'grin-furnace',
    measurement: {
        camera: { type: 'pinhole', fov: 1.0 },
        // F-BOX-M uses 48; lens traversals consume one bounce each, so give the
        // budget headroom — a low mean here is bounce starvation, raise this first.
        maxBounces: 64,
    },
    estimator: {
        directLighting: 'none',
        russianRoulette: null, // witness protocol: RR off
        volumeSampling: 'analytic',
        accumulation: { type: 'average' },
    },
    view: { tonemap: { type: 'reinhard' } },
};

// ---------------------------------------------------------------------------
// grin-glass / grin-glass-ref — THE HARD-INTERFACE TWIN (impl-plan-grin-interface).
// A constant-FORMULA medium ior on a dielectric wall routes through the FULL new
// pipeline — entry Fresnel with ior_of(region, p), the Verlet walker on a straight
// line (∇n = 0), the t_max guard, the inside-exit handoff, exit Fresnel/TIR, the
// interior L/n² factor (= 1 at constant n) — and must converge to the SAME image
// as a plain `ior: 1.5` dielectric, which rides only the GPU-verified F-ETA-class
// machinery. Any lens-shaped difference implicates the handoff/guard/factor.
// ---------------------------------------------------------------------------

const glassBase = (viaGrin: boolean): SceneDescription => ({
    id: viaGrin ? 'grin-glass' : 'grin-glass-ref',
    name: viaGrin ? 'GRIN glass twin (constant formula through the walker)' : 'GRIN glass twin reference (plain dielectric)',
    ambientSpace: { type: 'euclidean' },
    objects: [
        { type: 'plane', parameters: { normal: [0, 1, 0], offset: 0 }, material: 'floor', name: 'floor' },
        { type: 'sphere', parameters: { center: [0, 1, -2.5], radius: 0.8 }, material: 'red', name: 'backdrop' },
        { type: 'sphere', parameters: { center: [0, 1, 0], radius: 0.75 }, material: 'glass', name: 'ball' },
    ],
    materials: {
        floor: { model: 'lambert', albedo: [0.6, 0.6, 0.6] },
        red: { model: 'lambert', albedo: [0.7, 0.15, 0.1] },
        glass: viaGrin
            ? { model: 'dielectric', medium: { ior: 1.5 } }   // the ONE ior truth: the medium's (constant) field
            : { model: 'dielectric', ior: 1.5 },              // classic region-table constant — no ODE code emitted
    },
    lights: [
        { kind: 'quad', corner: [-2, 4, -2], edge1: [4, 0, 0], edge2: [0, 0, 4], emission: [5, 5, 5] },
    ],
    environment: { type: 'constant', color: [0.18, 0.2, 0.28], intensity: 1.0 },
});

export const grinGlass = glassBase(true);
export const grinGlassRef = glassBase(false);

// pt (chance-hit): the twin isolates routing/plumbing, not estimator policy. The GRIN
// arm consumes an extra bounce per interior traversal (entry hit → traversal → exit
// hit vs the ref's entry → exit), so the budget gets ~1.5× headroom.
export const grinGlassStrategy: RenderStrategy = {
    id: 'pt',
    measurement: {
        camera: { type: 'pinhole', fov: 0.9 },
        maxBounces: 12,
    },
    estimator: {
        directLighting: 'none',
        russianRoulette: null,
        accumulation: { type: 'average' },
    },
    view: { tonemap: { type: 'agx' } },
};

// ---------------------------------------------------------------------------
// grin-furnace-hard — the CONSERVATION gate for the hard interface. A dielectric-
// walled blob with a LINEAR index field n(p) = 1.5 + 0.9·(y − c_y): real Fresnel at
// the wall (n_wall ≈ 1.2–1.8, η ≠ 1), TIR, genuine bending (constant vertical force
// — the exact-parabola field of F-MIRAGE), and — the point — DIFFERENT n at each
// path's entry and exit points, so the equilibrium holds ONLY if the interior L/n²
// factor closes the η² books: enter (1/n_A)² · interior (n_A/n_B)² · exit (n_B)² = 1.
// Without the factor this witness reads visibly off 0.4; grin-furnace (continuous
// walls, n → 1) is blind to it.
// ---------------------------------------------------------------------------

const HARD_C: [number, number, number] = [-0.35, 0, -0.55];
const HARD_R = 0.35;

export const grinFurnaceHardScene: SceneDescription = {
    id: 'grin-furnace-hard',
    name: 'GRIN furnace, hard interface (linear field in glass)',
    ambientSpace: { type: 'euclidean' },
    objects: [
        { type: 'plane', parameters: { normal: [1, 0, 0], offset: 1.0 }, material: 'furnace' },
        { type: 'plane', parameters: { normal: [-1, 0, 0], offset: 1.0 }, material: 'furnace' },
        { type: 'plane', parameters: { normal: [0, 1, 0], offset: 1.0 }, material: 'furnace' },
        { type: 'plane', parameters: { normal: [0, -1, 0], offset: 1.0 }, material: 'furnace' },
        { type: 'plane', parameters: { normal: [0, 0, 1], offset: 1.0 }, material: 'furnace' },
        { type: 'plane', parameters: { normal: [0, 0, -1], offset: 1.0 }, material: 'furnace' },
        { type: 'sphere', parameters: { center: HARD_C, radius: HARD_R }, material: 'lens', name: 'lens' },
    ],
    materials: {
        furnace: { model: 'lambert', albedo: [0.5, 0.5, 0.5], emission: [0.2, 0.2, 0.2] },
        lens: {
            model: 'dielectric',   // the hard wall: Snell/Fresnel/TIR with the LOCAL n(p) below
            medium: {
                // Linear in y: n ∈ [1.185, 1.815] across the blob — no wall value is 1.
                ior: { kind: 'glsl', source: `1.5 + 0.9 * (p.y - ${HARD_C[1].toFixed(3)})` },
            },
        },
    },
    lights: [],
    environment: { type: 'none' },
};

// ---------------------------------------------------------------------------
// grin-emit / grin-emit-ref — EMISSION ALONG THE BENT PATH (impl-plan-grin-media
// batch 1), the telescoping twin: an `ior: 1` emissive absorbing medium routes
// through the GRIN walker's PER-STEP collection (E1.5 closed form each step ×
// the (n₀/n)² source factor, ≡ 1 at constant n) and must converge to the same
// image as the identical medium (sans ior) through the inline closed-form arm —
// for constant coefficients the per-step sum telescopes to that arm's exact
// integral, so the twin is exact up to fp.
// ---------------------------------------------------------------------------

const emitBase = (viaGrin: boolean): SceneDescription => ({
    id: viaGrin ? 'grin-emit' : 'grin-emit-ref',
    name: viaGrin ? 'GRIN emission twin (per-step collection)' : 'GRIN emission twin reference (closed-form arm)',
    ambientSpace: { type: 'euclidean' },
    objects: [
        { type: 'plane', parameters: { normal: [0, 1, 0], offset: 0 }, material: 'floor', name: 'floor' },
        { type: 'sphere', parameters: { center: [0, 1, 0], radius: 0.8 }, material: 'glow', name: 'glow' },
    ],
    materials: {
        floor: { model: 'lambert', albedo: [0.4, 0.4, 0.4] },
        glow: {
            model: 'none',
            medium: {
                sigma_a: [0.5, 0.8, 1.2],
                emission: [0.6, 0.4, 0.2],
                ...(viaGrin ? { ior: 1.0 } : {}),   // the ONE difference: route through the walker
            },
        },
    },
    lights: [
        { kind: 'quad', corner: [-2, 4, -2], edge1: [4, 0, 0], edge2: [0, 0, 4], emission: [3, 3, 3] },
    ],
    environment: { type: 'constant', color: [0.05, 0.06, 0.09], intensity: 1.0 },
});

export const grinEmit = emitBase(true);
export const grinEmitRef = emitBase(false);

export const grinEmitStrategy: RenderStrategy = {
    id: 'pt',
    measurement: { camera: { type: 'pinhole', fov: 0.9 }, maxBounces: 8 },
    estimator: { directLighting: 'none', russianRoulette: null, accumulation: { type: 'average' } },
    view: { tonemap: { type: 'agx' } },
};

// ---------------------------------------------------------------------------
// grin-furnace-emit — THE KIRCHHOFF GATE for the (n₀/n)² source factor. In an
// enclosure at equilibrium L₀ the radiance INSIDE a region of index n is n²·L₀
// (basic radiance), so an absorbing medium there holds equilibrium ONLY if it
// emits the local thermal source ε(x) = σ_a·L₀·n²(x). Authored exactly so (for
// the Luneburg field n² = 2 − r²/R², so ε = σ_a·0.4·(2 − r²/R²) — an expression
// ε on a deflecting medium, majorant-free by the carve). Equilibrium stays
// 0.4/channel ONLY with the source factor: collected emission mis-scales by n²
// without it. Every other furnace witness is blind to this term.
// ---------------------------------------------------------------------------

const KE_C: [number, number, number] = [-0.35, 0, -0.55];
const KE_R = 0.35;
const keDot = `dot(p - vec3(${KE_C[0].toFixed(3)}, ${KE_C[1].toFixed(3)}, ${KE_C[2].toFixed(3)}), p - vec3(${KE_C[0].toFixed(3)}, ${KE_C[1].toFixed(3)}, ${KE_C[2].toFixed(3)}))`;
const keN2 = `max(2.0 - ${keDot} / ${(KE_R * KE_R).toFixed(6)}, 0.0)`;   // Luneburg n²(x)

export const grinFurnaceEmitScene: SceneDescription = {
    id: 'grin-furnace-emit',
    name: 'GRIN furnace, Kirchhoff emission (ε = σ_a·L·n²)',
    ambientSpace: { type: 'euclidean' },
    objects: [
        { type: 'plane', parameters: { normal: [1, 0, 0], offset: 1.0 }, material: 'furnace' },
        { type: 'plane', parameters: { normal: [-1, 0, 0], offset: 1.0 }, material: 'furnace' },
        { type: 'plane', parameters: { normal: [0, 1, 0], offset: 1.0 }, material: 'furnace' },
        { type: 'plane', parameters: { normal: [0, -1, 0], offset: 1.0 }, material: 'furnace' },
        { type: 'plane', parameters: { normal: [0, 0, 1], offset: 1.0 }, material: 'furnace' },
        { type: 'plane', parameters: { normal: [0, 0, -1], offset: 1.0 }, material: 'furnace' },
        { type: 'sphere', parameters: { center: KE_C, radius: KE_R }, material: 'lens', name: 'lens' },
    ],
    materials: {
        furnace: { model: 'lambert', albedo: [0.5, 0.5, 0.5], emission: [0.2, 0.2, 0.2] },
        lens: {
            model: 'none',
            medium: {
                sigma_a: [0.4, 0.4, 0.4],
                // ε = σ_a · L₀ · n²(x) = 0.4 · 0.4 · n² = 0.16·n² (scalar broadcasts).
                emission: { kind: 'glsl', source: `0.16 * ${keN2}` },
                ior: { kind: 'glsl', source: `sqrt(${keN2})` },
            },
        },
    },
    lights: [],
    environment: { type: 'none' },
};

export const grinFurnaceEmitStrategy: RenderStrategy = {
    id: 'grin-kirchhoff',
    measurement: { camera: { type: 'pinhole', fov: 1.0 }, maxBounces: 64 },
    estimator: { directLighting: 'none', russianRoulette: null, accumulation: { type: 'average' } },
    view: { tonemap: { type: 'reinhard' } },
};

// ---------------------------------------------------------------------------
// grin-scatter / grin-scatter-ref — SCATTERING ALONG THE BENT PATH (batch 2),
// the arc-length twin: an `ior: 1` scattering medium routes through the GRIN
// channel-MIS sampler (the analytic arm's math with t → arc length, the walk
// discovering the exit) and must converge to the identical medium (sans ior)
// through the analytic arm itself.
// ---------------------------------------------------------------------------

const scatterBase = (viaGrin: boolean): SceneDescription => ({
    id: viaGrin ? 'grin-scatter' : 'grin-scatter-ref',
    name: viaGrin ? 'GRIN scattering twin (arc-length channel-MIS)' : 'GRIN scattering twin reference (analytic arm)',
    ambientSpace: { type: 'euclidean' },
    objects: [
        { type: 'plane', parameters: { normal: [0, 1, 0], offset: 0 }, material: 'floor', name: 'floor' },
        { type: 'sphere', parameters: { center: [0, 1, 0], radius: 0.8 }, material: 'fog', name: 'fogball' },
    ],
    materials: {
        floor: { model: 'lambert', albedo: [0.5, 0.5, 0.5] },
        fog: {
            model: 'none',
            medium: {
                sigma_a: [0.05, 0.05, 0.05],
                sigma_s: [0.6, 0.9, 1.4],
                phase_g: 0.3,
                ...(viaGrin ? { ior: 1.0 } : {}),   // the ONE difference: route through the walker
            },
        },
    },
    lights: [
        { kind: 'quad', corner: [-2, 4, -2], edge1: [4, 0, 0], edge2: [0, 0, 4], emission: [5, 5, 5] },
    ],
    environment: { type: 'constant', color: [0.1, 0.12, 0.16], intensity: 1.0 },
});

export const grinScatter = scatterBase(true);
export const grinScatterRef = scatterBase(false);

export const grinScatterStrategy: RenderStrategy = {
    id: 'pt',
    measurement: { camera: { type: 'pinhole', fov: 0.9 }, maxBounces: 12 },
    estimator: { directLighting: 'none', russianRoulette: null, volumeSampling: 'analytic', accumulation: { type: 'average' } },
    view: { tonemap: { type: 'agx' } },
};

// ---------------------------------------------------------------------------
// grin-furnace-scatter — the haze INSIDE the deflecting region: a Luneburg lens
// whose OWN medium scatters (chromatic σ_s, HG). Lossless scattering × lossless
// bending preserves the furnace equilibrium exactly — catches weight bugs in the
// arc sampler (the existing grin-furnace has the haze AROUND the lens, ambient).
// ---------------------------------------------------------------------------

export const grinFurnaceScatterScene: SceneDescription = {
    id: 'grin-furnace-scatter',
    name: 'GRIN furnace, scattering interior',
    ambientSpace: { type: 'euclidean' },
    objects: [
        { type: 'plane', parameters: { normal: [1, 0, 0], offset: 1.0 }, material: 'furnace' },
        { type: 'plane', parameters: { normal: [-1, 0, 0], offset: 1.0 }, material: 'furnace' },
        { type: 'plane', parameters: { normal: [0, 1, 0], offset: 1.0 }, material: 'furnace' },
        { type: 'plane', parameters: { normal: [0, -1, 0], offset: 1.0 }, material: 'furnace' },
        { type: 'plane', parameters: { normal: [0, 0, 1], offset: 1.0 }, material: 'furnace' },
        { type: 'plane', parameters: { normal: [0, 0, -1], offset: 1.0 }, material: 'furnace' },
        { type: 'sphere', parameters: { center: KE_C, radius: KE_R }, material: 'lens', name: 'lens' },
    ],
    materials: {
        furnace: { model: 'lambert', albedo: [0.5, 0.5, 0.5], emission: [0.2, 0.2, 0.2] },
        lens: {
            model: 'none',
            medium: {
                sigma_a: 0,
                sigma_s: [0.5, 1.0, 2.0],
                phase_g: 0.7,
                ior: { kind: 'glsl', source: `sqrt(${keN2})` },
            },
        },
    },
    lights: [],
    environment: { type: 'none' },
};

export const grinFurnaceScatterStrategy: RenderStrategy = {
    id: 'grin-scatfurnace',
    measurement: { camera: { type: 'pinhole', fov: 1.0 }, maxBounces: 64 },
    estimator: { directLighting: 'none', russianRoulette: null, volumeSampling: 'analytic', accumulation: { type: 'average' } },
    view: { tonemap: { type: 'reinhard' } },
};

export const grinFurnaceHardStrategy: RenderStrategy = {
    id: 'grin-hard',
    measurement: {
        camera: { type: 'pinhole', fov: 1.0 },
        // TIR loops cost ~2 bounces each (interior traversal + wall event); F ≈ 0.05
        // per event makes deep chains exponentially rare, but give real headroom —
        // a low mean here is bounce starvation before it is physics.
        maxBounces: 96,
    },
    estimator: {
        directLighting: 'none',
        russianRoulette: null, // witness protocol: RR off
        accumulation: { type: 'average' },
    },
    view: { tonemap: { type: 'reinhard' } },
};

// ---------------------------------------------------------------------------
// grin-long — a traversal is ONE event however many steps it takes (taxonomy §4.1), and the
// walker's long-traversal roulette is unbiased. An orthographic camera looks down −z through two
// `ior: 1` boxes (straight rays, weight 1) at a constant sky of radiance 1: the left box is 30
// units deep (1500 Verlet steps at GRIN_STEP = 0.02 — 2 roulette rounds), the right one 60 (3000
// steps — 5 rounds). With maxBounces 1 every pixel is exactly 1: camera → traversal (the one
// event) → sky. A per-step-count charge against the bounce budget reads 0 here, and a biased
// give-up reads below 1 on the right more than on the left. Survivors carry 1/0.9^k, so the
// noise grows with the depth; the mean does not move.
// ---------------------------------------------------------------------------

export const grinLongScene: SceneDescription = {
    id: 'grin-long',
    name: 'Two long ior:1 regions in front of a unit sky (one event per traversal)',
    ambientSpace: { type: 'euclidean' },
    objects: [
        { type: 'box', parameters: { center: [-0.41, 0, -15.1], halfSize: [0.39, 0.6, 15] }, material: 'vacuum', name: 'short' },
        { type: 'box', parameters: { center: [0.41, 0, -30.1], halfSize: [0.39, 0.6, 30] }, material: 'vacuum', name: 'long' },
    ],
    materials: {
        vacuum: { model: 'none', medium: { ior: 1.0 } },
    },
    lights: [],
    environment: { type: 'constant', color: [1, 1, 1], intensity: 1.0 },
};

export const grinLongStrategy: RenderStrategy = {
    id: 'pt',
    measurement: {
        camera: { type: 'orthographic', scale: 0.5 },   // film ±0.67 × ±0.5: every ray crosses a box or the 0.04 gap
        maxBounces: 1,
    },
    estimator: { directLighting: 'none', russianRoulette: null, accumulation: { type: 'average' } },
    view: { tonemap: { type: 'reinhard' } },
};
