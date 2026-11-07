# The App, its extensions and the parameter system: notes for a conversation

A discussion document, not a plan. Nothing here is decided, and no part of it is a redesign to
adopt. It prepares a conversation in which the owner and I go through `src/app` one concrete
change at a time (AGENTS.md). Line numbers are at HEAD 51b1a4b. App.ts, RendererManager.ts and
src/engine have not changed since 8a101b6 (Oct 1, before the survey), so the survey's citations
for them still hold; extension and compiler citations were re-read at HEAD on Nov 7.

Sources: docs/claude-2026-11-review/survey/{app-core, app-ui-extensions, parameters, engine,
tests-tooling}.md and survey/findings.md (each finding has an independent checker's verdict).
Facts below marked "checker" were re-read by that checker; I re-read the ones I cite at HEAD.

**Thought levels.** Every idea carries a tag. [Checked: how] says what was verified and how.
[Thought through, not checked] means I reasoned through it and read the code it touches, but
nothing was built, digested or run. No idea in this document was built.

**The Oct 3 decisions.** On 2026-10-03 the owner and the model went through the App's parts
and recorded decisions 1–17 in docs/claude-app-decisions.md. On Oct 4 that file was replaced
by the withdrawal notice. The CHANGELOG names a recovery copy in /private/tmp; it no longer
exists (checked Nov 7). **The written record is lost.** On 2026-11-06 the owner said decisions
1–17 remain the owner's decisions (decisions.md item 7); the Oct 4 notice still says there is no
approved replacement architecture or implementation batch. What follows is the model's memory
note, not the owner's words, and the owner should correct it. The memory note numbers only
12–17; where this document says "decision 2" or "decision 3", the number is inferred from the
order of the note.
- The codebase is a workshop for many shipped programs (hyperbolic explorer, tilings, a
  one-image production program, black-hole sim, optics demo), stored on the owner's website.
  The lab and gallery are test infrastructure only.
- Decisions as noted: navigation; panels redraw from state; production as its own job system
  (in the tab, on this machine); run controls; the cheap-renderer preview as its own piece; one
  scene per program for now; one repeatable load step; production's boundary, with the slider
  lock staying.
- Parameters: the explorer and jobs own their values; the lock stays; deleting the App's
  name-based reset guess is a cleanup with no behavior change.
- 12 no guesses, ever. 13 render-size modes, with follow-the-window as the default. 14 shipped
  programs are precompiled to readable GLSL plus data, with uniform computations as named
  functions (a change to the locked contract, needing explicit approval). 15 a program is
  written as code. 16 built once, readable but not arranged for editing. 17 one command table
  per program.
- Open then: panel labels, production job details (with sessions), pose representation,
  undeclared values.

Already fixed on this branch (build-log.md): keyboard directions in KeyboardControls (a5935d0),
the parameter panel following store changes with one batched write per flush (b16ef59), and
the stats panel's hide (ef89535).

---

## 1. The App today

**The model in plain terms.** A page makes an App on a canvas. The App compiles the scene
once per strategy into renderers, puts the scene's data on the GPU and runs a frame loop.
Values the user changes go into a store; each change is copied to the engine and restarts the
accumulation. A production render locks the store, renders to a sample target and saves
stamped files; a tiled render does the same tile by tile. UI and input modules
("extensions") are plugged into the App by the page.

| Part | Lines | What it owns |
|---|---|---|
| App.ts | 968 | The facade (75 public methods). Also: initialize, environment bake/load (~120 lines: App.ts:212-250, 312-355, 435-447, 950-968), context-loss restore, sessions, saving and stamps, layout passthrough, the extension registry. |
| RendererManager.ts | 401 | Compiling the scene, loading and switching renderers, the strategy→renderer map, the active renderer, parameter metadata, the scene-data plan. |
| RenderCoordinator.ts | 324 | The frame loop; mode (interactive/production) × state (rendering/paused/complete/stopped); the production promise; holding back a reset while stopped. |
| ProductionOrchestrator.ts | 241 | A production session (idle/active/settled): lock, layout switch, resize, profiling, the save list, the tile loop, a runId guard. |
| TiledRenderer.ts | 155 | Tiled jobs: plan, pin the salt, capture per tile, stitch, stamp, save. |
| ParameterStore.ts | 132 | User-chosen values, the lock, change batches, serialize/restore. |
| sceneData.ts | 159 | Executes the compiler's scene-data plan into packed textures. |
| EventBus, events, types, tiling, capture, BuiltinAssets, index | 486 | Pub/sub, event names and the reset guess, shared types, tile arithmetic, save requests, builtin assets. |
| utils/ | 691 | File export (RGBE, PNG, stamps), workers, vectors, DOM bookkeeping. |
| extensions/ | 2066 | Seven modules (orbit, keyboard, shortcuts, stats, parameter panel, production panel, render controls) on a UIExtension base. The lab installs six; KeyboardControls is not installed anywhere. |
| layout/ | 233 + 328 CSS | Six page regions and four CSS layout modes. |
| ui/ | ~2114 + 1310 CSS | A small widget toolkit; WidgetFactory turns compiler metadata into widgets; ErrorOverlay. |

src/app is about 3557 lines of core TypeScript and about 4400 more for extensions, layout and
the toolkit. The Engine below it (2887 lines) runs compiled renderers blindly.

**One parameter, end to end.** An authored `{ param: 'clay.albedo', default, min, max }`
becomes a uniform `u_clay_albedo` and a metadata row (label, group, range, widget type,
`triggersReset`). The panel builds a widget from the row. A change goes widget →
`app.setParameters` → ParameterStore → `onChange` (App.ts:97-125) → `engine.setParameter`
plus one reset per changeset. Each frame the engine runs each uniform's closure if its inputs
changed and uploads the result.

---

## 2. Where it is tangled (checked facts only)

Each item was read in the code; the checker's verdict is in findings.md under the given id.

**2.1 The renderer map and the active renderer live in two places** (app-1, confirmed).
RendererManager.ts:41 and :45 duplicate Engine.ts:36-37. App reads both: App.ts:453 asks the
manager, App.ts:744 and :268 ask the engine. The procedural bake moves only the engine's
selection, so App.ts:270-273 re-selects by hand. RendererManager.selectRenderer returns early
when its own id matches (RendererManager.ts:260). tools/witness.mjs:362-367 works around an
intermittent "selection lost" by toggling through another renderer "to defeat the idempotence
guard". Whether the two copies cause that race was not established.

**2.2 Two parameter value stores, and a resend that does nothing** (app-2, P6, confirmed).
ParameterStore.ts:5 and Engine.ts:44 each hold the values; App.ts:100 copies every change.
The engine's map is cleared only in dispose (Engine.ts:471), so it survives renderer switches
and context loss. Yet `resendAll` runs at RendererManager.ts:247 and :275 and App.ts:279, and
App.ts:103 (`isResend = oldValue === newValue`) exists only to make that resend silent. Three
comments say the engine forgets values (App.ts:255-256, Engine.ts:47-49, Engine.ts:531); they
are false. The engine's map is not a pure mirror: measured `env.size`, `env.sizeOct`,
`env.totalWeight` and the display index `renderer.picture` go to it directly and are never in
the store (App.ts:226-239, 348, 770).

**2.3 The reset guess** (app-3 partly, P1 confirmed). App.ts:406-412 uses the active
renderer's `triggersReset`, else the prefix rule in events.ts:63-67. All 16 metadata literals
in src (15 in the compiler, one in components/color/spectra/blackbody) set `triggersReset: true` (values.ts:110,177; Planner.ts:779,803,816,837;
environment.ts:129,152,153,204,205; camera.ts:31,129,130; lighting.ts:56; blackbody.ts:124);
none sets false. The prefix rule decides only for a path the active renderer does not
declare, and such a value is not read by the active program, so the image is the same either
way (checker).

**2.4 Other decisions made twice.**
- Environment tables (app-5, confirmed): App.ts:958-959 repeat the Planner's defaults
  (Planner.ts:577-580); the chart→size-parameter rule appears at App.ts:239 and :348,
  environment.ts:62-64 and lighting.ts:505,528. The App imports `envVariantSuffix` from a
  generator module (App.ts:7).
- Stamp wavelengths (app-6, partly): App.ts:832 repeats `color ?? 'rgb'` and the wavelength
  resolution of Planner.ts:567.
- The main picture (UI-12, confirmed): `'radiance'` is spelled at AppShortcutsExtension.ts:130,
  ProductionPanelExtension.ts:332 and RenderControlsExtension.ts:207,214, while
  `App.getPictures()` documents "the first is the main picture".
- Scalar→vec3 color broadcast (P5, confirmed): plan/values.ts:21-23,
  generate/values.ts:162-167, ParameterPanelExtension.ts:279.
- Camera pose (UI-3, confirmed): the store holds `camera.position/target`; OrbitControls keeps
  its own spherical state (OrbitControls.ts:22-26), read once at install. A session stores the
  pose twice, and restore applies the orbit copy last (App.ts:600-618), so a typed pose saved
  in a session comes back as the orbit's pose.
- Accumulation clears (app-4, partly): through the coordinator (with an event), deferred while
  stopped, or straight to the engine (RendererManager.ts:248, :278; App.ts:718). App.ts:396
  patches the image-parameter snapshot by hand after recompile. A resize cannot be deferred:
  it reallocates the textures.
- Small repeats (app-16, P7, confirmed): quickSave builds its own download and revokes the
  URL at once (App.ts:635-642), which downloadBlob (file-export.ts:115-126) warns against;
  three timestamp formatters (App.ts:700-709, :856-865, TiledRenderer.ts:151-155); three
  array-equality helpers (ParameterStore.ts:116-129, ParameterManager.ts:258-271,
  shader-uniform-utils.ts:140-155).

**2.5 Context-loss restore uses four policies** (app-11, confirmed). Builtin assets keep CPU
bytes (BuiltinAssets.ts:5); scene data is re-packed from the plan (App.ts:275-276); the HDR is
re-fetched from its URL (App.ts:278); a procedural sky is re-baked (App.ts:269-274). A
`restoring` flag guards five entry points (App.ts:460-503). Two paths leave the restore with
wrong inputs: `App.recompile(newScene)` never updates `this.config` (app-8; `App.recompile` has no
caller today), and a second `initialize` keeps only the latest strategies in `this.config`
(app-9), which the witness runner does for every variance render (tools/witness.mjs:359, :844).
tools/witness-spectral-lifecycle.mjs:25-42 forces a context loss and restore and asserts the
restored image is bit-identical and that no asset is re-fetched. The withdrawn Oct 4 batch included
"HDR recovery", so this area is the owner's to frame.

**2.6 App, ProductionOrchestrator and TiledRenderer form a cycle** (app-15, confirmed).
ProductionOrchestrator makes 21 calls to 15 distinct App methods (ProductionOrchestrator.ts:66-237), including the
layout mode (:172-174, :198, :208-209). TiledRenderer receives both the App and the
orchestrator (TiledRenderer.ts:69). "What the app is doing" is spread over the coordinator's
mode and state, the orchestrator's phase and runId, the store's lock, the tiled job,
`App.restoring` and the engine's state. On screen, one production render passes through five
pieces linked by events, and two completion UIs appear with overlapping actions (UI-6).

**2.7 Plugin machinery with no consumers** (UI-5, confirmed). An extension may declare
`version`, `description` and `dependencies` (types.ts:81-92); `use` checks dependencies and
emits an install event (App.ts:869-891). No extension declares dependencies; `unuse`,
`getExtension`, `getExtensionNames` and `getEventBus` have no caller outside App; the install
and uninstall events and `camera.moved` have no listener. The only consumer is
pages/scene-lab.ts:56-61, which installs six modules together. Every extension receives the
whole App and the bus, so the interface limits nothing. Session `extensions` state is written
only by the two camera controls.

**2.8 The keyboard map is spread over four active listeners, plus one in an uninstalled
module** (UI-7, confirmed). AppShortcutsExtension.ts:42 (window), StatsPanel.ts:148 (window,
`i`), ParameterPanelExtension.ts:328 (window, capture phase, Tab), ErrorOverlay.ts:145
(document, Escape, only while the overlay is shown); KeyboardControls.ts:62 is not installed.
No table lists the bindings; while the overlay is shown, Escape both stops the render and
closes the overlay. Space and Tab are taken at window level, which an
embedded program would inherit.

**2.9 Parameter metadata is built by 16 literals with three label rules** (P2, P3, P4, P9,
confirmed). Labels are the capitalized last path segment (values.ts:109, :175), the raw last
segment (Planner.ts:771, for placement sliders), or a fixed name (camera.ts, environment.ts,
lighting.ts:56 "Env select P", blackbody.ts:123 "Kelvin"). The range rule is repeated, except
blackbody, which invents a range from its domain. Precedence differs: first wins inside a
feature, last wins across features (merge.ts:94), with no diagnostic when two declarations of
one path disagree. `mintValueUniform` takes the GLSL type, widget type and HDR flag
positionally, although they follow from shape and role; call sites decide HDR differently.
Three slider validators disagree on whether a default is required; placement sliders may omit
it and the Planner substitutes [0,0,0], identity, 0 or 1 (Planner.ts:776, 801, 813, 834). A
default can exist in up to four copies. The word "parameters" means four different things
(survey/parameters.md §4).

---

## 3. Candidate simplifications

Each is small and removes a part. Each can be discussed on its own; where two touch the same
code (C3 and C4 in RendererManager, C7 and C8 in sessions, C11 and app-9), the text says so.
None is recommended over another; the order follows the sections above. "Behavior" says what a user would notice.

**C1. Delete `resendAll` and the `isResend` test; correct the three false comments.**
Removes a store method, its three call sites and an identity protocol in `onChange`.
Behavior: none expected. [Thought through, not checked: the engine-map facts were read and
confirmed by the checker; nothing was run. A lab check after a renderer switch would be the
test; tools/witness-spectral-lifecycle.mjs already checks a context loss bit for bit.] Pro: data
flows one way. Con: two unit tests change (parameterStore.test.ts:82-88, the spy in
rendererManager.test.ts:87).

**C2. Delete the reset guess: every store change resets.** Removes `_triggersReset`,
`shouldResetAccumulation` and its test. The Oct 3 note calls this a no-behavior-change cleanup.
Behavior, precisely: a store write to a path the active renderer does not declare (an
`env.*` value for another strategy, from a session or `initialParameters`) now resets where it
did not; the image is unchanged (the checker's note on app-3 found this case). [Thought
through, not checked.] Pro: removes the only
name-prefix guess. Con: the `triggersReset` field then carries nothing; whether to drop it is a
separate question (it would matter again only if a live "view" slider is wanted; none exists,
exposure is a `#define`).

**C3. Make the Engine the only holder of loaded renderers and the active id.**
RendererManager keeps strategies, the strategy→renderer map, the scene and the scene-data
plan. Removes a map, an id, the early return and the hand re-selection after the bake.
Behavior: none intended. [Thought through, not checked.] Pro: one answer to "which renderer is
active". Con: touches every RendererManager getter and its tests. It might explain the witness
race in 2.1; that is a hypothesis, not checked.

**C4. Send renderer-switch and recompile clears through the coordinator.** Removes the direct
engine clears at RendererManager.ts:248, :278 and the hand snapshot at App.ts:396. Behavior:
the reset event now fires on a switch (only App listens, App.ts:85), and
`coordinator.resetAccumulation` also restarts the coordinator's clock (RenderCoordinator.ts:140),
so the stats panel's Time restarts on a renderer switch where today it does not. Resize stays
as it is. [Thought through, not checked.] Pro: one clear path with one event; the snapshot patch
goes. Con: RendererManager needs a reset callback instead of the engine; the step-7 plan lists
these clear sites (section 5).

**C5. Small one-answer fixes.** Main picture from `getPictures()[0]` at the four sites;
quickSave through `downloadBlob`; one timestamp helper; one value-equality helper; one
wavelength resolver shared by the Planner and the stamp. Behavior: quickSave no longer
revokes its URL immediately; timestamps in file names may change format. [The duplicate sites
are checked: re-read at HEAD on Nov 7. The changes are thought through, not checked: nothing
was built.] Pro: each is a few lines. Con: file names change format; the shared wavelength
resolver touches the compiler as well as the App.

**C6. One keymap table per program.** Replaces the listeners in 2.8 with one table (key →
action) that lists every binding (Oct 3 decision 17, as noted). Behavior: depends on where it
listens; on the canvas container instead of the window, the user must click the canvas first.
[Thought through, not checked.] Pro: one place lists every key; the Escape double use and the
window-level Space and Tab become visible choices. Con: must keep the production-lock whitelist
(AppShortcutsExtension.ts:67) and the unbound `n` that the step-7 plan relies on
(docs/claude-outputs-step7-plan.md:215-216), or update that plan; KeyboardControls is
scaffolding the survey says to keep (UI-15), so its keys belong in the table too.

**C7. The store as the only owner of the camera pose.** Orbit derives its spherical
coordinates from `camera.position/target` at the start of a drag and stops saving its own
state. Removes Orbit's saveState/restoreState and the second copy in sessions. Behavior: a
typed pose survives a drag and a session restore. [Thought through, not checked.] Pro: one
owner of the pose; the session-restore overwrite in 2.4 goes. Con: pose
representation was open on Oct 3 and curved spaces will change it (UI-8); this fixes the
duplicate, not the representation. tools/witness-spectral-live.mjs:50,61 uses sessions.

**C8. Extensions as plain functions.** A control becomes `orbitControls(app)` returning its
disposer; a program calls the ones it wants. Removes the registry, name map, dependency check,
version, `unuse`, `getExtension(Names)`, two events and (with C7) session extension state.
Behavior: none in the lab. [Thought through, not checked.] Pro: a control's reach is what it
is handed, and there is no registry to read. Con: seven files and several docs change;
docs/production-rendering.md:247 presents `getExtension` as API. The owner decided on Nov 6 that
unused pieces are usually in-progress work, not dead code (decisions.md item 1), and the UI-5
checker names future scene programs as the likely consumer of composable controls, so this is
a simplification to discuss, not a removal of dead code. Best discussed with question 4.2.

**C9. One production UI piece; layout chosen outside the orchestrator.** One module owns the
dialog, progress and completion actions; the `p` key calls it directly. Removes
`production.dialogRequested`, the hidden RenderControls root and one completion UI; the
orchestrator stops calling layout methods. Behavior: one completion UI instead of two; what
the screen shows during production is the owner's choice. [Thought through, not checked.] Pro:
one production render is followed in one file, not through bus events. Con:
this is the area of the withdrawn rewrite; it needs its own conversation.

**C10. One metadata builder in the compiler.** A single function builds every metadata row
(label, group, range, widget, HDR) from the value, its shape and role. Removes about 16 row
literals and two label rules. Behavior: placement slider labels become capitalized; everything
else should be identical, which the digest would check. [Thought through, not checked.] Pro:
one label, range and HDR rule. Con: wide,
shallow diff; blackbody's domain-derived range must fit the one rule or become explicit.

**C11. The compiler declares the environment tables it reads.** The App executes the list,
as it does for scene data. Removes the App's re-derived defaults and naming (2.4) and fixes
app-9 by construction. Behavior: tables only for strategies that sample the environment.
[Thought through, not checked.] Pro: the App's last scene-derived decision goes, with one
spelling of each name. Con: adds a field to the compiler's scene output (owner approval); the
HDR loader's own default table has to move too.

**Questions rather than changes.** These need a yes or no before anything is proposed:
- `initializeWithPresets` has no caller and skips scene data and the environment (app-7). Is the
  preset API still wanted?
- Session `productionGoal` is written and never restored (app-10). Wanted?
- Restore strips measured `env.*` keys from old sessions (P16). Do old sessions matter?

---

## 4. Bigger questions to think through together

Framed as questions, with the facts that bear on them. No answers are proposed.

**4.1 Shipped programs and precompilation.** If a shipped program is precompiled GLSL plus
data with named uniform functions (decision 14, as noted), what runtime does it carry: this App,
a smaller one, or a separate one written per program? Is the lab's runtime the same code?
Facts:
- `UniformBinding.compute` is a JS closure over Planner data (compiler/types.ts:797); the test
  helper writes it as `'[fn]'` (tests/helpers/compiledJson.ts:16) and the digest evaluates it
  at two parameter sets. A precompiled program needs these as code or as named functions.
- There is no build entry for a program: vite.config.ts:26 builds only the gallery and the lab.
- Today's recipe takes the page: AppLayout's CSS resets every descendant of `[data-layout]`
  and fixes the canvas to the viewport; the canvas is sized once (App.ts:62-64) and nothing
  listens for resize, which bears on decision 13 (follow the window); ErrorOverlay mounts on
  `document.body` (App.ts:137); keys are taken at window level.
- "One scene per program" (as noted) versus a second `initialize` that merges strategies
  (RendererManager.ts:76-82), which the witness runner uses.

**4.2 What an extension should be.** Is an "extension" anything more than a function a
program calls? What may a control touch: the whole App, or a few named actions? Should
sessions carry UI state, or only values and the renderer? Facts: 2.7; decisions 2 (panels
redraw from state), 15 (a program is code) and 17 (one command table), as noted; the panel now
follows store changes (b16ef59), which is one step toward "redraw from state"; the UI toolkit
claims to be standalone but `components.css` imports the extensions' CSS (UI-14); each UI
piece has two mount paths (region or `document.body`).

**4.3 Parameters as one model.** Where should the one value holder be: the store, with the
engine handed values each frame, or the engine's map? Who declares whether a change resets and
whether it is locked during production: one fact per parameter (its measurement / estimator /
view section), the same fact for both? Should every slider require a default? Where do
measured values (`env.size`, `env.totalWeight`) and display state (`renderer.picture`) live, if
not in the `env.*` and `renderer.*` names they share with sliders? What happens to an undeclared
value (open on Oct 3; decision 12 says no guesses)? Facts:
- Representations today (survey/parameters.md §4): 4 authored spellings, 6 compiler-internal
  forms, 2 contract types, 5 runtime value holders (store, engine map, ParameterManager caches,
  the image-parameter snapshot, sessions), 5 name registries.
- The lock is all-or-nothing (ParameterStore.ts:23-31, :39-43), and the Oct 3 note says it
  stays.
- `env.selectProb` is an estimator value: it must not change the converged image but still
  needs a reset (checker's additional note, findings.md:538).
- The pose is Euclidean (position + target; compiler/types.ts:725-740), and pose
  representation was open on Oct 3. docs/fable-transforms.md already plans placements as
  elements of the space's structure group; the camera pose has no written design (P11).
- docs/claude-outputs-accumulation.md §8 (lines 240-258) records a "parameter system revamp"
  on the same diagnosis as deferred, needing its own design.

**4.4 Run state and context loss.** Is "settled" (orchestrator) the same fact as "complete"
(coordinator)? With production as its own job system (decision 3, as noted), which of the six
state holders in 2.6 remain? Is recovering from a lost WebGL context a practical need (the
tiled renderer cites GPU watchdog losses at 8K, TiledRenderer.ts:6-8)? A tool already tests the
restore (tools/witness-spectral-lifecycle.mjs, section 5). If recovery is not needed, the
restore path and its guards could go; if it is, should every texture be re-supplied the same
way?

---

## 5. Contracts to keep in mind

What outside code calls, so that a change can be checked against it.

- **The witness runner and scripts** (TT-3, partly: the checker confirmed the methods and
  corrected only the finding's framing; counts from a grep of `app.X(` in
  tools/*.mjs and scripts/*.ts at HEAD): stop 11, readExport 10, pinResetSalt 9,
  renderProduction 8, resize 7, selectRendererByStrategy 6, initialize 3 (including the
  second-initialize path), getCanvas 3, and once or twice each setParameters, save,
  renderTiled, getResetSalt, getPictures, getActiveStrategy, getActiveRenderer, saveSession,
  restoreSession, getStats, getCanvasSize, getAvailableExports, getActiveRendererId,
  extendProduction, capture, buildRenderStamp. These are called by name from untyped JS, so a
  rename fails only at run time in a browser.
- **The lab page hooks:** `window.app`, `sceneSuite`, `witnessSuite` before `start()`
  (pages/scene-lab.ts:52-54), `__witnessDigest` (:82), and `?witness` skipping `start()` (:67).
  No tool touches an extension.
- **Sessions:** tools/witness-spectral-live.mjs:50,61 saves and restores a session, including
  the orbit's extension state. C7 and C8 change what it restores.
- **Context-loss restore:** tools/witness-spectral-lifecycle.mjs:25-42 loses and restores the
  WebGL context, waits for the log line "restored after WebGL context loss" (App.ts:281),
  and asserts a bit-identical image and no re-fetched assets. C1 and any change in 4.4 meet it.
- **The step-7 plan** (docs/claude-outputs-step7-plan.md, awaiting the owner): the picture
  list, `readExport`, capture and saveAll reading before any await, every accumulation-clear
  site (C4 changes these), the production-lock whitelist and the unbound `n` (C6).
- **The OIDN test plan** (docs/claude-oidn-test-plan.md:200): `new App(canvas)` works without
  a page layout.
- **The lab is test infrastructure** (docs/claude-app-decisions.md): it should not dictate the
  App's design. TT-3 suggests one small typed module of the hooks the runner needs, so tsc
  catches renames and the App can change behind it. [Thought through, not checked.] Pro: one
  list of what the tools rely on. Con: the runner still calls the hooks by string inside
  `page.evaluate`; it adds a module, which AGENTS.md allows only for a practical need.
