# Plan: measured metals (`conductor` + `rough_conductor`)

Status: draft for owner review. Nothing in the repo is edited. Scratch evidence lives beside
this file: `refs/` (downloaded pbrt-v4 and Mitsuba 3 sources), `scripts/standins.ts` with
`standins.out`, and `scripts/float32.ts` with `float32.out`.

Labels: [checked-code file:line] means I read it in this repo; [checked-src URL/file:line] means
I read it in the downloaded reference source; [checked-num script] means I measured it with a
scratch script; [reasoning] means I did not check it.

## 1. The problem

- Both metals today use Schlick's Fresnel with an RGB `f0`. See `ggx.ts:13` (the `f0` row),
  `ggx.glsl:22,41` and `mirror.glsl:7-10`, whose comment calls Schlick a "DELIBERATE deviation
  from pbrt" until "spectral η/k data" exist. [checked-code]
- Schlick cannot produce the color shift and the dip that real metals show near grazing angles.
  The worst case is aluminium: Schlick with the correct normal-incidence color is off by
  **0.118** at 85° (red), against the exact Fresnel term with measured η, κ projected to RGB.
  Silver is off by 0.015, copper by 0.039, gold by 0.029 and brass by 0.048. [checked-num
  standins.ts]
- Spectral programs lift an RGB `f0` to a smooth spectrum. A measured metal spectrum is never
  used, so gold and copper in spectral renders are only as right as an RGB guess. [checked-code
  rgb.ts:27-30, lookup.glsl:48-50]
- There is no way to give a material a spectrum per wavelength lane that is not radiometric.
  Role `index` is a float, and a dispersive index is hero-collapsed (`color.ts:55-59`,
  `values.ts:143`). Every other role is reflectance, coefficient or emission
  (`descriptors.ts:44-52`). This is survey finding MLC-8. [checked-code]

## 2. The model

A metal has a complex refractive index η(λ) + iκ(λ) relative to the outside medium. The
unpolarized Fresnel reflectance at incidence cosine c = cos θᵢ ∈ [0, 1] is

  F(c; η, κ) = ½ (r_s + r_p),
  with s² = 1 − c², t = η² − κ² − s², A = √(t² + 4η²κ²), a = √(½(A + t)),
  r_s = (A + c² − 2ca) / (A + c² + 2ca),
  r_p = r_s · (A c² + s⁴ − 2ca s²) / (A c² + s⁴ + 2ca s²).

This is Mitsuba 3's `fresnel_conductor` [checked-src mi3 include/mitsuba/render/fresnel.h:103-127].
It equals pbrt-v4's complex form `FrComplex`, (|r∥|² + |r⊥|²)/2 with complex cos θₜ
[checked-src pbrt src/pbrt/util/scattering.h:81-100]. In double precision the two agree to
5.7e-14 over five metals, 360–830 nm and c ∈ [0, 1] [checked-num standins.ts]. At c = 1,
F = ((η−1)² + κ²)/((η+1)² + κ²). With η = 0 and any κ > 0, F ≡ 1, a perfect mirror.

- **Smooth (`conductor`)**: a delta reflection with weight F(cos θᵢ). This matches pbrt's
  `ConductorBxDF::Sample_f` smooth branch [checked-src pbrt bxdfs.h, class ConductorBxDF]
  and Mitsuba's `conductor` [checked-src mi3 src/bsdfs/conductor.cpp:268-303].
- **Rough (`rough_conductor`)**: GGX with VNDF sampling, f = D·F·G / (4 cos θᵢ cos θₒ), with
  F = F(|wₒ·h|). This is the existing `ggx` model with Schlick replaced by F. pbrt differs in
  one place: it uses the height-correlated G, while this repo uses the separable G₁G₁ from
  `microfacet.glsl`. I keep the house G so that `ggx` and `rough_conductor` differ only in F,
  and record this as a deviation. [checked-code microfacet.glsl:33-36]
- **Wavelengths**: reflection does not depend on λ for its direction, so each lane gets its own
  F and there is **no hero collapse**. pbrt also evaluates `FrComplex` per lane with no
  `TerminateSecondary` for conductors [checked-src pbrt materials.h ConductorMaterial::GetBxDF].
- **Measured data**: pbrt-v4's tables `metal-{Ag,Al,Au,Cu,CuZn}-{eta,k}`, piecewise-linear in λ
  [checked-src pbrt spectrum.cpp:1124-1297, 2632-2679]. They cover 298.8–885.6 nm (CuZn:
  290–890 nm), which contains this repo's 360–830 nm [checked-code uniform.glsl:1]. The file is
  Apache-2.0, "Copyright(c) 1998-2020 Matt Pharr, Wenzel Jakob, and Greg Humphreys"
  [checked-src spectrum.cpp:1-3]. The metal arrays carry no separate source note; the CC0 note
  at :1348 covers only the glasses. MgO and TiO₂ are left out: their κ is 0 (they are
  dielectrics) and MgO stops at 768 nm [checked-src :1298-1346].
- **Outside medium**: η and κ are taken as given, relative to the outside medium, as in both
  references (pbrt uses `eta` as passed; Mitsuba `conductor.cpp:268-269`). A metal under water
  is not corrected for the water's index. [checked-src]
- **Defaults**: Mitsuba's η = 0, κ = 1 (`conductor.cpp:232-233`), which is a perfect mirror.
  [checked-src]

## 3. The change and its boundaries

Four commits, each reviewable alone.

**C0: extract the D65 stand-in projection (refactor, no output change).** `gaussianStandIn`
(gaussian.ts:24) becomes `d65StandIn(g: (λ) => number): Vec3` in
`src/components/color/spectra/standIn.ts`, keeping the same arithmetic order. Gaussian then
calls it. The digest must be unchanged.

**C1: the `optical` role and the `measured` spectrum kind.**
- `descriptors.ts`: `SpectrumRole` gains `'optical'`, a dimensionless real optical constant
  (η or κ) evaluated per wavelength lane, never collapsed. `isRadiometric` must exclude it.
  A new `isLaneSpectrum(role)` returns true for radiometric roles and for `optical`; it replaces
  `isRadiometric` at the material-row sites that mean "a per-lane Spectrum": `Planner.ts:1024`
  (the census of kinds evaluated at wavelengths), `schema.ts:47` (defaults) and
  `materials.ts:214,400` (slider type and the lookup). The domain is the role's
  default, nonnegative (`propertyValidation.ts:188-191`, unchanged).
- How it converts: an `optical` value lifts like a coefficient (`color.ts`, `spectrumContext`
  maps `optical` to `color_lift_coefficient`). That lift is the identity in RGB, and it is
  exact for a gray value in spectral programs (lookup.glsl:40, the gray bypass) [checked-code].
  No GLSL file gains a lift.
- `analyze/spectral.ts` (`spectralLimitations`): in a spectral program, an `optical` material
  row must hold a number, a scalar `{param}` or a `measured` value. A triple, a vec3 slider, an
  expression or an attribute is an error ("RGB-only; use a measured spectrum or a number").
  RGB programs accept every binding as typed.
- New kind `src/components/color/spectra/measured/`, files `measured.ts`, `data.ts`, `README.md`:
  - Spelling `{ measured: 'metal-Au-eta' }`. Roles `['optical']`. No live parameters.
    `validate` rejects unknown names and lists the known ones. `dispersive`,
    `constantNonzero` and `mayBeNonzero` are false.
  - `data.ts` copies the ten pbrt arrays verbatim with their notice. The license is shipped as
    `public/licenses/pbrt-v4.txt`, as was done for `rgb2spec.txt`.
  - `glsl`: one helper block generated from `data.ts`, so the numbers have one source. Each
    table is a function `float measured_<id>(float λ)` holding its knots as function-local
    const arrays. It finds the interval by binary search (6 steps for 56 or 61 knots) and
    interpolates linearly, which is exactly pbrt's `PiecewiseLinearSpectrum`. A wrapper
    `Spectrum measured_<id>_lanes(Wavelengths wl)` loops over lanes. `emit` returns
    `measured_<id>_lanes(wl)`.
  - `toRGB`: `d65StandIn(λ ↦ table(λ))` for η and κ separately (stand-in S2 in §6).
  - Registered in `spectra/index.ts:13` (`NAMED_KINDS`), and `MeasuredValue` is added to
    `NamedSpectrumValue` (types.ts:312).

**C2: the occupants.**
- `glsl/core/math.glsl`: `Spectrum conductor_fresnel(float cos_i, Spectrum eta, Spectrum k)`,
  a transcription of the formula in §2 with componentwise Spectrum arithmetic (vec3 in RGB,
  vec4 in spectral, no loop), placed beside `schlick_fresnel` and `dielectric_fresnel`.
  `dielectric_fresnel` set the precedent for a Fresnel form shared by a delta model and a
  rough model (math.glsl:88-95) [checked-code]. This puts one uncalled function into every
  program's text, which is open question 3.
- `components/materials/conductor/`: `conductor.glsl` has the same structure as `mirror.glsl`,
  with `F = conductor_fresnel(cos_i, mp.eta, mp.k)` and
  `conductor_albedo(hit, mp) = conductor_fresnel(1.0, mp.eta, mp.k)`. `conductor.ts` declares
  the rows
  `{ name:'eta', glslType:'Spectrum', role:'optical', source:'eta', default:0, storage:'field' }`
  and
  `{ name:'k', glslType:'Spectrum', role:'optical', source:'k', default:1, storage:'field', constraint:{kind:'positive'} }`,
  with `albedo: { fn: 'conductor_albedo' }`, `nonDeltaLobes: false`, `transmission: false`,
  `support: 'hemisphere'` and `emissive: false`. `conductor.md` holds the math note.
- `components/materials/rough_conductor/`: `rough_conductor.glsl` copies `ggx.glsl`'s three
  functions line for line, with Schlick replaced by `conductor_fresnel(abs(dot(wol,h)), mp.eta,
  mp.k)`. `rough_conductor.ts` has rows `eta` and `k` (shared with `conductor` by name and type)
  plus `roughness` and the derived `alpha` (shared with `ggx`), `usesMicrofacet: true`,
  `nonDeltaLobes: true` and the albedo function `rough_conductor_albedo`. With all four metal
  models present, `MaterialProperties` gains only `eta` and `k`.
- Two lines in `materials/index.ts`. The materials README lists the occupants and the new role.
- `fable-reference-implementations.md` gets a §7c, conductor Fresnel, written first in keeping
  with the house rule.
- Curved spaces: the rough model works in local frame coordinates (`microfacet_to_local`, which
  uses `ambient_dot`). The delta model reflects as `mirror` does, so it adds no new Euclidean
  assumption.

**C3: witnesses and documentation.** The fixtures are in §4. A CHANGELOG entry follows.

Unchanged: `mirror`, `ggx`, the `f0` row, `schlick_fresnel`, and every existing scene's material.
Their images must be identical.

## 4. Verification, written first

**TS twin tests** (`rough_conductor/rough_conductor.test.ts`, plus `measured.test.ts`):
1. **Transcription**: the twin of `conductor_fresnel` (Mitsuba's real form) matches an
   independent pbrt complex `FrComplex` to < 1e-12 (f64) over 5 metals × 360..830 nm ×
   c ∈ [0, 1]. The measured gap is 5.7e-14 [checked-num]. A float32-emulated form stays within
   4e-6 of f64. Measured: ≤ 1.1e-6 for the metals and 3.3e-6 for η = 0.05, κ = 8. The complex
   form in float32 is worse (up to 9.1e-5), which is why I transcribe Mitsuba's form
   [checked-num float32.ts].
2. **Limits**:
   - At c = 1 the closed form holds.
   - At c = 0, F = 1.
   - With η = 0 and κ > 0, F is exactly 1 in emulated float32 [checked-num].
   - As κ → 0 with η > 1, F matches the twin of `dielectric_fresnel` with argument 1/η.
   - 0 ≤ F ≤ 1 over the whole domain.
3. **The §11.3 triple for `rough_conductor`**: the χ² histogram, weight·pdf = eval·|cos θᵢ| and
   sample.pdf = pdf, using the harness and configuration grid of `ggx.test.ts` with F set to
   Au, Al and (η = 0, κ = 1). This includes "eval covers the sampler support".
4. **Measured kind**:
   - The binary-search interpolation in the twin equals the reference `plin` at every knot and
     at midpoints.
   - All ten stand-ins are positive.
   - The Au stand-in is η = (0.080, 0.405, 1.561), κ = (3.390, 2.504, 1.771) [checked-num].
   - Its GLSL helper compiles under glslang.
   - `spectrumKinds.test.ts` gets an example value.
   - `spectrumDiagnostics.test.ts` gains snapshot cases for a triple η in a spectral program,
     for `measured` in a reflectance slot, and for an unknown table name.
5. Contract tests run as they are (descriptor and registry contracts, purity). The glslang
   compile covers the new fixtures under RGB and the RG canary.

**New witnesses** (`tests/witnesses/scenes/conductorWitness.ts` plus registry entries):
- **`conductor-gold`** (exact). A smooth Au plane faces a pinhole camera with fov 0.1 under a
  unit white sky (D65 in spectral), with one bounce, the layout of `spectral-gaussian-plane`.
  The incidence is under about 4°, where F moves by less than 1e-5 [reasoning from the angle
  table: < 1.5e-3 even at 30°]. Arms and expected values:
  - spectral, no NEE, and spectral MIS: `d65StandIn(λ ↦ F(1; η_Au, κ_Au))` =
    **(1.0218, 0.7823, 0.3435)** [checked-num]. Red is above 1 because gold lies outside the
    sRGB gamut. This also checks that the spectral path does not clamp.
  - RGB MIS: F(1; η_c, κ_c) from the stand-in = **(0.9747, 0.8034, 0.3560)** [checked-num].
  - Tolerance 0.006 at 256 spp, as in the Gaussian witness.
- **`conductor-perfect`** (a twin of **`conductor-perfect-ref`**). The `veach-mis` geometry,
  plus one sphere. The test scene uses `rough_conductor` and `conductor` with η = 0, κ = 1. The
  reference uses `ggx` and `mirror` with f0 = 1, where Schlick is exactly 1. The two use the
  same random numbers, so the gate is `twin` with meanTol 0.002 and rmse 0.01, as in
  `expr-const`. This checks sample, eval, pdf, MIS and the NEE guard of both new models
  against two witnessed ones.
- **`veach-metals`**. The `veach-mis` plates as `rough_conductor` Au, Cu, Al and Ag. RGB arms
  pt-mis, pt-nee and pt; spectral arms nee and mis. Gates: `equality` [mis, nee] with χ² in
  each color model, and [mis, pt] with rmse, copied from the `veach-mis` entry.

**Existing witnesses to rerun** (targeted, never the sweep): `mirror`, `veach-mis`, `furnace`,
`eta`, `spectral-mirror`, `spectral-materials`, `spectral-gaussian-plane` (C0), plus
`npm run witness:color`. A digest before and after each commit:
- C0 must show **no** difference.
- C1 must show none either, since no existing scene has an `optical` row.
- C2 must show only the added `conductor_fresnel` lines and the source-map line shifts they
  cause.

## 5. What it does not do

- It changes no existing model. `mirror` and `ggx` keep Schlick and `f0`, and no scene is
  migrated.
- No energy compensation (Kulla–Conty). Rough metals stay single-scattering and too dark at
  high roughness, as `ggx` is. That is a separate plan.
- No OpenPBR F82-tint artist parameters, and no pbrt `reflectance` → (η = 1, κ) path. `ggx`
  with `f0` remains the artist route. The pbrt mapping matches normal incidence but is off by
  up to 0.09 at grazing angles [checked-num, S4 in standins.out].
- RGB-authored η or κ triples are not lifted in spectral programs; they are an error.
- No correction for the outside medium's index, no anisotropy, no thin films and no
  polarization.
- No per-instance (attribute) or expression η and κ in spectral programs.
- No authoring sugar such as `metal('Au')`. Scenes spell out both `measured` values.
- No showcase or demo scene. Composing one belongs to the photorealism scene work.

## 6. Risks and open questions

1. **The RGB stand-in.** RGB programs need one (η_c, κ_c) per channel. I measured four
   choices against the truth, which is F(θ, η(λ), κ(λ)) projected with D65 into linear sRGB,
   for 0–89° [checked-num standins.ts]:
   - S1, Mitsuba's `spectrum_list_to_srgb` (equal-energy, not white-preserving): worst
     0.055 (Au), 0.045 (CuZn).
   - **S2, D65-normalized projection of η and κ separately** (the Gaussian rule): worst 0.047
     (Au red at 0°, where the truth is 1.022 and so out of gamut). The others are Cu 0.017,
     CuZn 0.018, Al 0.002 and Ag 0.001.
   - S5, D65 η with κ solved to match R(0) exactly (Gulbrandsen's relation): worst 0.011.
     It gives NaN for gold's red, where R(0) > 1. It also couples the η and κ values, which
     breaks the rule that a kind answers only about its own value.
   - Schlick with the correct R(0), which is today's `ggx`: worst 0.03–0.12.

   I recommend S2. It is the simplest rule that fits the contract, has no special cases, and
   is the existing Gaussian rule. **Owner: is S2 acceptable, given that RGB is already a
   declared truncation?**
2. **Spectral programs and RGB η/κ triples**: an error, as recommended, or lifted with the
   coefficient lift? The coefficient lift would give a smooth spectrum through the triple,
   which is a guess about the spectrum between the channels.
3. **`conductor_fresnel` in `math.glsl`** (the precedent) changes every program's shader text
   by one uncalled function. Rendering is unchanged. The alternative is a gated core file
   behind a second `uses…` descriptor flag; the survey already calls `usesMicrofacet` a
   single-purpose gate. I recommend `math.glsl`. **Owner's choice.**
4. **Two occupants, not one.** pbrt switches between delta and glossy per hit
   (`EffectivelySmooth`, scattering.h:137). Here the NEE guard is a compile-time model fact,
   and the existing pairs mirror/ggx and dielectric/rough_dielectric follow that. Mitsuba also
   has two plugins, `conductor` and `roughconductor`. I recommend keeping the pair.
5. **Const-array cost**: indexing function-local const arrays dynamically (2 tables × 4 lanes ×
   6 steps per hit) may be slow on some drivers. This is untested and gets measured on the
   test browser. It affects only spectral programs that use `measured`. [reasoning]
6. **A third copy of the microfacet twin** in `rough_conductor.test.ts`. That follows the
   precedent of `rough_dielectric.test.ts`, which has its own copy. A shared test helper would
   be a separate refactor.
7. The role name `optical` is open to a better one.

## 7. Estimate

- Code: about 330 lines.
  - GLSL: about 25 (math) + 35 (conductor) + 60 (rough_conductor).
  - TypeScript: about 70 (descriptors) + 90 (measured kind and generator) + 40 (compiler sites)
    + 15 (stand-in extraction).
- Data: about 200 lines of verbatim pbrt arrays, plus the vendored Apache license text.
- Tests: about 400 lines (twin and harness about 250, kind about 80, fixtures and registry
  about 170).
- Documentation: about 150 lines (three READMEs and math notes, §7c, CHANGELOG).
