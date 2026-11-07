# Review: coated step 1, `plastic` (smooth clear coat over Lambert)

Reviewer: independent agent. Plan read: `.../photoreal/coated/plan.md`. Nothing in the repo
was edited. Probe scripts are in `.../photoreal/coated/review-scripts/`. A fresh copy of
Mitsuba 3 `plastic.cpp` and `fresnel.h` is in `.../photoreal/coated/review-src/`.

**Verdict: approve with changes.** The model is the right first coat. It is a transcription
of a closed form, its eval/sample/pdf are exactly consistent, and it needs no transport or
compiler change. Three items must be fixed in the plan before it goes to the owner. All
three are small.

Labels: [checked-code file:line], [checked-src URL], [checked-num script], [reasoning].

## Must fix

1. **The albedo domain lets the BSDF blow up in RGB programs.**
   - In RGB, the reflectance role is checked only for being nonnegative.
     `roleDomain` returns `{kind:'nonnegative'}` for every role except index
     [checked-code src/compiler/analyze/propertyValidation.ts:188-191]. The limit
     reflectance ≤ 1 exists only in the spectral program [checked-code
     src/compiler/analyze/spectral.ts:8,26; tests/compiler/spectralMaterials.test.ts:39-40].
   - For lambert, R > 1 is only non-physical. For plastic it is singular. The factor
     R/(1 − R·K) has a pole at R = 1/K, which is 1.677 at η = 1.5, and is negative beyond
     it. RGB `albedo: 2` therefore compiles and renders negative radiance [reasoning, from
     the plan's own formula].
   - **Fix:** give plastic's `albedo` row `constraint: { kind: 'closed-interval', min: 0, max: 1 }`.
     This is exactly what `constraint` is for: "a domain the model's mathematics requires"
     [checked-code propertyValidation.ts:38-39]. It also makes A ≤ 1 hold in both color models.
   - Two consequences need a sentence in the plan:
     - The row is then no longer "declared exactly like lambert's". That is harmless:
       `unionFields` dedupes by name and type only [checked-code
       src/compiler/generate/schema.ts:55-68], and validation reads each model's own rows
       [checked-code propertyValidation.ts:55-57].
     - Add an invalid-value case (RGB albedo 1.1 rejected) to the twin/compiler tests.
   - GLSL-expression albedo stays the author's contract, as the house rule says
     [checked-code propertyValidation.ts:12].

2. **Open question 3 has a checked answer, and the plan must decide.**
   - A `{kind:'glsl'}` value on a row that feeds a derived field passes validation:
     `valueProblems` accepts any expression [checked-code propertyValidation.ts:93-95], and
     the only derived-input rule covers per-instance attributes [checked-code
     src/compiler/analyze/Validator.ts:1223-1230].
   - `materialDerivedExpr` then hands the expression object to `fn` [checked-code
     src/compiler/generate/features/materials.ts:340-347, 355-357].
   - Today, ggx with `roughness: {kind:'glsl', …}` makes the compile **throw**
     `GLSL format: cannot format non-finite number: NaN`. That is a raw exception, not a
     diagnostic [checked-num review-scripts/exprDerived.ts, run with vite-node].
     `coat_ior` would behave the same way.
   - **Fix:** state this in §6 and choose. I recommend a separate one-rule Validator commit,
     beside Validator.ts:1223: "a row feeding a derived field takes a constant or a
     {param}". It is one home, it fixes ggx too, and it is not mixed into the plastic commit.

3. **The spectral witness is under-specified, and its flatness evidence is wrong.**
   - "spectral nee key (spectral-mirror's setup)" does not name a scene or region.
     spectral-mirror uses `mirrorScene` (the furnace-sky geometry) with fov 0.2 at distance 4
     and **no region**, so the whole frame [checked-code
     tests/witnesses/scenes/spectralMaterials.ts:41-47; mirrorWitness.ts:15-27].
   - Over that whole frame, the exact mean for gray 0.5 is **0.316313**, not 0.316071. The
     smallest μ in the frame is 0.828 [checked-num review-scripts/imgmean.ts]. The difference
     (2.4e-4) is inside the 0.004 tolerance, but the plan should state the value for the
     region it actually reads. Either use the center region (exact value 0.316071) or quote
     0.31631.
   - The flatness reasoning is invalid evidence. spectral-mirror cannot show that the lift is
     flat, because Schlick is affine in f0: any lift that round-trips to RGB 0.5 reads 0.5.
   - The real answer is checked: **exact grays bypass the lift table**
     [checked-code src/components/color/spectral/README.md:32]. Gray 0.5 is therefore exactly
     flat, and open question 5 is closed. Replace the [reasoning] with this citation.

## Simplicity

- **Drop `plastic-darkening`.** `plastic-chroma`'s green channel is albedo 0.5 with the same
  expected value 0.316071, and `mean` checks are per channel [checked-code
  tests/witnesses/types.ts:50-59]. That leaves one witness entry fewer, with the same
  coverage.
- Everything else is minimal for what it does:
  - one occupant folder;
  - one derived row, the existing ggx `alpha` pattern [checked-code
    src/components/descriptors.ts:84-101];
  - two private helpers, each the single home of a fact.

  I found nothing added for hypothetical needs.
- **The ε in P_spec is not speculative.** coat_ior = 1 with a black albedo gives 0/0. Mitsuba
  guards the same spot [checked-src review-src/plastic.cpp:209-213]. Keep it, and say which
  input it covers.
- **Exact K versus Mitsuba's fit.** The exact quadrature costs about 15 host lines and runs
  per frame only for a slider, at about 20k Fresnel evaluations, which is negligible
  [reasoning]. Keeping it is right under "no guesses".
  - Note that the GPU furnace cannot tell the difference. A 0.1% K error moves the R = 1
    furnace by about 0.0015, inside its 0.008 tolerance [reasoning: (1−K)/(1−K_fit) with
    ΔK ≈ 6e-4].
  - So the twin's identity test (§4.1) is the only gate on K, and the plan should say so.

## Estimator correctness: checked

- **Triple and selection.** I re-ran the scratch twin [checked-num twin.ts]:
  - weight·pdf = f·cos to 4.6e-16;
  - `pdf(sample.wi) == sample.pdf` exactly;
  - reciprocity 4.3e-16;
  - χ² 197.5 and 191.7 on 199 dof;
  - MC albedo matches the closed form for all R and μ.

  One limit: the twin's own §1 identity agrees only to about 1e-7, because it splits plain
  Gauss–Legendre at μ_c. The 1e-16 figure comes from `idlow.ts` (the substitution μ = μ_c +
  (1−μ_c)s²), which I also re-ran. The descriptor `fn` and the test must use the
  `idlow.ts` form, or the 1e-12 tolerance in §4.1 will fail.
- **Mixed delta and non-delta samples.**
  - The transport records delta-ness per sample, not per model [checked-code
    kernel.glsl:32; kernel.ts:47-48].
  - The emitter and environment MIS weights return 1 after a delta sample [checked-code
    src/components/transport/combiner.ts:34,53].
  - NEE runs because `nonDeltaLobes` is true [checked-code light.glsl:10]. It sees only the
    diffuse eval, and `plastic_pdf` = P_diff·cos/π is the correct continuous density of the
    mixture.
  - rough_dielectric is precedent for a delta sample from a non-delta model [checked-code
    rough_dielectric.glsl:100-106].
  - pt, pt-nee and pt-mis converge to the same image [reasoning].
- **Spectral.** `spectrum_average` over the hero wavelengths is used identically in sample
  and pdf [checked-code src/components/color/spectrum.glsl:5-9]. Calling the RGB-versus-
  spectral difference for chromatic R the declared "RGB color" truncation is fair: the model
  is nonlinear in R.
- **No undeclared change to existing images.** The registry is iterated only for models
  present in a scene, or for diagnostic text [checked-code Planner.ts:470; Validator.ts:306,
  1022]. The model type is `string` [checked-code src/compiler/types.ts:427]. The digest
  must show zero difference, and the plan already makes that its gate.
- **Curved spaces.** Every cosine goes through `ambient_dot`, as lambert's do. The world-space
  mirror expression is mirror.glsl's existing one [checked-code mirror.glsl:24-29]. Nothing
  new is Euclidean.

## Reference fidelity (re-fetched)

Mitsuba 3 `master` `src/bsdfs/plastic.cpp`, fetched fresh
[checked-src https://raw.githubusercontent.com/mitsuba-renderer/mitsuba3/master/src/bsdfs/plastic.cpp]:

- **Sampling weight.** `specular_sampling_weight` = mean(spec)/max(mean(diff)+mean(spec), ε),
  with spec = 1. Then prob_spec = F·w/(F·w + (1−F)(1−w)) = F/(F + (1−F)·mean(R)). This
  matches the plan's P_spec.
- **Diffuse sample weight.** `diff/(1 − diff·fdr_int) · inv_eta² · (1−f_i)(1−f_o)/prob_diffuse`
  matches.
- **eval and pdf.** `eval` carries cos/π (Mitsuba's eval includes the cosine), and `pdf` =
  cos/π·prob_diffuse. Both match the plan's bare f and pdf.
- **K.** `m_fdr_int = fresnel_diffuse_reflectance(1/η)`, the Egan–Hilgeman/d'Eon–Irving fit
  [checked-src mitsuba3 include/mitsuba/render/fresnel.h:345-371]. The deviation is as the
  plan describes.
- **OpenPBR.** The closed form E_c = F + E_b(1−F)(1−K)/(1−E_bK), with K = 1 − (1 − E_F)/η_c²,
  is as cited (plan's copy, openpbr_index.html:970-983).
- **pbrt-v4.** `pdfIsProportional` [bxdfs.h:676] and `Lerp(0.9f, 1/(4π), …)` [bxdfs.h:882]
  are as cited. Rejecting pbrt's layered model under the exact-pdf rule is correct.

## Can the verification fail?

- **Yes, for weights.** The R = 1 furnace (A ≡ 1) catches:
  - a wrong K;
  - a missing 1/η²;
  - a wrong outside-Fresnel η convention, because with F(μ, η) used throughout the center
    would read 0.04 + 0.96/η² = 0.467 [reasoning, from the closed form];
  - a delta lobe given a NEE or MIS weight.

  The chroma check catches the linear form (0.232 instead of 0.128 in blue) and errors that
  mix channels.
- **Weak spot: the center region only sees μ ≥ 0.978.** There F(μ, η) ≈ F(μ, 1/η) ≈ 0.04,
  and P_spec ≈ 0.08. Grazing-angle behavior is unchecked on the GPU: P_spec → 1, the ε path,
  the side flip and the clamps.
  - Suggestion: add a **whole-frame** mean = 1.0 check on the furnace render. It is exact,
    because every pixel, sky or sphere, reads 1 when R = 1 [checked-num imgmean.ts: whole-
    frame mean 1 with μ down to 0.017]. It costs one line and no extra render.
- **Blind spot.** A constant sky cannot see the direction of the delta sample, since any
  escaping direction reads 1. A wrong mirror direction would go undetected. The risk is low
  because the expression is copied from mirror.glsl. State the blind spot in §4 rather than
  adding a witness.

## Smaller notes

- **§6.1, coat_ior relative to the outside.** A plastic object in water with coat_ior = 1.5
  renders silently wrong. That fits Mitsuba's convention, but it sits awkwardly with the
  owner's "no guesses" rule. Ask the owner whether a short note in the occupant README is
  enough. A Validator check would need the object's outside region at compile time, which
  is not cheap.
- **Twin variable names.** In `twin.ts`, `evalF` names F(wo) `Fi` and F(wi) `Fo`. The product
  is symmetric, so the result is right, but the real test should use correct names.
- **Estimate.** About 520 lines is plausible. With `plastic-darkening` dropped and the albedo
  constraint added, it comes to about 500.
