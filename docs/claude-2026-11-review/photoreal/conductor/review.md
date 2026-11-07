# Review: conductor plan (independent)

**Verdict: approve with changes.** The model, the references and the estimator are right. Seven
items must change before the owner sees the plan. Two of them break house rules (exact linkage,
and one answer per fact), and one is a gap in verification: no GPU check can catch a wrong
grazing-angle Fresnel.

Labels: [checked-code], [checked-src], [checked-num] and [reasoning], as in the plan.

## What I checked and found correct

- **Formula.** I re-fetched Mitsuba's `fresnel_conductor`
  (raw.githubusercontent.com/mitsuba-renderer/mitsuba3/master/include/mitsuba/render/fresnel.h,
  about lines 102–127). It matches §2 term for term [checked-src]. I also re-fetched pbrt's
  `FrComplex` and its per-lane `SampledSpectrum` overload (src/pbrt/util/scattering.h, about
  lines 79–97). pbrt clamps cos to [0, 1] and loops over the lanes with no collapse [checked-src].
- **Numbers.** I re-ran `scripts/standins.ts`. It reproduces the 5.7e-14 agreement, the Au
  stand-ins and the angle table [checked-num].
- **Rough lobe.** pbrt's `ConductorBxDF` uses pdf = D_vis/(4|wo·m|) and F = FrComplex(|wo·m|), with
  a smooth branch f = F/|cos|, pdf 1 (refs bxdfs.h:296–327) [checked-src]. That is the plan's
  model.
- **Estimator.** eval, sample and pdf use the same F(|wo·h|), so the §11.3 triple is unchanged
  from ggx. F does not depend on the sampled direction's λ, so per-lane F with no hero collapse
  is correct. F is symmetric, so reciprocity holds. F ≤ 1 per lane [reasoning, standard].
- **Cited code.** The cited lines exist and say what the plan claims:
  - `ggx.ts`, `mirror.glsl`, `microfacet.glsl:33-36`;
  - `math.glsl:87-102` (the dielectric_fresnel precedent);
  - `descriptors.ts:43-52`;
  - `gaussian.ts:24`;
  - `lookup.glsl:40` (the gray bypass), which makes the coefficient lift of a gray value exact,
    since 2g · 0.5 = g;
  - `uniform.glsl:1` and `visible.glsl`, both [360, 830] nm, inside the tables' 298.8–885.6 nm;
  - `propertyValidation.ts:188-191`;
  - `spectra/index.ts:13`, `types.ts:312`;
  - `public/licenses/rgb2spec.txt` exists. [checked-code]
- **Witness names.** These all exist: `mirror`, `veach-mis`, `furnace`, `eta`, `spectral-mirror`,
  `spectral-materials`, `spectral-gaussian-plane`, `expr-const` (a twin gate with meanTol 0.002,
  rmse 0.01), and the `witness:color` script [checked-code `npm run witness -- --list`,
  tests/witnesses/index.ts].
- **The `conductor-perfect` twin.** With η = 0 and κ = 1, F is exactly 1 in float32
  [checked-num float32.out]. Schlick with f0 = 1 is exactly 1. So the twin isolates the
  plumbing, as the plan claims [reasoning].
- **Reference to the house G.** Mitsuba's roughconductor uses the separable
  `smith_g1(wi)·smith_g1(wo)` (refs roughconductor.cpp:481–482) [checked-src]. The house G
  therefore matches Mitsuba and differs only from pbrt, which uses the height-correlated
  1/(1+Λ(wo)+Λ(wi)) [checked-src scattering.h about line 149]. §2 should say this rather than
  call the house G a bare "deviation".

## Must fix

1. **Exact linkage of the `measured` helper block.** The plan generates one block holding all ten
   table functions plus ten `_lanes` wrappers, and links it whenever any `measured` value is used.
   The kind contract's `glsl` is one static block, linked once
   (`spectrumKind.ts`, `glsl?: { origin; source }`) [checked-code]. So a gold-only scene carries
   the Ag, Al, Cu and CuZn tables, which are 18 dead functions and about 1,100 dead floats. The
   house rule says a generated function exists only if something calls it. Choose one of these:
   - make the kind's `glsl` a function of the values in use, which is a small contract change and
     should be named in §3;
   - or state the exception and get the owner's OK.

   A committed static `measured.glsl` checked against `data.ts` by a test does not solve this: the
   house forbids two copies that a test asserts agree.

2. **`rough_conductor.glsl` copies `ggx.glsl` line for line.** That puts the GGX reflection lobe in
   two places: D·G₁G₁/(4cc), the VNDF weight G₁(wi), the pdf and the horizon test. CLAUDE.md says
   "one answer per fact … extract a function both call — don't mirror the logic". The simpler
   design:
   - Add a refactor commit before C2 that moves the F-free lobe into `microfacet.glsl`, for
     example `microfacet_reflect_{eval,sample,pdf}` returning the scalar factor and the
     half-vector cosine.
   - Have `ggx` call it. Prove the commit with a bit-exact `npm run frames` compare on
     `veach-mis`, `rough-furnace` and `mirror`, since the digest is not neutral when shader text
     changes.
   - `ggx.glsl` and `rough_conductor.glsl` then differ only in their Fresnel line.
   - This also removes risk 6: the rough_conductor twin test needs only the Fresnel, plus one
     §11.3 run through the shared lobe.

   If the owner prefers the copy, the plan must say it knowingly breaks this rule.

3. **No GPU check can fail on the angular part of `conductor_fresnel`.**
   - `conductor-gold` tests only c ≈ 1, where F reduces to ((η−1)²+κ²)/((η+1)²+κ²).
   - The `veach-metals` equality gates pass for any consistent F.
   - `conductor-perfect` has F ≡ 1.

   A wrong r_p term, or a wrong s⁴ or c² term, therefore passes every GPU witness. CLAUDE.md
   notes that nothing checks a GLSL file against its twin. Add an off-normal arm: an orthographic
   camera, so every pixel has the same incidence, looking at a smooth Au plane tilted to 70–80°
   under the unit sky. The expected value comes from the twin.
   - Spectral expectation: d65StandIn(F(cos θ; η(λ), κ(λ))). At 70° the angle table gives about
     (0.994, 0.806, 0.436) [checked-num standins.out].
   - RGB expectation: F at the S2 stand-in.
   - At 70° the blue channel moves by 0.09 from normal incidence, so the gate has teeth.

4. **Slider widget for the `optical` role.** The plan swaps `isRadiometric` for `isLaneSpectrum` at
   `materials.ts:214`, which makes η and κ sliders `metaType: 'color'`. `hdr` is set only for
   emission (`f.source === EMISSION_KEY`), so this becomes an LDR color picker
   [checked-code materials.ts:212-217, values.ts:171-173, WidgetFactory.ts:116]. κ for metals runs
   from 2 to 8, so the picker cannot hold it. Leave `:214` on `isRadiometric` (a `float` widget),
   or say which widget an optical slider gets. Simpler still: in this plan, η and κ take
   constants, scalar `{param}` and `measured` only.

5. **The spectral-limitations rule must not name a kind.** §3 C1 says an optical row must hold "a
   number, a scalar `{param}` or a `measured` value". Written that way, `analyze/spectral.ts`
   tests for `measured` by name. `spectrumKinds.test.ts` enforces that nothing outside
   `color/spectra/` does that (CLAUDE.md, "Spectrum values have kinds"). State the rule as "a
   named kind (whose roles admit `optical`, already checked at propertyValidation.ts:105), a
   number, or a scalar `{param}`".

6. **Say plainly that RGB gets worse for gold.**
   - With the S2 stand-in, gold's worst RGB error is 0.047.
   - Today's `ggx` with the correct f0 has a worst error of 0.029 for gold [checked-num
     standins.out, Au rows].
   - S2 wins clearly for Al (0.002 against 0.118), Cu, CuZn and Ag.

   §1 and §6 risk 1 should state this, so the owner decides on S2 knowing the RGB gain depends on
   the metal.

7. **Write `safe_sqrt` into the transcription.** Mitsuba uses `dr::safe_sqrt` for both roots
   [checked-src]. Your float32 numbers assume `max(0, ·)` [checked-code scripts/float32.ts].
   §2 and §3 write a bare √. Without the clamp, rounding when A ≈ −t, for example a dielectric-like
   lane with κ → 0 and grazing incidence, can give a negative argument, and sqrt of it returns
   NaN [reasoning]. Put the `max(0.0, …)` into the GLSL spec.

8. **Documents that state the now-changed invariants.** Add these to the docs list:
   - CLAUDE.md, which says "the spectral model adds only reflectance ≤ 1 and the media
     ceilings". The new optical triple error is a third spectral limitation.
   - The doc comments in `spectrumKind.ts`: `toRGB` gives "a triple for a radiometric role, the
     index … for the index role", and `emit` gives "a Spectrum for radiometric roles". Both need
     the optical role.
   - The spectra README.

## Simplifications (optional)

- With item 2 done, `rough_conductor.test.ts` shrinks to Fresnel tests plus one §11.3 call
  through the shared lobe, and no third copy of the microfacet twin is needed.
- Drop vec3 and expression sliders on optical rows for now, as in item 4. That leaves fewer sites
  to change and nothing to decide about widgets.
- `measured_<id>_lanes`: `emit` can write `Spectrum(f(wl.lambda.x), f(wl.lambda.y), …)` inline
  and drop the ten wrapper functions.
- The alpha `derived` closure would now exist in three descriptors (ggx, rough_dielectric,
  rough_conductor). This is pre-existing, but a third copy is a good moment to export one
  `ggxAlpha` from microfacet's home. If you do it, make it a separate refactor commit.

## Not a problem (checked)

- **`conductor_fresnel` in `math.glsl`.** It is hand-written core included whole, with
  `dielectric_fresnel` as the precedent, so exact linkage does not forbid it. Open question 3 is
  a fair owner choice.
- **Two occupants rather than one.** This matches the mirror/ggx and dielectric/rough_dielectric
  pairs, the compile-time NEE guard, and Mitsuba's two plugins.
- **Rejecting RGB triples for η and κ in spectral programs.** This deviates from both references,
  which lift through an "unbounded" texture (Mitsuba conductor.cpp:232–233,
  `get_unbounded_texture`) [checked-src]. It fits the owner's no-guess rule and is already open
  question 2.
- **Existing images.** No existing model or scene changes. Only the `math.glsl` text grows, so
  nothing changes undeclared.
