# Plan: microfacet energy compensation (rough metals and rough glass stop darkening)

Status: **proposal, not approved.** Written 2026-11-06 for the photorealism batch (decisions.md
item 12). Labels: [checked-code file:line] = read in this repo at 0d9c945; [checked-src URL] = read
in the reference's source, downloaded to `scratchpad/photoreal/energy-compensation/src/`;
[checked-num script] = computed by a prototype in `scratchpad/photoreal/energy-compensation/proto/`
(output in the matching `.out` file); [reasoning] = argued, not measured.

## 1. The problem, with evidence

GGX with Smith masking counts one bounce between microfacets and drops the rest, so rough
materials lose energy that a real rough surface reflects or transmits.

- `ggx_eval` is the single-scattering D·F·G/(4 cosᵢ cosₒ) and nothing else
  [checked-code src/components/materials/ggx/ggx.glsl:24]; `rough_dielectric_eval` is likewise
  single-scattering on both lobes [checked-code src/components/materials/rough_dielectric/rough_dielectric.glsl:62-70].
- How much is lost, for a white conductor (F = 1), directional albedo E(μₒ, α):
  E = 0.916 at μ=1, roughness 0.5; E = 0.409 at μ=0.5, roughness 1; E = 1 − ln 2 = 0.3069 at
  μ=1, roughness 1, which matches the closed form exactly [checked-num proto/check1.ts, check6.ts].
  So a rough chrome sphere renders at a third of its true brightness in its center.
- For glass, the repo already records the loss: up to 39% at roughness 0.7 on the exit side
  [checked-code src/components/materials/rough_dielectric/rough_dielectric.md:64-97]. My twin
  reproduces three of that table's entries to 4 digits (0.9792 vs 0.9791, 0.8063 vs 0.8064,
  0.6104 vs 0.6105) [checked-num proto/check1.ts], so the twin below is the same model.
- The loss is already called a declared truncation in the bias ledger
  [checked-code rough_dielectric.md:64-68], but no measurement field names it
  [checked-code src/compiler/types.ts:574-610], and the `rough-furnace` witness only records the
  deficit with wide brackets [checked-code tests/witnesses/index.ts:2535-2557].
- The improvements list plans this as Kulla–Conty [checked-code docs/claude-improvements-2026-09.md:230-249].
  This plan picks a simpler member of the same family; §2 says why.

## 2. The model

**Reference.** Turquin 2019, "Practical multiple scattering compensation for microfacet models"
(Eqs. 8, 10, 12, 18) [checked-src https://blog.selfshadow.com/publications/turquin/ms_comp_final.pdf],
as implemented in Blender Cycles `microfacet_ggx_preserve_energy`
[checked-src https://raw.githubusercontent.com/blender/blender/main/intern/cycles/kernel/closure/bsdf_microfacet.h
lines 544-600; the gain is applied to eval at 1232 and to sample at 1248; tables built by
intern/cycles/app/cycles_precompute.cpp lines 20-50, 160-215, 255-280]. MaterialX's OpenPBR
library uses the same form [checked-src MaterialX libraries/pbrlib/genglsl/lib/mx_microfacet_specular.glsl:514-522].
OpenPBR asks for compensation and names Heitz 2016, Kulla–Conty 2017 and Turquin 2019
[checked-src OpenPBR index.html:428]. **pbrt-v4 does not compensate** (`ConductorBxDF` at
src/pbrt/bxdfs.h:280 has no energy term; "energy" occurs in bxdfs.h only in LayeredBxDF)
[checked-src pbrt-v4 bxdfs.h]. **Mitsuba 3 `roughconductor` does not either** (no hit for
energy/multiple/compens in src/bsdfs/roughconductor.cpp) [checked-src].

**The math.** Let f_ss be the existing single-scattering BSDF and μₒ = cos θₒ in the local
shading frame. Define the energy albedo (η² radiance factor undone on transmission, as
rough_dielectric.md:70-75 already does):

    A(μₒ) = ∫ f_ss(ωᵢ, ωₒ) |cos θᵢ| dωᵢ        (conductor with F = 1: written E(μₒ, α))

The compensated BSDF is f_ss times a gain that depends on ωₒ only:

- **Conductor** (Turquin Eqs. 8, 10, 12; Cycles 583-597):
  g(μₒ) = 1 + F_ms · (1 − E(μₒ)) / E(μₒ),   F_ms = F_avg·E_avg / (1 − F_avg·(1 − E_avg)),
  E_avg(α) = 2∫₀¹ E(μ, α) μ dμ,   F_avg = 2∫₀¹ F(μ) μ dμ.
  F_ms is the geometric series of further bounces, each attenuated by F_avg and escaping with
  E_avg (Kulla–Conty slide 15 [checked-src kulla.pdf p.15]). For Schlick, F_avg = f0 + (1 − f0)/21
  exactly [checked-num proto/check4.ts]. With F = 1: F_ms = 1, g = 1/E, so ∫ g f_ss cos = 1
  **exactly** (up to the table) — the white furnace.
- **Dielectric** (Turquin Eq. 18; Cycles 562-575): g(μₒ) = 1 / A(μₒ, α, η), applied to both
  lobes. The interface becomes lossless; R and T keep the single-scattering split.

**Why this one** (Turquin Table 1, and the code):
- The gain depends on ωₒ only, so **sampling and pdf do not change**. eval' = g·f,
  weight' = g·weight, pdf' = pdf; then weight'·pdf' = g·f·|cos θᵢ| = eval'·|cos θᵢ|, so the
  §11.3 triple holds whenever it held before [reasoning; tested in §4]. Kulla–Conty instead adds a
  diffuse-shaped lobe, which needs a mixture sampler and a mixture pdf, and its dielectric form
  couples two tables. More parts.
- **Not reciprocal** (g uses ωₒ only). In this renderer f is always evaluated with ωₒ = the
  direction back along the camera path, in both the kernel and the light technique
  [checked-code src/components/transport/techniques/kernel/kernel.glsl:29, light/light.glsl:25].
  So pt, pt-nee and pt-mis estimate the same integral [reasoning; tested by the witnesses in §4].
  Light tracing would need the adjoint; it is out of scope (decisions.md item 6).
- What is exact and what is not: energy for F = 1 conductors and lossless dielectrics is exact up
  to table error. The angular shape of the multiple-scattering energy (the single-scattering lobe,
  rescaled) and its color (F_ms) are approximations; Heitz 2016 is the exact limit and is not built.
- Colored conductors never gain energy: max compensated albedo over f0 ∈ {0.04, 0.5, 0.9, 1},
  roughness {0.3, 0.6, 1}, μ ∈ {0.05, 0.3, 0.7, 1} is 1.0000 (at f0 = 1)
  [checked-num proto/check5.ts]. That is a grid check, not a proof.

**The table.** One RGBA32F texture, slices of 32×32 over y = √μ (rows i/31, μ = max(1e-4, y²)) and
x = √α (α = max(1e-3, x²)), 32 slices over z = √((r−1)/(r+1)), r = max(η, 1/η) (Cycles'
`ior_to_z_index`, bsdf_microfacet.h:147-155). Channels: R = A for η < 1 (entering the denser side),
G = A for η > 1 (leaving it), B = E_avg(α), A = 0. Slice z = 0 is the index-matched limit
A = G1(μₒ) (checked: A → 0.609 / 0.613 at η = 1.001 / 0.999 vs G1 = 0.612); slice z = 1 is the
F = 1 conductor, so **the conductor E is the z = 1 slice of either channel**: one table serves both
[checked-num proto/check1.ts]. 32 × 1024 texels, 512 KiB. Nodes are computed by a 256×256
midpoint rule over VNDF samples with the lobe choice integrated out (quadrature error ≤ 2.3e-4
[checked-num proto/check1.ts]).

Measured furnace error |A_true / A_table − 1| at random off-grid points [checked-num]:

| table | case | max | mean |
|---|---|---|---|
| 32×32 | conductor (check2) | 3.7e-3 (μ=0.03) | 2.2e-4 |
| 32×32×32 | entering, n ∈ {1.1 … 2.42} (check3) | 1.3e-3 | 1.4e-4 |
| 32×32×32 | leaving, same | 6.0e-3 (n=1.1, μ=0.12) | 6.0e-4 |
| 32×32×16 | leaving | 1.5e-2 | 1.8e-3 |
| 16×16×16 (Cycles' glass size) | leaving | 2.1e-2 | 2.4e-3 |

So 32 slices in z, not 16: the leaving side near index match needs them.

## 3. The change and its boundaries

**Decision for the owner (recommended form).** A new measurement truncation
`measurement.microfacet: 'single-scattering' | 'energy-compensated'`, default
`'single-scattering'`. Limit: multiple scattering on the Smith microsurface (Heitz 2016, not
built). It sits beside `scattering: 'ignored'` [checked-code src/compiler/types.ts:596-598]: a
renderer-wide A/B of one physical effect, stamped into exports by `resolveMeasurement`
[checked-code src/compiler/plan/measurement.ts:14-35]. Existing scenes keep their images. The
alternative (a per-material switch in the scene) is in §6.

**Files** (each its own commit, in this order):

1. `tools/witness.mjs` FRAME_CASES (`:759`) + 2 cases: `veach-mis` strategy 0 (ggx, mis) and
   `rough-mis` strategy 1 (rough glass, mis). Recorded **before** any other change.
2. `src/components/materials/microfacet_energy/` — a shared part of the materials family, not an
   occupant (no registry line; folders are allowed by tests/components/structure.test.ts:50-57):
   - `build.ts` — the TS twin of D, G1, VNDF and `dielectric_fresnel` as used by
     glsl/core/microfacet.glsl:29-54 and rough_dielectric.glsl:104-128, the energy integrands, the
     grid mapping, and `lookup(table, μ, α, z, channel)` (the twin of the GLSL lookup). Pure
     functions, no imports. One answer for the generator and the tests.
   - `data/energy.bin` (512 KiB, generated) and `data.ts` (generated: version
     `ggx-smith-energy-v1`, width 32, height 1024, quadrature N, sha256).
   - `assets.ts` — `{ id, url, width, height, sha256 }`, like
     src/components/color/spectral/assets.ts:5-8; `components/assets.ts:11` adds it to
     `BUILTIN_ASSETS`. The App already uploads any `extern:` id it finds there, hash-checked
     [checked-code src/app/BuiltinAssets.ts:9-30]. No App change.
   - `microfacet_energy.glsl` — the compensated gains (static math):
     `vec4 microfacet_energy_texel(int i, int row)` (texelFetch), a bilinear slice lookup, and
     `Spectrum microfacet_conductor_gain(float mu_o, float a, Spectrum f_avg)` (the z = 1 slice,
     .r and .b; then g as in §2) and `float microfacet_dielectric_gain(float mu_o, float a, float eta)`
     (trilinear, channel by side; returns 1/A). Grid sizes come from `textureSize` (slices are
     square: N = width, slices = height/width), so no constant is written twice.
   - `microfacet_energy.md` — the math of §2 and the table layout.
3. `tools/microfacet-energy/generate.ts` (run with `npx tsx`, ~15 min single-threaded, estimated
   from the prototype's 5.6 M samples/s [checked-num proto/check1.ts]) writes `energy.bin` + `data.ts`.
4. `src/components/descriptors.ts` (`MaterialModelDescriptor`, after `usesMicrofacet` at :116): one
   optional fact
   `energyCompensation?: { kind: 'conductor' | 'dielectric'; unitIntervalRows: string[] }` —
   "this model's GLSL calls `microfacet_<kind>_gain`; under compensation these rows must lie in
   [0, 1]". `ggx.ts`: `{ kind: 'conductor', unitIntervalRows: ['roughness', 'f0'] }`
   (f0 ≤ 1 keeps F_avg ≤ 1, so the F_ms denominator stays ≥ E_avg > 0). `rough_dielectric.ts`:
   `{ kind: 'dielectric', unitIntervalRows: ['roughness'] }`.
5. Model GLSL (twins updated in the same commit):
   - `ggx.glsl`: in eval (:24) and sample (:44) multiply by
     `microfacet_conductor_gain(abs(wol.z), a, f_avg)` with
     `f_avg = mp.f0 + (SPECTRUM_ONE - mp.f0) * (1.0 / 21.0)` (Schlick's hemispherical average).
   - `rough_dielectric.glsl`: in eval (:63, :70) and in the sample's two microfacet branches
     (:112, :126) multiply by `microfacet_dielectric_gain(wol.z, a, eta)`. Not in the
     index-matched delta branch (:96-102), which already carries all the energy.
6. `src/compiler/generate/features/core.ts` (beside the microfacet gate at :111): if some present
   model declares `energyCompensation`, then under `'energy-compensated'` include
   `microfacet_energy.glsl` and declare the texture
   `{ name: 'u_microfacetEnergy', source: 'extern:ggx-smith-energy-v1', precision: 'highp' }`
   (the spectral precedent, src/components/color/spectral/spectral.ts:15); under
   `'single-scattering'` emit generated bodies `return SPECTRUM_ONE;` / `return 1.0;`, only for
   the kinds present (the `medium_emission` folded-constant precedent,
   src/compiler/generate/features/materials.ts:153-167).
7. Measurement plumbing: `MeasurementDescription.microfacet` with its truncation doc
   (types.ts:~598), `ProgramDescription.measurement.microfacet` (plan/types.ts:~57), the default in
   `resolveMeasurement` (measurement.ts:27), the enum in the Validator's `measurementEnums`
   (Validator.ts:875-880). One new Validator rule under `'energy-compensated'`: each material whose
   model declares `energyCompensation` has its `unitIntervalRows` in [0, 1] (constants, and slider
   min/max, which must then be present); a present model with `usesMicrofacet` but no
   `energyCompensation` is an error (it would silently stay single-scattering).
8. Docs: materials/README.md (the fact, the shared part), rough_dielectric.md "Energy" (now
   optional), fable-strategy-taxonomy.md §4 ledger row, CHANGELOG.md.

**Both color models.** RGB and spectral use the same code: the gains read μₒ, α and a scalar η;
F_avg is per lane (`Spectrum`), so it is vec3 or vec4 without change. Dispersive glass already
collapses to the hero wavelength before index-dependent scattering, so η is one float per hit
[checked-code src/components/materials/README.md:65-70]. No raw vec3 literal (SPECTRUM_ONE only).
**Curved spaces.** Only local-frame quantities enter (μₒ from `microfacet_to_local`, which uses
`ambient_dot`, microfacet.glsl:22-24); no new Euclidean assumption [reasoning].
**Other conductors.** A future complex-index `conductor` occupant declares
`{ kind: 'conductor', unitIntervalRows: ['roughness'] }` and passes its own F_avg; an 8-point
Gauss–Legendre rule in μ gives F_avg within 4e-6 for gold, copper, aluminium, silver and iron
[checked-num proto/check4.ts]. That choice belongs to the conductor plan.

## 4. Verification (written first)

**TS (vitest), `src/components/materials/microfacet_energy/microfacet_energy.test.ts`:**
1. Asset integrity: sha256 of `energy.bin` = `data.ts`; size 32×1024×16 bytes; all values finite
   and in (0, 1]; slice z = 0 equals G1(μ) analytically; at z = 1 R = G; B equals 2∫E μ dμ of the
   z = 1 slice.
2. Reproducibility: 24 random nodes recomputed by `build.ts` equal the stored floats (float32
   equality).
3. White furnace, conductor: at 300 random off-grid (μ ∈ [0.005, 1], roughness ∈ [0.03, 1]),
   g·E_true (E_true at N = 512) − 1: max < 5e-3, mean < 5e-4 (measured 3.7e-3 / 2.2e-4).
4. Lossless dielectric: same for both sides at n ∈ {1.1, 1.33, 1.5, 1.7, 2, 2.42, 1.5/1.33}:
   max < 8e-3, mean < 1e-3 (measured 6.0e-3 / 6.0e-4).
5. Colored conductors gain no energy: g·E_F(μ) ≤ 1 + 1e-3 on the check5 grid.
6. Smooth limit: at roughness ≤ 0.05, |g − 1| < 1e-3 (compensation vanishes where the loss does).
7. In `ggx.test.ts` and `rough_dielectric.test.ts`: the existing χ² + triple + pdf-agreement cases
   repeated with the gain (twin of the compensated model): weight·pdf = eval·|cos| and
   sample.pdf = pdf on both lobes. This is the test that eval and sample apply the same gain.
8. Compiler: single-scattering programs contain the folded bodies and no `u_microfacetEnergy`;
   compensated programs contain the texture and the static file; the Validator rejects roughness
   1.2, f0 1.1 (ggx), a slider without max, and an unknown `microfacet` value.

**Before/after on the GPU, default unchanged:** `npm run frames -- record` before commit 2 and
after commit 7, then `compare`: all cases bit-identical, including the two new microfacet cases
and the existing `spectral` case (spectral-materials has ggx and rough_dielectric
[checked-code tests/witnesses/scenes/spectralMaterials.ts:19-21]). The default multiplies by an
exact 1.0, so bit-identity is expected [reasoning]; `frames compare` measures it. `npm run digest`
before/after: differences only in programs containing ggx or rough_dielectric, only the gain lines.

**New witnesses** (`tests/witnesses/scenes/microfacetEnergyWitness.ts` + registry entries), run
targeted, never the full sweep:
- `ms-furnace` — constant white sky, no lights; spheres: ggx f0 = 1 at roughness 0.3 / 0.6 / 1.0
  and rough_dielectric ior 1.5 at roughness 0.3 / 0.6 / 1.0. Strategies: (0) RGB pt,
  `microfacet: 'energy-compensated'`, maxBounces 64, no roulette; (1) the same in spectral
  (visible wavelengths); (2) RGB single-scattering control. Checks, all tier `exact`:
  every sphere region = **1.0** (tol 0.01 = noise + the ≤ 0.6% table error) in strategies 0 and 1;
  background = 1.0; control: a small region at the center of the roughness-1 conductor sphere
  (inside 10% of its projected radius, so μ ≥ 0.995) = **1 − ln 2 = 0.3069** (tol 0.005; E there is
  0.3069–0.3076 [checked-num proto/check6.ts]). The control proves the scene can see the gain.
  Spectral grey furnaces already read exact values [checked-code tests/witnesses/scenes/spectralFoundation.ts:37-41],
  so f0 = 1 lifts to 1 [reasoning from that].
- `veach-mis-ms` — the `veach-mis` scene and checks [checked-code tests/witnesses/index.ts:2268-2286]
  with the three strategies set to `'energy-compensated'` (pt ≡ nee ≡ mis for ggx).
- `rough-mis-ms` — the `rough-mis` scene and checks [checked-code tests/witnesses/index.ts:2317-2334]
  likewise (two-lobe glass with NEE).

Existing witnesses to run once after the change, targeted: `rough-furnace`, `veach-mis`,
`rough-mis`, `spectral-materials` (should be unaffected; frames already prove it bit-exactly, so
these are a cheap second look). Also `npx vitest run` and `npx tsc --noEmit`.

## 5. What it does NOT do

- Not Heitz 2016 (exact random-walk multiple scattering); not Kulla–Conty's reciprocal lobe.
- No light tracing / bidirectional adjoint (the gain is not reciprocal).
- Does not change the default image of any scene; does not flip the default (owner decision).
- No complex-index conductor (separate plan; this gives it the hook), no anisotropy, no
  sheen/coat/layered models.
- No compensation for the `transmittance` tint's own physics: the gain scales both lobes, the tint
  is applied as today.
- Does not extend the table past roughness 1 (Validator error instead).

## 6. Risks and open questions

1. **Measurement field or scene setting?** Recommended: the measurement field (§3), because
   rough_dielectric.md already calls the loss a truncation and it allows a side-by-side A/B of one
   scene. Alternative: a per-material switch (scene section). Owner decides.
2. **Default.** Recommended: keep `'single-scattering'` now; photoreal scenes opt in. Flipping the
   default later changes rough-furnace, veach-mis and every rough scene: a separate decision.
3. **Grazing accuracy.** The worst table error is 0.6% (leaving glass at n ≈ 1.1, grazing) and 0.4%
   (conductor, μ ≈ 0.03). Visible only as a faint rim on a furnace silhouette. 64 z-slices would
   halve the glass error at 1 MiB; I would not, unless the witness shows it.
4. **Cost.** +4 texel fetches per ggx eval/sample, +8 per rough-glass eval/sample [reasoning].
   Not measured; `--perf` on veach-mis-ms can measure it.
5. **Gain above 1 at grazing near index match.** g = 1/G1(μₒ) grows as μₒ → 0 when z → 0, but the
   sampled weight g·G1(ωᵢ) stays ≈ 1 there because ωᵢ ≈ −ωₒ [reasoning]. NEE eval can be large on
   those rare grazing pairs; MIS weights bound it. Watch `rough-mis-ms` noise.
6. **Frames bit-identity** relies on the GLSL compiler keeping x·1.0 = x. If `frames compare`
   reports differences, stop and ask (fallback: compare by tolerance with the existing witnesses).
7. The improvements doc's Kulla–Conty plan (§2.4) should be updated to point here if this is
   approved (one answer per fact).

## 7. Estimate

About 1,000 lines: GLSL ~70 (static file 55, models 12, generated bodies in core.ts); TS
production ~200 (descriptor fact 12, core.ts 30, measurement plumbing 15, Validator 40, assets 15,
build.ts twin 90); generator 60; tests ~350; witnesses ~160; docs ~100. Plus one 512 KiB binary
asset. No new dependency. Build time for the table: ~15 minutes, once.
