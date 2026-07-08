# Validation Scenes (Concrete)

**Status:** Executable companion to [fable-compiler-contracts.md](fable-compiler-contracts.md) §11. Each test is a concrete scene + strategy + an **expected number or invariant** with its derivation, so implementing a harness is transcription, not design. Scene literals use the *contract-target* format (post-migration `SceneDescription`), not the current vertical-slice types.
**Date:** July 2026
**Prerequisite:** the HDR-export off-by-one ([fable-review.md](fable-review.md) C2) — **fixed** (PipelineBuilder now exports `accumulation_previous`, the post-swap freshly-written buffer). Numeric assertions below are safe to trust against `readExport('hdr')`.
**Protocol note:** all expected values are **linear HDR** (`readExport('hdr')`), pre-tonemap. Strategies for tests: Russian roulette **off** (unbiased but adds variance and complicates tolerances), pixel jitter on, `display` irrelevant.

---

## 1. F-BOX — the analytic furnace (energy conservation)

**The single most valuable test in this document.** A closed box whose every face has albedo ρ and uniform emission Le converges to the same radiance at every pixel:

```
L = Le · (1 + ρ + ρ² + …) = Le / (1 − ρ)
```

**Scene:** box interior via 6 planes at ±1 (normals inward: the existing Cornell-box plane pattern). One material on all faces:

```typescript
materials: { furnace: { model: 'lambert', albedo: 0.5, emission: 0.2, sampleAsLight: false } }
// path-only emitter → §6.2 gives w = 1 always → NEE machinery not required for this test
lights: []            // none; emission is the only source. No environment (closed).
camera: anywhere inside, any direction, e.g. position [0,0,0], target [0,0,-1], fov 1.0
strategy: { maxBounces: 16, directLighting: 'none', russianRoulette: off }
```

**Expected:** every pixel = `0.2 / (1 − 0.5)` = **0.4** in all channels.
**Truncation error** (why 16 bounces suffices): `Le · ρ^(B+1) / (1 − ρ)` = `0.2 · 0.5¹⁷ / 0.5` ≈ **3×10⁻⁶** — negligible.
**Pass:** per-channel mean over all pixels within `0.4 ± 0.002` at 1024 spp, 256².
**Catches:** any energy gain/loss in Lambert eval/sample/weight, cosine double-counting (§2.2 violations render ≈0.36 or ≈0.44, far outside tolerance), emission bookkeeping errors, accumulation-weighting errors.

### 1b. F-BOX-M — the chromatic scattering furnace (run after volumes land)

Same box, plus a **non-absorbing, chromatic, anisotropic** ambient medium:

```typescript
scene.ambientMedium = 'haze'
materials: { ..., haze: { surface: 'none', medium: { sigma_s: [0.5, 1.0, 2.0], sigma_a: 0, phase_g: 0.7 } } }
strategy: { ..., volumeIntegrator: 'raymarch', maxBounces: 48 }   // scattering lengthens paths
```

**Expected: still exactly (0.4, 0.4, 0.4).** A non-absorbing medium conserves energy, and the uniform equilibrium field is preserved by scattering — per channel, at *any* σ_s and *any* g. This one scene simultaneously catches: the chromatic-extinction ratio bug (fixed in the reference audit — omitting the ratio makes the channels split), HG normalization errors, medium-event weight errors, and bounce-budget starvation (if the mean sits below 0.4, raise `maxBounces` — truncation scales with total interaction count).
**Pass:** per-channel mean `0.4 ± 0.004` at 4096 spp (higher variance than 1a).
**Note:** the HG *sign/eval* bug is NOT caught here (equilibrium is direction-independent) — that's what X-FOG (§4) and the pdf-histogram (§6) are for. A test that passes everything catches nothing; this suite is deliberately a set.

## 2. F-SLAB — exact Beer–Lambert through null interfaces

**Scene:** emissive backwall, absorbing-only fog slab, camera looking through it:

```typescript
objects: [
  { plane z = -2, normal +z, material 'screen' },                        // emissive backdrop
  { box from z=-1 to z=0 spanning view, material 'ink' },                // the slab
]
materials: {
  screen: { model: 'lambert', albedo: 0, emission: 1.0, sampleAsLight: false },
  ink:    { surface: 'none', medium: { sigma_a: [1.0, 2.0, 4.0], sigma_s: 0 } },   // null interface!
}
camera: position [0,0,2], target [0,0,-2]   // center pixel crosses the slab perpendicular, path length 1
strategy: { maxBounces: 4, directLighting: 'none' }
```

**Expected center pixel:** `1.0 · e^(−σ_a·1)` = **(0.36788, 0.13534, 0.01832)**.
**Pass:** center-pixel mean within ±1% relative, per channel, 1024 spp.
**Catches:** null-interface handling (any spurious Fresnel on the slab boundary shifts the value), double-attenuation (applying transmittance both as survival probability *and* as a weight — renders the *square*: (0.135, 0.018, 0.0003), unmissable), spectral `sigma_a` plumbing, and `current_medium` updates across two null crossings.

## 3. F-ETA — the η² witness (the most-omitted factor in hobby tracers)

**Scene:** an emissive plane submerged under a flat water surface, camera in air looking straight down:

```typescript
objects: [
  { plane y = 0, normal +y, material 'water' },     // half-space of water below y=0
  { plane y = -1, normal +y, material 'glow' },     // emitter INSIDE the water
]
materials: {
  water: { model: 'dielectric', ior: 1.33 },
  glow:  { model: 'lambert', albedo: 0, emission: 1.0, sampleAsLight: false },
}
camera: position [0,1,0] looking straight down (−y); evaluate the center pixel (normal incidence)
strategy: { maxBounces: 4, directLighting: 'none', russianRoulette: off }
```

**Derivation:** at normal incidence, `R₀ = ((1.33−1)/(1.33+1))²` = 0.020053. The camera path crosses air→water once (emitter path terminates inside the water): throughput = `(1−R₀) · (n_air/n_water)²` = `0.97995 · (1/1.7689)` = **0.5540**.
**Expected center pixel: 0.5540 ± 1%** (small contribution from the TIR/reflection branch bounces is cut by low albedo and maxBounces).
**The point:** an implementation that omits the η² radiance-compression factor renders **0.980** — 77% too bright — and looks completely plausible. Through-glass scenes can't catch this (the factor cancels on enter+exit); only a path that *terminates inside* the medium exposes it. This scene is the regression test for the most-annotated line in the dielectric reference (§2 of [fable-reference-implementations.md](fable-reference-implementations.md)).

## 4. X — cross-strategy convergence trio (§11.2)

**Protocol (shared):** render each scene under each strategy to 4096 spp at 256², export HDR, compare per-channel means and relative RMSE excluding the top 0.1% brightest pixels (firefly guard). **Pass:** relative RMSE < 1.5% between every strategy pair. Different strategies use independent RNG streams — agreement must come from convergence, not shared randomness.

- **X-CORNELL:** the existing Cornell box, but with the point light replaced by an **emissive quad** on the ceiling (`sampleAsLight: true` — samplable). Strategies: `pt` (directLighting none) vs `pt-nee`. Divergence implicates the §6.2 double-count bookkeeping (`w = 0` rule), the quad sampler's solid-angle pdf, or shadow offsetting.
- **X-FOG:** X-CORNELL plus `ambientMedium` = grayscale haze (σ_s 0.4, σ_a 0.05, g 0.6). Divergence implicates medium-event NEE — and specifically the **HG eval/sample consistency**: `pt` uses only `hg_sample`, `pt-nee` additionally uses `hg_eval` in the NEE estimate, so the audit-caught sign bug makes exactly these two disagree. This scene is that bug's regression test.
- **X-GLASS:** X-CORNELL plus a centered glass sphere (ior 1.5, r 0.5). Divergence implicates delta bookkeeping (`prev_was_delta` propagation, NEE correctly skipped at delta vertices, emission weight after specular chains). Expect slower convergence; this is the noisiest pair — if RMSE hovers just above threshold, double spp before suspecting bias.

When MIS lands, each becomes a three-way comparison (`pt-mis` joins), same thresholds.

## 5. R — regressions from the verification traces

- **R-SUBMERGED** (trace T2, the innermost-wins fix): pool box (half-extent 5, `water`: dielectric ior 1.33) with a glass sphere (r 0.4, ior 1.5) at its center; camera inside the water looking at the sphere. **Invariant:** render with and without the sphere; the sphere's pixel footprint must differ (mean absolute difference over the footprint > 5% of Le scale). Under the deepest-wins bug the sphere gets η = 1 → Fresnel ≡ 0 → **perfectly invisible** — the diff collapses to ~0. Cheap, binary, and directly tied to the flipped inequality in the generated classifier.
- **R-CUP** (trace T1): the multi-region water-line cup (glass shell / water / air-gap regions via shared bases), point light above. **Invariant (v1, no reference image needed):** the §11.4 medium-tracking repair counter over a converged frame must be ~0 (< 0.1% of segments), and the image must be stable frame-to-frame (no medium-flicker). Promote to a golden-image test once a trusted render exists.
- **R-FOGCUBE** (trace T5): a fog cube (`surface: 'none'`) floating in clear air over a checkered emissive floor. **Invariant:** the cube's *silhouette edge* must show no Fresnel-like rim brightening (compare edge pixels against an analytically-equivalent scene where the fog fills a region bounded by nothing — any boundary highlight means the null interface leaked a BSDF).

## 6. H — pdf–histogram spec (§11.3, per material model)

Generated debug strategy per model: fix `wo` at three inclinations (cosθ ∈ {0.9, 0.5, 0.1}) and representative properties (GGX: roughness ∈ {0.1, 0.4, 0.8}); draw ≥2²⁰ samples via `<model>_sample`; bin `wi` into a 32×16 (φ×cosθ) hemispherical grid (write to an accumulation buffer, one invocation per sample batch); compare bin frequencies against `<model>_pdf` integrated over each bin (midpoint × solid angle is adequate at this resolution). **Pass:** χ² p-value > 0.001, and — separately — `sum(weight·pdf−f·|cos|)` style consistency: for non-delta models, `sample.weight · sample.pdf ≈ eval(wi,wo)·|cosθᵢ|` per sample within 1e-4 relative (the three-way triple check, nearly free to assert inside the same debug shader). First customers: HG (would have caught the sign bug), then GGX.

## 7. Running these

All tests reduce to: `compile(scene, strategy)` → load → render N spp → `readExport('hdr')` → assert. The infrastructure exists (multi-strategy loading, production render to target samples, HDR export); what's missing is only headless orchestration — either a vitest+playwright page that loads a test harness bundle and posts results, or, pragmatically at first, a manual `examples/validation.ts` page that runs the suite and prints a pass/fail table. Start manual (it exercises the same code), automate when the suite stabilizes. Suggested implementation order mirrors dependency order: F-BOX (needs only migrated Lambert + loop) → F-SLAB, R-FOGCUBE (null interfaces + absorbing media) → F-ETA, R-SUBMERGED (dielectric) → X-CORNELL (quad lights + NEE) → X-FOG, F-BOX-M (scattering) → X-GLASS, H (harness maturity).
