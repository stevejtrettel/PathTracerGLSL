# HANDOFF — the Aug 10 2026 SDF-acceleration session (Stage C)

**Written for a FRESH instance + the owner, at the owner's request, to adjudicate ONE
main decision and a handful of riders. Read this whole file before touching anything.
The owner wants a SIMPLE system, is (rightly) skeptical of salvaging failed
experiments, and requires structure DISCUSSION before implementation. This session
went badly in places — the process lessons at the bottom are not optional reading.**

---

## 1. Where things stand (verified state, not narrative)

- **Commit `d6f3f0b`** holds the day's PROVEN work, all owner-GPU-swept green:
  light-BVH stages 1–2 + instance lights, mesh emitters under the light tree, the
  accel review/correctness fixes, the walk & builder consolidation
  (`bvhWalkLines`, `buildBVHCore`), placement-fold stage 4 (box/cylinder analytic,
  cube clouds), directional/beam/softbeam. Do not disturb any of it.
- **Stage C (boxed-SDF leaves) sits UNCOMMITTED on top** — `git diff` shows exactly
  and only it (19 paths incl. snapshots), plus two untracked docs:
  `docs/fable-sdf-accel.md` (the design authority) and `docs/impl-plan-sdf-accel.md`
  (the build record **including the incident record — read it**).
- **Stage C WORKS as it sits**: after the one-shot fix, `sdf-field` (150 distinct
  SDF objects, table dispatch) loads in **0.74s on Metal / 2.9s SwiftShader** and
  renders correctly; the owner confirmed it interactively ("this holds up").
  vitest 1759 green, glslang green on every pair. The owner's witness sweep of the
  Stage C gates (`sdf-table-twin`, the `solids`/`cube-cloud` twins from stage 4,
  `perf-sdf` crossover under `--perf`) has NOT run yet.

## 2. The failure that already happened (so nobody re-trips it)

The first build stalled shader compile past ~50 objects on EVERY backend (froze the
owner's machine → black screen). Mechanism: the generated leaf marchers committed
hits through `raymarch_commit` → `scene_normal` → `scene_object_sdf`, an **N-arm
region dispatch**, which GLSL compilers inline at every commit site inside every
marcher: ~6·N ops × 2 sites × 3 type-marchers × nearest/any variants. Fixed by the
self-contained per-type commit `march_commit_<type>` (six taps of the leaf's OWN
field, O(1); quat-rotated once). Full mechanism + measurements in
`impl-plan-sdf-accel.md` § "THE FAILURE AND THE FIX".

**The generalized law that must survive any decision below:** in generated GLSL,
per-region code may be O(N) only as single-line arms in top-level functions; no
O(N)-body call may be reachable from inside any per-item loop (inlining multiplies
it by every enclosing site).

---

## 3. THE MAIN DECISION — the shape of the SDF leaf-march code

Both options produce near-identical GPU code (post-fix) and identical images. This
is a decision about **code organization and long-term maintainability**, not
correctness or speed. The heat it carries is from the session's history, not from
the technical stakes — both answers are sound.

### Option 1 — KEEP the as-built form (generated per-type marchers, post-fix)

The compiler emits, per SDF type present in a tabled scene:
`<type>_from_record` reader, `sdf_leaf_field_<type>`, `uv_leaf_<type>`,
`march_commit_<type>`, `march_leaf_<type>`, `march_leaf_any_<type>` — defined in the
scene-table block, PROTOTYPED in the sdf-dispatch block (an ordering dance:
generated blocks emit in a fixed sequence, and the region dispatches reference the
field helpers before their definitions).

- **For**: it exists, it is measured working (0.74s Metal @150 objects), vitest/
  glslang green, and the marchers can bake per-type constants at emission time if
  ever wanted. Zero further engineering risk.
- **Against**: it VIOLATES the repo's own pinned doctrine — **"math is static;
  policy/plumbing are generated"** (fable-transport-glsl-target; the rule the whole
  transport family was rebuilt around). The march loop is *math* and it lives in
  the generator as strings: harder to read, harder to test in isolation, invisible
  to the per-component .md/test pattern, and the prototype/definition split exists
  ONLY to serve this choice. Six generated functions per type is real surface.
- **Required follow-ups if kept** (from the session's review, all small):
  (a) region dispatches (`scene_object_sdf`/`scene_object_uv`) must emit
  **residual-only arms** — the tabled arms are DEAD (no caller can reach them since
  the commit fix) and are the last live instance of the §2 inlining hazard: one
  driven SDF added to a 1000-tabled scene re-triggers the explosion through
  `raymarch_commit`'s 6-tap gradient. This is a deletion, provable by the twin.
  (b) assert `residual.scale === 1` at record pack (a future multi-point-row shape
  would silently mis-scale distances instead of failing loudly).
  (c) the eligibility record-budget check should call `sdfTailTexel` instead of
  duplicating its arithmetic.

### Option 2 — REBUILD the GLSL half in the UNIFORM form (the owner's original idea)

"An SDF object is an analytic object whose intersect happens to iterate." Move the
math to the components, exactly as every other primitive's math lives:

- Add to each SDF-capable component file, beside its `_sdf`:
  `bool <type>_sdf_intersect(Ray lray, <Struct> s, float t0, float t1, out float t)`
  (~15 static lines: march |sdf| in the interval; epsilon-dilation + stall discipline
  inline — transcribe from the current generated marcher, which is verified) and
  `vec3 <type>_sdf_normal(vec3 p, <Struct> s)` (six taps, static).
- The generated `LEAF_SDF` arm reshapes to a near-copy of the PROVEN
  instanced-analytic leaf (`instanceLeafItem`'s third arm): fetch record, conjugate
  by the rigid tail (`placement_rigid`/`placement_dir`), kind-dispatch, call
  `<type>_sdf_intersect`, fill the hit locally (`placement_normal` on the static
  gradient; uv from the type's chart or the planar placeholder).
- DELETE: all six generated per-type functions, the prototype block, the tabled
  arms in the region dispatches (they die naturally — the dispatches revert to
  their exact pre-Stage-C residual-only role). The plan side (eligibility,
  `LEAF_SDF`, records + rigid tail, leaf-1 interval, `sdfRecordPack`/`sdfTailTexel`)
  is UNCHANGED — it was clean and is test-pinned.

- **For**: matches the house doctrine and the owner's stated want (SIMPLE); the
  generator's Stage C footprint shrinks ~two-thirds; the §2 hazard class becomes
  structurally impossible (static functions over structs never touch region
  dispatches); a new SDF shape = one function beside its sdf (the door pattern);
  per-type math gets the component test/md treatment.
- **Against**: it is a rewrite of the verified GLSL half — everything re-gates from
  scratch (twin witness, glslang, the headless matrix, the owner's sweep). The
  march-loop skeleton repeats across the three shape files (~15 lines each — the
  same accepted repetition as each type's closed-form intersect). One session of
  careful work with real (if modest) regression risk, at the end of a day with no
  trust budget left.
- **Riders (b) and (c) from Option 1 still apply** (they're plan-side).

### Option 3 — REVERT Stage C entirely

`git checkout` the 19 diffed paths + delete the two untracked docs' code references
(keep the docs as the rebuild spec — they are complete: design + incident + this
handoff). Rebuild later, fresh, on the Option 2 shape.

- **For**: cleanest possible slate; honors the owner's "prefer rebuild with a good
  plan" instinct; zero risk carried forward; `d6f3f0b` loses nothing.
- **Against**: throws away a working, owner-verified 150-object result whose only
  criticized property is code organization; the rebuild will re-do ~80% identically
  (the plan side and the math transcribe straight back).

### The recommending instance's view (label it as such to the owner)

Option 2, executed as a single disciplined batch against the existing gates — it is
the owner's own design instinct, the house rule, and mostly deletion; Option 1 is a
legitimate cheaper stop if the appetite for one more GLSL change is zero (take its
follow-up (a) regardless — the dead arms are a live hazard); Option 3 is the right
answer only if trust in the current diff itself is gone.

---

## 4. Rider decisions (independent of the main one; none urgent)

1. **Leaf-1 scene TLAS is currently UNCONDITIONAL** (Stage C changed it from
   leaf-2). Correct always; for pure-analytic tables (grand-bazaar) it ~doubles
   node count with unmeasured perf effect. Decide by measurement (a grand-bazaar
   perf row) or make leaf-1 conditional on SDF leaves being present.
2. **Containment is runtime-linear in tabled solids** (the record loop in
   `scene_region_at`, ~3 fetches + one field eval per solid per classification
   probe). Pre-existing table property (analytic side identical). Fine at hundreds;
   the deferred point-in-box early-out or a containment descent is the 1000+ answer.
   Declare the ceiling in `fable-sdf-accel.md` either way.
3. **Nothing is measured past 150 distinct objects.** A `perf-sdf-1000` TABLE-ONLY
   arm (never an unrolled arm on a big card — see lessons) would turn "ready for
   1000 distinct SDFs" into a number. Expected fine post-(a); unproven.
4. **SDF instancing (thousand-COPY clouds) is the deferred door**: the frame-tier
   instancing wrapper + the leaf march as the leaf body. Small batch; unlocks
   SDF clouds; do it after the main decision lands.
5. **The owner's sweep of Stage C + stage-4 witnesses has not run** — whatever
   option is chosen, `npm run witness` (and `-- --perf` for the crossover) is the
   final gate. (Sweep is owner-run, never agent-run.)

## 5. Verification kit (all of it exists and worked this session)

- Cheap gates: `npx tsc --noEmit`, `npx vitest run` (1759 green at handoff),
  glslang rides in vitest. Snapshots re-golden with `-u` — audit the diff classes.
- **Headless GPU matrix** (NEVER have the owner smoke-test risky GPU work): the
  pattern is in this session's scratchpad as `diagnose.mjs` — playwright chromium,
  `--use-angle=swiftshader --enable-unsafe-swiftshader` for CPU reference AND
  `--use-angle=metal` for the real platform, 120s hard timeouts, time-to-ready +
  screenshot luminance. Recreate it if the scratchpad is gone (~60 lines; dev
  server on :3000, `lab.html?scene=<id>`, wait for `window.app`).
- The A/B and stress gates: `sdf-table-twin` (30 objects, table ≡ unrolled
  identical-stream + the grazing-slab epsilon stress), `sdf-field` (the 150-object
  demo card — the owner's own acceptance test).

## 6. Process lessons from this session (they cost more than the bug did)

1. **The eager-compile rule**: the app compiles EVERY strategy arm at card load.
   Never put an unrolled/global arm on a card past ~50 objects (grand-bazaar's
   entry documents this; it was ignored once this session, freezing the owner's
   machine). A/B arms at scale belong on small witnesses.
2. **When the owner reports an observation — diagnose and DISCUSS. Do not rewrite
   fixtures, build harnesses, or delete files on inference.** "Back up" does not
   mean delete; "separate" means commit-split. Ask when scope words are ambiguous.
3. **Headless first** for anything that can hang a GPU.
4. **Sizing rule for generated GLSL** — §2's law. Review any generated code against
   it before it ever reaches a browser.
5. The owner wants **one clear recommendation**, not menus; structure discussion
   BEFORE implementation; and math transcribed into components, not generated.
