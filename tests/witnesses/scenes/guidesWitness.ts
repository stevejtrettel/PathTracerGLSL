// witnesses/scenes/guidesWitness.ts — `guides` and the `guides-grin-*` scenes: the first-hit
// AOVs (components/aov), checked region by region against values derived before the run
// (docs/claude-outputs-step6-plan.md §4).
//
// THE CLAIM UNDER TEST. A guide sample is g(first surface) × the path's weight on arrival,
// captured only while the path has had no scattering event. Every medium arm's arrival weight
// is an unbiased estimate of the transmittance T along the camera ray, so the averaged albedo is
// g ⊙ T and the averaged normal n · avg_c(T), in EVERY arm; a path an arm ends (absorption,
// GRIN no-return) arrives with weight 0. A definition that recorded g unweighted on arrival (the
// pbrt-v4 convention) would instead read g · P(arrive): g at full strength behind an absorbing
// slab, and one gray factor for every channel behind a tracked one — these scenes tell them apart.
//
// THE FRAME. An orthographic camera looks straight down −z at a lambert wall (albedo WALL_G,
// front face at z = −1, facing the camera), so every ray in a column crosses the same thickness
// perpendicularly and each column has ONE expected value. What stands in front of the wall
// (between z = 0 and z = 1; null-walled boxes unless stated):
//
//   guides — seven columns and the sky:
//     direct          nothing                          → g, n = +z                 (exact)
//     absorbing       constant absorbing medium        → g·e^{−σ_a d}              (deterministic arm)
//     scattering      constant chromatic scattering    → g·e^{−σ_t d}              (analytic channel-MIS arm)
//     exprAbsorbing   expression absorbing medium      → g·e^{−∫σ_a}               (ratio tracking)
//     exprScattering  expression chromatic scattering  → g·e^{−∫σ_t}, σ_a > 0      (delta tracking — the
//                                                        absorption branch, the terminated-path case, runs)
//     nullSlabs       two absorbing slabs, 4 crossings → g·T₁T₂, and 0 with maxNullCrossings 3
//     glass           tinted glass (dielectric)        → its transmittance, n = +z (its own surface value)
//     sky             a miss                           → 0
//
//   guides-grin-* — one GRIN material each, the way every GRIN scene in the suite is built (a
//   scene with several GRIN materials and NEE measured minutes per sample on SwiftShader, an
//   open item outside these witnesses):
//     traversal       GRIN region, 1 thick, n = 1      → 0                         (a traversal is an event)
//     substep         GRIN slab 0.015 thick, absorbing → g·e^{−σ_a d}              (thinner than one walker
//                                                        step: flown straight, not deflected)
//     substep-scatter the same, scattering             → g·e^{−σ_t d}              (the collision lottery)
//     capture         GRIN region with n > GRIN_CAPTURE→ 0                         (no-return: zero weight
//                                                        falling through to the wall; deflected rays: an event)
//     elsewhere       a PLAIN absorbing slab 0.015 thick, with a small GRIN box elsewhere in the scene
//                                                      → g·e^{−σ_a d}              (a GRIN medium anywhere in the
//                                                        program must not change how other media are crossed)
//
// Tolerances: a few 1e-5 where the value is a constant (average_update is a mix(), which need not
// return a constant exactly); 2e-3 more where a ray crosses medium boundaries (the spawn margins
// shorten the path by a small fp-relative amount, the budget null-budget-view uses); 5σ of the
// region mean where the arm's variance is closed form (the analytic lottery: Var = (gT)²(1/pdf − 1),
// pdf = avg_c T_c; the normal's sample is exactly 1 on arrival, a Bernoulli(pdf)); and a stated
// bound for the tracking arms below.

import type { SceneDescription, RenderStrategy, Vec3, MaterialDescription } from '../../../src/compiler/types.js';
import type { WitnessCheck, WitnessRegion, WitnessSpec } from '../types.js';

export const WALL_G: Vec3 = [0.8, 0.5, 0.2];
const SIZE: [number, number] = [160, 120];
const SPP = 64;
/** guides renders five strategies, two with NEE (about 3 s a sample on SwiftShader, guides on or
 *  off alike), so it takes half the samples of the single-strategy GRIN scenes. */
const GUIDES_SPP = 32;
const SCALE = 1.4;                                    // film half-height (world units)
const HALF_W = SCALE * SIZE[0] / SIZE[1];             // film half-width

const exp3 = (v: Vec3, s = 1): Vec3 => v.map((x) => Math.exp(-x * s)) as Vec3;
const mul3 = (a: Vec3, b: Vec3): Vec3 => a.map((x, i) => x * b[i]) as Vec3;
const sum3 = (a: Vec3, b: Vec3): Vec3 => a.map((x, i) => x + b[i]) as Vec3;
const avg3 = (v: Vec3) => (v[0] + v[1] + v[2]) / 3;
/** ∫₀¹ c(1 + z) dz = 1.5c. */
const ramp = (c: Vec3): Vec3 => c.map((x) => 1.5 * x) as Vec3;
const glsl = (source: string) => ({ kind: 'glsl' as const, source });
const ramped = (c: Vec3) => glsl(`vec3(${c.join(', ')}) * (1.0 + p.z)`);

// The media, and the transmittance each column's ray sees through its thickness.
const ABS_SIGMA_A: Vec3 = [0.2, 0.7, 1.5];                   // d = 1
const SCAT_SIGMA_A: Vec3 = [0.1, 0.2, 0.3];                  // d = 1
const SCAT_SIGMA_S: Vec3 = [0.5, 0.3, 1.0];
const EXPR_ABS_C: Vec3 = [0.3, 0.6, 1.2];                    // σ_a = c(1 + z), z ∈ [0, 1]
const EXPR_SCAT_A: Vec3 = [0.2, 0.4, 0.6];                   // σ_a, σ_s = c(1 + z)
const EXPR_SCAT_S: Vec3 = [0.6, 0.3, 0.9];
const NULL_SLAB_SIGMA = 0.3;                                 // two slabs, d = 0.4 each
const GLASS_T: Vec3 = [0.9, 0.7, 0.5];
const THIN_D = 0.015;                                        // below GRIN_STEP (0.02)
const THIN_SIGMA_T: Vec3 = [20, 40, 60];

export const GUIDE_T = {
    absorbing: exp3(ABS_SIGMA_A),
    scattering: exp3(sum3(SCAT_SIGMA_A, SCAT_SIGMA_S)),
    exprAbsorbing: exp3(ramp(EXPR_ABS_C)),
    exprScattering: exp3(ramp(sum3(EXPR_SCAT_A, EXPR_SCAT_S))),
    nullSlabs: exp3([NULL_SLAB_SIGMA, NULL_SLAB_SIGMA, NULL_SLAB_SIGMA], 0.8),
    substep: exp3(THIN_SIGMA_T, THIN_D),
};

// ---------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------

const WALL: SceneDescription['objects'][number] = { type: 'box', name: 'wall', parameters: { center: [0, 0, -1.5], halfSize: [2.5, 1.0, 0.5] }, material: 'wall' };
const ENVIRONMENT: SceneDescription['environment'] = { type: 'constant', color: [0.3, 0.3, 0.3], intensity: 1.0 };
const columnBox = (x: number, halfWidth: number, material: string, zLo: number, zHi: number, name: string): SceneDescription['objects'][number] => ({
    type: 'box', name,
    parameters: { center: [x, 0, (zLo + zHi) / 2], halfSize: [halfWidth, 0.8, (zHi - zLo) / 2] },
    material,
});
/** The inner part of a column of half-width w centred at x, away from its edges. */
const region = (x: number, w: number): WitnessRegion => ({
    x: (x - w + HALF_W) / (2 * HALF_W), w: (2 * w) / (2 * HALF_W),
    y: (-0.6 + SCALE) / (2 * SCALE), h: 1.2 / (2 * SCALE),
});
const SKY: WitnessRegion = { x: 0, y: (1.1 + SCALE) / (2 * SCALE), w: 1, h: (SCALE - 1.15) / (2 * SCALE) };
/** Samples in a region, counted the way the runner bounds it (whole pixels). */
const samplesIn = (r: WitnessRegion, spp: number) =>
    (Math.ceil((r.x + r.w) * SIZE[0]) - Math.floor(r.x * SIZE[0])) * (Math.ceil((r.y + r.h) * SIZE[1]) - Math.floor(r.y * SIZE[1])) * spp;

const strategy = (id: string, directLighting: 'none' | 'nee', extra: Partial<RenderStrategy['measurement']> = {}, aovs = true): RenderStrategy => ({
    id,
    measurement: {
        camera: { type: 'orthographic', scale: SCALE, position: [0, 0, 4], target: [0, 0, 0] },
        // One bounce: the guides are captured at bounce 0, and the radiance checks hold at any budget.
        maxBounces: 1,
        ...(aovs ? { aovs: ['albedo', 'normal'] } : {}),
        ...extra,
    },
    estimator: {
        directLighting,
        volumeSampling: 'delta-tracking',   // the expression media need it; constant media stay analytic
        russianRoulette: null,
        accumulation: { type: 'average', variance: true },   // all four pictures on the GPU
    },
    view: { tonemap: { type: 'reinhard' } },
});

const CONST = 3e-5;     // a constant through mix()
const MARGIN = 2e-3;    // + boundary spawn margins on a medium crossing
const Z: Vec3 = [0, 0, 1];
const ZERO: Vec3 = [0, 0, 0];
const normalTol = (z: number): Vec3 => [1e-4, 1e-4, z];
const zT = (T: Vec3): Vec3 => [0, 0, avg3(T)];

/** 5σ of the region mean for the analytic lottery: per channel, a sample is g·T_c/pdf with
 *  probability pdf = avg(T) and 0 otherwise; the normal's z is 1 or 0. */
function lotteryTol(T: Vec3, r: WitnessRegion, spp: number) {
    const pdf = avg3(T), n = samplesIn(r, spp);
    return {
        albedo: WALL_G.map((g, c) => 5 * g * T[c] * Math.sqrt((1 / pdf - 1) / n) + MARGIN) as Vec3,
        normalZ: 5 * Math.sqrt(pdf * (1 - pdf) / n) + MARGIN,
    };
}

const pair = (r: WitnessRegion, label: string, albedo: Vec3, aTol: number | Vec3, normal: Vec3, nTol: Vec3, strategyIndex = 0): WitnessCheck[] => [
    { kind: 'mean', picture: 'albedo', region: r, value: albedo, tol: aTol, strategy: strategyIndex, label: `albedo, ${label}` },
    { kind: 'mean', picture: 'normal', region: r, value: normal, tol: nTol, strategy: strategyIndex, label: `normal, ${label}` },
];

// ---------------------------------------------------------------------------
// guides — the media arms, null slabs and glass
// ---------------------------------------------------------------------------

const COLUMNS = ['direct', 'absorbing', 'scattering', 'exprAbsorbing', 'exprScattering', 'nullSlabs', 'glass'] as const;
const COL_W = (2 * HALF_W) / COLUMNS.length;
const colX = (name: typeof COLUMNS[number]) => -HALF_W + (COLUMNS.indexOf(name) + 0.5) * COL_W;
const col = (name: typeof COLUMNS[number]) => region(colX(name), 0.12);
const slab = (name: typeof COLUMNS[number], zLo = 0, zHi = 1, suffix = '') => columnBox(colX(name), 0.2, name === 'nullSlabs' ? 'nullSlab' : name, zLo, zHi, `${name}${suffix}`);

export const guidesScene: SceneDescription = {
    id: 'guides',
    name: 'Guides: the first-hit albedo and normal through every medium arm',
    ambientSpace: { type: 'euclidean' },
    objects: [
        WALL,
        slab('absorbing'), slab('scattering'), slab('exprAbsorbing'), slab('exprScattering'),
        slab('nullSlabs', 0.0, 0.4, 'A'), slab('nullSlabs', 0.6, 1.0, 'B'),
        slab('glass'),
    ],
    materials: {
        wall: { model: 'lambert', albedo: WALL_G },
        absorbing: { model: 'none', medium: { sigma_a: ABS_SIGMA_A } },
        scattering: { model: 'none', medium: { sigma_a: SCAT_SIGMA_A, sigma_s: SCAT_SIGMA_S } },
        // Majorants above each field's maximum on z ∈ [0, 1] (2c), so the D1 clamp never binds.
        exprAbsorbing: { model: 'none', medium: { sigma_a: ramped(EXPR_ABS_C), majorant: 2.5 } },
        exprScattering: { model: 'none', medium: { sigma_a: ramped(EXPR_SCAT_A), sigma_s: ramped(EXPR_SCAT_S), majorant: 3.2 } },
        nullSlab: { model: 'none', medium: { sigma_a: [NULL_SLAB_SIGMA, NULL_SLAB_SIGMA, NULL_SLAB_SIGMA] } },
        glass: { model: 'dielectric', transmittance: GLASS_T, ior: 1.5 },
    },
    lights: [{ kind: 'point', position: [0, 0.5, 3], emission: 4 }],
    environment: ENVIRONMENT,
};

export const guidesStrategies: RenderStrategy[] = [
    strategy('pt', 'none'),                                  // 0
    strategy('pt-nee', 'nee'),                               // 1
    strategy('pt-nee-plain', 'nee', {}, false),              // 2: no AOVs — radiance and variance must not change
    strategy('null-cut', 'none', { maxNullCrossings: 3 }),   // 3: the null slabs' fourth crossing is past the budget
    strategy('zero-bounce', 'none', { maxBounces: 0 }),      // 4: the capture precedes the budget break
];

/** The tracking arms have no closed-form variance. Ratio tracking's weight lies in [0, 1], so a
 *  sample lies in [0, g] and σ ≤ g/2: 5σ of the mean ≤ 2.5g/√n. Delta tracking's history-aware
 *  weights can exceed 1; it gets the fixed bound 0.03, about 8σ of a Bernoulli at these counts. */
const DELTA_TOL = 0.03;

function guidesChecks(): WitnessCheck[] {
    const ratioN = samplesIn(col('exprAbsorbing'), GUIDES_SPP);
    const scat = lotteryTol(GUIDE_T.scattering, col('scattering'), GUIDES_SPP);
    return [
        ...pair(col('direct'), 'direct', WALL_G, CONST, Z, normalTol(CONST)),
        ...pair(col('absorbing'), 'constant absorbing', mul3(WALL_G, GUIDE_T.absorbing), CONST + MARGIN, zT(GUIDE_T.absorbing), normalTol(CONST + MARGIN)),
        ...pair(col('scattering'), 'analytic scattering', mul3(WALL_G, GUIDE_T.scattering), scat.albedo, zT(GUIDE_T.scattering), normalTol(scat.normalZ)),
        ...pair(col('exprAbsorbing'), 'ratio tracking', mul3(WALL_G, GUIDE_T.exprAbsorbing),
            WALL_G.map((g) => 2.5 * g / Math.sqrt(ratioN) + MARGIN) as Vec3, zT(GUIDE_T.exprAbsorbing), normalTol(2.5 / Math.sqrt(ratioN) + MARGIN)),
        ...pair(col('exprScattering'), 'delta tracking', mul3(WALL_G, GUIDE_T.exprScattering), DELTA_TOL, zT(GUIDE_T.exprScattering), normalTol(DELTA_TOL)),
        ...pair(col('nullSlabs'), 'two null slabs', mul3(WALL_G, GUIDE_T.nullSlabs), CONST + MARGIN, zT(GUIDE_T.nullSlabs), normalTol(CONST + MARGIN)),
        ...pair(col('glass'), 'glass', GLASS_T, CONST, Z, normalTol(CONST)),
        ...pair(SKY, 'sky (a miss)', ZERO, 1e-7, ZERO, normalTol(1e-7)),
        // The budget: past maxNullCrossings before the first surface, the guide is 0; a column with
        // two crossings is unaffected.
        { kind: 'mean', picture: 'albedo', region: col('nullSlabs'), value: 0, tol: 1e-7, strategy: 3, label: 'albedo, null slabs past maxNullCrossings' },
        { kind: 'mean', picture: 'albedo', region: col('absorbing'), value: mul3(WALL_G, GUIDE_T.absorbing), tol: CONST + MARGIN, strategy: 3, label: 'albedo, absorbing within maxNullCrossings' },
        // Estimators: no estimator-specific draw precedes the capture, so pt and pt-nee give the
        // same guides bit for bit; so does maxBounces 0 (the capture precedes the budget break).
        { kind: 'identical', strategies: [0, 1], picture: 'albedo', label: 'albedo: pt ≡ pt-nee' },
        { kind: 'identical', strategies: [0, 1], picture: 'normal', label: 'normal: pt ≡ pt-nee' },
        { kind: 'identical', strategies: [0, 4], picture: 'albedo', label: 'albedo: maxBounces 1 ≡ 0' },
        { kind: 'identical', strategies: [0, 4], picture: 'normal', label: 'normal: maxBounces 1 ≡ 0' },
        // The AOVs change nothing else: the same strategy without them renders the same radiance and
        // variance bit for bit.
        { kind: 'identical', strategies: [1, 2], picture: 'radiance', label: 'radiance: with AOVs ≡ without' },
        { kind: 'identical', strategies: [1, 2], picture: 'variance', label: 'variance: with AOVs ≡ without' },
    ];
}

export const GUIDES_WITNESS: WitnessSpec = { size: SIZE, spp: GUIDES_SPP, checks: guidesChecks() };

// ---------------------------------------------------------------------------
// guides-grin-* — one GRIN material per scene
// ---------------------------------------------------------------------------

const GRIN_REGION = region(0, 0.3);   // the middle of a 0.5-wide box: away from its silhouette

function grinScene(id: string, name: string, material: MaterialDescription, zLo: number, zHi: number): SceneDescription {
    return {
        id, name,
        ambientSpace: { type: 'euclidean' },
        objects: [WALL, columnBox(0, 0.5, 'grin', zLo, zHi, 'grin')],
        materials: { wall: { model: 'lambert', albedo: WALL_G }, grin: material },
        lights: [],
        environment: ENVIRONMENT,
    };
}

/** pt only, guides without the variance: these scenes test where the capture lands, not
 *  estimators (the estimator checks are guides'). */
export const guidesGrinStrategies: RenderStrategy[] = [{
    ...strategy('pt', 'none'),
    estimator: { ...strategy('pt', 'none').estimator, volumeSampling: 'analytic', accumulation: { type: 'average' } },
}];

export const guidesGrinTraversal = grinScene('guides-grin-traversal', 'Guides: a GRIN traversal is an event (guide 0)',
    { model: 'none', medium: { ior: 1.0 } }, 0, 1);   // n = 1 bends nothing, but a traversal is still one event
export const guidesGrinSubstep = grinScene('guides-grin-substep', 'Guides: a GRIN slab thinner than one walker step, absorbing',
    { model: 'none', medium: { ior: 1.0, sigma_a: THIN_SIGMA_T } }, 0.5 - THIN_D / 2, 0.5 + THIN_D / 2);
export const guidesGrinSubstepScatter = grinScene('guides-grin-substep-scatter', 'Guides: a GRIN slab thinner than one walker step, scattering',
    { model: 'none', medium: { ior: 1.0, sigma_a: [10, 10, 10], sigma_s: [10, 30, 50] } }, 0.5 - THIN_D / 2, 0.5 + THIN_D / 2);
// A strong point of index at the box's centre: rays through it pass n > GRIN_CAPTURE (50).
export const guidesGrinCapture = grinScene('guides-grin-capture', 'Guides: GRIN capture (no-return, guide 0)',
    { model: 'none', medium: { ior: glsl('1.0 + 200.0 * exp(-dot(p - vec3(0.0, 0.0, 0.5), p - vec3(0.0, 0.0, 0.5)) / 0.02)') } }, 0, 1);

/** A plain medium slab in a program that also carries a GRIN medium (off to the side, outside the
 *  measured region): its crossing must be exactly the one a GRIN-free program makes. */
export const guidesGrinElsewhere: SceneDescription = {
    id: 'guides-grin-elsewhere',
    name: 'Guides: a plain thin slab, with a GRIN box elsewhere in the scene',
    ambientSpace: { type: 'euclidean' },
    objects: [
        WALL,
        columnBox(0, 0.5, 'slab', 0.5 - THIN_D / 2, 0.5 + THIN_D / 2, 'slab'),
        // Above the wall's top (y ≤ 1), so it covers only sky pixels; n = 1 at its 'none' wall.
        { type: 'box', name: 'lens', parameters: { center: [1.6, 1.25, 0.5], halfSize: [0.1, 0.1, 0.1] }, material: 'lens' },
    ],
    materials: {
        wall: { model: 'lambert', albedo: WALL_G },
        slab: { model: 'none', medium: { sigma_a: THIN_SIGMA_T } },
        lens: { model: 'none', medium: { ior: 1.0 } },
    },
    lights: [],
    environment: ENVIRONMENT,
};

const substepScatter = lotteryTol(GUIDE_T.substep, GRIN_REGION, SPP);
const grinWitness = (checks: WitnessCheck[]): WitnessSpec => ({ size: SIZE, spp: SPP, checks });

export const GUIDES_GRIN_WITNESS = {
    traversal: grinWitness(pair(GRIN_REGION, 'GRIN traversal', ZERO, 1e-7, ZERO, normalTol(1e-7))),
    substep: grinWitness(pair(GRIN_REGION, 'GRIN sub-step, absorbing', mul3(WALL_G, GUIDE_T.substep), CONST + MARGIN, zT(GUIDE_T.substep), normalTol(CONST + MARGIN))),
    substepScatter: grinWitness(pair(GRIN_REGION, 'GRIN sub-step, scattering', mul3(WALL_G, GUIDE_T.substep), substepScatter.albedo, zT(GUIDE_T.substep), normalTol(substepScatter.normalZ))),
    capture: grinWitness(pair(GRIN_REGION, 'GRIN capture', ZERO, 1e-7, ZERO, normalTol(1e-7))),
    elsewhere: grinWitness(pair(GRIN_REGION, 'plain slab, GRIN elsewhere', mul3(WALL_G, GUIDE_T.substep), CONST + MARGIN, zT(GUIDE_T.substep), normalTol(CONST + MARGIN))),
};
