# Plan: plan the scene once, then each renderer

**Status:** proposed Sep 26, 2026, for the owner's approval. No code is written. Line numbers are
at 104521e.

**Decided with the owner (Sep 26):**
- Keep N renderers per scene. The real uses are a real renderer plus a fast preview, and
  comparing strategies that differ in transport. The code for 2 renderers is the code for N, so
  a cap buys nothing.
- Plan the scene once, then plan each renderer against it.
- One rule: **anything the renderers share (the scene plan, the GPU data) must not depend on any
  renderer's settings.**
- Colour, option (a): the shared parts keep colours as the author wrote them, and each renderer
  converts. Spectral may come soon, and an RGB preview beside a spectral renderer is a natural
  case of the first use.

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

**4. Colours as authored in the scene plan.**
- `resolveColorProperty` stops converting a constant blackbody. It still turns a scalar into a
  grey triple; a grey RGB triple is the same colour under any colour model.
- The RGB conversion (`foldBlackbody`) is applied on the renderer side, where the colour is
  used. Two users already do this (`emitValue`, `resolveRadiometricValue`). Four sites assume
  plan entry did it and must convert first:
  - the Planner's `emitters.driven` (Planner.ts:627) counts any blackbody as driven. It gets a
    "driven value" predicate. The Validator spells the same predicate (Validator.ts:666), so both
    call one function.
  - materials.ts:46 and :389: "is this emission nonzero" treats any blackbody as nonzero. A
    constant blackbody with scale 0 is legal and is zero.
  - lighting.ts:97: an instanced light's emission must be a triple or an attribute; a blackbody
    would throw.
  - sceneData.ts:171: the same emission packed for the light tree; a blackbody would silently
    become black.
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

1. **Blackbody in GPU memory.** Everything in the shared GPU data is already in the authored form
   (RGB triples, per-instance values, image skies) except one case: a constant-blackbody light is
   stored as RGB in the light tree's rows. Storing its temperature instead would mean GPU data
   and GLSL that no renderer reads, which your unused-code rule forbids.
   **Recommend:** keep RGB there until a spectral renderer exists; the spectral plan changes it.
   This is narrower than the "(a)" I described: the scene plan is fully as authored, the GPU data
   is except for this one case.
2. **Delete the test "decisions do not depend on the data layout"** (dataReads.test.ts:30). After
   step 2 the decisions function has no layout input, so the test cannot fail. The other tests in
   that file stay. **Recommend:** delete.
3. **Commit the digest tool** (step 0). Both refactor batches relied on it, and the scratch copy
   was broken. **Recommend:** yes.
4. **Split Planner.ts** after the restructure (step 5). **Recommend:** yes, as its own commit.

## Not in this plan

- Validation split the same way. Today a scene's rules run once per strategy, and repeated
  warnings are merged by their text.
- Spectral itself. RGB-only authored forms it will have to handle: GLSL-formula colours,
  image skies, media coefficients given as RGB.
- The App's own derivation of environment-table variants (claude-data-exact-linkage.md, status).
- A `{param}` emission on a model that cannot emit still gets two warnings.
