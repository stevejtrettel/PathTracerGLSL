# Plan: small material additions for photographs (key `small-materials`)

Status: **draft for owner review. Nothing is built.** Scratch only; no repo file was edited.

Labels: [checked-code file:line] = I read it in the repo; [checked-src URL] = I read the
reference source (downloaded copies in `…/scratchpad/photoreal/small-materials/src/`);
[checked-num script] = computed by `…/scratchpad/photoreal/small-materials/twin.ts`
(run with `npx tsx` from the repo root); [reasoning] = argued but not checked.

## 0. Verdicts at a glance (ordered by visual impact in photographs)

| # | item | verdict | size | why |
|---|---|---|---|---|
| 2 | **sheen** (fabric: velvet, cotton, upholstery, dust) | **build now** | ~500 lines, about 60% tests and fixtures | Cloth is in most interior and still-life photos and nothing in the registry produces its grazing-angle highlight. Exact pdf (perfect LTC importance sampling), no tangents, no UVs, so it works on SDFs and math surfaces. |
| 1 | **thin dielectric** (window pane, glass case, picture glass) | **build now, with a media restriction in v1** | ~360 lines | Exact closed form, tiny. Today a dielectric quad is wrong from its front (§1.1). Soap-film colors are **not** produced by it (that is thin-film interference). |
| 5 | **subsurface** | **no material work**: it already is a random walk | 0 | It is a dielectric boundary plus a scattering medium, gated by the `sss-furnace` and `slab-albedo` witnesses. Its gaps are transport and authoring, already listed in fable-subsurface §8 step 5. |
| 3 | **anisotropic GGX** (brushed metal) | **later**, with normal mapping | ~60 lines of math, plus a tangent-field design | The math is a small transcription. The problem is that `Frame.t` is arbitrary and discontinuous, so no surface has a brushing direction. |
| 4 | **emission on any model / two-sided** | **later (emission), nothing to do (two-sided)** | n/a | Glowing glass already exists as an emissive medium inside a dielectric. Emission on any model is the MLC-7 contract change and needs a design talk. All models are already two-sided. One-sided emission belongs to the lights family. |

## 1. The problem, with evidence

### 1.1 Thin glass
- The registry has six models, and none is a zero-thickness transmitter [checked-code src/components/materials/index.ts:14-21].
- A `dielectric` on a zero-thickness surface refracts into its own index from the front.
  - The dispatcher fabricates `region_to = owner` on a front hit [checked-code src/compiler/generate/features/intersection.ts:1694-1697].
  - The fixture's own note calls this "an open defect" [checked-code tests/witnesses/index.ts:1515].
  - The Validator only warns [checked-code src/compiler/analyze/Validator.ts:1284-1300].
- The workaround is a thick glass box. It is physically exact but costs at least 2 events per pass plus internal reflections against `maxBounces` [reasoning].
- Earlier design notes already sketch the pbrt model and its questions [checked-code docs/claude-improvements-2026-09.md:148-191].

### 1.2 Fabric
- Every model is lambert, a microfacet model or a delta model [checked-code src/components/materials/index.ts:14-21].
- None has the retro/grazing fiber highlight of cloth.
- OpenPBR treats it as its own layer, "fuzz" [checked-src https://raw.githubusercontent.com/AcademySoftwareFoundation/OpenPBR/main/index.html lines 1075-1120].

### 1.3 Brushed metal
- `microfacet_D/G1/sample_vndf` take one scalar `a` [checked-code src/glsl/core/microfacet.glsl:28-54].
- The shading frame's tangent comes from `ambient_frame`, which branches on |n.x| < 0.9. That makes it discontinuous and unrelated to any surface direction [checked-code src/components/ambient/euclidean/euclidean.glsl:13-19].
- Nothing else writes `frame.t` (grep for `frame.t` writers found none outside `ambient_frame`) [checked-code grep].

### 1.4 Emission
- Only lambert has `emissive: true` [checked-code src/components/materials/lambert/lambert.ts:20; survey MLC-7, docs/claude-2026-11-review/survey/findings.md:1586-1593].
- Emission keys on `region_to` [checked-code src/components/transport/techniques/kernel/kernel.glsl:17-19]. This is what makes quads and disks one-sided emitters [checked-code src/components/geometry/quad/quad.glsl:3].

### 1.5 Subsurface
- `subsurfaceMedium()` converts (color, radius, g) into σ_s, σ_a and phase_g, then hands the compiler an ordinary medium [checked-code src/authoring/subsurface.ts:146-189].
- The object is a `dielectric` or `rough_dielectric` boundary with that medium, walked by the path tracer [checked-code demos/sssLabScene.ts:1-20].
- Gates: `sss-furnace` (exact 0.4, roulette off and on) and `slab-albedo` (exact plane albedo) [checked-code tests/witnesses/index.ts:1239-1246; docs/fable-subsurface.md §8 step 3].
- Owner decisions:
  - Thin shells are absent: "not deferred, not planned" (fable-subsurface §5.1).
  - Diffusion/BSSRDF models are rejected (§10) [checked-code docs/fable-subsurface.md:176-178, 553-560].

## 2. The models, in mathematical terms

### 2.1 Thin dielectric (pbrt-v4 `ThinDielectricBxDF`)
Source: [checked-src https://raw.githubusercontent.com/mmp/pbrt-v4/master/src/pbrt/bxdfs.h lines 209-277].

**The model.** An infinitely thin slab with relative index η. There is no lateral shift, and the two refractions cancel. Let R = F_dielectric(|cos θ_o|, η) be the single-interface Fresnel reflectance and T = 1 − R. Summing the internal bounces gives

  R_tot = R + T²R/(1 − R²) = 2R/(1 + R),  T_tot = 1 − R_tot = (1 − R)/(1 + R)  (bxdfs.h:225-230)

**Lobes.** Both are delta.
- Reflection: ω_i = mirror(ω_o), picked with probability R_tot (bxdfs.h:241-245).
- Transmission: ω_i = −ω_o, picked with probability T_tot (bxdfs.h:247-251).
- In our convention (weight = f|cos|/pdf, delta cancellation) both weights are exactly 1.
- `eval` and `pdf` return 0 (bxdfs.h:217-219, 256-259).

**Values** [checked-num twin.ts], house `dielectric_fresnel` with η = 1/1.5:
- normal incidence: R = 0.04, T_tot = 0.923077, R_tot = 0.076923;
- cos θ = 0.5: R = 0.089187, T_tot = 0.836232;
- the identity 2R/(1+R) = R + T²R/(1−R²) holds to 5 digits at cos ∈ {1, 0.7, 0.3, 0.05, 0}.

**Lossless.** R_tot + T_tot = 1 identically.

**What η means here.** η is the sheet's index *relative to its surroundings*, as pbrt's own `eta` is (pbrt carries no surrounding index here) [checked-src bxdfs.h:214, 225]. This is declared in the descriptor and the .md. It is not inferred.

**Spectral.** η is a plain scalar, so R is the same in every lane and the weight is 1 in RGB and spectral alike. A dispersive (Cauchy/Sellmeier) η is an explicit Validator error in v1. pbrt's version terminates secondary wavelengths instead.

### 2.2 Sheen: OpenPBR fuzz over a Lambertian base (Zeltner, Burley & Chiang 2022)
Spec: [checked-src OpenPBR index.html lines 1075-1120].

Fuzz lobe:

  μ_i f_fuzz(ω_i, ω_o) = **c** · E(μ_o, r) · D(ω_i | ω_o, r)

- D is a linearly transformed cosine (LTC), a normalized pdf on the upper hemisphere.
- E is the fitted directional albedo.

Layering with albedo scaling and coverage W (spec "fuzz-layering-approx"):

  f = W·f_fuzz + (1 − W·E(μ_o))·f_base,  f_base = ρ/π.

Transcription source: MaterialX `mx_microfacet_sheen.glsl` [checked-src https://raw.githubusercontent.com/AcademySoftwareFoundation/MaterialX/main/libraries/pbrlib/genglsl/lib/mx_microfacet_sheen.glsl]:
- E fit: lines 97-104.
- LTC inverse coefficients a⁻¹(μ_o, r) and b⁻¹(μ_o, r): lines 106-115.
- LTC frame (X in the plane of ω_o and n): lines 117-133.
- `D(ω) = (max(w'_z,0)/π)·(a⁻¹/|w'|²)²` with w' = M⁻¹ω: lines 135-155.
- Sampler (cosine sample, apply M, normalize, pdf = (w_z/π)(a⁻¹|Mw₀|²)²): lines 157-188.
- Roughness is clamped to [0.01, 1] at every use [checked-src …/genglsl/mx_sheen_bsdf.glsl lines 36-39, 53].

**Facts that make it simple:**
- **Exact pdf.** The sampler's pdf equals D to 2e-15 relative error at 7 (μ_o, r) points [checked-num twin.ts].
- **Normalized on the hemisphere exactly.** M fixes the z-component, so the upper hemisphere maps onto itself. Quadrature gives ∫D = 1.00000 at five ordinary points [checked-num]. At (μ_o 0.02, r 0.01) quadrature reads 1.19 and χ² fails. The lobe there is narrower than the 1200² grid, so this is a quadrature failure, not a sampler failure: the pdf still matches D to 1e-15 [checked-num, plus reasoning]. The twin test must use a lobe-adapted grid there, or drop that corner. Recorded as risk R3.
- **E can go slightly negative.** The fit dips to −2e-5 near r = 0.05. The model clamps E to [0, 1] in the host-derived value (see §3.2), so 1 − W·E ≤ 1 holds and energy is never created. Over μ_o ∈ [0,1], r ∈ [0.01,1] the maximum of E is 0.745 [checked-num].
- **Frame-free.** D depends on ω_i only through a frame built from ω_o and n. So the result does not depend on `frame.t`/`frame.b`. That makes it safe on SDFs and math surfaces with the arbitrary `ambient_frame` tangent [reasoning; twin test T-S5 checks it].

**Sampling.** Choose the fuzz lobe with probability p = W·E(μ_o), otherwise cosine-sample the base. The mixture pdf is

  pdf = p·D + (1 − p)·μ_i/π.

When **c** = ρ, the weight f μ_i/pdf equals ρ exactly. That is zero variance in the furnace, and it is the furnace witness's exact value [reasoning: the numerator is ρ times the denominator].

**Non-reciprocal.** f(ω_i, ω_o) ≠ f(ω_o, ω_i), because E depends on μ_o. In a unidirectional tracer every technique (BSDF sampling, NEE, MIS) evaluates the same f(· | ω_o), so the estimators still agree. The measurement is defined with ω_o as the camera-side direction. This is declared in sheen.md [reasoning].

**Spectral.** E, D and p are wavelength-free scalars. **c** and ρ are reflectance-role Spectrum rows, lifted like every reflectance. The model is identical in RGB and spectral programs [reasoning]. The lobe probability p uses no spectrum reduction.

**Curved spaces.** All lobe math runs in local frame coordinates, obtained via `ambient_dot` exactly as `microfacet_to_local` does [checked-code src/glsl/core/microfacet.glsl:21-26]. The way back out uses the same `from_local` that ggx and lambert already use. No new Euclidean assumption is added [reasoning].

### 2.3 Anisotropic GGX (for "later"; recorded so the later plan starts here)
pbrt-v4 `TrowbridgeReitzDistribution` [checked-src https://raw.githubusercontent.com/mmp/pbrt-v4/master/src/pbrt/util/scattering.h lines 109-187]:
- D(m) = 1/(π α_x α_y cos⁴θ (1 + tan²θ (cos²φ/α_x² + sin²φ/α_y²))²) (125-134);
- Λ(ω) uses α² = cos²φ α_x² + sin²φ α_y² (143-149);
- the VNDF sampler stretches by (α_x, α_y) (163-187).

Our sampler is already the same Heitz 2018 routine with α_x = α_y [checked-code src/glsl/core/microfacet.glsl:40-54].

Note: pbrt uses the height-correlated G = 1/(1+Λ_o+Λ_i) (scattering.h:152). The house uses separable G1·G1 [checked-code microfacet.glsl:33-36; ggx.glsl]. Keep separable, because it is what makes the house sampling weights collapse.

**Blocker.** A meaningful tangent field ∂p/∂u (analytic charts, mesh tangents from UVs, an authored direction field for SDFs). Normal mapping needs the same field, so it belongs to that design.

## 3. The change and its boundaries (items 1 and 2 only)

### 3.1 `thin_dielectric` (new occupant; one folder plus one registry line)

**New files** in `src/components/materials/thin_dielectric/`:
- `thin_dielectric.glsl`:
  - `thin_dielectric_eval`, `_pdf` and `_emission` return zero;
  - `thin_dielectric_sample` computes cos_i = clamp(ambient_dot(wo, n, p), 1e-6, 1). This uses the dielectric's discipline: n faces region_from [checked-code dielectric.glsl:24-25];
  - R = `dielectric_fresnel(cos_i, 1.0/mp.thin_ior)`, then R_tot = 2R/(1+R);
  - on `uc < R_tot`: mirror, weight `SPECTRUM_ONE`, flags `LOBE_REFLECTION|LOBE_DELTA`;
  - otherwise: `wi = -wo`, weight `SPECTRUM_ONE`, flags `LOBE_TRANSMISSION|LOBE_DELTA`;
  - `thin_dielectric_albedo()` returns `SPECTRUM_ONE`, the clear-glass value the albedo guide uses for dielectrics [checked-code descriptors.ts:115-122].
- `thin_dielectric.ts` descriptor:
  - rows: `{ name: 'thin_ior', glslType: 'float', source: 'ior', default: 1.5, storage: 'field', constraint: { kind: 'positive' } }`, with **no `role`**;
  - capabilities: `{ nonDeltaLobes: false, transmission: false, support: 'sphere', emissive: false }`;
  - `albedo: { fn: 'thin_dielectric_albedo' }`.
  - With no role, it is a plain number: constants or `{param}` only. A spectrum-kind value must be rejected; see verification T-T5.
  - `transmission: false` is deliberate. The sheet does not change index, so it gets no region-table ior and no thin-surface warning. `ior_of` pins non-transmissive regions to 1.0 [checked-code intersection.ts:1612-1615], so the walk's η²-ratio multiplies by 1 on its crossings. `eta_scale` feeds only the roulette metric [checked-code pt.ts:159, 206]. This is exactly the "sphere support, transmission false" combination the descriptor comment anticipated [checked-code descriptors.ts:136-141].
- `thin_dielectric.md`: the math note from §2.1, the meaning of η, the identity, and a statement that it does **not** produce interference colors.
- `thin_dielectric.test.ts`: the TS twin (§4).

**Edits:**
- `src/components/materials/index.ts`: one registry line.
- `MaterialModel` union / Validator known-model list, if it is not open-vocabulary. Check this first.
- `src/compiler/analyze/Validator.ts`: one **error**. A `thin_dielectric` material in a scene that has any medium (the same fact that switches the walk's `f.media` on) is rejected, with the reason. On a zero-thickness owner's front hit, `region_to` is the owner, so the walk's `current_medium = region_to` [checked-code pt.ts:446] would mistrack the segment behind the pane. The dispatcher cannot change, because one-sided emission depends on that same `region_to` [checked-code kernel.glsl:17-19, quad.glsl:3]. This is v1's honest boundary. Lifting it is open question Q3.
- `docs/fable-strategy-taxonomy.md:89` (bias ledger): one-word clarification, "dielectric interfaces (including thin sheets)".
- `src/components/materials/README.md`: occupant list. Also fix the list's existing omission of rough_dielectric and checker [checked-code README.md:59-62].
- CHANGELOG entry.

**Not touched:** transport, intersection, lighting, `glsl/core`.

### 3.2 `sheen` (new occupant; monolithic fuzz-over-lambert)

**New files** in `src/components/materials/sheen/`:
- `sheen.glsl`, with helpers prefixed `sheen_`:
  - `sheen_E(mu, r)`, `sheen_ainv`, `sheen_binv`;
  - `sheen_ltc_D(vec3 wl_ltc, mu, r)`;
  - `sheen_to_ltc`: in local coordinates, rotate about z so wo lies in the +x half of the xz plane. When wo ∥ n, use identity.
- Then the four contract functions:
  - `eval` = W·c·E·D/μ_i + (1 − W·E)·ρ/π, zero unless both directions are above the surface (wo's side, the lambert rule);
  - `pdf` = p·D + (1 − p)·μ_i/π with p = W·E;
  - `sample`: uc < p selects the LTC sample, otherwise cosine; weight = eval·μ_i/pdf. The house writes out the algebra where it cancels. Here it does not cancel in general, so the quotient is computed;
  - `emission` = 0.
- Local and world conversions use `microfacet_to_local` / `microfacet_from_local` (open question Q5).
- `sheen.ts` descriptor rows:
  - `albedo` (Spectrum, reflectance, default 0.8; shared with lambert by name and type);
  - `sheen_color` (Spectrum, reflectance, default 1);
  - `sheen_weight` (float, default 1, constraint [0,1]);
  - `sheen_roughness` (float, default 0.5, constraint [0,1]; the OpenPBR defaults, spec lines 1122-1126).
- Derived (D4, host-side): `sheen_r = clamp(sheen_roughness, 0.01, 1)`, the MaterialX clamp, so eval and sample cannot disagree.
- E depends on μ_o, so it is computed in GLSL. Its clamp `clamp(E, 0, 1)` sits inside `sheen_E`, the one answer.
- Capabilities: `{ nonDeltaLobes: true, transmission: false, support: 'hemisphere', emissive: false }`.
- `albedo: { row: 'albedo' }`.
- `usesMicrofacet: true` (Q5).
- `sheen.md`: the model, sources, non-reciprocity, the furnace identity, and the fit's validity range.
- `sheen.test.ts`: the TS twin.

**Edits:** registry line, README occupant list, CHANGELOG.

**Not touched:** transport, generator code. The dispatch, struct union and resolver are generated from the descriptor [checked-code materials/README.md:46-53].

### 3.3 Assets
None. Both models are closed form, and the sheen fits are seven short rational and Gaussian formulas.

## 4. Verification (written first)

### 4.1 TS twins (vitest, CPU, in the occupant folders; the ggx.test.ts pattern [checked-code src/components/materials/ggx/ggx.test.ts:130-200])

**thin_dielectric.test.ts:**
- T-T1: R_tot + T_tot = 1, and R_tot = 2R/(1+R) = R + T²R/(1−R²), over cos ∈ [0,1] and η ∈ {1.0001, 1.33, 1.5, 2.4}.
- T-T2: the reflection frequency over 10⁶ uc draws matches R_tot (binomial 5σ).
- T-T3: transmitted wi = −wo exactly; reflected wi is the mirror; both weights are 1.
- T-T4: values pinned at normal incidence and cos 0.5 for η 1.5: T_tot = 0.923077 and 0.836232 [checked-num].
- T-T5: compiler and Validator tests (tests/compiler):
  - a scene with `dielectric` **and** `thin_dielectric` compiles; `MaterialProperties.thin_ior` and the `ior_of` table coexist; each model reads its own `ior`;
  - `ior: cauchy(...)` on thin_dielectric is a Validator error;
  - thin_dielectric plus any medium is a Validator error;
  - unknown keys behave as for other models.

**sheen.test.ts:**
- T-S1: E ∈ [0, 1] after the clamp, over a 51×50 (μ_o, r) grid.
- T-S2: the LTC sampler's pdf equals D to 1e-9 relative error.
- T-S3: χ² histogram of the **full mixture** sampler against the mixture pdf, using the house χ² critical value (ggx.test.ts:130). Grid: μ_o ∈ {1, 0.5, 0.1}, r ∈ {0.05, 0.3, 0.5, 1}, W ∈ {0.3, 1}. Scratch χ² on the LTC lobe alone: 68-79 over 64 cells at 400k samples [checked-num].
- T-S4: the §11.3 triple: weight·pdf = eval·μ_i on every sample, and `pdf()` equals the sampler's pdf.
- T-S5: rotating (t, b) about n leaves eval and pdf unchanged. This is the SDF safety claim.
- T-S6: furnace identity. Monte Carlo ∫ f μ_i dω_i = W·c·E + (1−W·E)·ρ for c ≠ ρ, and = ρ when c = ρ.
- T-S7: the GLSL constants match the MaterialX source digits (a frozen table in the test).

**Existing gates:**
- `npx vitest run`: includes the glslang compile of every registry scene, so the new witness fixtures get static-compiled.
- `npx tsc --noEmit`.

### 4.2 No-change gate for every existing scene
- Run `npm run digest -- before.json` before and after, then `--compare`. **Expected: zero scenes differ.** Exact linkage means an absent model contributes nothing [reasoning, from materials/README.md:48-53].
- If any existing scene differs: stop and report.
- With an identical digest, no existing witness needs re-running [reasoning].

### 4.3 New GPU witnesses (targeted runs only: `npm run witness -- thin-pane sheen-furnace`, under `caffeinate -i`)

**`thin-pane`.**
- Scene:
  - orthographic camera;
  - no environment;
  - a lambert emitter quad with Le = 1 behind a `thin_dielectric` quad (η 1.5) that covers the left half of the frame;
  - the right half sees the emitter directly.
- Arms (scene variants):
  - pane facing the camera;
  - pane flipped (back-face hit);
  - pane tilted to cos θ = 0.5.
- Keys: pt-nee, pt-mis, pt. NEE cannot see through the pane (opaque shadows). The emitter is reached after a delta event, so its emission counts at full weight under every key [checked-code kernel.glsl:32 records the delta flag; reasoning for the weight].
- Checks (`kind: 'mean'`, region form as in furnace-sky [checked-code tests/witnesses/index.ts:1418-1428]):
  - direct region = 1.0;
  - pane region = **0.923077** (normal, both facings) and **0.836232** (tilted) [checked-num];
  - tolerance about 0.005, the furnace-sky precedent.
- A spectral key with the same checks, if a white emitter reads back 1.0 in spectral; otherwise an equality check against the RGB key (to confirm when the fixture is written).

**`sheen-furnace`.**
- Scene: the open furnace of `furnace-sky` [checked-code tests/witnesses/index.ts:1409-1430]: a constant samplable sky with L = 1 and a sphere.
- Material: `sheen` with c = ρ = 0.4.
- Arms: (W 1, r 0.5), (W 1, r 0.05), (W 0.5, r 1).
- Keys: nee, mis, pt.
- Exact expectation: sphere region = **0.4** and sky = 1.0 on every key and arm (§2.2: the convex body sees one bounce, and the albedo is ρ for every μ_o).
- A spectral key with value 0.4. The `spectral-scatter-furnace` precedent asserts 0.4 in spectral [checked-code tests/witnesses/scenes/spectralMedia.ts:48-54].
- What this does **not** gate: the shape of the lobe. That is T-S3's job on the twin.

**Optional fourth arm, cross-check tier.** c = 1, ρ = 0 (fuzz alone, W = 1). The sphere's center pixel equals E(μ_o = 1, r)·L. Since μ_o is known at the center, E is a closed-form value: E(1, 0.5) = 0.0249 [checked-num]. This tests that the GLSL E matches the twin's.

## 5. What this does NOT do
- No thin-film interference (soap bubbles, oil slicks, coated lenses): a separate spectral model.
- No tinted thin glass (absorption in the sheet) in v1 (Q2).
- No thin dielectric in scenes with media (v1 Validator error, Q3).
- No transparent shadow rays through panes. A **delta** light through a window, such as `directional` sunlight, stays dark under every estimator. The bias ledger declares this (opaque-dielectrics), and it is the same under pt, nee and mis, so estimator equality holds [checked-code tests/witnesses/index.ts sky-lamp note, line ~1437]. This is the biggest remaining gap for sunlit interiors. It needs its own design: improvements §2.1 Q5.
- No sheen layered over ggx, coat or metal. This occupant is fuzz over lambert only. General layering is the layered-materials work.
- No anisotropic GGX, no tangent field, no emission-on-any-model refactor, no SSS changes.
- No change to transport, intersection, lighting or `glsl/core`.

## 6. Risks and open questions
- **Q1 (owner decision).** Is `thin_dielectric` compatible with fable-subsurface §5.1 ("thin shells … absent")? My reading is yes: §5.1 is about a *scattering* thin-walled SSS mode, while this sheet has no interior transport. It is still a zero-thickness optical model, so I ask rather than assume.
- **Q2.** Tint now? Improvements §2.1 Q4 gives the absorbing series R + T²Rτ²/(1−R²τ²), T²τ/(1−R²τ²). It needs a thickness d and σ_a, two more rows. My suggestion: v1 without it.
- **Q3.** The media restriction. To lift it, the walk would need the far-side region for zero-thickness owners. The generated `scene_region_thin` already exists [checked-code intersection.ts:1672-1677], but it is a transport/intersection change and should get its own plan. It would also repair `dielectric` on quads in fog.
- **Q4.** Row naming. The authored key is `ior` (same vocabulary as dielectric), but the struct field is `thin_ior`, so it does not share a name with the region-table `ior` row. I have not read the full resolver path for two models with one `source` and different storage. T-T5 is written first to catch it. Fallback: author key `eta` (pbrt's name).
- **Q5.** Sheen needs `microfacet_to_local`/`from_local`, which are gated by `usesMicrofacet`. Options:
  - (a) declare `usesMicrofacet: true`: one answer for the frame maps, but D/G1/VNDF get linked unused in sheen-only programs;
  - (b) move the frame maps to a core frame file: a refactor, kept separate per CLAUDE.md;
  - (c) inline the three `ambient_dot` calls as lambert does.
  - I recommend (a) for this batch.
- **Q6.** Model name: `sheen` (common) or `fuzz` (OpenPBR)? And should the base be fixed to lambert? Fixing it to lambert is the simplest thing that renders cloth.
- **R1.** Sheen is non-reciprocal by construction (OpenPBR albedo scaling). This is harmless for unidirectional estimators and declared, but it rules sheen out of any future adjoint or bidirectional use.
- **R2.** The E and LTC fits are fits. The model *is* the fit, which is OpenPBR's choice, so nothing is guessed. The only hazard is the negative-E sliver, which is clamped.
- **R3.** The χ² test at r ≤ 0.02 with grazing μ_o needs lobe-adapted binning (§2.2). If that proves awkward, the twin restricts to r ≥ 0.05 and the descriptor constraint stays [0,1], with the MaterialX clamp at 0.01. The plan does not hide the corner.
- **R4.** Sunlit interiors through thin panes stay dark (delta sun, opaque shadows). Users may read this as a bug. sheen.md and thin_dielectric.md say so, and the owner should know before building a window scene.

## 7. Estimate of lines changed

| piece | GLSL | TS (descriptor + Validator) | tests | fixtures + registry | docs |
|---|---|---|---|---|---|
| thin_dielectric | ~45 | ~35 + ~15 | ~120 | ~100 | ~40 |
| sheen | ~110 | ~45 | ~200 | ~90 | ~60 |
| **total** | ~155 | ~95 | ~320 | ~190 | ~100 → **≈ 860** |

Order: thin_dielectric first (smaller, one commit), then sheen (one commit). Each commit gets: digest compare, vitest and tsc, then its own targeted witness.
