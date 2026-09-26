// witnesses/scenes/emissionWitness.ts
// The medium-emission witness fixtures (impl-plan-medium-emission E2).
// `emission` on a medium is ε, the VOLUME EMISSION COEFFICIENT (P1 — B2's dimensional
// ladder): radiance added per unit path length, dL/ds = ε. Saturation = ε/σ_t.
//
//   emit         — F-EMIT: constant glowing absorbing slab (ANALYTIC closed-form arm).
//                  Exact center-pixel numbers, incl. an equilibrium channel (ε = σ_a =
//                  L_back = 1 ⇒ the green channel is identically 1 — glow exactly
//                  replaces what absorption removes).
//   emit-sat     — F-EMIT-SAT: camera deep inside a uniform glowing SCATTERING medium:
//                  every pixel = ε/σ_a exactly (uniform equilibrium: 0 = −σ_t L +
//                  σ_s L + ε ⇒ L = ε/σ_a). Gates the DELTA arm's per-collision
//                  collection with an absolute number, AND the auto-derived majorant
//                  (constant-ε scattering medium, no authored σ̄ — P5).
//   emit-swap    — EMIT-SWAP: the F-EMIT slab authored as EXPRESSIONS (+majorant) —
//                  ratio pass-through arm, P3 per-collision collection — must equal
//                  the analytic twin AND the same exact numbers. The estimator-swap
//                  gate for emission (the F-HET-CONST discipline).
//   emit-scatter — glowing scattering fog under a ceiling quad: pt-nee ≡ pt (emission
//                  + scattering + NEE compose; NEE never double-counts glow — volumes
//                  are never light-sampled, P4).
//   emit-sat-budget — the emit-sat fog at maxBounces 0, 1, 2: the bounce budget inside a
//                  medium, against exact truncated values.

import type { SceneDescription, RenderStrategy, MediumDescription } from '../../../src/compiler/types.js';

// ---------------------------------------------------------------------------
// F-EMIT — glowing ink slab, the F-SLAB geometry (slab z ∈ [-1, 0], thickness 1,
// emissive backdrop L = 1, camera perpendicular).
// Derivation: L = ε/σ_a·(1 − e^{−σ_a·1}) + e^{−σ_a·1}·L_back, σ_a = 1 gray,
// ε = (0.5, 1, 2), e⁻¹ = 0.3678794, 1−e⁻¹ = 0.6321206:
//   r: 0.5·0.6321206 + 0.3678794 = 0.6839397
//   g: 1.0·0.6321206 + 0.3678794 = 1.0000000   ← equilibrium channel (ε = σ_a·L_back)
//   b: 2.0·0.6321206 + 0.3678794 = 1.6321206
// ---------------------------------------------------------------------------

const emitSlab = (id: string, name: string, ink: MediumDescription): SceneDescription => ({
    id,
    name,
    ambientSpace: { type: 'euclidean' },
    objects: [
        { type: 'plane', parameters: { normal: [0, 0, 1], offset: 2.0 }, material: 'screen', name: 'screen' },
        { type: 'box', parameters: { center: [0, 0, -0.5], halfSize: [4, 4, 0.5] }, material: 'ink', name: 'slab' },
    ],
    materials: {
        screen: { model: 'lambert', albedo: [0, 0, 0], emission: [1.0, 1.0, 1.0] },
        ink: { model: 'none', medium: ink },
    },
    lights: [],
});

export const emitScene = emitSlab('emit', 'F-EMIT (glowing slab, closed form)', {
    sigma_a: 1.0,
    emission: [0.5, 1.0, 2.0],
});

// The estimator-swap twin: SAME medium as expressions → ratio pass-through arm with
// P3 per-collision collection. Majorant 1.0 = σ_t exactly (tight, no clamp).
export const emitSwapScene = emitSlab('emit-swap', 'EMIT-SWAP (glowing slab, tracking arm)', {
    sigma_a: { kind: 'glsl', source: '1.0' },
    emission: { kind: 'glsl', source: 'vec3(0.5, 1.0, 2.0)' },
    majorant: 1.0,
});

export const emitStrategy: RenderStrategy = {
    id: 'pathtracer',
    measurement: { camera: { type: 'pinhole', fov: 0.6 }, maxBounces: 4 },
    estimator: {
        directLighting: 'none',
        volumeSampling: 'analytic',
        russianRoulette: null, // witness protocol: RR off
        accumulation: { type: 'average' },
    },
    view: { tonemap: { type: 'reinhard' } },
};

export const emitSwapStrategy: RenderStrategy = {
    ...emitStrategy,
    id: 'pathtracer-swap',
    estimator: { ...emitStrategy.estimator, volumeSampling: 'delta-tracking' },
};

// ---------------------------------------------------------------------------
// F-EMIT-SAT — deep inside the glowing fog. Uniform infinite glowing scattering
// medium: the equilibrium radiance solves 0 = −σ_t·L + σ_s·L + ε (scattering
// redistributes an isotropic field into itself), so EVERY pixel = ε/σ_a exactly:
// ε = (1, 2, 4), σ_a = 2 ⇒ L = (0.5, 1, 2). σ_s = 1 keeps real scattering chains
// in play (albedo 1/3 — the Neumann series converges fast; maxBounces 32 truncates
// below fp32 noise). No authored majorant: derived = σ_t = 3 (P5, gated here as a
// NUMBER, not just a compile). The distant sphere sits behind optical depth ~90.
// ---------------------------------------------------------------------------

export const emitSatScene: SceneDescription = {
    id: 'emit-sat',
    name: 'F-EMIT-SAT (saturation = ε/σ_a)',
    ambientSpace: { type: 'euclidean' },
    objects: [
        { type: 'sphere', parameters: { center: [0, 1, 0], radius: 0.5 }, material: 'gray', name: 'anchor' },
    ],
    materials: {
        gray: { model: 'lambert', albedo: [0.5, 0.5, 0.5] },
        glow: {
            model: 'none',
            medium: {
                sigma_a: [2.0, 2.0, 2.0],
                sigma_s: [1.0, 1.0, 1.0],
                emission: [1.0, 2.0, 4.0],
                phase_g: 0.0,
            },
        },
    },
    lights: [],
    ambientMedium: 'glow',
};

// ---------------------------------------------------------------------------
// emit-sat-budget — the bounce budget inside a medium, exactly. `maxBounces: N` renders
// Σ_{n≤N} TⁿE: at most N scattering events, medium events included (CLAUDE.md, invariants).
// Deep inside the uniform infinite emit-sat fog, every segment collects ε/σ_t and every
// scattering event keeps the fraction α = σ_s/σ_t = 1/3, so the n-th order contributes
// (ε/σ_t)·αⁿ and
//   L_N = (ε/σ_t)·Σ_{n=0}^{N} αⁿ:   N = 0 → ε/3,   N = 1 → 4ε/9,   N = 2 → 13ε/27,
// with ε = (1, 2, 4) and σ_t = 3; N → ∞ gives emit-sat's ε/σ_a. Neighbouring N differ by 33%
// and 8%, so a budget off by one in the medium branch fails. At N = 0 every path scores exactly
// ε/σ_t at its first collision (certain, in an infinite medium): no noise.
// ---------------------------------------------------------------------------

export const EMIT_SAT_BUDGETS = [0, 1, 2] as const;

/** L_N per channel for the emit-sat fog. */
export function emitSatBudgetValue(n: number): [number, number, number] {
    const eps = emitSatScene.materials.glow.medium!.emission as [number, number, number];
    const sa = (emitSatScene.materials.glow.medium!.sigma_a as number[])[0];
    const ss = (emitSatScene.materials.glow.medium!.sigma_s as number[])[0];
    const st = sa + ss, alpha = ss / st;
    let series = 0;
    for (let k = 0; k <= n; k++) series += alpha ** k;
    return eps.map((e) => (e / st) * series) as [number, number, number];
}

export const emitSatBudgetScene: SceneDescription = {
    ...emitSatScene,
    id: 'emit-sat-budget',
    name: 'The bounce budget inside a medium (emit-sat at maxBounces 0, 1, 2)',
};

export const emitSatStrategy: RenderStrategy = {
    id: 'pathtracer',
    measurement: { camera: { type: 'pinhole', fov: 0.8 }, maxBounces: 32 },
    estimator: {
        directLighting: 'none',
        volumeSampling: 'delta-tracking',
        russianRoulette: null, // witness protocol: RR off
        accumulation: { type: 'average' },
    },
    view: { tonemap: { type: 'reinhard' } },
};

// ---------------------------------------------------------------------------
// emit-scatter — glowing scattering fog box under a ceiling quad in a gray room:
// the composition witness. Constant-ε scattering fog (auto-derived majorant again,
// σ̄ = 0.7) with real NEE through it. pt-nee and pt must converge to the same
// image: glow is PATH-FOUND on both arms (volumes are never light-sampled, P4),
// so the only estimator difference is the quad's direct term.
// ---------------------------------------------------------------------------

export const emitScatterScene: SceneDescription = {
    id: 'emit-scatter',
    name: 'Glowing Fog + Quad (emission × NEE)',
    ambientSpace: { type: 'euclidean' },
    objects: [
        { type: 'plane', parameters: { normal: [0, 1, 0], offset: 0.0 }, material: 'gray', name: 'floor' },
        { type: 'plane', parameters: { normal: [0, -1, 0], offset: 2.5 }, material: 'gray', name: 'ceiling' },
        { type: 'plane', parameters: { normal: [0, 0, 1], offset: 3.0 }, material: 'gray', name: 'backwall' },
        { type: 'box', parameters: { center: [0, 1, -0.5], halfSize: [1, 1, 1] }, material: 'glowfog', name: 'fogbox' },
    ],
    materials: {
        gray: { model: 'lambert', albedo: [0.5, 0.5, 0.5] },
        glowfog: {
            model: 'none',
            medium: {
                sigma_a: [0.1, 0.1, 0.1],
                sigma_s: [0.6, 0.6, 0.6],
                emission: [0.8, 0.4, 0.2],
                phase_g: 0.3,
            },
        },
    },
    lights: [
        {
            kind: 'quad',
            corner: [-0.5, 2.48, -1.0],
            edge1: [1.0, 0.0, 0.0],
            edge2: [0.0, 0.0, 1.0],
            emission: 12.0,
        },
    ],
};

// ---------------------------------------------------------------------------
// emit-driven — F-EMIT-SAT with a DRIVEN σ_a, run at a point ABOVE its authored
// default (impl-plan-env-power-selection batch 2, the DERIVED-majorant gate).
// σ_a = {param 'glow.absorb', default 0.5} slid to 2.0 → live σ_t = 3 EXCEEDS the
// default-point extinction (1.5). A stale plan-time σ̄ would make the null
// coefficient σ̄ − σ_t negative (invalid probabilities → a wrecked image); the
// derived u_majorant closure keeps σ̄ = 3 exact, so the equilibrium number
// ε/σ_a = (0.5, 1.0, 2.0) must reproduce — the SAME absolute gate as emit-sat.
// ---------------------------------------------------------------------------

export const emitDrivenScene: SceneDescription = {
    ...emitSatScene,
    id: 'emit-driven',
    name: 'EMIT-DRIVEN (derived majorant σ̄ follows the slider)',
    materials: {
        gray: { model: 'lambert', albedo: [0.5, 0.5, 0.5] },
        glow: {
            model: 'none',
            medium: {
                sigma_a: { param: 'glow.absorb', default: 0.5, min: 0.1, max: 4.0 },
                sigma_s: [1.0, 1.0, 1.0],
                emission: [1.0, 2.0, 4.0],
                phase_g: 0.0,
            },
        },
    },
};

export const emitScatterNeeStrategy: RenderStrategy = {
    id: 'pt-nee-emit',
    measurement: { camera: { type: 'pinhole', fov: 0.9 }, maxBounces: 24 },
    estimator: {
        directLighting: 'nee',
        volumeSampling: 'delta-tracking',
        russianRoulette: { startDepth: 4 },
        accumulation: { type: 'average' },
    },
    view: { tonemap: { type: 'reinhard' } },
};

export const emitScatterPtStrategy: RenderStrategy = {
    ...emitScatterNeeStrategy,
    id: 'pt-emit',
    estimator: { ...emitScatterNeeStrategy.estimator, directLighting: 'none' },
};

/** emit-sat's estimator at a small bounce budget. */
export function emitSatBudgetStrategy(n: number): RenderStrategy {
    return { ...emitSatStrategy, id: `budget-${n}`, measurement: { ...emitSatStrategy.measurement, maxBounces: n } };
}
