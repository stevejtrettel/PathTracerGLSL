# Spectral rendering: how it works, and a code review (Sep 28, 2026)

Scope: the spectral work through commit 5dbf4e3 (the color family, spectrum kinds, the compiler's
spectral plumbing, transport, lights, media, tests and docs). Four independent reviewers, each
given one area and none given my reasoning, read the code. I then checked their main findings
myself. Every finding below says how it was checked: **run** (a scratch compile or probe),
**read** (the code path read end to end), or **reviewer** (reported by a reviewer, not
re-checked by me). No repo code was changed.

Part 1 describes the system. Part 2 is the review.

**Later commit.** After the review, f720e64 added a `gaussian` reflectance kind and replaced the
"a named kind" uses of `BlackbodyValue` with a `NamedSpectrumValue` union. The cast in B2
(plan/values.ts) now reads `as NamedSpectrumValue`. The findings otherwise stand as written.

**Bug-fix status.** A1, A2, A4, A5 and A6 are fixed (docs/claude-spectral-bugfix-plan.md). A3
is fixed differently from what §A suggests: under the light tree the sky now gets a fixed half
of the light samples, as in pbrt-v4 (docs/claude-lamp-power-plan.md). See the CHANGELOG
entries.

---

## Part 1. How it works

### What a spectrum is here

A spectrum is a real function of wavelength on [360, 830] nm. A path carries four wavelengths,
so on the GPU a `Spectrum` is a `vec4`: the function's values at those four wavelengths. (In RGB
mode `Spectrum` is a `vec3` and everything below that converts RGB to spectra is the identity.)

Every place that holds a spectrum is a **slot**, and the slot has a **role**:

- **reflectance**: a multiplier in [0, 1] (albedo, checker colors, conductor f0, glass
  transmittance);
- **coefficient**: a nonnegative multiplier per unit length (σ_a, σ_s);
- **emission**: light itself (radiance for area emitters, intensity for point-like lights,
  irradiance for directional ones);
- **index**: a refractive index n(λ).

The multiplier roles act diagonally: throughput `*=` a `vec4` is exactly pointwise
multiplication at the four wavelengths. Emission is the only role treated as light.

The value in a slot has a **kind**, which says how it was written:

- **rgb**: a number, an RGB triple, a `{param}` slider, a GLSL expression, or a per-instance
  attribute;
- **blackbody** `{ kelvin, scale }`: emission only;
- **Cauchy** and **Sellmeier** coefficients: index only.

An authored RGB triple becomes a smooth spectrum through the Jakob–Hanika model:
ρ(λ) = ½ + ½·p/√(1+p²), with p a quadratic in λ whose coefficients come from a table lookup
(lookup.glsl). The role decides how the triple is turned into a spectrum:

- **Reflectance** uses ρ directly, so it stays in [0, 1].
- **Coefficient** scales: 2·max(rgb)·ρ(rgb / (2·max)).
- **Emission** is the coefficient spectrum times the D65 illuminant, so "RGB white light" means D65.

Blackbody is Planck's law evaluated directly at the four wavelengths, normalized to unit CIE Y
and multiplied by `scale`. Cauchy and Sellmeier evaluate n(λ) from their formulas.

### Materials

Each material model declares a row per property, with its role. Two examples:

- **Lambert**: `albedo` (reflectance) and `emission` (emission).
- **Dielectric**: `transmittance` (reflectance) and `ior` (index, stored per region).

The material stores the *authored* value: an RGB literal, a slider uniform, an RGB expression,
an attribute texel, or a blackbody's numbers. The conversion to a spectrum happens in the
shader, at every hit.

The generated `scene_material_properties(mat, p, uv, element, wl)` fills a `MaterialProperties`
struct. Each spectral field in it is a `vec4` evaluated at the hit's four wavelengths:

- an expression computes its RGB at `p` and `uv` first, then converts;
- an attribute fetches RGB from the data texture, then converts.

A nondispersive index is a plain float. A dispersive one is evaluated at wavelength lane 0; see
the hero collapse below.

### Lights and the sky

**Lights.** There are nine light kinds. Each has geometry rows and one emission row. The
generator writes `light_get_<id>(wl)`, which builds the light's struct with its emission
evaluated at `wl`.

Emissive objects (a Lambert with emission, a mesh light) become lights built from the same
value. That is why next-event estimation and a BSDF ray hitting the emitter see the same
spectrum.

Under the light tree, lights are rows in a data texture:
- the geometry floats;
- the emission's RGB projection;
- for blackbody only, a header holding (kelvin, scale × normalization), so the shader can
  evaluate Planck from the row.

Light-selection probabilities (power, tree importance) use an RGB number. That affects
variance only; it is not a bias.

**Media.** A medium has:
- σ_a and σ_s (coefficient);
- emission;
- phase parameters;
- a GRIN index, which must not depend on wavelength.

The medium is computed in RGB, including the density-ceiling clamp for expression media, and
then converted.

**Sky.** There are three kinds:
- A constant sky is any emission value × intensity.
- An image sky is filtered RGB × intensity, then converted.
- A procedural sky is an RGB formula, then converted.

Their sampling tables use luminance.

### Tracing a path

For each pixel sample:

1. **Wavelengths.** The accumulator draws one uniform number u and sets
   λᵢ = F⁻¹(frac(u + i/4)) for i = 0..3. F is the CDF of either the "visible" density
   (sech², peaked near 538 nm) or the uniform one. Each lane keeps its own density p(λᵢ).
2. **The ray carries the wavelengths.** They sit on `Ray.wl`, and every `Hit` copies them.
3. **The walk.** The walk is the usual pbrt-style loop, generated per scene. It intersects the
   scene; inside a medium it samples the segment (absorption, scattering, emission). At a
   surface it:
   - evaluates the material at the four wavelengths;
   - scores any emission it found, with its MIS weight;
   - does next-event estimation;
   - samples the BSDF;
   - applies Russian roulette on the largest lane.

   Throughput and radiance are `vec4`s. There are four estimates, one per wavelength, sharing
   one geometric path.
4. **Hero collapse.** At the first surface that refracts through a dispersive glass, the path
   keeps lane 0 multiplied by 4 and zeroes the other three. This happens once per path, after
   that surface's emission is scored and before NEE. From then on the path follows lane 0's
   wavelength. Radiance scored before the collapse keeps all four lanes.
5. **Film.** `color_to_pixel` returns ¼ Σᵢ S(λᵢ)·Lᵢ / p(λᵢ), where S is the CIE 1931 response
   mapped to linear sRGB. Film RGB may be negative; it is averaged signed, and tonemapping
   comes later.

**Is it right?** Each lane's weights have the form f(λᵢ)/q, where q is either lane-independent or
symmetric in the lanes. So each lane estimates L(λᵢ), and the film estimate is unbiased for
∫ S·L dλ.

The collapse is also unbiased. The part of the path before the collapse is symmetric under a
cyclic relabeling of the lanes. Therefore E[S₀T₀B⁽⁰⁾/p₀] equals the average over the four lanes,
and weighting lane 0 by 4 is exact. (Here T₀ is lane 0's throughput at the collapse and B⁽⁰⁾ the
rest of the path sampled at λ₀.)

It is also a little better than pbrt's `TerminateSecondary`, because it keeps the four-lane
radiance already scored. The collapse cannot happen twice (a flag guards it). The shadow rays
after it and the MIS pdfs all read lane 0. [reviewer derived; I checked the derivation and the
generated walk]

---

## Part 2. Review

### Summary

The math is correct and the switch between RGB and spectral mode is small. Only about ten lines
branch on it: the kinds, two lines in the Planner and one in the Validator. There are no `#ifdef`s.

The system is less uniform than the model it states, in four ways:

1. **Half the paths bypass the kinds.** Kinds reach the GPU only for material rows, light rows
   and the constant sky. Everything else calls the RGB lift directly.
2. **The role does not travel with the value.** Readers infer it from the kind.
3. **Wavelength-lane facts live outside the color model.** "Four lanes, the hero is lane 0" is
   spelled in transport and in the index kinds.
4. **Validation happens in four places, and they disagree.**

There are also a few real bugs. Only one can spoil an image, and it is a rare NaN in Russian
roulette that predates spectral.

### A. Bugs

**A1. Surface Russian roulette can divide 0 by 0, which leaves a pixel NaN for good.**
[read, generated code and RNG]

- **Where:** pt.ts:207–209 compute `p_survive = min(RR_MAX_SURVIVAL, spectrum_max(throughput))`,
  test `random() > p_survive`, then divide by `p_survive`. The interior rule guards this case
  (pt.ts:263, `if (p_survive <= 0.0) return false;`); the surface rule does not.
- **How it happens:**
  - A path absorbed by delta tracking returns `ms.weight = SPECTRUM_ZERO` with
    `scattered = false` (delta_tracking.glsl, the absorption arm).
  - The walk multiplies it in and carries on to the next surface.
  - `random()` is `float(u32 >> 8) / 2²⁴`, so it returns exactly 0 with probability 2⁻²⁴.
  - When both happen, 0/0 = NaN. The next emission term adds NaN to the radiance, and the
    pixel's running mean stays NaN.
  - The hero collapse adds another route to zero throughput: lane 0 may already be 0.
- **Scope:** rare per sample, but a long render draws billions of samples. It is a transport
  bug, not specific to spectral.
- **Fix:** guard it as the interior rule does, or end the path when throughput is black. The
  second option also stops dead paths walking to `maxBounces` when roulette is off.

**A2. Blackbody validation has its own weaker checker, and malformed values crash it.**
[run, my probe in both color models]

- **Where:** blackbody.ts:92–103 (`checkDial`), which reimplements the slider checks of
  `validatePropertyValue`.
- **What I ran:**
  - `kelvin: { param: 5, default: 3000 }` gives no validator error, then the compile throws
    `path.replace is not a function`. The same mistake on an albedo is reported properly.
  - `emission: { blackbody: null }` makes the validator throw a `TypeError`, against the rule
    that validation reports and never throws.
  - `environment.color: { blackbody: undefined }` makes validation throw.
  - `{ blackbody: { kelvin: 3000, scael: 5 } }` compiles silently with scale 1.
- **Fix:** give `validate` access to the shared scalar checker instead of a second copy, and
  check the object's shape and keys.

**A3. The sky-versus-lights split ignores instanced lights.** [read; reviewer measured]

- **Where:** lighting.ts:508 sums power over `plan.lights` only, while Planner.ts:683 turns the
  split on for instanced emitters too.
- **Effect:** in `spectral-packed` the sky gets 0.405 of the light samples, against 0.220 for
  the same emitters written as ordinary spheres. With three bright instanced lamps and a dim
  sky it hits the 0.99 clamp. Sampler and pdf read the same number, so this costs variance only.
- **Also:** not spectral-specific.

**A4. The reflectance lift overflows for a tiny largest channel.** [arithmetic checked; not run
on a GPU]

- **Where:** lookup.glsl:18, `xy = … * (63.0 / z)`.
- **Effect:** for 0 < z below about 1.9·10⁻³⁷, `63/z` is +Inf in float32. A zero other channel
  then gives NaN, and `ivec2(NaN)` is undefined.
- **Reach:** only the reflectance role sees raw z (the other roles divide by 2·max first). A
  dark expression albedo could land there.
- **Fix:** compute `63.0 * (other / z)`, or treat a tiny z as black.

**A5. The kelvin slider's default range can exclude its own default.** [read]
- **Where:** blackbody.ts:147, `range: [min ?? 1000, max ?? 12000]`.
- **Effect:** a valid default of 20000 K gets a slider that ends at 12000.

**A6. The per-instance attribute check ignores the row's own constraint.** [reviewer, run]
- **Where:** Validator.ts:1200 uses `roleDomain(role)` only.
- **Effect:** a per-instance checker `uv_scale: [-1, 0]` passes, while the same value on the
  material is rejected.

### B. Design: where it is not yet "one type, read by the slot"

**B1. Two routes to the GPU.** [read]

- **The kind route:** `emitSpectrum` → `kind.emit` is used for material rows, light accessors
  and the constant sky.
- **The direct route:** nine sites call the RGB lift `emitColor` themselves:
  - medium σ_a, σ_s and emission (materials.ts:590–593, :602);
  - per-instance colors (materials.ts:392, lighting.ts:691);
  - image and procedural skies (environment.ts:158, :211);
  - light-table rows (lighting.ts:741);
  - schema defaults (schema.ts:46);
  - material fields derived from other rows (materials.ts:343).
- **What that costs:**
  - **Media accept no named kind.** A blackbody flame or glowing gas is rejected
    (propertyValidation.ts, `mediumSlots`), and Planner.ts:943 throws if one arrives. The reason
    is structural: the medium clamp runs on RGB before the lift. A constant spectrum could
    still be scaled by the clamp factor after its lift.
  - **The rgb kind is said to cover per-instance attributes** (CLAUDE.md, spectra README), but
    its `emit` would throw on one (generate/values.ts:52). Attributes take the direct route.
  - **Light-table rows fall back to the RGB payload unless a kind opts in with `packed`**
    (lighting.ts:741–746). Only blackbody does. A future emission kind that forgets it would be
    sampled as its RGB stand-in under the tree while BSDF hits see the true curve. pt and
    pt-nee would then converge to different images. Nothing checks this, and the header code
    (`code: 1`) has no uniqueness check.
- **Direction:** route every radiometric slot through its kind. Media apply the clamp scale
  after the lift. Attributes become an rgb-kind binding. Every emission kind declares its row
  encoding, with rgb as code 0 reading the payload.

**B2. The role is inferred from the kind, not taken from the slot.** [read; reviewer ran the
break]

- **The five sites:**
  - `roles.includes('index')` at plan/values.ts:13, Planner.ts:924 and Planner.ts:1016;
  - `roles.includes('emission')` at lighting.ts:100 and :342.
- **Why they work today:** every named kind has exactly one role.
- **Why that changes:** the spec (§1) says the next kind, measured curves, can go in any slot.
  A reviewer gave blackbody a second role at run time; valid emission and sky scenes then
  failed with "Spectral index reached a non-index property".
- **Nearby problems:**
  - plan/values.ts:23 casts any named kind to `BlackbodyValue`.
  - The row schema splits the role across `semantic` + `role`, and it is converted back to a
    role in four places.
- **Direction:** one `role` field per row, carried with the resolved value to every reader.

**B3. Every kind handles RGB mode itself.** [read, untruncated searches]

- **The branches:** each kind branches on `ctx.spectral` (blackbody.ts:122, 133, 136;
  cauchy.ts:39; sellmeier.ts:53).
- **`toRGB`** has exactly one caller (color/values.ts:31), which always passes `'emission'`.
  The Cauchy and Sellmeier `toRGB` are never called; their `emit` recomputes the same d-line
  number. `rgb.toRGB` returns a triple for the index role, against the contract.
- **`EmitContext.factor`** exists for one caller (the constant sky's intensity), and the kinds
  apply it differently.
- **The emit/linking pair:** "which kinds this program evaluates at wavelengths" is decided in
  the Planner (Planner.ts:1007–1038) and again inside each `emit`.
- **Direction:** in an RGB program a named kind *is* its RGB stand-in (a literal, or a derived
  uniform when live), so `emit` only ever evaluates at wavelengths.

**B4. The color model does not own its lane layout.** [read]

- **Where the facts live:**
  - pt.ts:447 emits `throughput *= vec4(4.0, 0.0, 0.0, 0.0)`;
  - cauchy.ts:41 and sellmeier.ts:55 emit `wl.lambda.x`;
  - spectral.glsl hard-codes `0.25`.
- **The sensor seam has two signatures:** `sensor_response(film, dir)` in ideal.glsl:2 and
  `sensor_response(lambda, film, dir)` in cie1931.glsl:3. Each color model also has its own
  `color_to_pixel`.
- **Direction:** the color model supplies the hero wavelength and the collapse. One
  `color_to_pixel` treats RGB as the three-point case (response eᵢ, pdf 1).

**B5. Validation in four places.** [read, plus A2 and A6]

- **The four:**
  - `validatePropertyValue` (role domains);
  - analyze/spectral.ts (reflectance ≤ 1, media ceilings, its own reading of slider bounds);
  - blackbody's `checkDial`;
  - the attribute loop.
- **Where they disagree:** A2 and A6 are the result.
- **Direction:** one checker. The spectral narrowing (reflectance ≤ 1) becomes a fact the color
  model declares, not `colorId === 'spectral' ? spectralLimitations(scene) : []`
  (Validator.ts:861). The media ceilings can stay separate.

**B6. Light power has no single owner.** [reviewer, read]

- **Three power computations:** lighting.ts:351, compiler/sceneData.ts:164 and
  app/sceneData.ts:118–136. The last hard-codes the sphere's rows.
- **Two scene radii** feed one partition.
- **Two ways of reducing a color to a number:** the RGB mean and luminance Y.
- **Cost:** variance only; A3 is what it costs today.

**B7. Smaller items.**

- **The dispersion predicate grows with the region count.**
  - `surface_uses_dispersion` has one comparison per region (intersection.ts:361–367). A
    300-sphere Cauchy scene gets an 8,260-character line.
  - The same "collapse needed" test is written three times (flags.ts:27, intersection.ts:362,
    :413).
  - The Planner returns a non-null record with empty `regions` that no reader tells apart from
    null.
  - [reviewer compiled it; I read the generator]
- **Dead struct fields:** `MaterialProperties.wl` and `MediumProperties.wl` are written
  (materials.ts:370, :551) and read nowhere (0 reads in GLSL). [read, untruncated]
  *Correction (Sep 29):* they are load-bearing. They are the one member every properties struct
  is guaranteed to have, and removing them leaves an empty struct in scenes whose materials are
  all `none`. They stay.
- **Copied accumulator code:** the three accumulators copy the sample → trace → project
  sequence, so the spectral change had to touch all three. [reviewer]
- **Stale defaults:** `mintValueUniform(…, color = 'rgb')` (generate/values.ts:95) makes a
  spectral caller that forgets the argument mint a wrong-shaped kelvin uniform silently. All
  current callers are safe. [reviewer, read]
- **Missing tree power:** instanced-light power exists only after packing (see A3).

### C. Tests

- **The source scan is weaker than its claim.**
  - It forbids kind tests outside `spectra/` (tests/components/spectrumKinds.test.ts:24), but
    matches only three textual patterns: predicate names, `.id === 'x'`, and `'x' in`.
  - It misses the B2 sites, `as BlackbodyValue`, `kindById('blackbody')`, `switch (kind.id)`
    and double-quoted names.
  - Its header says "outside components/color/", but it excludes only `spectra/`.
  - [read]
- **The diagnostics snapshot asserts nothing by itself.**
  - tests/compiler/spectrumDiagnostics.test.ts:129 is `toMatchSnapshot()`, so `vitest -u`
    would accept a newly accepted invalid value.
  - A few plain assertions would let it fail on its own: every case rejected, and RGB ≡
    spectral except `albedo 1.5`.
  - [read]
- **Most vitest spectral files check that things compile.** Six bare `toThrow()`s pass on any
  crash. [reviewer]
- **Every numeric check is a GPU witness run by hand.**
  - `witness:dispersion` and `witness:blackbody` are not in CI's manual GPU job either
    (ci.yml runs color, spectral, spectral-bindings, spectral-majorant, environment and
    wavelengths). [read]
  - None of the roughly 50 spectral scene witnesses has been in a full sweep; all were added
    after c5f3543. [reviewer, git log]
- **What is solid:**
  - CPU blackbody against an independent SI Planck quadrature;
  - Sellmeier against the SCHOTT datasheet;
  - the lift's round-trip audit in CI;
  - the analytic furnaces;
  - mutation checks in the GPU probes.

### D. Docs and comments

**Wrong (the code contradicts the text).** [reviewer; spot-checked]

- **Kind READMEs describe the code before steps 1–3.** blackbody/README.md:88
  (`ProgramDescription.blackbody`, removed), :79; cauchy/README.md:30 (`dispersion` "lists the
  used index forms"); sellmeier/README.md:33. The step-3 CHANGELOG says these were corrected.
- **Two overclaims.** "A kind answers every question" and "nothing outside the folder tests
  for a kind" (CLAUDE.md, spectra/README.md, spectrumKind.ts:3); B1 and B2 say otherwise.
- **"Spectral is limited" is still written in three places.**
  - compiler/types.ts:569 says spectral "supports the verified constant-RGB Lambert capability
    set".
  - docs/trace-loop-contract.md:24 and camera/README.md:42 say spectral is unimplemented.
- **The GRIN comment is out of date.** compiler/types.ts:440–443 says GRIN rejects σ_s and that
  λ is "future".
- **The spec contradicts itself.**
  - Appendix B says "`kindOf` takes the slot", but §7 and the code say it does not.
  - Line 38 describes `blackbody(3200, 1.5)` "helpers" that do not exist.
- **`formatSpectrum`** (glsl-format.ts:22–31) has no callers and a false comment. This was
  already raised with you as open.

**Stale.**

- **spectral/README.md:**
  - :283 still calls surface dispersion "a separate planned stage";
  - :311 points "below" to a section that is above;
  - :94 credits spectral validation with checks that both models now share.
- **The spectrum spec's Part 2 and the bindings doc** still describe the pre-refactor code, or a
  recommended `thermal` kind, in the present tense.
- **generate/values.ts:2** says "THE ONE PLACE the constant/driven split is decided", but
  blackbody now decides its own. The comment also carries history.

**Readability.** spectral/README.md is 432 lines. A reader needs about 130:
- the lift formulas;
- the role domains;
- what is supported.

The float32 tracking-bound proof, the derived-rate proof, benchmark timings, salts and standard
errors, and the binary layout belong in a math note, the CHANGELOG or the witness README.

**Style.**
- History tags in comments (D1, C3, S2, "crashed the GLSL formatter", the blackbody README's
  migration section).
- About 50 British spellings in the color READMEs and new comments.

### E. Checked and found correct

- the estimator and hero collapse (Part 1);
- the four-lane stratification (the cyclic shift is an exact permutation of the RNG grid);
- the visible-sampler CDF and pdf share their endpoints; the atanh arguments stay well inside
  (−1, 1);
- no Planck overflow in 1000–40000 K;
- the Cauchy and Sellmeier µm/nm conversions; the Sellmeier "red end is the minimum" argument;
- the d line;
- the 2·max coefficient construction;
- D65 applied only to emission;
- the blackbody normalization is applied once (the row header stores scale × normalization and
  the reader passes it as the single normalization);
- driven values update the selection pdfs;
- no luminance weights in any path weight;
- the ~6.7 ppm majorant envelope.

### F. Suggested order

1. **Bugs A1–A5.** Each is small and local. A1 first: it is the only one that can spoil an image.
2. **One design note, before any new kind (measured curves or step 4).** It covers B1 and B2
   together: the role travels with the value, and every radiometric slot goes through its kind.
   That removes the inference sites, the media and attribute exceptions and the opt-in packed
   row, and the next kind needs it anyway.
3. **Then:** B3–B5 (the color model owns the lanes and its RGB case; one validator), the test
   gaps in C, and the docs in D.

Each of these needs its own approved plan before code.
