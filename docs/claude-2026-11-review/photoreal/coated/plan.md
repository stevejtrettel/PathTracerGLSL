# claude-plan: coated materials, step 1: `plastic` (smooth clear coat over a diffuse base)

Status: draft for owner review. Nothing in the repo has been edited. The scratch twin and its
numbers are in `/private/tmp/claude-501/-Users-stevetrettel-Code-PathTracerGLSL/04194012-7031-43cb-a852-aed5c827ffd4/scratchpad/photoreal/coated/twin.ts`
and `idlow.ts`. Reference sources were downloaded to `.../coated/src/` and read there; line
numbers below refer to those copies (mitsuba3 `master`, pbrt-v4 `master`, OpenPBR `main`,
fetched 2026-11-06).

Labels: [code file:line] = read in this repo; [src file:line] = read in the reference source;
[num script] = computed by the scratch script; [reasoning] = argued, not checked.

## 1. The problem

- No layered or coated model exists. The registry has six models: lambert, dielectric,
  rough_dielectric, ggx, mirror, checker [code src/components/materials/index.ts:13-20]. The
  survey records this gap: "layered / coated | none" [code docs/claude-2026-11-review/survey/materials-lights-color.md:300].
- So glossy plastic, glazed ceramic, lacquer, varnished wood, and the clear coat of car paint
  cannot be authored. A diffuse body with a mirror-like Fresnel sheen on top is the most common
  look in product and still-life photographs [reasoning]. Today the closest option is lambert,
  which has no highlight and no grazing-angle reflection.
- A coat needs no UVs. It suits the owner's "photographs of purely mathematical scenes": a
  lacquered Menger sponge or a glazed torus needs only a normal [reasoning].
- The model cannot be made from existing pieces. A model cannot call another model's GLSL
  [code survey/materials-lights-color.md:250], so it has to be one self-contained occupant.

## 2. The model

**Physical setup** (Mitsuba 3 `plastic`, the "interfaced Lambertian"). A smooth dielectric
interface with relative index η lies over a Lambertian base with albedo R(λ). The coat is
infinitely thin and does not absorb. Light refracts in, reflects diffusely off the base, and
bounces between the base and the underside of the interface any number of times before it
leaves. The infinite series has a closed form.

Notation: local frame with n = +z, and μ_i, μ_o > 0 the cosines on the outside.
F(μ) = dielectric_fresnel(μ, 1/η) is the outside Fresnel term (house convention η_call = n_i/n_t).
K is the internal diffuse reflectance, the fraction of cosine-distributed light inside the coat
that the interface reflects back down, including total internal reflection:

  K(η) = ∫₀¹ F_inside(μ, η) · 2μ dμ,  where F_inside uses n_i/n_t = η.

**BSDF.** It has two lobes:

  f(ω_i, ω_o) = F(μ_o) · δ_mirror(ω_i, ω_o) + R / (1 − R·K) · (1 − F(μ_i))(1 − F(μ_o)) / (π η²)

- The first term is the delta reflection of the coat.
- The second term is the base, seen through the coat. Its parts:
  - 1/η² is the radiance compression into the coat.
  - R/(1 − R·K) is the geometric series of internal bounces.
  - The diffuse term is reciprocal, symmetric in i and o [num twin.ts §3: 4e-16].

**Source.** Mitsuba 3 `plastic.cpp` with `nonlinear = true`:
- eval [src plastic.cpp:301-309]
- diffuse sample weight [src plastic.cpp:276-281]
- the nonlinear term `diff / (1 − diff·fdr_int)` [src plastic.cpp:305-306]
- K = `fresnel_diffuse_reflectance(1/η)` [src plastic.cpp:197]

**Directional albedo.** It is exact and closed form:

  A(μ) = F(μ) + (1 − F(μ)) · R(1 − K)/(1 − R·K).

It uses the identity 1 − K = (1 − ∫F(μ)2μdμ)/η² (Stokes reciprocity). OpenPBR states the same
closed form for the interfaced Lambertian [src openpbr_index.html:970-983]. Checks:
- The identity holds to 1e-16 for η ∈ {0.6, 0.8, 1.2, 1.5, 2} [num idlow.ts].
- A(μ) agrees with quadrature of eval and with Monte Carlo over the sample weights [num twin.ts §2].
- **With R = 1, A ≡ 1 for every μ and η**, which is an exact furnace.
- With η = 1 the model reduces to lambert: K = 0 and f = R/π [num twin.ts §5].

**Sampling.** uc picks the lobe, transcribed from Mitsuba [src plastic.cpp:243-253, 211-219]:

  P_spec(μ_o) = F(μ_o) / max(F(μ_o) + (1 − F(μ_o))·avg(R), ε),  P_diff = 1 − P_spec.

- **uc < P_spec:** take the mirror direction. Weight = F(μ_o)/P_spec. pdf = 0 with flag
  `LOBE_REFLECTION | LOBE_DELTA` (house delta convention, §3.1).
- **Otherwise:** take a cosine-weighted ω_i (lambert's construction). Then
  pdf = P_diff·μ_i/π and weight = f_d·μ_i/pdf = R/(1−RK)·(1−F_i)(1−F_o)/(η²·P_diff).
- **`plastic_pdf`** returns P_diff(μ_o)·μ_i/π. It is the pdf of the only non-delta lobe. The
  mixture's delta part is not a density and is reported per sample through the flag.

The sampler and the pdf compute P_spec from the same (μ_o, R) and the same `hit.wl`, so the two
always agree. The selection rule only affects variance. Coverage: wherever f_d > 0 (some
channel of R > 0 and F_o < 1), P_diff > 0 [reasoning, from the formula].

**Transport needs nothing new.** A sample from a model with `nonDeltaLobes: true` can carry
`LOBE_DELTA`. The kernel records `prev_was_delta` for each sample
[code src/components/transport/techniques/kernel/kernel.glsl:32,
src/components/transport/techniques/kernel/kernel.ts:47-48]. rough_dielectric already does this
at index-matched interfaces [code src/components/materials/rough_dielectric/rough_dielectric.glsl:100-106].
NEE evaluates only the diffuse lobe, and an emitter hit after the delta lobe scores with weight 1.

**RGB vs spectral.**
- **coat_ior** is a plain scalar row, the same at every wavelength. F and K are scalars and need
  no hero collapse.
- **Dispersive coat:** a Cauchy or Sellmeier value on `coat_ior` is a Validator error in both
  modes, because the row has no `index` role [code src/compiler/analyze/propertyValidation.ts:105-107].
- **albedo** is a `reflectance` row. RGB applies R/(1 − RK) per channel; spectral applies it per
  wavelength to the lifted R(λ). For a chromatic R the two programs differ. That is the declared
  "RGB color" truncation, not a bug: the spectral program is the physical one [reasoning].
- **P_spec** uses `spectrum_average(mp.albedo)` [code src/components/color/spectrum.glsl:5]. In
  both programs it is computed identically in sample and pdf.

**Curved spaces.**
- Every cosine goes through `ambient_dot(·, hit.frame.n, hit.p)`, as in lambert.
- The mirror direction is the expression mirror.glsl already uses (`2·cos·n − wo`)
  [code src/components/materials/mirror/mirror.glsl:24-29]. It is an existing Euclidean spot,
  not a new one.
- No new world-space assumptions are added.

**Why not the other models.**
- **pbrt-v4 LayeredBxDF / CoatedDiffuse.** Its eval is a stochastic random-walk estimate
  `f / nSamples` [src bxdfs.h:515-652]. Its sample sets `pdfIsProportional = true`
  [src bxdfs.h:676]. Its PDF is a heuristic `Lerp(0.9, 1/(4π), pdfSum/nSamples)`
  [src bxdfs.h:882]. The §11.3 triple (sample.pdf = pdf(wi), weight·pdf = f·cos) cannot hold.
  It is rejected under the exact-pdf rule.
- **OpenPBR albedo scaling** f_coat + (1 − E_coat(ω_o))·f_sub. The spec itself calls it
  non-reciprocal [src openpbr_index.html:187-201]. It needs E_coat tables and does not model
  the internal bounces (the darkening), which the closed form above models exactly.
- **Weidlich–Wilkie 2007** was not read in source. Nothing here relies on it.
- **Mitsuba `roughplastic`** is step 2 (§5). It needs a per-material 64-entry table of the
  rough interface's transmittance t(μ) [src roughplastic.cpp:221-246, 290-291, 372-381] and
  is therefore deferred.

**Two deliberate deviations from Mitsuba.**
1. **K is computed exactly, not from a fit.** Mitsuba uses the Egan–Hilgeman / d'Eon–Irving
   fits, with 0.1–0.6% error at η ≤ 2 [src fresnel.h:345-371]. That error would break the exact
   furnace. The descriptor computes K by quadrature in μ = μ_c + (1 − μ_c)s², which removes the
   kink at the critical angle; the ∫₀^{μ_c} part is μ_c² exactly. It agrees with the identity to
   1e-16 [num idlow.ts].
2. **Only the physical `nonlinear` form.** Mitsuba's default `nonlinear = false` divides by
   (1 − K) instead of (1 − RK) to keep texture colors [src plastic.cpp:126-147]. For R = 0.5,
   η = 1.5 at normal incidence that gives 0.520 where the physical value is 0.316 [num twin.ts §5].
   There is no option for the non-physical form.

Mitsuba's `specular_reflectance` row is also dropped. Its docs say it "should never be touched"
for realism [src roughplastic.cpp:45-49].

## 3. The change and its boundaries

**New occupant `src/components/materials/plastic/`**, one folder plus one registry line:

- **`plastic.glsl`** (~90 lines). Functions: `plastic_eval`, `plastic_sample`, `plastic_pdf`,
  `plastic_emission` (returns 0), plus two private helpers:
  - `plastic_specular_prob(float cos_o, MaterialProperties mp)`, the ONE selection rule, called
    by both sample and pdf;
  - `plastic_diffuse(float cos_i, float cos_o, MaterialProperties mp)`, the ONE diffuse value,
    called by both eval and sample.

  Side handling follows lambert: n is flipped to wo's side, and eval/pdf return 0 when wi and
  wo straddle the surface. It depends on `dielectric_fresnel` (core math.glsl:95),
  `spectrum_average`, `ambient_dot`, and the LOBE_* flags. It does not use the microfacet library.

- **`plastic.ts`** descriptor:
  - `properties`:
    - `albedo`: Spectrum, role reflectance, default 0.8, field. Declared exactly like
      lambert's row, so the union dedupes it into one field
      [code src/compiler/generate/schema.ts:50-68].
    - `coat_ior`: float, default 1.5, field, constraint `positive`. It is the coat's index
      **relative to the medium the light arrives from**, Mitsuba's `eta = int_ior/ext_ior`
      [src roughplastic.cpp:75-78, 182]. It is named `coat_ior`, not `ior`, because `ior` is
      dielectric's region-table row with a different meaning.
  - `derived`: `{ name: 'coat_fdr', glslType: 'float', inputs: ['coat_ior'], fn: internalDiffuseReflectance }`.
    It is computed host-side; a live `{param}` coat_ior gets a compute closure automatically
    [code src/compiler/generate/features/materials.ts:349-370]. `internalDiffuseReflectance` is
    exported from plastic.ts and is the one definition the twin imports.
  - `albedo: { row: 'albedo' }`.
  - `capabilities: { nonDeltaLobes: true, transmission: false, support: 'hemisphere', emissive: false }`.
  - `usesMicrofacet` is absent.
- **`plastic.md`**: the math of §2, the identity, the furnace value, and the two deviations.
- **`plastic.test.ts`**: the TS twin, line for line (§4).
- **`src/components/materials/index.ts`**: one import and one registry line, appended last.
  Dispatch order only covers models present, so existing programs do not change [reasoning;
  the digest checks it].
- **`src/components/materials/README.md`**: one occupant line.

**No compiler, engine, transport, App, or core GLSL change.** The registry-wide tests pick the
model up automatically:
- glslang kitchen sink [code tests/compiler/glsl-compile.test.ts:150-155]
- spectral compile and reflectance-role validation [code tests/compiler/spectralMaterials.test.ts:14-45]
- AOV compile [code tests/compiler/glsl-compile.test.ts:361-364]
- the descriptor contract and GLSL symbols [code tests/components/materialsContract.test.ts:15-75]

**Witness fixture `tests/witnesses/scenes/plasticWitness.ts`** (~50 lines) and its registry
entries. It reuses `furnaceSkyScene` and its three strategies (pt-nee, pt-mis, pt; constant
samplable sky with L = 1; RR off; tonemap none)
[code tests/witnesses/scenes/envScenes.ts:81-122], with the sphere's material swapped.

**CHANGELOG.md**: a dated entry.

**Assets:** none.

## 4. Verification (written first)

**TS twin, `plastic.test.ts`** (pattern: rough_dielectric.test.ts). The scratch twin already
passes every item below [num twin.ts]:
1. **Fdr identity:** 1 − K(η) = (1 − Fdr(1/η))/η² to 1e-12 for η ∈ {0.6, 0.8, 1.2, 1.5, 2, 2.5}.
   This catches a wrong K or a wrong η convention.
2. **χ²** of the diffuse-branch samples against N·∫_bin plastic_pdf, with 10×20 θ×φ bins at
   μ_o ∈ {0.9, 0.3}. Scratch: χ² = 197.5 and 191.7 on 199 dof. The observed P(delta) matches
   P_spec (0.0782 vs 0.0784; 0.3437 vs 0.3440).
3. **Triple:** weight·pdf = eval·μ_i (scratch max relative error 4.6e-16), and
   `plastic_pdf(sample.wi) == sample.pdf` (exact). Delta samples have pdf 0 and flag
   LOBE_DELTA, and eval/pdf at the mirror direction return only the diffuse part.
4. **Reciprocity:** f(i, o) = f(o, i) (scratch 4e-16).
5. **Energy:** the MC mean of the sample weights matches the closed form A(μ) for
   R ∈ {1, 0.5, (0.8, 0.5, 0.2)} and μ ∈ {1, 0.7, 0.3, 0.05}, within 3σ. R = 1 gives 1.
6. **Reduction:** η = 1 gives f = R/π and P_spec = 0, the same as lambert's eval.

**New GPU witnesses.** Each uses furnace-sky's three keys, 96 spp, and its sphere-center
region {x 0.45, y 0.45, w 0.1, h 0.1}. At the region's corner μ ≥ 0.978 [reasoning: fov 0.8,
camera at 3.5, unit sphere]. A(0.978) − A(1) < 3e-5 [num twin.ts §5], so the exact value at
μ = 1 applies.

| id | material | expected per channel (all 3 keys) | catches |
|---|---|---|---|
| `plastic-furnace` | albedo 1, coat_ior 1.5 | **1.0** exactly (and sky = 1.0) | wrong K, missing 1/η², wrong lobe weight or selection, a NEE/MIS weight on the delta lobe |
| `plastic-darkening` | albedo 0.5 gray | **0.316071** = 0.04 + 0.96·0.5(1−K)/(1−0.5K), K = 0.5963457597 | the nonlinear term (the linear form would read 0.520) |
| `plastic-chroma` | albedo (0.8, 0.5, 0.2) | **(0.632833, 0.316071, 0.127997)** | per-channel errors |
| `spectral-plastic` | albedo 0.5 gray, spectral nee key (spectral-mirror's setup) | **0.316071** | the spectral program |

- **Tolerances:** start at furnace-sky's 0.008 RGB and spectral-mirror's 0.004 [code
  tests/witnesses/index.ts:1418-1428; tests/witnesses/scenes/spectralMaterials.ts:44-50].
  Calibrate on the first run and record that in the witness README.
- **Spectral:** the 0.316071 value assumes the lift of gray 0.5 is flat. spectral-mirror's
  "f0 = 0.5" check suggests it is [reasoning], and the first run confirms it.

**Existing witnesses: none need re-running.** The change adds a registry entry and touches no
shared GLSL or compiler code. The proof is `npm run digest` before and after, then `--compare`,
which must show **zero** differing scenes. As a harness sanity check, `furnace-sky` runs once
next to the new entries (minutes, never the full sweep).

**Also run:** `npx tsc --noEmit` and `npx vitest run`. The kitchen sink, spectral, AOV, and
contract tests cover the new model automatically.

## 5. What it does NOT do

- **No rough coat.** Step 2 (`rough_plastic`, Mitsuba roughplastic) needs the rough
  interface's transmittance t(μ; α, η) and internal reflectance as tables. The house has no
  per-material table storage (derived rows are float/Spectrum scalars
  [code src/components/descriptors.ts:92-101]). It should share the table infrastructure of the
  microfacet energy-compensation plan (Kulla–Conty E(μ, α) tables,
  [code docs/claude-improvements-2026-09.md:230-251]) and get its own plan after that one lands.
- **No coat absorption** (tint, thickness). The exact interfaced form needs the cosine-weighted
  average of exp(−2τ/μ) per channel. In spectral mode that is a nonlinear function of a lifted
  spectrum, which a host-side RGB derived row cannot represent. That needs its own plan.
  OpenPBR's `coat_color` = T² is an approximation [src openpbr_index.html:199-201, 923].
- **No coated conductor** (metallic car paint). Refracting a rough metal lobe through a coat has
  no exact closed form here. pbrt does it stochastically [src bxdfs.h:903-919].
- **No emission, textures, or per-instance coat_ior.** A per-instance input to a derived row is
  already rejected [code src/compiler/analyze/Validator.ts:1223-1230]. Per-instance `albedo` works.
- **No exterior-medium lookup.** coat_ior is relative and does not read `ior_of(region_from)`.

## 6. Risks and open questions

1. **coat_ior is relative.** A plastic object submerged in a medium with an index (water) needs
   its author to write coat_ior = 1.5/1.33. I recommend documenting this (Mitsuba's convention)
   over a runtime ratio, because K would then have to be computed in the shader.
   *Owner: OK?*
2. **Albedo AOV:** the base color, or A(1)? I recommend the `albedo` row (the diffuse color,
   OIDN's recommendation for a diffuse base). *Owner: OK?*
3. **GLSL-expression coat_ior** (a `{kind:'glsl'}` value). The derived fn cannot evaluate it.
   I have not checked what the Validator does today for ggx's `roughness` → `alpha` in the same
   case. That must be read before building, and the answer may be "reject" (one line in the plan).
4. **The delta lobe makes small lights' highlights BSDF-only.** Under pt-nee a quad light's
   mirror image on the coat is found only by chance hits, the same as `mirror` today. The image
   is unbiased but noisy for small lights. Rough coats (step 2) fix this.
5. **Spectral flatness** of the gray lift for the spectral witness value (§4).
6. **Naming:** `plastic` (Mitsuba's name, short) vs `coated_diffuse` (pbrt). I recommend
   `plastic`, since it pairs with a later `rough_plastic` the way `dielectric` pairs with
   `rough_dielectric`. *Owner: OK?*

## 7. Estimate

About 520 lines:
- plastic.glsl ~90
- plastic.ts ~60 (including the quadrature)
- plastic.md ~60
- plastic.test.ts ~200
- registry and README ~6
- witness fixture and entries ~90
- CHANGELOG ~12

No existing line changes except the registry import and line.
