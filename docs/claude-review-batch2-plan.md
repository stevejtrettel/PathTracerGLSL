# Batch 2 plan — contained correctness fixes

**Status:** done Sep 25 (commits a23c3a4 … b9c51c4; CHANGELOG "review batch 2"). Decisions taken:
`renderTiled` rejects on stop; start/resume are refused during a restore; a second
`initialize()` recompiles the scene's strategies together. Deviations from the plan: the loop
budget limit is 2³¹ − 2, not 2³¹ − 1 (the `<=` loops need one more increment); the 2.2 case
"a production started during the PNG write" could not be reproduced, so that guard is
unobserved; 2.1 also drops the measured keys from restored sessions (a session saved by an
older build carries them). Items come from
[claude-review-2026-09-25.md](claude-review-2026-09-25.md) (numbers in brackets). Every
"Problem" below was read in the code at HEAD 9b0906a; file:line references are to that commit.

**In scope:** review items 1.4, 1.5, 1.6, 1.7, 1.8, 1.10 and the small items of 1.11.
**Not in scope:** the GRIN design (1.1, 1.3) and the shadow-ray aim (1.2), which get their own
plans; the duplicated decisions of Part 2 (batch 4) except where an item here needs none; the
fp spawn margin (1.11, suspected), which needs a measurement plan first; history in comments.

**How each item is done:** one commit per item. The failing test is written first and seen to
fail; then the fix; then `npx tsc --noEmit`, `npx vitest run` (incl. glslang). GLSL changes
also get their targeted witnesses. No full sweep; I will ask when the batch is done. One
CHANGELOG entry at the end.

**One limitation up front.** There is no test harness for `App` itself (it needs a DOM and
WebGL); the unit tests cover the managers it delegates to (ProductionOrchestrator,
RendererManager, ParameterStore, RenderCoordinator) with fakes. Where a fix lives in a manager,
the failing test comes first. Where it lives in `App`, the plan says so, and the check is a
one-off headless probe (the witness runner's page, driven by a script), run before and after
and recorded in the CHANGELOG. Building an App test harness is a separate job.

---

## 2.1 Session restore must not touch measured environment values [1.4]

**Problem.** `ParameterStore.restore` removes every key the session lacks (ParameterStore.ts:89–112).
The App keeps three values it *measures* from the loaded environment in that same store:
`env.size`, `env.totalWeight` (App.ts:211) and `env.sizeOct` (App.ts:223, 320). Restoring a
session without them drops them to their compiled defaults — the 1×1 table size — so
environment NEE samples and weights against the wrong table, with no error. Restoring a session
saved with a different map overwrites them with that map's values: the same bug the other way.

**Rule.** A session holds what the user chose. Measured facts about the loaded content are not
session state. (CLAUDE.md reserves the `env.` prefix for the App.)

**Fix.** The App gives these three values to the engine directly (`engine.setParameter`),
not through the ParameterStore. Their only readers are engine-side: the generated environment
uniforms (environment.ts:60) and the environment-selection closure (lighting.ts:535–559).
Consequence: they no longer appear in session files, `getAllParameters()` or export stamps.
*To verify while implementing, and stop if false:* that the derived-uniform closures read
the engine's parameter map (so they see values that never went through the store), and that
every place that sets these values already resets accumulation (initialize, before the first
frame; `loadEnvironmentHDR`, via `clearAccumulation`; context restore).

*Rejected:* a "derived keys" notion inside ParameterStore — a second kind of key for the store,
serialize and restore to special-case.

**Boundaries.** App.ts: the three calls in `_loadImageEnvironment` and
`_bakeProceduralEnvironment`. Nothing else.

**Check.** In App, so a headless probe: load an image-environment scene, restore a session
without `env.*` keys, then one carrying another map's `env.size`; read the engine's `env.size`
before and after each (today: changed; after the fix: unchanged).

---

## 2.2 Tiled rendering: teardown and outcome [1.5]

**Problem.**
- (a) `renderTiles` clears the pixel offset and image size only if no newer session exists
  (ProductionOrchestrator.ts:137–143). After `app.stop(); app.renderProduction(…)` during a
  tiled job, the new production renders with the last tile's offset and the full image size.
- (b) `App.renderTiled`'s `finally` calls `start()` unconditionally (App.ts:451–460). After the
  last tile, the PNG encode runs while the session is already idle; a production started then
  is torn down by that `start()` (which calls `exitProduction`).
- (c) `renderTiled` swallows `RenderStoppedError`, so a caller cannot tell "saved" from
  "stopped, nothing saved"; `renderProduction` rejects on stop.
- (d) `renderTiled` calls `stop()` before TiledRenderer's "already running" check, so a second
  call kills the running job.

**Rule.** Leaving production restores the whole interactive view; nothing restarts interactive
rendering over a session it did not start.

**Fix.**
- `exitProduction()` also clears the pixel offset and image size — they are part of the
  production view, and only tiles set them. `renderTiles`' `finally` keeps only
  `if (run === this.runId) this.exitProduction()`.
- `App.renderTiled` throws if a tiled job is already running, before `stop()`; in `finally` it
  restarts interactive rendering only if the production phase is idle; it lets
  `RenderStoppedError` propagate, like `renderProduction` (RenderControlsExtension already
  handles that error).

**Needs your decision:** (c) changes `renderTiled`'s contract — it rejects with
`RenderStoppedError` when stopped, instead of resolving.

**Boundaries.** `ProductionOrchestrator.exitProduction` and `renderTiles`; `App.renderTiled`;
a phase query on the orchestrator if none exists.

**Check.** Failing tests first in productionOrchestrator.test.ts: stop during a tiled job, then
start a production → the new session has no offset and no image size. The App half ((b)–(d)) by
headless probe.

---

## 2.3 An export writes the image that was there when it was asked for [1.6]

**Problem.** Auto-export awaits the PNG encode (ProductionOrchestrator.ts:75) before
`exportHDR` reads its buffer, and `exportAllAOVs` reads each AOV only after awaiting the
previous save (App.ts:757–775). Escape is accepted while locked; `stop()` → `exitProduction()`
resizes and clears the buffer inside those windows, so the HDR and AOVs can be saved from the
cleared buffer, with a stamp. The comment at ProductionOrchestrator.ts:72–74 no longer holds.

**Fix.** Split each export into a synchronous *capture* (read the buffer, its size and the
stamp) and a *save* (encode, hand to the browser). `exportAllAOVs` captures every AOV first;
the orchestrator's auto-export captures PNG, HDR and AOVs before its first await, then saves.
Public signatures unchanged.

**Boundaries.** App's export methods; the auto-export block of `renderProduction`.

**Check.** Failing test first in productionOrchestrator.test.ts with a stub App whose PNG
save awaits a promise the test controls: stop during it, and assert the HDR written is the
pre-stop buffer. The App's capture split by reading plus the existing file-export tests.

---

## 2.4 Context restore: a gate, visible errors, the environment path [1.7]

**Problem.**
- `_restoreAfterContextLoss` pauses, then awaits the scene-data repack and the environment
  fetch (App.ts:243–267). `\`, Space and the panel's Resume can restart rendering before the
  textures are registered again; the frame throws, the loop stops, and the final
  `if (wasRendering) resume()` does nothing (resume works only from paused), so rendering
  stays off after a successful restore.
- `_showErrorOverlay` shows only errors that carry a diagnostic bag (App.ts:386), so frame
  errors (`RENDER_ERROR`) and restore failures are never shown; restore failures are not
  logged either. The CHANGELOG says frame errors are shown.
- `loadEnvironmentHDR` records the new path before the load succeeds (App.ts:408), so a failed
  load makes every later restore fail.
- A finished production on display keeps offering export of an image the restore erased.

**Fix.**
- A `restoring` flag. While it is set, `start`, `resume`, `renderProduction` and
  `extendProduction` refuse with a logged message; `stop` still works. At the end, resume only
  if still paused.
- Plain errors are shown by wrapping them in a one-entry DiagnosticBag (the overlay's only
  input; code `context-lost` for restore failures), and restore failures are also logged.
- `loadEnvironmentHDR` records the path only after the load resolves.
- A restore exits a finished production (its image is gone).

**Needs your decision:** refuse start/resume during a restore (my proposal), or queue them.

**Boundaries.** App.ts only.

**Check.** In App: headless probe that loses and restores the context (WEBGL_lose_context),
presses resume during the restore, and checks the render resumes afterwards; a failing
`loadEnvironmentHDR` followed by a context loss.

---

## 2.5 A second `initialize()` must not leave renderers on a stale layout [1.8]

**Problem.** `RendererManager.initialize` compiles only the new strategies and replaces the
scene data (RendererManager.ts:63–113); renderers already loaded keep offsets baked against the
old layout. The witness runner's variance path relies on this additive behaviour, and its
comment says "nothing already loaded is clobbered" (tools/witness.mjs:350). No witness number is
wrong today because the runner never renders the old renderers afterwards.

**Fix.** For the same scene, `initialize` recompiles the union of the loaded and the new
strategies, so every renderer is baked against the one layout the scene data uses. For a
different scene it replaces everything (unloads the old renderers). The runner's comment is
corrected.

*Rejected:* always replace — the runner's variance path selects the base renderer as a
fallback, so it would need changing too.

**Needs your decision:** these `initialize()` semantics (union for the same scene, replace
for a different one). "Same scene" = the same `SceneDescription` object.

**Boundaries.** `RendererManager.initialize`; tools/witness.mjs comment.

**Check.** Failing test first in rendererManager.test.ts (fake compiler): initialize strategy A,
then the same scene with strategy B → the compiler was asked for [A, B] and A was reloaded.

---

## 2.6 Validate the environment colour [1.10]

**Problem.** A constant environment's `color` and `intensity` are never validated
(Validator.ts ~872–887 checks only procedural environments). A negative colour or a nonsense
blackbody compiles and feeds the environment-selection probability (reviewer ran it:
`color: -1` gives P = 0.01).

**Fix.** Call the existing `validatePropertyValue(color, { shape: 'spectrum', constraint: {
kind: 'nonnegative' } }, 'environment.color', bag)` and require `intensity` finite and ≥ 0. No
new checking logic. (The lights' inline copy of the same checks is a Part 2 item, batch 4.)

**Boundaries.** The Validator's environment section.

**Check.** Failing tests first in validator.test.ts: negative colour, blackbody kelvin −100 and
scale −2, intensity −1 → errors; valid spellings → none.

---

## 2.7 Small items [1.11]

- **(a) rough_dielectric compares the indices, not their quotient.** Test `n_i == n_t` (both are
  in hand at all three sites, rough_dielectric.glsl:51, 92, 136) instead of `n_i / n_t == 1.0`.
  Identical wherever division is exact, which SwiftShader's is, so no failing test is possible
  here. Check: glslang, and `rough-sheet`, `rough-smooth-limit`, `rough-mis`, `rough-furnace`
  read the same numbers.
- **(b) mesh-light sampling rejects NaN.** `if (!(cos_l > 0.0))` instead of `cos_l <= 0.0`
  (lights/mesh/mesh.glsl:56), so a degenerate sliver's NaN normal gives pdf 0. No reproducible
  failing test (it needs a triangle degenerate in f32 but not in f64). Check: glslang,
  `mesh-light-twin`, `mesh-light-smooth` and `accel-triple` read the same numbers.
- **(c) OBJ normals.** A vertex whose adjacent faces cancel gets the largest adjacent face's
  normal instead of (0,0,0) (loadOBJ.ts:38–41); the comment is corrected (normals are averaged
  per output vertex, not per position). Failing test first: back-to-back triangles.
- **(d) `compileScene(scene, [])`** reports a diagnostic instead of a TypeError, like the
  existing duplicate-id check (Compiler.ts:34). Failing test first.
- **(e) `maxBounces` and `maxNullCrossings`** above 2³¹ − 1 (the GLSL int range) are rejected
  instead of producing invalid GLSL. Failing test first.
- **(f) CI:** push/PR runs and the dispatched witness run get separate concurrency groups, and
  only push/PR runs cancel older ones (.github/workflows/ci.yml:28–30). Checked by reading; takes
  effect on the first push.
- **(g) glslang harness:** only a spawn failure is reported as "could not be run"; a validator
  killed by a signal is reported as a crash on that shader (tests/helpers/glslangCheck.ts:66).
  Failing test first, with a fake validator script that kills itself.

---

## Decisions needed

1. **2.2(c):** `renderTiled` rejects with `RenderStoppedError` when stopped, like
   `renderProduction`, instead of resolving.
2. **2.4:** start and resume during a context restore are refused (logged), not queued.
3. **2.5:** `initialize()` on the same scene recompiles the union of strategies; on a different
   scene it replaces everything.

Everything else follows from rules already in CLAUDE.md or the review.
