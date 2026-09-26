# Plan: plan the scene once, then each renderer

**Status:** approved Sep 26, 2026. Owner decisions 1–3 answered (below); decision 4 is asked at
step 5. Line numbers are at 104521e.

**Decided with the owner (Sep 26):**
- Keep N renderers per scene. The real uses are a real renderer plus a fast preview, and
  comparing strategies that differ in transport. The code for 2 renderers is the code for N, so
  a cap buys nothing.
- Plan the scene once, then plan each renderer against it.
- One rule: **anything the renderers share (the scene plan, the GPU data) must not depend on any
  renderer's settings.**
- Colour, option (a): the shared parts keep colours as the author wrote them, and each renderer
  converts.
- **Spectral is being built next. Plan as if it exists tomorrow.** An RGB preview beside a
  spectral renderer on one scene is a target case, so this plan's colour step builds the seam
  spectral plugs into.

---

## Today

- `compileScene` (Compiler.ts:27) runs the Planner's one function, `planWithLayout`
  (Planner.ts:77), **2N times** for N renderers:
  - N trial runs (`programDecisions`, via line 55), each against a layout holding every optional
    structure (`READS_EVERYTHING`). They exist only to learn what each renderer reads.
  - N real runs (line 61), against the union of those reads.
- `planWithLayout` has two halves:
  - **The scene half (lines 87–393)**: materials, objects, meshes, instance batches, lights,
    the ambient medium, the object table, the light tree. It reads neither the strategy nor the
    Analyzer's facts (checked: the only mentions are the signature and a comment). But it
    stamps data-texture addresses onto the objects as it goes.
  - **The renderer half (`planProgram`, lines 418–638, and `planPipeline`)**: the strategy's
    decisions. It reads no addresses.
- The GPU data plan is built from the first renderer's copy of the scene half
  (`sceneDataPlanOf(scene, plans[0])`, Compiler.ts:74), trusting that all copies agree. Nothing
  checks that.
- The addresses stamped into the scene half (every `dataLayout` read in Planner.ts):
  - `PlannedMesh.slot` (line 145);
  - `PlannedInstanceBatch.slot` and a mesh prototype's `geometrySlot` (lines 179–194);
  - the `base` of per-instance attribute references, written into the batch material's values
    (line 171);
  - a mesh light's `tbase`, `wposBase` and `cdfBase` (lines 329–332);
  - `PlannedPrimitiveObject.tabled`, `sceneTable` and `lightTree` (lines 353–393).
- An emissive object's light values are computed twice, from the scene description: by the
  light roster (`lightRosterOf`, dataTenants.ts:228) and, as a surface, by the Planner. They
  agree (the census test, a018f4b), but nothing makes them agree by construction. This is
  batch 4's item 2 option (b), which was waiting for this restructure.
- Colour: a constant blackbody is turned into RGB at plan entry (`resolveColorProperty`,
  plan/values.ts:17). The generator already converts a blackbody itself wherever it writes a
  value (`emitValue`, generate/values.ts:58), and so does the CPU evaluator for light values
  (`resolveRadiometricValue`, lighting.ts:353). No suite scene uses a constant blackbody
  (hearth's lamp is driven).

## The target

```
compileScene(scene, strategies)
  analyze, validate each strategy                    (unchanged)
  planScene(scene)                    → ScenePlan     once: what the scene is; no addresses,
                                                            no strategy, colours as authored
  planProgram(scene plan, strategy)   → decisions     per renderer (today's planProgram)
  union of what the renderers read    → reads         (today's unionDataReads)
  placeScene(scene plan, reads)       → PlacedScene   once: the data layout and the addresses
  sceneDataPlanOf(placed scene)       → GPU data plan once (no more plans[0])
  generate(placed scene + decisions)  → renderer      per renderer (the generator is unchanged)
```

- The rule becomes structural: `planScene` and `placeScene` take no strategy. The only thing
  they learn about the renderers is the union of what they read, which is what the shared layout
  needs.
- The trial runs disappear: decisions are computed from the scene plan, which has no layout.
- The generator keeps reading a `RenderPlan`, now assembled as the placed scene plus one
  renderer's decisions and pipeline. Its fields do not change, so no generator code changes.
- The placed scene is shared by every renderer's generation. Generators already build new
  arrays rather than modify the plan (checked: the in-place sorts in intersection.ts sort
  copies). A new test (step 1) guards this.
- Unchanged: `CompiledScene`, the App, the engine, and the locked compiler↔engine types.

**Types.** The scene plan's records are the placed records without their address fields
(written with `Omit<…>`, one definition each). `placeScene` builds new records. It never
modifies the scene plan.

---

## Steps (one commit each)

Each step must leave the compiled output unchanged. **The proof, for every step:** a digest of
all 203 suite scenes, compiled with their declared strategies, is identical before and after.
The digest covers each renderer's shader text, uniforms, defaults, parameters, pipeline and
source maps, the GPU data plan (including the contents of its packed arrays), and the warnings.
Identical shaders and an identical data plan mean the GPU receives identical input, so no witness
render is needed. If a digest differs in a way the step doesn't predict, I stop and report.

**0. The digest tool.** `scripts/digest-compiled.ts` (owner decision 3). It checks itself: it
fails if its output contains no shader text. The scratch version used in batch 4 wrote the
shader Map as `{}` and packed arrays only by length. That false claim is corrected in the
CHANGELOG; the re-check confirmed batch 4's result.

**1. Guard: compiling is order-independent.** A test: for every suite scene with two or more
strategies, compiling them in reverse order gives each renderer the same output and the same
GPU data plan. Today this tests the `plans[0]` premise; after step 2 it guards the shared placed
scene. *Breakage:* a generator that appends to a plan array must fail it.
*Done (step 1):* 91 suite scenes have two or more strategies; all pass, so the `plans[0]` premise
holds across the suite today. The planned breakage cannot fail today, because each renderer still
has its own plan; it is run after step 2. Two other breakages fail it now: a light's radiance
doubled only under light-tree selection (3 scenes fail), and a generator counter kept between
compiles (all 91 fail).

**2. The split.** In Planner.ts:
- `planScene(scene, bag)`: the scene half without addresses. Which batch instances are lights
  (`lightBatches`) moves out of `dataTenantsOf` into a function both call, so the scene plan
  needs no layout to know it.
- `planProgram`: unchanged logic; it takes the scene plan instead of loose lists.
- `placeScene(scene, scenePlan, reads)`: `dataTenantsOf` and `planDataLayout`, called once, then
  the addresses, the object table and the light tree.
- `planRenderers(features, scene, strategies, bag)`: the whole Plan stage for a set of renderers.
  `compileScene` calls it, and so do the six test files that call `plan()` today (a direct call
  for one renderer is `planRenderers(…, [strategy])`).
- Removed: `planWithLayout`, `programDecisions`, `READS_EVERYTHING`, and `plan()`'s `reads`
  argument.
- `sceneDataPlanOf` takes the placed scene.
- Proof: the digest. I also record compile time for the largest suite scenes before and after,
  as a measurement, not a gate.
- *Done (step 2):* the digest is identical for all 203 scenes. vitest 2696 passing: 362 fewer,
  exactly the deleted test's one case per scene and strategy pair. With step 1's planned breakage
  (a generator appending to the shared `materials`), all 91 order tests fail. Compile time shows
  no measurable change: the whole suite takes 240–400 ms before and 240–290 ms after, and repeat
  runs vary more than the difference.

**3. An emitter's light comes from its planned surface** (batch 4 item 2 (b)).
- `planScene` builds each emissive object's light from the planned object and the planned
  material: `valuesFromRegion(planned parameters, planned emission)`. A mesh light takes its
  radiance from the planned material and its area from the planned placement.
- An authored light's values (`toValues`) move from the roster into `planScene` too, so all light
  values are made in one place.
- `lightRosterOf` keeps only identity (kind and source), which is all the data layout reads.
- The census test's comparison (roster values = values from the planned surface) becomes true by
  construction, the kind of test batch 5 removed. Replace it with hand-computed expected values
  for the translated, rotated and scaled quad, sphere and disk emitters and the mesh's area, so it
  can still fail.
- Proof: the digest.
- *Done (step 3):* the digest is identical for all 203 scenes; vitest 2696 passing. The census
  helper now checks only authored area lights against their regions (still two computations: 2
  lights). The four object lights are checked against values the test computes with its own
  rotation (Rodrigues' formula) and the placement rule x ↦ R(s·x) + t. The two blackbody-emitter
  tests check their values directly. *Breakages,* each failing the emitter test: the light built
  from the authored (unplaced) parameters; the mesh area without the placement's scale.

**4. Colour conversion becomes a renderer step.**
- `resolveColorProperty` stops converting a constant blackbody, so the scene plan holds colours
  as authored. It still turns a scalar into a grey triple; a grey RGB triple is the same colour
  under any colour model.
- One function converts an authored colour for a colour model (the renderer's
  `measurement.color`). It is called wherever a colour is used for a renderer, and nowhere else.
  Today it has the RGB branch (`foldBlackbody`); spectral adds its branch in this one function.
  The call sites:
  - the generator's value writer (`emitValue`) and the CPU light-value evaluator
    (`resolveRadiometricValue`), which convert already;
  - four sites that assume plan entry converted, and must call the function first (below);
  - the GPU data packer (sceneData.ts), for the colours in shared memory.
- The four sites:
  - the Planner's `emitters.driven` (Planner.ts:627) counts any blackbody as driven. It gets a
    "driven value" predicate. The Validator spells the same predicate (Validator.ts:666), so both
    call one function.
  - materials.ts:46 and :389: "is this emission nonzero" treats any blackbody as nonzero. A
    constant blackbody with scale 0 is legal and is zero.
  - lighting.ts:97: an instanced light's emission must be a triple or an attribute; a blackbody
    would throw.
  - sceneData.ts:171: the same emission packed for the light tree; a blackbody would silently
    become black.
- **Shared GPU memory.** It holds a few colours: the light tree's rows, per-instance colours and
  image skies. Today the packer stores them as RGB; after this step it gets them through the one
  function, with identical bytes. When an RGB preview and a spectral renderer share a scene,
  shared memory must serve both. It can hold one copy per colour model that some renderer on the
  scene uses, the way optional structures are already laid out (`DataReads`). Or it can hold one
  form that each shader converts when it reads. That choice is the spectral design's (contracts §8
  upsamples RGB with fitted coefficients, which bears on it). Step 4 should be built to match it,
  so **the spectral design comes before step 4** (owner decision 1). Steps 0–3 do not touch colour.
- **Test first, since no suite scene covers this:** a constant blackbody compiles to exactly the
  output of its RGB triple, in each place a colour can be one: an emissive object's material, an
  authored area light and point light, an instanced light batch, the constant sky, and the scale-0
  case. It passes today and must pass after. *Breakage:* drop the conversion at the sceneData
  site; the instanced-light case must fail.
- Proof: the digest and the new test.

**5. (Owner decision 4) Split Planner.ts** into the scene plan, the program plan and placement,
as a pure move. Proof: the digest.

**6. Records.** Update CLAUDE.md (the Plan stage; the colour rule under Conventions),
docs/compiler-system.md (its `plan(features, scene, strategy)` section),
docs/claude-data-exact-linkage.md (Design §2, "each strategy is planned as today"), the handoff,
and the CHANGELOG.

---

## Owner decisions

1. **Write the spectral design before step 4** (docs only, starting from
   fable-compiler-contracts.md §8). Its first question is how shared GPU memory serves an RGB and
   a spectral renderer on one scene, and step 4 builds to that answer. It can be written while
   steps 0–3 are built. **Decided:** yes; another instance writes the spectral design now.
2. **Delete the test "decisions do not depend on the data layout"** (dataReads.test.ts:30). After
   step 2 the decisions function has no layout input, so the test cannot fail. The other tests in
   that file stay. **Decided:** delete.
3. **Commit the digest tool** (step 0). Both refactor batches relied on it, and the scratch copy
   was broken. **Decided:** yes.
4. **Split Planner.ts** after the restructure (step 5). **Recommend:** yes, as its own commit.
   Asked at step 5.

## Not in this plan

- Validation split the same way. Today a scene's rules run once per strategy, and repeated
  warnings are merged by their text.
- Building spectral (its own design and plan, next). Authored forms that are RGB today and that
  its design must cover: GLSL-formula colours, image skies, media coefficients given as RGB.
- The App's own derivation of environment-table variants (claude-data-exact-linkage.md, status).
- A `{param}` emission on a model that cannot emit still gets two warnings.
