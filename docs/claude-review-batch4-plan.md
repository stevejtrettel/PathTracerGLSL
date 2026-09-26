# Batch 4 — who owns each fact (review Part 2)

**Status:** done Sep 26 (d61e76a … db0c163; CHANGELOG "review batch 4"). Approved Sep 26, then
**re-checked and corrected** the same day, after step 4.1 showed that a claim in it was false
(`dataReads` has a reader). The deviations made while building are listed at the end of part 2. The re-check repeated every claim with
complete searches; its findings are in "Re-check" at the end of part 1, and the affected steps are
corrected in place. The corrected plan was approved Sep 26, with `dataReads` kept. Line numbers
are at f4cc5d7 unless marked otherwise.

---

## The rule for choosing an owner

These come from CLAUDE.md's layer rules (Authoring → App → Engine → Compiler → Components; the
compiler's Analyze → Validate → Plan → Generate).

1. **A fact about one model** (a shape, a light kind, a material model, the equirect chart) lives in
   that component. Nobody else restates it.
2. **A decision that depends on the scene and the strategy** is made once by the Planner and
   recorded in the plan. Generators emit from the plan alone, and the App reads it; neither
   re-derives it.
3. **The Validator runs before the Planner.** Where it must predict a Planner decision, it calls
   the same function the Planner calls, never a copy.
4. **The App executes the plan.** Where it must compute something from data only it holds (a loaded
   instance cloud), it calls the owning component's function.
5. **Tests read the source of truth**, or pin their copy against it.

---

## The items

### 1. Which objects are lights

- **Today:**
  - The census `samplableEmitterObjects` (dataTenants.ts:175) is the official answer. It has two
    legs: the object's shape (analytic, constant placement, no retained frame, and a light kind
    exists for the shape) and its material (not opted out, constant nonzero emission).
  - The Validator keeps its own copy of the shape leg (`samplableObjectUses`, Validator.ts:1524),
    plus a third partial copy in the driven-transform rule (:1310).
  - Underneath, one fact is stated twice: "shape T can be sampled as a light". It appears as the
    geometry descriptor flag `samplableAsLight` (quad, sphere, disk) and as the light registry's
    kinds that declare `region` + `valuesFromRegion` (`regionLightKind`). The census checks both;
    the Validator checks only the flag.
- **Owner:**
  - The census, in the compiler's plan layer (dataTenants.ts), exports its shape leg as its own
    predicate. The Validator's two rules call it.
  - "Shape T can be sampled" belongs to the **light registry**: a light kind knows which region it
    can be built from. The geometry flag is a geometry descriptor making a claim about the lights
    family, which descriptors must not do. **Decided (Sep 26):** remove the flag and derive
    everything from the registry.

### 2. An emitter's light values vs its surface (review 1.9)

- **Today:**
  - The light list (`lightRosterOf`) computes an emissive object's light values itself: it folds
    the placement and resolves the emission (blackbody fold, scalar broadcast).
  - The Planner separately plans the same object's surface parameters and material emission.
  - They agree today. The placement fold is one shared function (`foldPlacementIntoParameters`,
    reached through `classifyPlacement` for these shapes). The emission resolution is two copies:
    the roster's inline fold, and the Planner's `resolveColorProperty`.
  - pt ≡ pt-nee depends on them agreeing, and only GPU witnesses check it.
- **Owner — a real choice:**
  - **(a) Small:** both paths call one emission-resolution function, moved to a module both can
    import.
  - **(b) Structural (recommended):** a light built from an object is derived *from the planned
    object and its planned material*. The Planner plans the surface, then builds the light from
    that surface's parameters and emission with the kind's `valuesFromRegion`. The light sampler
    then describes the surface rays hit, by construction. `lightRosterOf` keeps only identity
    (kinds and sources), which is all the data layout uses.
- **Also affected, but not a duplicate:** see "The bigger structural question" below.

### 3. "Does this medium scatter in this program?"

- **Today:** the predicate is "the program allows scattering, and the medium has σ_s". It is
  recomputed at nine sites:
  - materials.ts:122, 682, 686, 748, and 833 (its negation);
  - Planner.ts:488 and 500;
  - Validator.ts:513 (these spell it `scattering === 'full'`, equivalent today);
  - flags.ts reads only the program half.
- **Owner:**
  - The **Planner**. It decides this per medium and records it in the plan (for example a
    `scatters` flag on each planned medium). The generators read that flag.
  - The Validator, which needs the same answer before planning, calls the one function the
    Planner uses.

### 4. Whether the sky-vs-lights draw exists

- **Today:** the Planner records `environmentSelectionLive` (Planner.ts:631), which counts the
  instanced lights. The lighting generator's sampler branches on `lights.length === 0` instead
  (lighting.ts:575), which doesn't count them.
- **Owner:** the **Planner** (already). The generator reads the recorded decision. (To check in
  part 2: whether the two can disagree today, for a scene with only instanced lights plus a sky.)

### 5. The power and box of instanced sphere lights

- **Today:**
  - For registry lights, the compiler's scene-data plan calls each kind's `power()`.
  - For instanced sphere lights, the App re-implements both of the sphere light's formulas
    (app/sceneData.ts:112–128): the box center ± r (the descriptor's `treeBounds`) and the power
    π·4πr²·Le with the channel mean and a 1e-8 floor (the descriptor's `power()`, sphere.ts:24–27,
    which already has the same floor and mean).
- **Owner:** the **sphere light descriptor**. The App, which alone holds the per-instance records,
  calls that kind's `treeBounds()` and `power()` for each instance. (Part 1 first put the floor in
  the tree builder; reading sphere.ts showed the descriptor already owns it.)

### 6. The equirect sky mapping

- **Today:** direction → texture coordinate is written twice in GLSL:
  - generated in environment.ts:153–157, for looking up the sky's colour;
  - in the equirect component (equirect.glsl:22–24), for sampling.

  Only the component's copy wraps u with `fract`.
- **Owner:**
  - The **equirect component**: one function both call. The design rule stays: the colour lookup
    must not depend on which sampling chart is chosen. It calls the equirect mapping function,
    not the chosen chart.
  - (To check in part 2: the TypeScript that builds the sampling tables uses the same convention;
    a twin across languages needs a pin, not one function.)

### 7. The render-stop sequence

- **Today:** `RenderCoordinator.fail` (:237) repeats `stopInternal`'s steps (:188). It differs
  only in the error it rejects with and the extra error event.
- **Owner:** the same class. `fail` calls `stopInternal` with the error.

### 8. Shader constants copied into witness fixtures

- **Today:** precisionWitness.ts:127–128 hard-codes `MAX_DIST = 1000` and
  `SHADOW_BACKOFF = 0.002`, copied from math.glsl, with no check.
- **Owner:** the **GLSL defines**. The fixture reads them from math.glsl (a raw import, parsed by
  one small helper that epsilonCoupling.test.ts also uses) instead of copying them. The
  alternative is a vitest pin.

### 9. Validator checks stated twice

- **Similarity well-formedness** ("one finite positive scale; a unit quaternion or nonzero axis"):
  - Today it is stated for object transforms (`validateScale`/`validateRotation`) and again for
    instance placements (`placementProblem`, :1634), in different words.
  - Owner: the **similarity module** (components/geometry/similarity.ts), next to
    `similarityFromTransform`, the function an invalid transform would break. It is one predicate
    returning the problem. The Validator turns it into diagnostics and adds the rules that apply
    only to objects (driven parameters, the extreme-scale warning).
- **Camera row shapes:** `wellShaped` (:809) re-checks the rows the loop above just checked,
  without the finiteness rule. Owner: that loop records its result, and `wellShaped` reads it.
- **Emission on a model that cannot emit:** two rules (:285 and :979) both warn for the same
  mistake. Owner: one rule. It is an error if the census would make the object a light, and one
  warning otherwise.

### 10. Output nothing reads

- `CompiledScene.dataReads` has no reader outside the compiler (grep).
- materials.ts builds a `defines` object the review says is always empty (not re-checked yet).
- Under your unused-code rule these are for you to decide: keep, or remove.

---

## The bigger structural question (not proposed for batch 4)

Several of these share one cause. The Planner produces one `RenderPlan` per strategy, and each
plan mixes two kinds of fact:
- **scene facts**, the same for every renderer: planned objects, lights, resolved materials, the
  data layout;
- **program decisions**: estimator, arms, which media scatter.

Because scene facts are recomputed per strategy, the scene-data plan is built from `plans[0]`, on
the unchecked premise that any plan's scene facts serve (Compiler.ts:74). And the light values
have no single place to be derived from the planned surface (item 2).

The clean structure would plan the scene once and plan each program against it. That changes the
compiler's plan types, so under your rules it is its own discussion and batch, not a batch 4
cleanup.

**Your call:**
- do item 2 as (a) now and leave (b) for that restructure, or
- do (b) now inside today's structure.

Not duplicates, so not in this batch: the review's guards that don't exist (region→material
completeness, "each program reads only what the layout holds", the tabled-residual rule).

---

## Re-check (Sep 26, after step 4.1)

Every claim above was repeated with complete, untruncated searches over src, tests, pages, tools
and demos.

**Confirmed:**
- items 1, 7, 8 and 9 as stated, with their line numbers;
- item 2's placement fold is shared (quad, sphere and disk are similarity-closed with a point row);
- item 3's two Planner spellings are equivalent after validation (the Validator rejects the other
  `volumeSampling` values);
- item 4's two answers agree today;
- item 5's descriptor formula and floor are identical to the App's;
- item 6's sky texture repeats horizontally (`createRGB32F`).

**Wrong or incomplete, now corrected:**
1. **Item 10:** `CompiledScene.dataReads` has a reader: tests/compiler/dataReads.test.ts uses it to
   observe the compiler's layout decision. The search that said otherwise was cut off at ten
   lines. Its removal is undone. Keep or remove: **your decision**.
2. **Item 2:** the "fold if blackbody, widen if a number" wrapper is at five sites, not three:
   dataTenants.ts:210, :236 and :283; Validator.ts:1132; and its owner, Planner.ts:913. The two
   extra sites fold before asking `hasConstantNonzeroEmission`, which already handles blackbody,
   so they are redundant (same answers). The resolvers are also imported by
   tests/compiler/plannerHelpers.test.ts; an earlier search that only read single-line imports
   said otherwise.
3. **Item 3:** eight sites, not nine (materials.ts ×5, Planner.ts ×2, Validator.ts ×1).
4. **Item 4:** four generator functions re-derive "is the draw live", not one: the sampler, the pdf
   query, and their tree versions (lighting.ts:575, 668, 846, 919). The sampler also needs
   "the sky is samplable" for sky-only scenes; that stays.
5. **Item 5:** the byte-fingerprint test covers only a constant emission colour. Per-instance
   colours are used only by the loaded data-cloud demos, which that test skips.
6. **Item 6:** `proc-sky` and `proc-sky-rotated` never use the image lookup; they evaluate their
   formula. And no witness has a rotated image sky, so no witness can show the added wrap.
7. **Item 1:** step 4.8 must also update src/components/geometry/README.md:69, the comment at
   dataTenants.ts:165, and fable-geometry-materials-target.md (three mentions). The dated handoffs
   and implementation plans that mention the flag are history and stay.

## Decisions taken (Sep 26)

1. Item 1: remove the geometry `samplableAsLight` flag; the light registry is the one answer.
2. Item 2: option (a), one emission-resolution function now. Option (b) waits for the
   scene/program restructure, if we do it.
3. Item 10: remove both dead outputs. `defines` removed (d61e76a). `dataReads` turned out to have
   a test reader (Re-check 1) — kept, for now.
4. The restructure: not yet discussed.

## Decisions as first asked

1. **Item 1:** remove the geometry `samplableAsLight` flag, and let the light registry be the one
   answer?
2. **Item 2:** (a) one emission function now, or (b) derive the light from the planned surface now?
   Or wait for the scene/program restructure?
3. **Item 10:** keep or remove `CompiledScene.dataReads` and the empty `defines`?
4. **The restructure:** worth its own discussion after this batch?

Everything else follows from the rule above. The one exception, a pin versus a raw import in item
8, is minor.

---

# Part 2 — the steps (for approval)

**How every item is proven "no behaviour change".** After each commit: `npx tsc --noEmit`, and
`npx vitest run` with glslang. Three snapshots guard what reaches the GPU, and are expected
**unchanged** unless an item says otherwise:
- the generated GLSL;
- the ProgramDescription record;
- the scene-data byte fingerprints (these include the light tree).

Where a snapshot is expected to change, the item names the lines. Any other change stops the item,
and I bring it back. Only item 4.10 changes GLSL; its targeted witnesses run under
`caffeinate -i`. No full sweep without asking.

One commit per item below, in this order: smallest first, and compiler changes before the App and
GLSL ones.

### 4.1 Remove the two dead outputs [item 10]
- materials.ts:240–243: drop the empty `defines` and its comment (the contribution default is
  already empty).
- ~~Drop `CompiledScene.dataReads`~~: it has a test reader (Re-check 1); kept, for now.
- **Done:** d61e76a (the `defines` half). All tests pass; snapshots unchanged.

### 4.2 One stop sequence [item 7]
- `stopInternal(emitEvents, error?)` rejects a pending production with `error` if given
  (otherwise `RenderStoppedError`). When given an error it emits `RENDER_ERROR` before
  `RENDER_STOPPED`, the order `fail` uses today. `fail` becomes: log, then
  `stopInternal(true, err)`.
- **Proof:** the existing RenderCoordinator unit tests pass unchanged. If none covers the error
  path's event order, a test is added first, passing on today's code and after.

### 4.3 Validator: one rule for "emission on a model that cannot emit" [item 9c]
- Today the rules at Validator.ts:285 and :979 both warn for the same mistake. After, it is one
  rule: an error if the census would make the object a light, otherwise one warning (the :979
  wording, which also covers `{param}`/formula emission).
- **Test first, failing today:** a dielectric with constant emission and `sampleAsLight: false`
  gets **exactly one** warning. The two existing tests (validator.test.ts:327, :430) keep passing;
  the :334 regex is updated to the single wording.

### 4.4 Validator: camera row shapes checked once [item 9b]
- The per-row loop (Validator.ts:~785–806) records whether every row passed; `wellShaped` (:809)
  reads that instead of re-checking.
- **Proof:** validator tests unchanged. The one difference: a non-finite number now counts as
  malformed (today it slips past `wellShaped`), so the camera's `validateAuthored` no longer runs
  on it. The row error is reported either way.

### 4.5 One similarity well-formedness rule [item 9a]
- similarity.ts gets `similarityProblem(t)`, next to `similarityFromTransform`: the constant rules
  (position a finite vec3; one finite scale > 0; a quaternion of 4 finite numbers not near zero, or
  a nonzero finite axis with a finite angle). It returns which field is wrong and why.
- `placementProblem` (Validator.ts:1634) is replaced by it. `validateScale`/`validateRotation` use
  it for their constant cases, and keep their object-only rules: the driven-`{param}` rules, the
  extreme-scale warning, and the quaternion-normalization warning.
- **Proof:** validator and instancingPacked tests pass. Message texts stay as they are, formatted by
  each caller; if one must change, the plan's deviations list it.

### 4.6 Witness constants read from the shaders [item 8]
- A small helper `glslDefine(src, name)` (tests/helpers/) parses one `#define`.
- precisionWitness.ts reads `MAX_DIST` and `SHADOW_BACKOFF` from `math.glsl?raw` through it, and
  epsilonCoupling.test.ts uses the same helper instead of its own copy.
- **Proof:** `SUN_HAZE_CENTER` is identical (a vitest pins its value); the witness registry
  compiles; the snapshots are unchanged.

### 4.7 The generator reads the sky-selection decision [item 4]
- The four functions that decide the two-stage draw from `envSamplable` (lighting.ts:575, 668,
  846, 919: the sampler, the pdf query, and their tree versions) take the plan's
  `environmentSelectionLive` for that decision. The sampler keeps `envSamplable` for its sky-only
  branch. They agree today: the plan counts instanced lights only under tree selection
  (Planner.ts:450), and the pdf query runs only when a hittable light exists.
- **Proof:** generated GLSL unchanged.

### 4.8 The light census owns "which objects are lights"; the geometry flag goes [item 1]
- dataTenants.ts exports the census's shape leg as its own predicate (`isSamplableEmitterShape`).
  The census is that leg plus the material leg. "Shape T can be sampled" is `regionLightKind(T)`,
  from the light registry.
- The Validator's `samplableObjectUses` (:1524) and the driven-transform rule (:1310) call the shape
  leg. The sampleAsLight message (:259) lists the samplable shapes from the registry.
- Remove `samplableAsLight` from descriptors.ts:398–400, quad.ts:45, sphere.ts:21 and disk.ts:37,
  and update its mentions in src/components/geometry/README.md:69, dataTenants.ts:165 and
  docs/fable-geometry-materials-target.md.
- **Proof:** all snapshots unchanged; lightCensus and validator tests pass.

### 4.9 One function resolves an authored colour value [item 2, option (a)]
- `resolveColorProperty` and its scalar sibling move from Planner.ts to a new plan-layer module,
  `src/compiler/plan/values.ts` (like measurement.ts), so dataTenants.ts can import it without a
  cycle.
- The census's object route (dataTenants.ts:236–237) and `authoredLightEmission` (:208) call it,
  instead of their own blackbody-fold and scalar-broadcast. The two redundant pre-folds
  (dataTenants.ts:283, Validator.ts:1132) call `hasConstantNonzeroEmission` directly.
  tests/compiler/plannerHelpers.test.ts imports the resolvers from the new module.
- **The one possible visible difference:** today a driven authored light with a scalar `{param}`
  default gets the default widened on its material side but not its light side. After, both widen
  it. The check before committing: the generated GLSL and every uniform default for the
  driven-light scenes compared before and after. Any difference beyond the light's recorded
  default spelling stops the item, and I bring it back.

### 4.10 The Planner records which media scatter; generators read it [item 3]
- One predicate, `mediumScatters(med, scattering)` = `scattering === 'full' && mediumMayScatter(med)`,
  in compiler/types.ts beside `mediumMayScatter`. The Planner (:488, :500) and the Validator (:513)
  call it.
- The Planner records the result in the ProgramDescription as the list of material ids whose medium
  scatters in this program. It goes there rather than on the per-medium scene data, which should
  stay the same for every renderer.
- materials.ts (:122, :682, :686, :748, :833) reads the record instead of recomputing it.
- **Proof:** generated GLSL unchanged. The ProgramDescription snapshot changes by exactly one new
  field in media programs.

### 4.11 The App asks the sphere light for box and power [item 5]
- The scene-data plan's batch-light entries carry the light kind and the emission colour. Today
  they carry the precomputed channel mean; the colour is what makes the result bit-identical,
  since the descriptor takes its own mean.
- app/sceneData.ts builds each instance's values (center, radius, radiance) and calls the kind's
  `treeBounds()` and `power()`.
- **Proof:** the scene-data byte fingerprints are unchanged for instance-lights, instance-lights-sky
  and glow-shell, the light-tree texture included. Those cover only a constant emission colour,
  so a test comes first: a small scene whose instanced sphere lights carry per-instance emission
  colours, fingerprinted on today's code. It must stay identical after the change.

### 4.12 One equirect mapping [item 6]
- The equirect folder gets the mapping as its own file, `equirect_map.glsl` with `equirect_uv(dir)`
  (the rotation added, u wrapped with `fract`). It is included for every image environment,
  whichever sampling chart is chosen.
- The chart's `env_chart_uv` and the generated colour lookup (environment.ts:153–157) both call it.
- **Behaviour:** the lookup gains the wrap. The map texture repeats horizontally
  (TextureFactory.ts:90), so the colour read is the same up to float rounding in the filter
  weights near the seam.
- **Proof:** generated GLSL changes only in environment programs, and only those lines. `sky` and
  `sky-lamp` (the image-sky witnesses) pass, with their numbers recorded before and after. The
  wrap only matters under rotation, and no witness rotates an image sky. So a headless render of
  the `sky` scene with `env.rotation` set to 2.0, run before and after the change, must give the
  same frame mean. The procedural skies use only the moved chart function: glslang, plus the
  unchanged `proc-sky` numbers.

### Deviations and observations while building

- **4.1:** only the `defines` half was done; `dataReads` is kept (Re-check 1).
- **4.3:** an existing test (validator.test.ts, "warns when a non-emissive-capable model carries
  an emission value") asserted a warning in a case that is really the phantom-light error: the
  base scene's sphere uses the material. Its scenario now uses a `{param}` emission, the case only
  the removed rule covered.
- **4.5:** instead of one `similarityProblem(t)`, similarity.ts states the two rules that are
  specific to similarities: `scaleProblem` and `quaternionProblem`, plus the axis threshold
  `AXIS_DEGENERATE_LENGTH`. The position and angle checks were already one shared helper in each
  path. A third copy of the quaternion rule, found by a complete search, also uses it: the
  Planner's runtime guard for slider-driven rotations (`safeQuat`, Planner.ts:726). Its behaviour
  is identical. The Validator's "vec3" check (`isVec3`) tests shape, not finiteness; every
  number's finiteness is the scene-wide sweep. That meaning is unchanged.
- **4.6:** fog-sky's expected values (index.ts:1469–1470) also held the far clip, as
  `Math.exp(-1)` = e^{−σ·1000}. The review named them; the plan's step did not. They now use
  `MAX_DIST` too. The constants live in tests/witnesses/scenes/shaderConstants.ts, which both
  fixtures import. A new test (tests/witnesses/shaderConstants.test.ts) pins the three
  expected values to what they were before the move, and they are identical.
- **4.10:** the plan predicted the program-record snapshot would gain the field "in media
  programs"; it is in every program (the media block always exists), as `[]` in 300 of 359. The
  generator also used the program-wide flag for three program-level decisions; those stay. Proof
  as run: the generated GLSL is unchanged, and the full compiled output of all 202 suite scenes is
  byte-identical.
- **4.12:** the equirect chart's file now calls `equirect_uv` in another file, so every shader
  that includes the chart must include that file too. That covers the procedural-sky bake shader
  (EnvironmentBake.ts), which the plan did not list. The dependency is stated once, as a `needs`
  list on the chart registry entry (env/index.ts), and both the environment generator and the
  bake shader include it. Measured: the 7 checks of `sky`, `sky-lamp` and `proc-sky` are
  identical before and after (12 fresh renders). The `sky` scene rotated by 2.0 gives identical
  frame means to 10 significant digits on all four estimators.
- **Observation, not changed (for you):** a `{param}` emission on a model that cannot emit still
  gets two warnings: this rule's, and the general "a {param} knob the model doesn't read" rule.
  That was true before this batch, and it is outside the step as planned.

### Records
One CHANGELOG entry ("review batch 4"), the handoff, this plan marked done with its deviations, and
the review page.

### Not in this batch
- The scene/program restructure (item 2 option (b) waits for it).
- The review's missing guards (listed in part 1).
- Moving `MAX_DIST` out of GLSL.
