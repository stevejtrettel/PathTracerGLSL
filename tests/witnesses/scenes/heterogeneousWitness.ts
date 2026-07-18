// witnesses/scenes/heterogeneousWitness.ts
// The heterogeneous-media witness fixtures (fable-heterogeneous-media.md §5;
// impl-plan-heterogeneous-media.md V2). Four gates, three occupant functions:
//
//   het-const  — F-HET-CONST: the integrand-held-fixed estimator swap. σ_s authored as
//                the CONSTANT EXPRESSION glsl('0.5') (+ majorant) → delta-tracking arm;
//                the twin authors the same 0.5 as a plain number → analytic channel-MIS
//                arm. Same integrand, different estimators — the sharpest correctness
//                check of the whole build. NEE shadow rays through the fog exercise the
//                ratio-tracking seam-2 arm on one side, the closed form on the other.
//   het-slab   — F-HET-SLAB: a truly varying field with exact numbers. Chromatic linear
//                σ_a(z) whose optical depth integrates in closed form to EXACTLY the
//                F-SLAB triple (0.36788, 0.13534, 0.01832) — the ratio-tracked
//                pass-through arm against pencil-and-paper truth.
//   clamp      — F-CLAMP: D1 as an equality. glsl('2.0') under majorant 1.0 must render
//                IDENTICALLY to authored constant 1.0 — the ceiling-clamped field IS
//                the medium, proven, not asserted (plus the e^{-1} absolute number).
//   het-driven — HET-DRIVEN: a slider INSIDE the formula at two parameter points ≡
//                baked constant twins (the driven/driven-theta2 pattern) — the
//                GlslExpression.params machinery end to end (minting, upload, reset).

import type { SceneDescription, RenderStrategy, MediumDescription } from '../../../src/compiler/types.js';

// ---------------------------------------------------------------------------
// Shared room for the fog witnesses: floor + emissive backdrop panel (so the
// pt arm has a chance-hit target — the point light is invisible to it) + a fog
// box on null interfaces + a point light above (drives NEE through the fog).
// ---------------------------------------------------------------------------

const fogRoom = (id: string, name: string, fogMedium: MediumDescription): SceneDescription => ({
    id,
    name,
    ambientSpace: { type: 'euclidean' },
    objects: [
        { type: 'plane', parameters: { normal: [0, 1, 0], offset: 0.0 }, material: 'gray', name: 'floor' },
        { type: 'plane', parameters: { normal: [0, 0, 1], offset: 3.0 }, material: 'gray', name: 'backwall' },
        {
            type: 'box', parameters: { center: [-0.9, 1.3, -2.9], halfSize: [0.5, 0.5, 0.05] },
            material: 'panel', name: 'panel',
        },
        { type: 'box', parameters: { center: [0, 1, 0], halfSize: [1, 1, 1] }, material: 'fog', name: 'fogbox' },
    ],
    materials: {
        gray: { model: 'lambert', albedo: [0.5, 0.5, 0.5] },
        panel: { model: 'lambert', albedo: [0, 0, 0], emission: [4.0, 4.0, 4.0] },
        fog: { model: 'none', medium: fogMedium },
    },
    lights: [{ kind: 'point', position: [0, 3.5, 0.5], emission: 12 }],
});

// F-HET-CONST — the constant expression (delta arm) …
export const hetConstScene = fogRoom('het-const', 'F-HET-CONST (estimator-swap twin, delta arm)', {
    sigma_a: [0.02, 0.02, 0.02],
    // The whole point: an EXPRESSION that happens to be constant. Routing is by
    // authored type, so this runs Kutz spectral tracking against the same integrand
    // the ref solves in closed form. Majorant 0.6 > σ_t = 0.52: NO clamping (the
    // clamp has its own witness) — the integrands must be bit-identical.
    sigma_s: { kind: 'glsl', source: '0.5' },
    majorant: 0.6,
    phase_g: 0.3,
});

// … and its plain-number twin (analytic channel-MIS arm).
export const hetConstRef = fogRoom('het-const-ref', 'F-HET-CONST reference (analytic arm)', {
    sigma_a: [0.02, 0.02, 0.02],
    sigma_s: 0.5,
    phase_g: 0.3,
});

export const hetNeeStrategy: RenderStrategy = {
    id: 'pt-nee-het',
    measurement: { camera: { type: 'pinhole', fov: 0.9 }, maxBounces: 24 },
    estimator: {
        directLighting: 'nee',
        volumeSampling: 'delta-tracking',
        russianRoulette: { startDepth: 4 },
        accumulation: { type: 'average' },
    },
    view: { tonemap: { type: 'reinhard' } },
};

export const hetPtStrategy: RenderStrategy = {
    ...hetNeeStrategy,
    id: 'pt-het',
    estimator: { ...hetNeeStrategy.estimator, directLighting: 'none' },
};

// The ref runs the analytic arms — 'delta-tracking' there would be Validator-rejected
// as inert-in-reverse (rule 4b is the other direction; 4a would warn). Same walk,
// same RNG discipline, different medium estimator: exactly the §11.2 swap.
export const hetRefNeeStrategy: RenderStrategy = {
    ...hetNeeStrategy,
    id: 'pt-nee-ref',
    estimator: { ...hetNeeStrategy.estimator, volumeSampling: 'analytic' },
};

export const hetRefPtStrategy: RenderStrategy = {
    ...hetPtStrategy,
    id: 'pt-ref',
    estimator: { ...hetPtStrategy.estimator, volumeSampling: 'analytic' },
};

// ---------------------------------------------------------------------------
// F-HET-SLAB — chromatic LINEAR σ_a(z) through the F-SLAB geometry.
// The slab spans z ∈ [-1, 0]; the camera looks down -z through it at an emissive
// backdrop (L = 1), so the center pixel is exactly the transmittance.
// Derivation (fixture-owned, per §5): σ_a(z) = (0.5, 1, 2) · (1 + 2(z+1)).
//   ∫_{-1}^{0} (1 + 2(z+1)) dz = [z + (z+1)²] from -1 to 0 = (0+1) − (−1+0) = 2.
//   Optical depth per channel = (0.5, 1, 2) · 2 = (1, 2, 4)
//   ⇒ T = (e⁻¹, e⁻², e⁻⁴) = (0.36788, 0.13534, 0.01832) — the F-SLAB triple, now
//   reached through the ratio-tracked pass-through arm over a truly varying field.
// Majorant: max σ_t = 2 · (1 + 2·1) = 6 at z = 0 → exactly 6.0 (tight, no clamp).
// ---------------------------------------------------------------------------

export const hetSlabScene: SceneDescription = {
    id: 'het-slab',
    name: 'F-HET-SLAB (linear σ(z), ratio-tracked)',
    ambientSpace: { type: 'euclidean' },
    objects: [
        { type: 'plane', parameters: { normal: [0, 0, 1], offset: 2.0 }, material: 'screen', name: 'screen' },
        { type: 'box', parameters: { center: [0, 0, -0.5], halfSize: [4, 4, 0.5] }, material: 'ink', name: 'slab' },
    ],
    materials: {
        screen: { model: 'lambert', albedo: [0, 0, 0], emission: [1.0, 1.0, 1.0] },
        ink: {
            model: 'none',
            medium: {
                sigma_a: { kind: 'glsl', source: 'vec3(0.5, 1.0, 2.0) * (1.0 + 2.0 * (p.z + 1.0))' },
                majorant: 6.0,
            },
        },
    },
    lights: [],
};

export const hetSlabStrategy: RenderStrategy = {
    id: 'pathtracer',
    measurement: { camera: { type: 'pinhole', fov: 0.6 }, maxBounces: 4 },
    estimator: {
        directLighting: 'none',
        volumeSampling: 'delta-tracking',
        russianRoulette: null, // witness protocol: RR off
        accumulation: { type: 'average' },
    },
    view: { tonemap: { type: 'reinhard' } },
};

// ---------------------------------------------------------------------------
// F-CLAMP — D1 verified as a twin equality. The formula says 2.0 everywhere; the
// ceiling says 1.0; D1 says the MEDIUM is 1.0 (proportional scale, definitional).
// Twin: the authored-constant-1.0 slab (analytic Beer–Lambert arm). Center pixel
// on BOTH: e^{-1·1} = 0.36788 per channel.
// ---------------------------------------------------------------------------

const clampSlab = (id: string, name: string, ink: MediumDescription): SceneDescription => ({
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

export const clampScene = clampSlab('clamp', 'F-CLAMP (ceiling-as-definition twin)', {
    sigma_a: { kind: 'glsl', source: '2.0' },   // pokes above the ceiling EVERYWHERE
    majorant: 1.0,                              // ⇒ effective field ≡ 1.0 (D1)
});

export const clampRef = clampSlab('clamp-ref', 'F-CLAMP reference (authored 1.0)', {
    sigma_a: 1.0,
});

export const clampStrategy = hetSlabStrategy;   // same protocol (RR off, no NEE)

export const clampRefStrategy: RenderStrategy = {
    ...hetSlabStrategy,
    id: 'pathtracer-ref',
    estimator: { ...hetSlabStrategy.estimator, volumeSampling: 'analytic' },
};

// ---------------------------------------------------------------------------
// HET-DRIVEN — the slider in the formula (GlslExpression.params, heterogeneous D4)
// at two parameter points ≡ baked constant twins. het.gain scales σ_s live:
// default 1.0 → σ_s = 0.4; the θ′ point sets 2.0 → σ_s = 0.8. Majorant 1.0 bounds
// σ_t at BOTH points (0.42 / 0.82) — no clamping, so each point's integrand equals
// its baked twin's exactly. (Slider positions ABOVE 2.45 would saturate against the
// ceiling instead of misrendering — that safety is D1's, not this witness's.)
// ---------------------------------------------------------------------------

export const hetDrivenScene = fogRoom('het-driven', 'HET-DRIVEN (slider in the formula)', {
    sigma_a: [0.02, 0.02, 0.02],
    sigma_s: {
        kind: 'glsl',
        source: 'u_het_gain * 0.4',
        params: [{ param: 'het.gain', default: 1.0, min: 0.0, max: 3.0 }],
    },
    majorant: 1.0,
    phase_g: 0.3,
});

export const hetDrivenBaked = fogRoom('het-driven-baked', 'HET-DRIVEN baked twin (gain 1)', {
    sigma_a: [0.02, 0.02, 0.02],
    sigma_s: 0.4,
    phase_g: 0.3,
});

export const hetDrivenBaked2 = fogRoom('het-driven-baked2', 'HET-DRIVEN baked twin (gain 2)', {
    sigma_a: [0.02, 0.02, 0.02],
    sigma_s: 0.8,
    phase_g: 0.3,
});

export const HET_THETA2 = { 'het.gain': 2.0 };
