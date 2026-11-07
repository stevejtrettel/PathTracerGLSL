# App layer core — map (read-only survey, 2026-11-06, branch claudeapp @ 8a101b6 + uncommitted docs)

Scope: src/app/*.ts and src/app/utils/*. Extensions, layout and ui/ are other readers' areas
(touched only where they drive the core). Context read: AGENTS.md, docs/claude-app-decisions.md,
CHANGELOG 2026-10-04 entry, docs/claude-outputs-step7-plan.md §A.3 (depends on App seams).

## Status of App redesign (owner decisions)
- The broad App lifecycle rewrite and the input-copying/HDR-recovery batch were WITHDRAWN on
  2026-10-04 and rolled back to 8a101b6 (CHANGELOG.md:7-19). Not a plan; do not resume.
- Owner goals that remain (docs/claude-app-decisions.md): local exploration + high-res art;
  exportable independent scene programs for the website; simplify the app; lab/gallery are
  dev infrastructure and must not dictate design; still needs camera controls, param panel,
  renderer & picture selection, debug views, start/stop/restart, statistics.
- AGENTS.md: no machinery for hypothetical uses/failures; one concrete change at a time,
  discussed with the owner; no commits without explicit request.
- docs/claude-outputs-step7-plan.md (OIDN, awaiting owner) relies on: picture list,
  App.readExport, capture/saveAll reading before awaits, the accumulation-clear sites. Any
  App change must keep those seams.

## Line counts
| file | lines | role |
|---|---|---|
| App.ts | 968 | facade + lifecycle + env provisioning + context restore + sessions + saving + stamps + extensions + layout passthrough |
| RendererManager.ts | 401 | compileScene, load/swap renderers in engine, strategy→renderer map, active id, param metadata, shader-error mapping |
| RenderCoordinator.ts | 324 | rAF loop, mode (interactive/production) × state (rendering/paused/complete/stopped), production promise, deferred reset, FPS/progress |
| ProductionOrchestrator.ts | 241 | production session phase (idle/active/settled): lock, layout, resize, profiling, save list, tiles loop, runId token |
| sceneData.ts | 159 | executes compiler SceneDataPlan → packed Float32 channels (+U32 CWBVH): mesh BLAS, mesh lights, instance TLAS, object table, light tree, region→material |
| TiledRenderer.ts | 155 | tiled job: plan tiles, pin salt, per-tile capture + stitch, stamp, save files, TILED_JOB_* events |
| ParameterStore.ts | 132 | Map of user-chosen param values; lock; change batches; serialize/restore |
| types.ts | 122 | AppConfig, CreateAppOptions, StrategyPreset, RenderProgress, ParameterChange(s), Extension, SessionData |
| EventBus.ts | 102 | string pub/sub |
| tiling.ts | 76 | pure tile arithmetic (engine y-up coordinates, 64-px alignment) |
| events.ts | 67 | AppEvents names + shouldResetAccumulation prefix heuristic |
| index.ts | 49 | public exports |
| capture.ts | 38 | SaveRequest, Captured, validateSaves, snapshotSaves |
| BuiltinAssets.ts | 32 | fetch+sha256-check builtin float assets named by renderers' `extern:` refs; retains bytes for context restore |
| utils/file-export.ts | 261 | RenderStamp, RGBE, Radiance header, streaming PNG encoder, downloadBlob, saveImageFile |
| utils/vector3.ts | 103 | Vec3 helpers (used by KeyboardControls) |
| utils/worker.ts | 79 | runInWorker skeleton (sync fallback, transfer rules, task-failure vs worker-failure) |
| utils/EventManager.ts | 71 | DOM + bus listener bookkeeping (OrbitControls) |
| utils/packWorker.ts / instancePack.ts | 35 / 34 | off-thread instance TLAS pack |
| utils/lightTreeWorker.ts / lightTreePack.ts | 26 / 26 | off-thread light tree build |
| utils/format.ts / dom.ts | 30 / 26 | formatTime; isTypingInInput |
Total src/app/*.ts + utils: 3557. Tests: tests/app/*.ts 1450 lines (no test of App.ts itself).

## Ownership of state (who answers what)
- Compiled renderers: RendererManager.renderers AND Engine.renderers (two maps).
- Active renderer: RendererManager.activeRendererId AND Engine.activeRendererId. App mixes:
  getActiveRenderer → RendererManager; getPictureFormats → engine.getActiveRenderer (App.ts:744);
  context restore reads engine.getActiveRendererId (App.ts:268).
- Parameter values: ParameterStore.parameters (user choices; lock; session) AND
  Engine.customParameters (everything shaders read, incl. measured env.size/env.sizeOct/
  env.totalWeight and renderer.picture, which bypass the store). Engine.customParameters is
  cleared only in Engine.dispose (Engine.ts:471) — it survives renderer switches and context loss.
- "What is the app doing": RenderCoordinator.mode+state, ProductionOrchestrator.phase+runId,
  ParameterStore.locked, TiledRenderer.job, App.restoring, Engine.state (5–6 flags).
- What image is on screen: App.imageParameters (param snapshot taken on ACCUMULATION_RESET
  event, plus manual snapshots at App.ts:209 and :396 for resets that bypass the event).
- Displayed picture: App.displayedPicture (name) → engine param 'renderer.picture' (index).
- Scene + strategies: RendererManager.scene/strategies; App.config (for context restore & env).
- Scene-data plan: RendererManager.sceneData (from compileScene).
- Env tables: App (envVariants + _loadImageEnvironment + _bakeProceduralEnvironment).
- Builtin asset bytes: BuiltinAssets.data.

## Lifecycle
1. App.create(container, {layout}) → AppLayout + canvas → new App(canvas): WebGL2 ctx, Compiler,
   Engine, EventBus, ParameterStore, RenderCoordinator, RendererManager, ProductionOrchestrator,
   TiledRenderer, ErrorOverlay; wires store.onChange → engine.setParameter + PARAMETER_CHANGED +
   one coordinator.requestAccumulationReset per changeset (App.ts:97-125).
2. App.initialize(config):
   a. procedural env → _bakeProceduralEnvironment(scene, envVariants(strategies)): per chart,
      compileEnvironmentBake → engine.loadRenderers([bake]) → renderFrame → readExport('table')
      → registerEnvironmentTable per (chart, compensation) → setParameter env.size/env.sizeOct
      → unloadRenderer. (Moves the engine's selection; App re-selects on restore, App.ts:273.)
   b. RendererManager.initialize: compiler.compileScene(scene, strategies) → renderers +
      sceneData + warnings; engine.loadRenderers; select first; store.batch(initialParameters).
      Second call with the SAME scene object merges strategies and recompiles all (RM:76-82).
   c. BuiltinAssets.upload: scan every pass's `extern:` textures, fetch+verify known assets.
   d. _uploadSceneGeometry(sceneData plan) → packSceneData (workers for ≥4096 items) →
      engine.registerDataTexture(channelExtern(c)) / registerDataTextureU32(NODESQ_EXTERN).
   e. this.config = config; _loadImageEnvironment: engine.loadEnvironmentHDR(url) registers map
      + default tables; App builds non-default variants (octahedral resample at fixed
      DEFAULT_ENV_TABLE_SIZE[1]); measured params set on engine directly.
   f. imageParameters snapshot.
3. Page calls app.use(extensions…), app.start() → production.exitProduction() (no-op if idle)
   → coordinator.startInteractive → rAF loop: engine.renderFrame, FPS, progress (≤10 Hz).
4. Parameter change → store.set/batch (ignored with a warning while locked) → onChange →
   engine.setParameter; reset decided by _triggersReset (metadata.triggersReset else
   shouldResetAccumulation prefix rule) → coordinator.requestAccumulationReset: resets now if
   rendering/paused, else marks dirty for next start/resume (keeps a finished image exportable).
5. Production: App.renderProduction(target, {width,height,save,autoSave}) →
   ProductionOrchestrator.beginProduction (lock, layout 'centered', resize, suspend profiling,
   reset) → coordinator.startProduction (promise resolves at target, rejects on stop) →
   saveAll(save) → autoSave session → settleProduction (unlock, profiling; view kept = 'settled').
   extendProduction re-enters active from settled. exitProduction (on start/stop) restores
   layout/resolution, clears tile view. runId token guards stale finallys.
6. Tiled: App.renderTiled → stop() → TiledRenderer.render: validate, planTiles, pin salt,
   ProductionOrchestrator.renderTiles (one locked session; per tile resize + pixel offset +
   reset + startProduction) → per tile App.capture each SaveRequest → placeTile into stitched
   buffer → last tile builds stamps → saveImageFile per request → unpin salt → App restarts
   interactive if production idle.
7. Save: App.save/saveAll → snapshot + validateSaves(getPictureFormats) → capture (hdr:
   readExport(picture); png: engine.renderView('ldr', {'renderer.picture': idx}) + readExport
   ('ldr')) → buildRenderStamp (scene id+provenance, strategy with resolved wavelengths,
   resolveMeasurement, imageParameters, spp, salt, git) → floatToRGBE / PNG → download.
8. Session: saveSession (params, rendererId, extension states, productionGoal) / restoreSession
   (strips measured env params, store.restore (removed keys sent as undefined), select renderer,
   extension restoreState). quickSave downloads JSON; loadSessionFromFile.
9. Context loss: Engine rebuilds programs/framebuffers from retained CompiledRenderers, then
   calls App._restoreAfterContextLoss: pause, restoring=true (start/resume/production refused),
   rebake procedural env (re-select active), re-pack scene data from plan, re-upload builtin
   assets from retained bytes, re-FETCH image env from URL, resendAll, reset, resume/start.
10. recompile(scene?) → RendererManager.recompile (compile → GPU-validate → commit, unload stale
   ids) → builtin assets + scene data rebuilt. dispose().

## Connections
- Down: Compiler (compileScene, compileEnvironmentBake, envTableSize, resolveMeasurement,
  envVariantSuffix from compiler/generate/features/environment.js, mapEngineShaderError,
  SceneDataPlan type), Engine (load/select/unload/validate renderers, renderFrame, renderView,
  readExport, setParameter, registerDataTexture(U32), loadEnvironmentHDR,
  registerEnvironmentTable, resize, clearAccumulation, salt pin, pixelOffset/imageSize,
  profiling, onContextRestored), components (data channels/ledger/pack, mesh/instancing/
  bvh/cwbvh/light_tree packers, LIGHT_KINDS, ENV_EXTERN_NAMES, BUILTIN_ASSETS, color models).
- Up/side: extensions (OrbitControls, KeyboardControls, panels, RenderControls,
  AppShortcuts, StatsPanel) through App public API + EventBus; pages/scene-lab.ts;
  tools/witness*.mjs via window.app (stop, readExport, pinResetSalt, renderProduction,
  resize, selectRendererByStrategy, initialize (second-call strategy add), save, renderTiled,
  capture, buildRenderStamp, saveSession/restoreSession…); scripts/witness-*.ts and
  tests use packSceneData directly.

## Callers of App public methods (grep over src, pages, tools, scripts, tests)
No caller anywhere: initializeWithPresets, recompile (App-level; RM.recompile is used by the
second-initialize path), loadEnvironmentHDR (App-level), renderFrame (App-level),
getElapsedTime, getRenderMode, getRenderState, getAllParameters, unuse, getExtensionNames,
getEventBus, getLayout, resizeToWindow. These are not called "dead": recompile is the
documented compiler dev-loop entry; loadEnvironmentHDR is the env swap; others are facade
conveniences. initializeWithPresets is the legacy preset path (docs/architecture.md:1284 calls
STRATEGY_PRESETS "pending removal") and is broken if used (see findings).

## Findings (details in structured output)
1. Duplicated renderer/active-id state (RM vs Engine).
2. resendAll is functionally inert (engine keeps customParameters across switches/context
   loss); the oldValue===newValue "isResend" protocol exists only to make it inert; App.ts:256
   comment claims the engine loses parameter values.
3. Reset decision: every compiled triggersReset is `true` (no `false` anywhere); nothing writes
   debug./renderer. through the store → metadata field + prefix heuristic decide nothing today.
4. Accumulation-clear has 3 routes (coordinator event, coordinator deferred, engine direct from
   RM.selectRenderer/recompile and App.resize) → imageParameters patched manually.
5. envVariants re-derives Planner's defaults (`?? 'equirect'`, `?? false`); chart→size-param
   mapping spelled in App.ts:239,348, lighting.ts:505,528, environment.ts:63; extern names in
   ENV_EXTERN_NAMES and literal strings in environment.ts:225-226. App imports
   envVariantSuffix from a generator module.
6. Stamp re-resolves measurement/wavelengths and repeats `color ?? 'rgb'` (App.ts:832).
7. initializeWithPresets skips scene data, env, config → first frame would hit missing externs.
8. App.recompile(scene) never updates this.config nor re-provisions environment.
9. Second initialize on same scene sets this.config to only the new strategies; context
   restore then rebuilds env variants for those only (witness tool uses this path).
10. Session productionGoal saved, never restored; and always absent in autoSave (goal nulled
   on complete); SessionData doc claims it re-queues production. version unchecked.
11. Three restore policies for externs (retain bytes / re-pack / re-fetch URL / re-bake).
12. sceneData batch lights: App knows the sphere kind's value names and params-record layout;
   attribute emission without attrs silently yields zero power.
13. Euclidean assumptions in packing: AABB + similarity transforms, light-tree boxes/power.
14. App ↔ ProductionOrchestrator ↔ TiledRenderer cyclic coupling; 5–6 state flags.
15. Duplicated download + timestamp code (quickSave vs downloadBlob; 3 timestamp formatters).
16. Doc mismatches: compiler/types.ts:810 says ParameterStore.restore coerces camera.frame (it
   does not); docs/architecture.md "thin facade (~400 lines)" vs 968; types.ts:13-15.
17. App.ts is a grab-bag: env provisioning (~140 lines), context restore, sessions, saving/
   stamps, layout passthrough, extension registry all in the facade.
