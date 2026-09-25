// witnesses/scenes/estimatorAgreementWitness.ts
//
// ESTIMATOR AGREEMENT. The strategy taxonomy's contract is that changing the estimator never
// changes the converged image. Each scene here pins one place where two sampling techniques
// must count exactly the same set of paths and — before the September 2026 fixes — did not.
// Every expected value is exact.
//
//   bounce-budget     maxBounces = N means Σ_{n≤N} TⁿE under pt, pt-nee AND pt-mis.
//   proc-sky-rotated  the environment pdf that MIS uses must be the density the sampler
//                     used, also under a rotation.
//   fog-sky           environment NEE and a BSDF ray that misses find the sky at the same
//                     far clip, so an ambient medium attenuates both the same way.
//   rough-sheet       an index-matched rough dielectric is a delta pass-through: invisible,
//                     never NaN.

import type { SceneDescription, RenderStrategy } from '../../../src/compiler/types.js';
import { furnaceSkyScene, furnaceSkyNeeStrategy, furnaceSkyMisStrategy, furnaceSkyPtStrategy, procSkyScene } from './envScenes.js';
import { cornellArea } from './areaLightScenes.js';

// ---------------------------------------------------------------------------
// bounce-budget — the open furnace at maxBounces 0 and 1.
//
// A convex Lambertian sphere under a uniform sky L never sees itself, so its exit radiance
// is the single-scattering term ρ·L EXACTLY — the n = 1 term is the whole answer. Hence:
//   maxBounces 1: sphere = ρ·L = 0.4 and sky = L = 1 under every estimator.
//   maxBounces 0: only directly visible emission — sky = 1, sphere = 0.
// Before the fix the loop did N intersections with NEE at each: at maxBounces 1 pt read 0 on
// the sphere (its escaping ray was never traced), pt-mis read only the NEE share of 0.4, and
// at maxBounces 0 nothing ran at all, so even the sky was black.
// ---------------------------------------------------------------------------

export const bounceBudgetScene: SceneDescription = { ...furnaceSkyScene, id: 'bounce-budget', name: 'Bounce budget (open furnace at N = 0, 1)' };

const atBudget = (s: RenderStrategy, n: number): RenderStrategy => ({
    ...s,
    id: `${s.id}-${n}`,
    measurement: { ...s.measurement, maxBounces: n },
});

export const bounceBudgetStrategies: RenderStrategy[] = [
    atBudget(furnaceSkyNeeStrategy, 0), atBudget(furnaceSkyMisStrategy, 0), atBudget(furnaceSkyPtStrategy, 0),
    atBudget(furnaceSkyNeeStrategy, 1), atBudget(furnaceSkyMisStrategy, 1), atBudget(furnaceSkyPtStrategy, 1),
];

// ---------------------------------------------------------------------------
// proc-sky-rotated — the procedural sun sky, rotated by −3 rad.
//
// The chart's u for a world direction is φ/2π + ½ + r/2π, where r is the rotation, and that
// sum can leave [0, 1). environment_pdf used to CLAMP it instead of wrapping, so every
// direction whose table column lies in (1 + r/2π, 1) — here (0.523, 1) — was assigned the
// pdf of column 0. The sun sits at table u ≈ 0.574, inside that band, so a BSDF ray hitting
// the sun computed the pdf of a dim-sky column, took MIS weight ≈ 1, while NEE samples of the
// sun also took weight ≈ 1: the sun's light was counted about twice under pt-mis. pt-nee is
// unaffected, so nee ≡ mis is the gate. (A POSITIVE rotation's band is [0, r/2π) and would
// miss this sun — it must be the sign that sweeps the band over it.)
//
// The sun here is LARGE and dominant (≈10° radius, radiance 40, over a sky of 0.02): the
// double count must move the image far past the equality gate. proc-sky's own 2° sun supplies
// only a few percent of the light and is rarely found by BSDF sampling, so the same bias there
// measured 0.55% — invisible to a 2% gate.
// ---------------------------------------------------------------------------

export const procSkyRotatedScene: SceneDescription = {
    ...procSkyScene,
    id: 'proc-sky-rotated',
    name: 'Procedural big-sun sky, rotated (env pdf wrap)',
    environment: {
        type: 'procedural',
        glsl: {
            kind: 'glsl',
            source: 'vec3(0.02) + vec3(40.0) * smoothstep(0.985, 0.99, dot(dir, normalize(vec3(0.4, 0.35, 0.2))))',
        },
        intensity: 1.0,
        rotation: -3.0,
    },
};

// ---------------------------------------------------------------------------
// fog-sky — the open furnace inside a weakly absorbing ambient medium (σ_a = 0.001).
//
// MAX_DIST (1000) is the far clip: a BSDF ray that misses finds the sky there, attenuated by
// e^{−σ·1000} = e^{−1}. Environment NEE must place the sky at the same distance. It used a
// 1e20 sentinel instead, so its shadow walk attenuated by e^{−σ·10²⁰} = 0 and pt-nee lost
// all sky light on the sphere (pt-mis kept only the BSDF share).
// Exact values (camera at distance 2.5 from the sphere's near point, σ = 0.001):
//   sky pixels    = L·e^{−1}                       = 0.367879
//   sphere centre = ρ·L·e^{−1}·e^{−0.0025}         = 0.146784
// pt is exact per sample here (the Lambert weight is ρ and every bounce escapes).
// ---------------------------------------------------------------------------

export const FOG_SKY_SIGMA = 0.001;

export const fogSkyScene: SceneDescription = {
    ...furnaceSkyScene,
    id: 'fog-sky',
    name: 'Open furnace in absorbing air (the sky at the far clip)',
    ambientMedium: 'air',
    materials: {
        ...furnaceSkyScene.materials,
        air: { model: 'none', medium: { sigma_a: FOG_SKY_SIGMA } },
    },
};

// ---------------------------------------------------------------------------
// rough-sheet — cornell-area seen through a thin ROUGH dielectric sheet, from its BACK.
//
// Camera rays hit the sheet's back face. There the dispatcher resolves BOTH sides to the
// surrounding air (a zero-thickness surface claims no interior), so η = 1 exactly: F = 0 and
// every microfacet refracts straight through — the sheet must be INVISIBLE, and the image must
// equal cornell-area's. Before the fix the sampler reached the pass-through direction through
// the microfacet branch with an infinite pdf (the Jacobian's denominator is 0 at η = 1), which
// the MIS weight turned into NaN.
//
// Why the back face: on a FRONT-face hit the dispatcher sets region_to = the sheet's own
// region, which carries the material's index (1.5), so from the front a thin dielectric
// refracts as if ENTERING glass and never exits (bent and darkened by η²). That is how
// one-sided quad lights get their one-sidedness (emission is read from region_to), and it is
// an open defect for thin dielectrics — a separate question from the η = 1 sampler.
// ---------------------------------------------------------------------------

export const roughSheetScene: SceneDescription = {
    ...cornellArea,
    id: 'rough-sheet',
    name: 'Cornell behind an index-matched rough sheet',
    objects: [
        ...cornellArea.objects,
        {
            type: 'quad',
            // normal = edge1 × edge2 = −z: facing AWAY from the camera (at z = 4).
            parameters: { corner: [-3, -2, 2.5], edge1: [0, 6, 0], edge2: [6, 0, 0] },
            material: 'sheet',
            name: 'sheet',
        },
    ],
    materials: { ...cornellArea.materials, sheet: { model: 'rough_dielectric', roughness: 0.3 } },
};
