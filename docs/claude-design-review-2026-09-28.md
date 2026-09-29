# Design review after the spectral build (September 28, 2026)

**Status (later on Sep 28):** Part 2 (value forms) and item 3.1 (the emission rule) are
addressed by the one-spectrum-type work ([spec](claude-spectrum-spec.md), steps 0–3; commits
b65c763 … 3794fc8, each with a CHANGELOG entry). Of Part 9's order, items 1–3 are done (the
uncommitted work became 02ae534 and d35daee). Everything else below is still open, as written.

**What this is.** A review of the design of the whole renderer as it stands after the
spectral work (commits f9a0ed0 … 9e8f895, Sep 26–27, plus the uncommitted Sep 27–28 work in
the working tree). The question it answers: is this code simple, understandable and robust
enough to live with for years? Nothing has been changed. Every item ends with a suggested
direction for you to accept or reject; the larger ones would each need their own written plan.

**How it was done.** Five reviewers read the code at HEAD (read-only), one each for: the color
family and spectral code; the compiler; the transport GLSL; the app, engine and authoring
layers; and the tests, tools and documents. I read the spectral core and the compiler's color
handling myself and checked the reviewers' main claims against the code. A sixth, fresh
reviewer then fact-checked this document against the code; Appendix B lists what it
corrected. Each item says how it is known:

- **Checked**: I read the code, ran the command or measured it myself.
- **Reviewer**: a reviewer verified it by reading; I did not repeat the check.
- **Suspected**: plausible from reading; not reproduced.

Where an item concerns code that is not committed yet, it says **(uncommitted)**.

---

## Part 0: Summary

**The architecture is sound, and the spectral build is the proof.** Adding a complete
four-wavelength renderer (sampling, the RGB-to-spectrum lift, a CIE sensor, spectral media,
GRIN, blackbody and dispersion) added about 1,300 and removed about 730 lines of TypeScript
and GLSL logic in `src`, a net +570. The rest of the `src` change is 600 lines of data tables
(CIE curves, spectral asset metadata) and a net 740 lines of READMEs
(`git diff --numstat f9a0ed0^ HEAD -- src`, split by file type, **Checked**). The
compiler/component split, the `Spectrum` typedef, the `color_lift_<role>` seam and the film
boundary absorbed a large feature with very little new logic. That is the strongest evidence
available that the main abstractions are right.

**The problems are around that core, not in it.** In order of importance:

1. **Special value kinds have no home.** Blackbody, Cauchy and Sellmeier are "value forms"
   (ways of writing a spectrum or an index), but there is no form interface. Each is
   recognized case by case: `isBlackbody(` is called at 21 sites in 11 files; the index-form
   predicates at 14 sites in 5 files (**Checked**). The next planned work (sampled spectra, lamp
   presets) would add another of these to every site. This is exactly the open question in
   the plan's Sep 28 "authoring design checkpoint", and it is the one to settle first.
2. **The same rule is written in several places, with different coverage.** The clearest
   case: "emission must be nonnegative" is checked in at least five places, and RGB medium
   emission is not checked at all. A live material emission `{ param, default: -1 }`
   **compiles in RGB and is rejected in spectral** (**Checked** by running it, Part 3.1). The
   validator is one 1,300-line function, which makes this hard to see.
3. **The color-model registry is open in name but closed in practice.** `COLOR_MODELS` is a
   registry, but the compiler writes `'rgb' | 'spectral'` in 15 type positions and branches
   on the model's name (`=== 'spectral'`, `=== 'rgb'`) in 9 places (**Checked**). The design
   doc promised a test forbidding this in the generators (§3.10); it was not written.
4. **Verification and documentation grew faster than the code, and in a harder style.** The
   spectral build added a net 570 lines of TypeScript and GLSL logic, but about 1,600 lines
   of standalone GPU check scripts (plus 290 lines of node-only audits), 2,800 lines of docs
   and 16,700 net lines of snapshots. There are now four separate GPU test systems, 13 commands
   that CLAUDE.md never mentions, and a `scripts/` folder that is never typechecked. The two
   spectral design documents total 2,935 lines, and neither is clearly the authority.
5. **Some numerics are certified far beyond what they protect.** The spectral tracking bound
   rests on a simple fact (the lifted coefficient is at most twice its largest RGB channel),
   but its README section adds a float32 rounding analysis whose whole purpose is a 6.7
   parts-per-million margin. The actual cost (a majorant 4× the RGB one, so tracked rays take
   about 4× as many steps) gets one line.
6. **The CLAUDE.md writing rules have drifted.** About 300 comment lines carry batch codes or
   dates, several comments are stale, component READMEs read as lab notebooks, and the recent
   CHANGELOG entries are hard to read.

**On estimator correctness,** no reviewer found an error in the spectral transport. The hero
collapse is correct as written (Part 4.4). Two older, small, estimator-dependent effects are
real but not on the bias ledger in CLAUDE.md: the shadow ray's fixed 0.002 back-off (4.2), and
the 1e-3 spawn floor that any GRIN medium imposes on every hit in the program (4.3).

**What I would do first** is in Part 9: a short, ordered list of small pieces, each of which
can be planned and reviewed on its own.

---

## Part 1: What is working well (keep these)

- **The compile pipeline.** Scene + strategy → analyze → validate → plan → generate is real in
  the code. The Plan stage plans the scene once, then each renderer, then one data layout
  (Planner.ts:68–74), and `compileOrder.test.ts` checks that strategy order changes nothing.
  `ProgramDescription` is a serializable record of every decision. (**Reviewer**)
- **Exact linkage.** Features declare the seams they provide and require; merging reports
  missing, conflicting and unused seams (generate/features/merge.ts:45–89). Generated shaders contain only what
  is called. (**Reviewer**)
- **The color seam itself.** Descriptors declare a radiometric *role* per row
  (reflectance/coefficient/emission); generators wrap values in `color_lift_<role>(rgb, wl)`
  without branching; RGB arithmetic (filtering, expressions, clamps) happens before the lift,
  which is the right order. The accumulators receive a linear-sRGB `vec3` and never see a
  `Spectrum`, and each lane keeps its own camera pdf (spectral.glsl:13–19). (**Checked**)
- **The hero collapse is small and guarded.** One flag on `PathState`, one generated helper
  that returns early if already applied (pt.ts:443–450), included only when a dispersive
  region exists. The "applied once" rule is in the code, not just in a doc. (**Checked**)
- **Asset integrity.** The spectral tables have versioned ids, length and SHA-256 checks with
  named errors, a test for 404/length/checksum failures, a pinned generator, and CPU copies
  kept for WebGL context restore. (**Reviewer**)
- **Tests that can fail.** The GLSL probe runner (`tools/render-glsl-probes.mjs`, 63 lines)
  executes the real generated GLSL, and many probe scripts include deliberately broken
  shaders that must fail. `npm run digest` gives per-scene evidence that a refactor changed
  nothing. The witness system (provenance tiers, pinned salt, resumable cache) is well
  designed. (**Reviewer**)
- **Honest status.** CLAUDE.md's status section is accurate: a reviewer checked the six
  registry counts, `MAX_DIST`, equiangular's scope and the last full sweep's commit, and all
  hold. (**Reviewer**)
- **The transport loop's core types.** `Ray` is a pure seed, the running nearest lives on
  `hit.t`, and a shadow ray is defined by its destination and re-aimed after every crossing.
  The combiner makes pt, pt-nee and pt-mis three bodies of the same functions, and the bounce
  budget cannot vary with the estimator. The containment oracle with self-heal replaces a
  medium stack. (**Reviewer**)
- **Built to last.** There are no runtime dependencies and eight dev dependencies; scenes are
  plain data; sessions are saved as versioned files, not browser storage; the App compiles
  before it packs, so a bad scene fails before any GPU work; the context-restore path
  re-provisions everything the App supplied. (**Reviewer**)

---

## Part 2: Value forms (blackbody, Cauchy, Sellmeier) need one interface

**2.1 What the problem is.** *Checked.* An authored value can be plain RGB, a `{param}`, a GLSL
expression, an attribute, or a special *form*: `{ blackbody: { kelvin, scale } }`,
`{ cauchy: [A, B, C] }` or `{ sellmeier: { B, C } }`. RGB, params and expressions go through
one clean path (the role's lift). The special forms do not. Every place that needs to know
something about a value asks "is it a blackbody? is it Cauchy? is it Sellmeier?" itself:

| Question asked about a value | Where it is answered |
|---|---|
| Is it one of these forms? | `isBlackbody` 21 call sites in 11 files; `isCauchyIndex`/`isSellmeierIndex`/`isSpectralIndex`/`indexIsDispersive`/`evaluateIndex` 14 sites in 5 files |
| Which parameters does it read? | `radiometricValueDeps` (color/values.ts:16) |
| Can it emit? | `hasConstantNonzeroEmission` (values.ts:30), `emissionMayBeNonzero` (values.ts:41), and a private copy in Validator.ts:1695 that differs on a negative scale |
| What is its RGB value? | `projectRGB` (values.ts:53) |
| Is its domain valid? | propertyValidation.ts:86–137 (Sellmeier, Cauchy, blackbody each by hand) |
| What GLSL reads it? | `emitBlackbody`, `emitIndex`, `emitSpectrum` (generate/values.ts, generate/color.ts), each branching on `'rgb' \| 'spectral'` |
| Which GLSL file must be linked? | core.ts:104–106, one line per form, by name |
| How is it packed for the light tree? | lights/table.ts:70–76: a Planck-specific header tag with kelvin and normalization |

Adding Sellmeier (uncommitted) touched nine TypeScript files outside its own folder: the
validator, planner, plan types, plan values, value generator, core generator, scene types,
the shared color values and Cauchy's helpers (**Checked**: the working-tree diffs that mention
the index forms; the blackbody change in the same working tree was separated out). CLAUDE.md's
promise is "adding an occupant = one folder + one registry line".

**2.2 Why it matters.** Three reasons.

- *Growth.* The plan's next steps are a sampled-spectrum form, then lamp presets, then outdoor
  illuminants (implementation plan, S2a). Each would add a branch to every row of the table
  above. The light-table header already has room for exactly one form's parameters.
- *Silent fall-through.* Some helpers have defaults that are wrong for a form they don't know.
  If a new index form were added to `isSpectralIndex` but not to `indexIsDispersive`, the
  latter would return false and `emitIndex` would fold the form to its d-line constant even
  in spectral mode; `indexForm` returns `'sellmeier'` for anything that is not Cauchy; and
  `radiometricValueDeps` returns no dependencies for an unknown radiometric form, so its live
  control would not update. TypeScript would catch some of this (`evaluateIndex` and
  `emitIndex`'s Sellmeier branch narrow on the union), but not these three (**Checked** by
  reading; no such form exists yet).
- *Traps for the caller.* `emitValue` on a blackbody always emits the RGB projection
  (generate/values.ts:60–61); only callers who know to use `emitSpectrum` get Planck in a
  spectral program. `mintValueUniform` quietly defaults its `color` argument to `'rgb'`
  (values.ts:116). Getting the right answer depends on picking the right function.
  (**Checked**)

**2.3 A direction, and the precedent for it.** pbrt-v4 has the same problem and solves it with
one interface: `class Spectrum` is a tagged union over seven forms (constant, densely sampled,
piecewise linear, three RGB-derived kinds, blackbody), each implementing the same three
operations: evaluate at a wavelength, `MaxValue()`, and `Sample(SampledWavelengths)`
(`src/pbrt/util/spectrum.h`, read Sep 28). The analogue here would be a small `FormDescriptor`
per form folder, declaring the facts the table above asks for: its predicate, dependencies,
domain check, RGB projection (or reference value for an index), whether it varies with
wavelength, its GLSL file, and how to emit a read of it given a wavelength expression. The
compiler then loops over a registry instead of testing forms by name, and an exhaustive
`switch` with a `never` check replaces silent defaults.

This is a direction, not a design. The checkpoint in the implementation plan already asks
for "one reviewable contract" covering the value algebra, RGB-mode meaning, resource
lifecycle, support matrix and sampled storage before more authoring code; the form interface
belongs inside that deliverable. Two points it should weigh:

- **Radiometric forms and index forms are different things.** Blackbody is a spectrum;
  Cauchy and Sellmeier give a refractive index. They live together in `components/color/`
  beside the two real color models (`rgb`, `spectral`), with the same folder shape but no
  registry. Separating them (for example `color/forms/` for spectra and an `index/` family, or
  one `forms/` family with a declared kind) would make the folder tree tell the truth.
- **An alternative worth comparing:** lower every non-RGB radiometric form to one sampled
  representation at planning time, so the GLSL has only two readers (RGB lift, sampled curve).
  That trades exact Planck evaluation and cheap live temperature for fewer code paths. I have
  not evaluated it; it should sit in the design's comparison table next to the interface.

**2.4 Where form types live.** *Checked.* The authored types (`BlackbodyValue`, `CauchyIndex`,
`SellmeierIndex`, `ValueParam`) are in `compiler/types.ts`, while the predicates that recognize
them are in `components/color/values.ts`, and `compiler/types.ts:3` re-exports those
predicates back. The generic `isValueParam` lives in the color folder although it has nothing
to do with color. Whatever the form design decides, each form's type, predicate and math
should sit together.

---

## Part 3: The compiler

**3.1 One rule, several copies, different answers.** *Checked (run).* "Emission must be
nonnegative" is enforced in at least five places, each covering different cases:

- lights, Validator.ts:151: constants and `{param}` defaults, not slider bounds;
- materials, Validator.ts:274–276: constants only;
- the environment color: via a `nonnegative` constraint in propertyValidation;
- a blackbody's `scale ≥ 0`: propertyValidation.ts:138;
- `spectralLimitations` (analyze/spectral.ts:11–19): constants, defaults and slider bounds, but
  only for spectral programs. It is also the only check on medium emission.

I compiled two fixtures with the emission changed (scratch scripts, vite-node): the minimal
scene's sphere material, and the spectral slab's medium (its strategy's spectral-only
wavelength setting removed for the RGB run).

| Emission | RGB | Spectral |
|---|---|---|
| material `-1` | rejected | rejected, with two messages saying the same thing |
| material `{ param, default: -1 }` | **compiles** | rejected |
| material `{ param, default: 1, min: -5, max: 5 }` | **compiles** | rejected |
| medium `-1` | **compiles** | rejected |
| medium `[0.5, -0.2, 0.1]` | **compiles** | rejected |

So an RGB scene can render negative emission, even from a constant in a medium, and switching
the same scene to spectral turns it into an error. The rule "a `{param}`'s default, min and max must lie in
the domain" is likewise written at least four times (analyze/spectral.ts:11,
propertyValidation.ts:129 and :144, Validator.ts:816 for the camera, Validator.ts:140–151 for
lights) (**Reviewer**).

*Direction:* each role (reflectance, emission, coefficient, index) declares its domain once,
as a row constraint, and every value goes through one `validatePropertyValue` that checks
constants, defaults and bounds alike. The spectral lift's extra limits (reflectance ≤ 1 for
the bounded lift, the medium ceilings) become facts the color model declares, not a hand-
written function in the compiler named after one model.

**3.2 The validator is one function.** *Checked.* `validate()` runs from Validator.ts:47 to
about line 1346, with 127 diagnostics separated by comment banners (160 in the whole file;
**Reviewer** for the counts). It is readable line by line, but you cannot see from its shape which rules exist
for which part of the scene. *Direction:* split it into per-area functions (lights, materials
and media, instancing, strategy, camera, parameters) called in order. This is a pure refactor;
`npm run digest` plus the validator tests would show nothing changed.

**3.3 Defaults are resolved twice, and generators re-decide.** *Reviewer; spot-checked.*
`plan/types.ts:28–38` says `ProgramDescription` is the only decision record, that generators
never re-derive decisions, and that it has "no optionals". In the code:

- The validator applies defaults itself (`?? 'rgb'` at Validator.ts:858, and four more times
  in plan/measurement.ts:29–31; the light-selection default at Validator.ts:61 and :1155 and
  Planner.ts:490).
- Generators decide things the plan should record: the tracking majorant is computed in
  generate/features/materials.ts:785–797 (**Checked**); the Russian-roulette default 0.95 is
  applied in pt.ts:71 (**Checked**); `dispersion.regions.length > 0` is re-tested in three
  places.
- `ProgramDescription` has at least five optional fields (`colorModelVersion?`,
  `wavelengths?`, which core.ts reads with `!`, `maxSurvival?`, `emissionCones?`,
  `envSelectWeight?`), although some are optional on purpose ("absent = derived")
  (**Checked** for the first three). The comment's "no optionals" is wrong either way.
- For export stamps the App calls the same shared resolvers the Planner uses
  (`resolveMeasurement`, `resolveWavelengthSampler`, App.ts:880–882), so the logic is not
  copied; but it re-runs them, with its own `?? 'rgb'`, instead of reading the plan's record
  (**Checked**).

*Direction:* one "resolve defaults" step that produces a resolved scene and strategy, read by
both Validate and Plan; per-medium routing and majorants recorded in the plan; the newest
top-level fields (`blackbody`, `dispersion`) moved into a color section of
`ProgramDescription`.

**3.4 The color-model registry is closed in practice.** *Checked.* Besides the 9 string
branches and 15 literal-type positions, Validator.ts:881 hard-codes the list
`['rgb', 'spectral']`, and the same `?? 'rgb'` default appears six times on five lines. There are two honest
options, and I recommend the first:

| | A. Say there are two models | B. Make the registry real |
|---|---|---|
| What changes | One `ColorModelId` type derived from the registry keys, one `DEFAULT_COLOR_MODEL`, one `isSpectral(program)` helper; branches stay but are named once | Descriptor gains facts: hero-wavelength expression, collapse GLSL, form evaluation, domain limits; compiler branches go |
| Cost | Small | Medium |
| Buys | Findability; no drift in the default | A third model without touching the compiler |
| Realistic third model? | GLSL vectors stop at 4 components, so 8 wavelengths or polarization (Mueller matrices) would be transport redesigns, not new occupants (**Reviewer**, inferred) | |

Either way, add the test the design promised (§3.10): no `'rgb'`/`'spectral'` literals in
`src/compiler/generate/`, or an explicit allow-list if option A keeps a few. What would change
my recommendation: a concrete plan for a third color model.

**3.5 Four-lane assumptions outside the spectral occupant.** *Checked.* The collapse writes
`s.throughput *= vec4(4.0, 0.0, 0.0, 0.0)` (pt.ts:447) and index reads use `wl.lambda.x`
(generate/values.ts:204, 207): the lane count and "lane 0 is the hero" are spelled out in the
transport and the value generator, not asked of the color model. The two-channel canary cannot
catch these, because it replaces `COLOR_MODELS.rgb` only (glsl-compile.test.ts:28–29), so
spectral-only paths never run under it. Under option A above, the README should state N = 4
as a fixed fact; under option B, the model supplies both expressions.

**3.6 Big files.** *Reviewer.* Validator.ts 1,779 lines; generate/features/intersection.ts
1,748 (its `contributeIntersection` alone is about 400); types.ts 1,120; Planner.ts 1,019.
`types.ts` is really three files (scene description, strategy, the locked engine contract) and
also holds runtime predicates. Planner.ts is well organized and would split cleanly along its
three functions (this was already "step 5, the owner's call"). Imports also run against stage
order in places: the analyzer and validator import `plan/dataTenants`, and `sceneData.ts`
imports generator modules (**Reviewer**).

---

## Part 4: Transport

**4.1 How it reads.** *Reviewer.* The static technique files are short and clear (kernel.glsl
34 lines, light.glsl 28). The hard part is the generator: `walk()` in pt.ts:291–439 has 15
flag conditionals, and its media block interleaves emission, equiangular sampling, GRIN
deflection, scattering, budget checks, `continue`/`break` and `bounce--`. The deferred
emitter score (the stored `LightQuery` that MIS replays at the next hit) is not explained in
the file. The generated GLSL is the readable form of the loop; `generated-shaders/` holds only
GRIN scenes from Sep 26, so there is no current example of a spectral program to read.
*Direction:* refresh the dump with one scene per major feature (and write each program's
`ProgramDescription` next to its GLSL, so the "why" sits by the "what").

**4.2 The shadow back-off is an undeclared estimator difference.** *Checked.* NEE stops
`SHADOW_BACKOFF` = 0.002 short of the light point (math.glsl:31–39; opaque.glsl:17,
media.glsl:39). So an occluder within 0.002 of an emitter blocks BSDF-sampled paths but not
NEE, and in a scene with such an occluder pt and pt-nee converge to slightly different images. The comment in math.glsl says
this plainly, but it is not on CLAUDE.md's bias ledger or in the strategy taxonomy (searched:
neither mentions it), and it is an absolute world length, so its effect depends on scene
scale. *Direction:* at least declare it on the ledger; better, make it relative to the light
distance or to the light point's own floating-point error.

**4.3 A GRIN medium changes spawn offsets everywhere.** *Checked (code); effect Suspected.* In
any program with a deflecting (GRIN) medium, every floating-point-accurate hit gets its spawn
margin floored at 1e-3 (intersection.ts:202–227), not only hits on GRIN walls. The mesh code's
own comment (mesh.glsl:29–32) says a fixed world-space floor "skips a sliver of medium on entry
… a measurable loss in dense media" and breaks scale invariance, which is why meshes removed
theirs. So a scene with a GRIN lens and a dense medium probably carries a small bias the other
scenes don't. Not measured. *Direction:* floor only at the GRIN region's own boundaries.

**4.4 The hero collapse: correct, but its proof is somewhere else.** *Checked (code),
Reviewer (symmetry audit).* The collapse runs once (a guarded flag, pt.ts:445–449), after the
emitter score and before NEE and continuation (pt.ts:415); lane 0 carries ×4 and the film's
0.25 average cancels it. Its validity rests on every decision *before* the collapse treating
the four lanes symmetrically (uniform channel selection, symmetric reductions, cameras that
ignore wavelength). A reviewer checked those and found none that favors a lane. But that
precondition is written only in color/cauchy/README.md:53–78; the call site has a two-line
comment with no pointer, and none of the sites that must stay symmetric says so. A future
hero-biased wavelength proposal would silently bias every dispersive image. *Direction:* move
the collapse into the color model (next to `color_to_pixel`, so "hero = lane 0, ×N" has one
home, see 3.5) and state the symmetry precondition at the call site.

**4.5 GRIN scatter events drop their η² record.** *Checked.* The GRIN scatter arm sets
`ms.eta_scale` (grin.glsl:378, 395), but the walk reads it only on the deflection branch
(pt.ts:351), not on scatter. This affects only the Russian-roulette metric, so it costs
variance, not correctness. Small fix.

**4.6 Media: a clean call, a hard-coded matrix behind it.** *Reviewer.* The walk makes one
`medium_sample` call and gets one struct back, which is good. Behind it, `medium_sample` has
six arms (inline Beer–Lambert with and without emission, analytic, ratio-absorb, delta
tracking, GRIN, GRIN-scatter), `medium_transmittance` five forms, routed by seven predicates in
compiler/types.ts:336–411, with the GLSL bodies imported directly by the compiler rather than
through a registry. The channel-MIS formula exists three times (analytic.glsl and twice in
grin.glsl). Adding a medium type means a GLSL body plus edits to three generator functions,
the predicates, the Planner flags and the validator. Volumetrics are one of the stated
long-term goals, so this is where the next big feature lands. *Direction:* give volume arms
descriptors (sample / transmittance / survival facts) and extract one channel-MIS helper,
before the next medium type rather than after.

**4.7 The curved-space seam.** *Reviewer; one item Checked.* Mostly respected: the spectral
work added no new Euclidean operations, and the light files and phase functions declare
their Euclidean exemptions. Undeclared leaks that would matter for H³ or Nil:

- `length(light_p - shadow_ray.origin)` in opaque.glsl:17, the NEE path of every scene
  (**Checked**); the same call in media.glsl:39 is declared.
- World-space `normalize` after a frame change in lambert, checker, mirror, dielectric and
  `microfacet_from_local`.
- The GRIN walker (`r + h*T`, `length`, `normalize`) is Euclidean but not marked so, and it is
  the natural template for black-hole geodesics.
- Six generated seams take `vec3` where the contract says `Point`/`Direction`
  (`scene_region_at`, `ior_of`, `ior_at`, `scene_material_properties`,
  `scene_medium_properties`, `environment_radiance`). These would fail loudly, not silently,
  when `Point` becomes `vec4`.

*Direction:* not urgent. Before curved-space work starts: add `ambient_distance` and
`ambient_normalize`, mark GRIN as Euclidean-only, and fix the six signatures.

**4.8 Absolute lengths.** *Reviewer.* `MARCH_CLEARANCE`, `EPS_INTERFACE`, `SHADOW_BACKOFF`,
the GRIN step constants and `MAX_DIST` are world lengths, so SDF, GRIN and shadow behavior
depend on scene scale, while floating-point-accurate hits do not. Worth one line in the
bias ledger ("scenes are assumed to be authored at roughly unit scale").

**4.9 Stale transport comments.** *Checked.* pt.ts:193–194 and the emitted text at :204 say
Russian roulette is "ONE function for both call sites", while the same file (pt.ts:16–21)
explains it is now two. docs/trace-loop-contract.md:22 says "spectral rendering remains
unimplemented". A reviewer found more (structs_media.glsl:10–11; math.glsl:17–18), and counted
122 of 168 `§` references in this area that name no document, so the reader cannot follow
them.

---

## Part 5: Numerical certification out of proportion

*Checked.* The spectral tracking majorant is 18 lines of code (color/spectral/majorant.ts).
Its README section (spectral README lines 342–417) has three parts: a numerical author contract
(about 15 lines), a proof (about 45 lines) and a paragraph on the witness. Part of the proof
establishes the factor-4 bound itself (the lift stays in [0, 1], the tables are finite, nothing
overflows), and that part is worth keeping. The rest is a float32 rounding analysis whose
result the README states as "about 6.7 ppm above 4A". Around it are domain limits spread
across majorant.ts:2 and analyze/spectral.ts:41–45 (a literal `2 ** 60`, and
`spectralCeilingRange[1] / 2`) and an author contract on 2⁻¹²⁰ normalization denominators that
nothing checks. The step "round up one float32 ulp" is done by incrementing the bits through a
`Uint32Array` (majorant.ts:16), which is correct but opaque.

The fact that matters for you is simpler and currently gets one line: **the lifted spectrum of
an RGB coefficient c is at most 2·max(c), so the spectral majorant is 4× the authored ceiling
(two coefficients)**, while RGB uses the ceiling itself (rgb.ts:5). A tracked ray samples
tentative collisions at the majorant's rate, so it takes about 4× as many steps as in the same
RGB scene. The factor 4 is a worst case (absorption and scattering each at their largest
lift); whether a tighter bound exists when both coefficients share one density field is a
question I have not evaluated.

*Direction:* keep the guarantee, the factor-4 argument and the GPU witness, but replace the
ppm-level rounding analysis with a generous margin, e.g. `M = 4A·(1 + 2⁻¹⁰)` rounded up, and a one-paragraph argument ("the lift
chain's rounding error is a few ulps, far inside 0.1%"). Tie the upper ceiling limit to the
tracking cap and `MAX_DIST` in code rather than in prose. The same test for other certified
numerics: is the argument something you could re-derive in a year?

---

## Part 6: Verification tools and tests

**6.1 Four GPU test systems, no single entry point.** *Reviewer; spot-checked.* The scene
witnesses (`tools/witness.mjs`), the GLSL probe runner used by eight scripts, two ad hoc
Playwright scripts that need a running dev server, and node-only quadrature audits. They are
split between `tools/*.mjs` and `scripts/*.ts`, and twelve files each launch Chromium
themselves. The manual CI GPU job runs six of these commands; `witness:dispersion`,
`witness:blackbody`, `witness:spectral-live` and `witness:spectral-lifecycle` are never in CI,
and three audit scripts that fixtures cite as the source of their expected values have no npm
script. CLAUDE.md mentions none of the 13 new commands. The last full witness sweep was at
c5f3543, 81 commits ago, before any spectral work.

*Direction:* one command that runs every GPU check (probes, audits, scene witnesses), and a
short "if you changed X, run Y" table in CLAUDE.md's "Verifying changes". Fold the probe
scripts into one runner with one Chromium launcher.

**6.2 `scripts/` is never typechecked.** *Checked.* `tsconfig.json:24` includes only `src`,
`tests` and `pages`. A reviewer ran the scripts through the repo's strict settings and got 14
errors, 7 of them real strictness errors (**Reviewer**). *Direction:* add `scripts` (and a
declaration for the `.mjs` runner) to the typecheck.

**6.3 Snapshots too large to review.** *Checked.* Three snapshot files hold 135,730 lines: the
generated-GLSL snapshot 83,183 and the program-description snapshot 51,609. Each spectral commit
grew the latter by 600–2,450 lines, and in one commit more than half the GLSL-snapshot changes
were source-map line numbers (**Reviewer**). The GLSL snapshot's stated job (proving a refactor
changed nothing) is now done better by `npm run digest`. *Direction:* keep the
program-description snapshot for a small, named set of scenes; drop or shrink the GLSL snapshot
in favor of the digest.

**6.4 New fixtures don't carry their derivations.** *Reviewer.* The witness README says
fixtures carry their derivations in comments. The 12 spectral fixtures have 0–5% comment lines
(older ones 10–71%). Half of them do name their source script in a `from:` field (e.g.
spectralFoundation.ts:5 names scripts/audit-spectral.ts), but the expected values themselves
are pasted 17-digit literals from that script's output (e.g. spectralFoundation.ts:45), and the
derivation is not in the fixture. The same Simpson/CIE quadrature is copied into eight places.
*Direction:* one shared quadrature helper; each fixture recomputes its number from it (or
states the closed form) rather than pasting it.

**6.5 Assertions that can pass for the wrong reason.** *Checked.* dispersion.test.ts:56–59
checks the order of calls in the walk with `indexOf(a) < indexOf(b)`. If one of the earlier
calls (`kernel_score_emitter_hit`, `if (bounce ==`) is renamed, its `indexOf` returns −1 and the
check passes whatever the order. (A missing collapse call does make the check fail.) A reviewer also
counted 19 bare `.toThrow()` calls with no expected message, 8 in the new spectral tests.
*Direction:* assert each `indexOf` is ≥ 0, and match the diagnostic text in `toThrow`.

---

## Part 7: Documentation

**7.1 The spectral docs.** *Checked.* The design doc (1,472 lines) and the implementation plan
(1,463 lines), with the five color READMEs, come to about 3,700 lines for about 550 lines of
color-family code. Neither of the two documents is clearly the authority: the design doc's §11 and §13 still read
as open decisions and "items to resolve before implementation", and the plan, still titled
"draft for adversarial review", marks D2 (Jakob–Hanika), D4 (linear-sRGB film) and D8 (separate
σ_a/σ_s lift) as **Proposed** (plan lines 52, 53 and 56) although all three are built. Either the table
is stale or those were built without your acceptance; you should know which. *Direction:*
freeze the design doc as the math and the reasons; make the plan's decision table the one
ledger; keep "what is built" in one place (CLAUDE.md status).

**7.2 Component READMEs read as lab notebooks.** *Checked.* The spectral README (432 lines)
is organized by enablement stage ("Surface material verification", "Homogeneous media",
"Volume emission", …) and includes timings on "the development Apple Silicon machine",
salts, standard errors and benchmark numbers. The blackbody README's new section converting
old strengths is migration history (uncommitted). A contract README should say what the
component does, its units and domain, and how to check it, in about a page. *Direction:* move
measurements to CHANGELOG or the witness README; rewrite the spectral README as a present-tense
contract.

**7.3 The CHANGELOG got harder to read.** *Checked.* Compare the Sep 25 entries (a cause, a
fix, before/after numbers from a named witness) with the Sep 27 entries: no bullets, long
verification paragraphs quoting suite totals (3,554 tests, 61,440 lane margins, 81,920 lane
margins …), and terms like "field-up/rate-down neighboring float32 values". Of the Sep 26–28
headings, 12 are plan, research, review or audit entries and 6 changed no code, although the
file says it records "what was built, fixed, and measured" (**Reviewer** for the counts).
*Direction:* entries of the Sep 25 shape: what changed and why, in a few sentences; the witness
and its number; leave the test totals out.

**7.4 The docs index is out of date.** *Reviewer.* `docs/README.md` lists 47 of 117 top-level
docs and misses 5 of the 15 design authorities in CLAUDE.md (including the owner-pinned
strategy taxonomy and the trace-loop contract). Some entries are wrong (rough dielectric
listed "NOT built"). About 9 docs call themselves historical or superseded but are not archived,
and 4 plans still say "planned" for built work. The uncommitted edit to
`claude-review-handoff.md` says scene-once step 4 is "not yet decided", while the CHANGELOG
records it implemented on Sep 27 (**Checked**). *Direction:* an archive pass and an index that
lists the authorities first.

---

## Part 8: The writing rules in CLAUDE.md

**8.1 History in comments.** *Checked (approximate).* A regex for batch codes (T6, C6, D4, P5,
E2, …), "owner-locked/decided" and 2026 dates matches about 300 comment lines in `src`; a
sample confirms most are real tags, e.g. generate/values.ts:2 "Model B, owner-locked Jul 18
2026", pt.ts:16 "roulette() USED TO BE one of those", Planner.ts:553 "(T6)". This is older than
the spectral work; review batch 6 was planned to address it.

**8.2 Stale comments.** *Checked.* types.ts:575–576 says "Spectral currently supports the
verified constant-RGB Lambert capability set"; docs/compiler-system.md:197 and :266 still
describe an `ENABLE_NEE` define that appears nowhere in `src` (**Checked**: 0 matches).

**8.3 Constants stated twice.** *Checked.* The Planck constant c₂ is computed in blackbody.ts:7
and written as a literal in blackbody.glsl:5; the kelvin slider range `[1000, 12000]`
(generate/values.ts:155) ignores `blackbodyTemperatureRange` (blackbody.ts:5). The spectral
table layout numbers (64 nodes, 6 search steps, 360/470) are literals in both lookup.glsl and
lookup.ts rather than generated from data.ts (**Reviewer**).

**8.4 Spelling.** The spectral code and docs use British spelling ("colour", "grey"), against
your stated preference.

---

## Part 8b: App, engine and authoring

**8b.1 The App re-derives decisions because the compiler doesn't hand them over.** *Checked.*
`envVariants` (App.ts:1004–1008) applies `envSampler ?? 'equirect'` and
`envCompensation ?? false`, the same defaults as Planner.ts:577–578, and the export stamp
re-runs the shared wavelength-sampler resolver with its own `?? 'rgb'` (App.ts:880). The
`envVariants` case is a documented exception: CLAUDE.md and docs/claude-data-exact-linkage.md
(lines 3–6) record that moving it into the compiler needs the procedural-sky bake reordered
after the main renderers load. The export stamp has no such reason; `CompiledScene` simply
carries no record of the resolved strategy. If a Planner default changes, a missing
environment table fails loudly, but an export stamp would be wrong silently. *Direction:*
the compiler returns the resolved measurement/estimator record, and the App stamps from it.
This is the same fix as 3.3. The `envVariants` exception stays until the bake is reordered.

**8b.2 Only the components layer has a layering test.** *Reviewer.* `purity.test.ts` checks
that components import only types from other layers; nothing checks the engine, app or
compiler. Today there are no upward imports, but the engine does import a component value
(`engine/loaders/build-environment-sampler.ts:9` imports the env importance-table builder),
which runs estimator math inside the "blind" engine. *Direction:* extend the same import scan
to all five layers.

**8b.3 App.ts is mostly a facade.** *Reviewer.* About 60% of its 1,016 lines are one-line
delegations. The real logic it owns is environment work (image loading, procedural baking,
table variants), context-loss restore, sessions and exports. The three largest managers
(renderer switching, the render loop, production renders) are narrow and sensible.
*Direction:* move the environment work into a provider like `BuiltinAssets`; the App then
becomes close to a pure facade.

**8b.4 Authoring reads well, with some inconsistent spellings.** *Reviewer; spot-checked.*
Scenes are plain object literals and read well for a mathematician. The inconsistencies:
shapes nest their fields under `parameters` while materials and lights are flat; the
environment uses `color` + `intensity` rather than the "one radiometric word" `emission`;
Cauchy is a positional tuple `[A, B, C]` while Sellmeier uses named fields `{ B, C }`. The
reference-Y blackbody change (uncommitted) makes `scale` mean reference luminance, so scenes
converted to keep their old look now carry 16-digit strengths such as
`blackbody(1000, 0.2174975862105915)` (spectralBlackbody.ts:9, **Checked**). Authoring
constants like `N_BK7` are found only through a README. *Direction:* settle the spellings in
the value-form design (Part 2); give authoring constants one index.

**8b.5 Two environment assumptions.** Spectral assets are verified with `crypto.subtle`
(BuiltinAssets.ts:24, **Checked**), which browsers expose only in secure contexts, so opening
the dev server over plain http on a LAN address would probably fail every spectral scene
(**Suspected**; worth a clear error message). If `OES_texture_float_linear` is missing,
float textures silently fall back to nearest filtering (TextureFactory.ts:85, **Reviewer**;
whether any sampler depends on linear filtering was not checked).

---

## Part 9: What I would do, in order

Each item is small enough for one written plan and one review. The order puts the decision
that shapes the most code first, and cheap safety fixes early.

1. **Decide the value-form design** (Part 2), as the checkpoint's "one reviewable contract".
   Nothing else in the authoring roadmap should be built before it.
2. **Fix the emission rule** (3.1): one domain per role, one check covering constants,
   defaults and bounds, in both color modes. Small, and it fixes a real inconsistency.
3. **Commit or hold the uncommitted work.** The working tree holds two features, Sellmeier
   with N-BK7 and the reference-Y blackbody change (about 200 source lines plus tests), mixed
   together with the doc edits that describe them as built (CLAUDE.md, the CHANGELOG, three
   READMEs). Git at HEAD is consistent; the risk is that one mixed commit, or a lost working
   tree, makes the history unreadable. Two separate commits, or an explicit hold.
4. **Settle the spectral decision ledger** (7.1): confirm or reject D2, D4, D8 as built. In
   the same pass, put the two undeclared estimator differences on the bias ledger (4.2, 4.3)
   and decide whether to fix them.
5. **Verification entry point** (6.1, 6.2): one GPU command, a "changed X, run Y" table,
   `scripts/` typechecked, the vacuous assertions fixed. Then one full sweep, since none has
   run since the spectral work began.
6. **Color-model option A** (3.4) and the generator test the design promised; move the hero
   collapse into the color model with its precondition stated (3.5, 4.4).
7. **Compiler tidying** (3.2, 3.3, 3.6): split the validator; one defaults step; record the
   generator-made decisions in the plan. Each is a no-output-change refactor checkable by
   `npm run digest`.
8. **Docs and comments** (Parts 7 and 8): the spectral README as a contract, the index, the
   archive pass, then batch 6 (history in comments).
9. **Simplify the majorant argument** (Part 5), when that code is next touched.
10. **Before the next medium type:** volume-arm descriptors and one channel-MIS helper (4.6).
    **Before curved-space work:** the ambient-seam fixes (4.7).

---

## Appendix A: commands behind the checked numbers

- Production vs verification churn: `git diff --numstat f9a0ed0^ HEAD`, grouped by top-level
  directory (snapshots separated); for `src`, further split into Markdown, the two data-table
  files (`sensor/cie1931/curves.ts`, `color/spectral/data.ts`) and the remaining TS/GLSL.
- Form tests: `grep -rn "isBlackbody(" src | grep -v "export function"` → 21 lines in 11 files;
  `grep -rnE "(isSpectralIndex|isCauchyIndex|isSellmeierIndex|indexIsDispersive|evaluateIndex)\("
  src | grep -v "export function"` → 14 lines in 5 files.
- Color-model branches: `grep -rnE "=== ?'spectral'|!== ?'spectral'|=== ?'rgb'|!== ?'rgb'" src`
  → 9; `grep -rn "'rgb' | 'spectral'" src` → 15.
- Negative emission: two scratch vite-node scripts. One compiles `minimalScene` with the
  sphere material's emission replaced; the other compiles `spectralSlab` with the medium's
  emission replaced (its strategy's `estimator.wavelengths` removed for the RGB run, since
  RGB rejects that setting). Each under `measurement.color` `'rgb'` and `'spectral'`.
- The promised generator test: `grep -rlE "readFileSync|readdirSync|import\.meta\.glob|globSync"
  tests` → 10 files read source; none of them both mentions `generate` and the model names.
- History tags: `grep -rnE "//.*\b(T|C|D|P|E|H|A)[0-9]+\b|owner-(locked|decided)|(Jul|Aug|Sep)
  [0-9]+,? 2026" src` excluding D65/D50 → about 300 lines. It includes some false positives and
  misses tags on JSDoc `*` lines, so it is a rough size, not an exact count.
- Snapshot sizes: `find tests -name '*.snap' | xargs wc -l`.

## Appendix B: what the independent check changed

A fresh reviewer who had not seen my reasoning checked the draft against the code. It
reproduced the negative-emission runs, confirmed the main counts and line references, and
found these errors, all now corrected above:

- **Overstated sizes.** I had called the spectral build "net +1,900 lines of production code";
  only 570 of those are TS/GLSL logic (the rest are data tables and READMEs). I had counted
  "about 3,000 lines of GPU scripts"; about 1,600 are GPU checks, the rest vendored C++,
  the table generator and node-only audits. Doc totals were rounded up (4,000 → 3,700; 2,900 →
  2,800).
- **A wrong claim about a test.** I said the order checks in dispersion.test.ts pass if the
  collapse call disappears; they fail in that case. They pass vacuously only if an earlier call
  is renamed.
- **Undercounts.** Emission sign is checked in at least five places, not four, and the fifth
  gap (RGB medium emission, unchecked) turned out to be the worst case; I then ran it myself.
  `ProgramDescription` has at least five optional fields, some deliberately.
- **Unfairness.** Half the spectral fixtures do cite their source script; the `envVariants`
  default in the App is a documented exception with a stated reason; the App's export stamp
  calls the shared resolvers rather than copying their logic.
- **Small errors.** Index-form counts (5 files, not 6), a wrong line number for a `(T6)` tag,
  a misattributed "no decision-making" quote (it describes the Generate phase's rule, so it is
  not stale), the validator's diagnostic count (127 in `validate()`), eight dev dependencies,
  not seven, and the majorant section's framing (part of that proof establishes the factor 4
  itself and should stay).

Separately, I dropped one reviewer finding after checking it: a suspected early `return` in
the procedural-sky bake loop (App.ts:319) is harmless, because the bake compiler returns
nothing only when the sky is not procedural, which is the same for every chart.
