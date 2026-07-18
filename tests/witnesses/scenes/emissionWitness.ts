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
