# Survey findings (November 2026)

Every finding from the 16 survey readers, with the adversarial checker's verdict. "confirmed"/"partly"/"refuted" are the checker's verdicts after re-reading the code; "reclassify-in-progress" means the item is deliberate scaffolding for planned work, not dead code; "unverified" means a research area with no checker. These are survey claims, not owner decisions and not plans. The per-area notes in this folder are the readers' raw maps.

## app-core

The App layer (3557 lines in src/app/*.ts and utils; App.ts alone is 968) sits between the pages/tools and the Compiler and Engine. App.create builds a canvas inside an AppLayout. The App constructor wires six collaborators:
- RendererManager compiles all strategies together (compileScene), loads and switches renderers, keeps the strategy-to-renderer map, the parameter metadata and the scene-data plan.
- RenderCoordinator runs the requestAnimationFrame loop. It tracks mode (interactive or production) and state (rendering, paused, complete, stopped), returns the production promise, and holds back a parameter-triggered reset while stopped so a finished image stays exportable.
- ParameterStore holds the values the user chose, the production lock and the session data.
- ProductionOrchestrator runs a production session in three phases (idle, active, settled): lock, layout, resize, profiling, the save list and the tile loop. A runId token stops a stale `finally` from undoing a newer session.
- TiledRenderer renders large images in tiles with a pinned salt, stitches them on the CPU and saves one stamped file.
- EventBus is a string pub/sub.

Lifecycle: initialize first bakes a procedural sky, if any. It then compiles, uploads the builtin assets (the extern names come from the renderers' declared `extern:` references) and packs the scene data by executing the compiler's SceneDataPlan (sceneData.ts, off-thread workers at 4096 items or more). Last, it loads an image environment and builds every (chart, compensation) table variant the strategies use. After that, start runs the interactive loop. A parameter change goes from the store to engine.setParameter, then to a reset request. renderProduction and renderTiled end in save/saveAll: capture reads the float export or redraws the view into 'ldr', and the file gets a reproducibility stamp. Sessions save and restore parameters, the renderer and extension state. A WebGL context loss is repaired by re-baking the sky, re-packing the scene data, re-uploading the retained builtin bytes and re-fetching the HDR from its URL.

The design is sound in its core seams: compile before pack, picture facts read from the renderer's export targets, the save path validated before rendering, and pure tiling arithmetic. Its weak points are state duplication and decisions made twice:
- The renderer map, the active renderer and the parameter values are each kept in both the App and the Engine.
- The parameter resend that exists to keep those copies in sync does nothing, because the engine never drops parameter values on a renderer switch or a context loss.
- The accumulation-reset decision (a metadata flag plus a prefix heuristic) cannot change any outcome today.
- Accumulation is cleared through three routes, so the image-parameter snapshot is patched by hand.
- The App repeats the Planner's environment defaults and naming.
- Unused or rarely used paths have real gaps: initializeWithPresets, App.recompile with a new scene, and a second initialize followed by a context restore.

The broad App rewrite was withdrawn on 2026-10-04 (AGENTS.md, docs/claude-app-decisions.md). Every suggestion below is a separate small change to discuss with the owner, not a redesign.

### app-1 — Renderer map and active renderer kept in both RendererManager and Engine

- kind: duplication; reader confidence: checked; checker: **confirmed**
- evidence: RendererManager.ts:41 `private renderers: Map<string, CompiledRenderer>` and :45 `private activeRendererId` mirror Engine.renderers / Engine.activeRendererId (Engine.ts:166-183). App reads both: App.ts:453 `getActiveRenderer(): ... this.rendererManager.getActiveRenderer()` but App.ts:744 `this.engine.getActiveRenderer()?.exportTargets` and App.ts:268 `const active = this.engine.getActiveRendererId();`. The bake moves only the engine's selection (App.ts:270-273 'which moves the engine's selection — re-select the active renderer afterwards'). RendererManager.getAvailableRendererIds already delegates to the engine (RendererManager.ts:302-304).
- why it matters: Two places answer 'which renderer is active', and they can disagree. The procedural bake already makes them diverge, and the App has to patch that by hand. RendererManager.selectRenderer returns early when its own id matches (RendererManager.ts:260), so a divergence can block a reselect.
- suggestion (thought-through-not-checked): Make the Engine the only holder of loaded renderers and the active id. RendererManager keeps only what the engine does not know: strategies, the strategy→renderer map, the scene and the sceneData plan.
- pros/cons: Pro: one answer to the question, fewer resync lines, and the bake no longer needs a reselect. Con: touches RendererManager tests (tests/app/rendererManager.test.ts) and every getter. getActiveStrategy must look up the map from the engine's id.
- checker note: Verified. RendererManager.ts:41,45 duplicates Engine.ts:36-37. App reads both: App.ts:452-453 and :556/:688 go through RendererManager, while App.ts:744 (getPictureFormats) and :268 read the engine. The early return at RendererManager.ts:260 causes real trouble. tools/witness.mjs:358-370 carries a workaround for an intermittent 'selection lost' failure: the manager reports the variance renderer as active, but readExport (the engine's view) hits the original renderer. The workaround says 'selecting an already-"active" id is a manager no-op, so go through the base renderer to defeat the idempotence guard'. That is direct evidence that the two holders diverge in practice (the root cause was not established).

### app-2 — ParameterStore.resendAll and the 'isResend' protocol do nothing: the engine never forgets parameter values

- kind: complexity; reader confidence: checked; checker: **confirmed**
- evidence: Engine.customParameters is written at Engine.ts:259 and cleared only in dispose (Engine.ts:471). Renderer switches (Engine.ts:166-183) and context loss (Engine.ts:480-490) leave it alone. Yet RendererManager.ts:273-275 says 'Re-send all parameters to the new renderer (parameter persistence)', recompile at :247 calls resendAll, and App.ts:279 calls resendAll on restore. App.ts:255-256 claims the engine cannot rebuild '...the parameter values, which live in the ParameterStore'. App.ts:102-103 `const isResend = change.oldValue === change.newValue;` exists only to make the resend produce no events or resets.
- why it matters: The resend, the identity-based protocol and a misleading comment are three moving parts with no effect. A reader concludes that parameter state is per renderer when it is global.
- suggestion (thought-through-not-checked): Remove resendAll and the isResend check. Correct the App.ts:255-256 comment. Then the only values sent to the engine are real changes.
- pros/cons: Pro: deletes a protocol and a store method, and the data flow becomes one-way. Con: ParameterManager caches are reset on select and clear (Engine.ts:180, :307), and uniforms are rebuilt from customParameters every frame (Engine.ts:236-252). That reasoning says nothing depends on the resend, but it needs a quick witness or lab check after a renderer switch.
- checker note: Verified. Engine.customParameters (Engine.ts:44) is cleared only in dispose (:471). It survives selectRenderer (:166-186), context loss (:476-491) and restore (:493-534), and _buildParameters merges it every frame (:250-252). ParameterManager is reinitialized on select (:181) and its cache is cleared on clear (:308). In onChange, a resend only re-sets identical map entries; isResend suppresses both the reset and the event. So resendAll has no effect. Two more comments make the same false claim and the reader missed them: Engine.ts:47-49 ('the caller must ... re-send parameter values') and Engine.ts:531. Removing resendAll also means changing tests/app/parameterStore.test.ts:82-88 and the resendAll spy in tests/app/rendererManager.test.ts:87.

### app-3 — The accumulation-reset decision (metadata flag plus prefix heuristic) cannot change any outcome today

- kind: complexity; reader confidence: checked; checker: **partly**
- evidence: App.ts:406-412 `_triggersReset` prefers `meta?.triggersReset`, else `shouldResetAccumulation(path)` (events.ts:63-67, a prefix rule). Every producer sets `triggersReset: true` (values.ts:110,177; Planner.ts:779,803,816,837; environment.ts:129,152-153,204-205; lighting.ts:56; camera.ts:31,129-130; blackbody.ts:124). A search for `triggersReset: false` finds nothing. Nothing writes `debug.*` or `renderer.*` through the store: renderer.picture goes straight to engine.setParameter (App.ts:770), and the measured env.* values do too (App.ts:226-227).
- why it matters: The owner forbids guessing, and the prefix rule is a guess for undeclared parameters. In practice every store change resets, so the flag, the fallback and their test (tests/app/events.test.ts) carry a decision that never varies.
- suggestion (thought-through-not-checked): State the fact directly: every ParameterStore change resets accumulation, because display-only state (the displayed picture) already lives outside the store. Drop the optional triggersReset field and shouldResetAccumulation, or keep the field only if a display-only store parameter is actually planned.
- pros/cons: Pro: removes a heuristic and a metadata field nobody varies. Con: if a future debug view wants a store-backed toggle that should not reset, a declared fact must come back; ParameterMetadata is part of the locked compiler-engine contract and needs owner sign-off to change.
- checker note: Mostly right. Every compiled metadata entry sets triggersReset: true. The few multi-line entries (values.ts:109-110, lighting.ts:55-56, blackbody.ts:123-124) also set it on the next line, and no entry sets triggersReset: false. One overstatement: the fallback IS consulted, and can return false, for a store key that the ACTIVE renderer does not declare, because metadata comes only from the active renderer (RendererManager.getParameterMetadata). Examples are env.selectProb or env.intensity arriving through a session restore, initialParameters, or a strategy whose program lacks that uniform. In those cases no reset happens, but the active program does not read the value either, so the image is unaffected. 'Cannot change any outcome' holds for the image but not literally for the code path. A wording point: docs/compiler-engine-contract.md does not mention ParameterMetadata or triggersReset. The type lives in compiler/types.ts:825-846 as an optional field of CompiledRenderer, so 'locked contract' is the reader's inference.

### app-4 — Accumulation is cleared through three routes; the image-parameter snapshot is patched by hand for the ones that skip the event

- kind: complexity; reader confidence: checked; checker: **partly**
- evidence: Route 1: coordinator.resetAccumulation emits ACCUMULATION_RESET (RenderCoordinator.ts:138-143), which App listens to for `imageParameters` (App.ts:85). Route 2: requestAccumulationReset is deferred while stopped (RenderCoordinator.ts:150-156). Route 3 calls engine.clearAccumulation directly and emits no event: RendererManager.selectRenderer (:278), RendererManager.recompile (:248) and App.resize (App.ts:718). To compensate: App.ts:209 and App.ts:396 `this.imageParameters = this.parameterStore.serialize();   // the accumulation restarted`. docs/claude-outputs-step7-plan.md §A.3 lists the same sites.
- why it matters: An extension listening for ACCUMULATION_RESET misses switches and resizes. App.resize while stopped wipes the finished image, despite the coordinator's rule that keeps it exportable. The future OIDN step depends on knowing every clear site.
- suggestion (thought-through-not-checked): Route every clear through the coordinator: RendererManager and App.resize call coordinator.resetAccumulation instead of the engine. The manual snapshots at App.ts:209 and :396 can then go.
- pros/cons: Pro: one clear path, one event, a reliable snapshot. Con: RendererManager would need the coordinator (or a reset callback) instead of the engine for this. Resize-while-stopped semantics need an owner decision (defer, or clear now).
- checker note: The three routes are real: RendererManager.ts:248 and :278 and App.ts:718 clear through the engine. Four parts are overstated. (1) Only App.ts:85 listens for ACCUMULATION_RESET; no extension subscribes (full grep), so 'an extension misses switches' is hypothetical. (2) App.ts:209 is initialize's first snapshot, not compensation for a skipped event. Only App.ts:396 (recompile) is. selectRenderer and resize leave imageParameters alone, but neither changes parameter values, so the snapshot stays correct. (3) Resize cannot be deferred. Engine.resize zeroes every renderer's sample count, and ResourceManager.resize reallocates the accumulation textures (_resizeTextures, ResourceManager.ts:200-224), so the finished image is gone with the reallocation whichever route clears it. The 'resize-while-stopped semantics' choice in the cons does not exist. (4) ProductionOrchestrator already calls coordinator.resetAccumulation after its tile and production resizes (ProductionOrchestrator.ts:138-140, :216-223). The consolidation suggestion is still reasonable for switch and recompile.

### app-5 — Environment-table variants: the App repeats the Planner's defaults, the chart→size-parameter rule and the extern names

- kind: duplication; reader confidence: checked; checker: **confirmed**
- evidence: App.ts:958-959 `const chart = st.estimator.envSampler ?? 'equirect'; const compensation = st.estimator.envCompensation ?? false;` repeats Planner.ts:578-579. App.ts:962 falls back to `equirect|false` when there are no strategies. Chart→size path: App.ts:239 and App.ts:348 `chart === 'octahedral' ? 'env.sizeOct' : 'env.size'`, lighting.ts:505 and :528, and sizeParamPath in environment.ts:62-64. Extern names: ENV_EXTERN_NAMES (components/env/index.ts:42) versus the literal `extern:env_cdf_cond${suffix}` in environment.ts:225-226. App imports envVariantSuffix from compiler/generate/features/environment.js (App.ts:7). CLAUDE.md names envVariants as the App's one allowed derivation from the scene.
- why it matters: If a default or a name changes in the compiler, the App builds the wrong table or misses one. The executor then fails hard on a missing extern at the first frame. The App also builds variants for strategies that never sample the environment.
- suggestion (thought-through-not-checked): Have the compiler declare the environment tables it reads, for example in CompiledScene: `envTables: [{chart, compensation, condExtern, margExtern, sizeParam}]`, from the planned envSampler. The App then just executes that list, as it does for sceneData.
- pros/cons: Pro: removes the last scene-derived decision in the App, gives one spelling of each name, and builds only the tables that are read. Con: adds a field to the compiler's scene output (owner approval). The HDR loader builds the default table itself today, so the loader and the App split this job; that has to be resolved as well.
- checker note: Verified. App.ts:958-959 repeats the defaults at Planner.ts:577-580. The chart-to-size rule appears at App.ts:239 and :348, environment.ts:62-64 (sizeParamPath), and lighting.ts:505 and :528. environment.ts:225-226 hard-codes `extern:env_cdf_cond${suffix}` instead of using ENV_EXTERN_NAMES, although components/env/index.ts:39-42 says all three layers 'speak THESE names'. envVariants also builds a table for every strategy, whether or not that strategy samples the environment. Some of those tables are wasted, but none is missing.

### app-6 — The export stamp re-resolves measurement and wavelengths and repeats the `color ?? 'rgb'` default

- kind: duplication; reader confidence: checked; checker: **partly**
- evidence: App.ts:832-834 `wavelengths: resolveWavelengthSampler(COLOR_MODELS[strategy.measurement.color ?? 'rgb'], ...)` and `measurement: ... resolveMeasurement(scene, strategy)`. The Planner already resolves both (Planner.ts:567; measurement.ts:29 `color: m.color ?? 'rgb'`).
- why it matters: The same functions are called again, so the values match today. But the `?? 'rgb'` default is a second copy of a planner fact, and the stamp could drift from what the program actually compiled.
- suggestion (thought-through-not-checked): Have the compiled renderer carry its resolved description (or the stamp's strategy and measurement part), and have the stamp read it.
- pros/cons: Pro: the stamp states what was compiled, by construction. Con: CompiledRenderer is a locked contract type (docs/compiler-engine-contract.md), so this needs owner approval. A smaller step is to export a resolver that takes the strategy and use it in both places.
- checker note: Only the wavelength line is a duplicate: App.ts:832 repeats `strategy.measurement.color ?? 'rgb'` and the resolveWavelengthSampler call from Planner.ts:567. The measurement part is not a re-derivation. resolveMeasurement (compiler/plan/measurement.ts) is the single shared resolver, and its header says explicitly that 'the Planner records it ... and the App writes it into export stamps'. That is exactly the CLAUDE.md rule to extract a function both callers use. The smaller fix is to export one wavelength resolver taking the strategy, or to have resolveMeasurement callers share it. Contract approval is not needed for that step.

### app-7 — initializeWithPresets skips scene data, environment and config, so the first frame would fail

- kind: defect; reader confidence: checked; checker: **confirmed**
- evidence: App.ts:357-364 calls only `this.rendererManager.initializeWithPresets(...)` and `this.builtinAssets.upload(...)`. No _bakeProceduralEnvironment, no _uploadSceneGeometry, no _loadImageEnvironment, no `this.config = ...`. A grep over src, pages, tools, scripts and tests finds no caller. docs/architecture.md:1284 calls the legacy STRATEGY_PRESETS 'pending removal'.
- why it matters: For any scene with meshes, instances, a light tree or an environment map, this public entry point leaves externs unregistered, and the executor hard-errors on missing externs. A context restore would also do nothing, because config is null.
- suggestion (checked): Either route it through initialize({scene, strategies}), which is one line, or ask the owner whether the preset API is still wanted. Do not delete it without asking.
- pros/cons: Pro: the one-line delegation removes a divergent lifecycle. Con: none, unless the preset concept itself is being retired, which is the owner's call.
- checker note: Verified. App.ts:357-364 skips the procedural bake, _uploadSceneGeometry, _loadImageEnvironment and `this.config = ...`. A full grep found no caller anywhere. The title overstates one point: a scene without data textures or an environment map renders normally (packSceneData returns null and no externs are needed). Even then, config stays null, so context restore is a no-op (App.ts:261) and loadEnvironmentHDR throws (:440). The default `presets = {}` also means every call without explicit presets throws 'Unknown strategy preset'. STRATEGY_PRESETS no longer exists in src. docs/layout-system.md:288-298 still imports it, so that doc is stale as well.

### app-8 — App.recompile(newScene) leaves this.config and the environment stale

- kind: defect; reader confidence: checked; checker: **confirmed**
- evidence: App.ts:379-398 recompiles and re-packs scene data, but never assigns `this.config` and never re-bakes or reloads the environment. _restoreAfterContextLoss uses `config.scene` and `config.strategies` (App.ts:269-278). The RendererManager.recompile doc comment says it is the 'compiler dev-loop entry point' (RendererManager.ts:157-177).
- why it matters: After a dev-loop scene swap, a context restore re-bakes the old scene's procedural sky and reloads the old HDR. A new scene whose environment type or URL differs renders against the old tables now. The swap is in-progress dev tooling, so this matters when it gets used.
- suggestion (thought-through-not-checked): When recompile gets a scene, update config.scene and re-run the environment provisioning, ideally through the same function initialize uses.
- pros/cons: Pro: one provisioning path for initialize, recompile and restore. Con: re-baking takes time on every recompile, and the work belongs in a provisioning function shared by initialize, recompile and restore.
- checker note: Verified. App.recompile (App.ts:379-398) never assigns this.config and never re-bakes or reloads the environment. _restoreAfterContextLoss takes the scene data from the RendererManager (current) but the environment from config.scene (stale). A dev-loop swap to a scene with a different procedural sky or HDR URL also renders immediately against the old environment tables, before any context loss.

### app-9 — A second initialize() on the same scene keeps only the new strategies in this.config

- kind: defect; reader confidence: checked; checker: **confirmed**
- evidence: RendererManager.ts:76-82 merges strategies for the same scene (`for (const strategy of strategies) this.strategies.set(...)`). App.ts:206 `this.config = config;` keeps only the latest call's strategies. Context restore rebuilds env variants from `config.strategies` (App.ts:272, :278 → envVariants). tools/witness.mjs:356 and :841 use this second-initialize path to add variance strategies.
- why it matters: After a context loss, renderers from earlier initialize calls may read env CDF variants (for example octahedral or compensated) that are no longer registered, and the restore fails with missing externs. This happens only on context loss, but it is the witness tool's normal path.
- suggestion (thought-through-not-checked): Take the strategy list from RendererManager (the merged set) when building env variants, instead of from config.
- pros/cons: Pro: one source for 'which strategies are loaded'. Con: small; it overlaps with app-5. If the compiler declared the env tables, this bug would go away.
- checker note: Verified. RendererManager.ts:76-82 merges the strategies, while App.ts:206 replaces config with only the latest call's strategies. On the initial call this is harmless, because earlier variants stay in the texture registry. Restore is the problem: TextureRegistry.handleContextLoss drops every texture, and App.ts:272 and :278 then rebuild variants only for config.strategies. The same narrowed list feeds loadEnvironmentHDR (App.ts:443-444), so swapping the HDR after a witness-style second initialize also rebuilds variants only for the last call's strategies. The earlier renderers would then bind the old map's CDF tables, or none.

### app-10 — Session productionGoal is written but never restored, and is always absent in autoSave

- kind: doc-code-mismatch; reader confidence: checked; checker: **confirmed**
- evidence: types.ts:102-105 says the session captures 'productionGoal: re-start a production render'. App.ts:692-695 writes it, but restoreSession (App.ts:594-628) never reads it. RenderCoordinator.complete sets `this.goal = null` (RenderCoordinator.ts:281) before renderProduction's autoSave (ProductionOrchestrator.ts:84), and getProductionGoal returns undefined without a goal (RenderCoordinator.ts:174-179). SESSION_VERSION (types.ts:122) is never checked on restore.
- why it matters: The session format promises a behavior that does not exist, and the one automatic save never includes the field.
- suggestion (checked): Ask the owner whether restoring a production is wanted. If not, drop the field and fix the comment. If yes, it is a feature to plan.
- pros/cons: Pro: the comment would match what the code does. Con: none.
- checker note: Verified. restoreSession (App.ts:594-628) never reads productionGoal, and SESSION_VERSION is written (App.ts:685) but never checked. The autoSave runs after the coordinator's complete() sets goal = null (RenderCoordinator.ts:281), so the automatic save never contains the goal. A manual quickSave during an active production would include it, but nothing restores it.

### app-11 — Four different policies for re-supplying textures after a context loss

- kind: complexity; reader confidence: checked; checker: **confirmed**
- evidence: Builtin assets keep CPU bytes (BuiltinAssets.ts:5-7 'Retain immutable CPU bytes'). Scene data is re-packed from the plan, which re-runs the BVH builds (App.ts:275-276 → packSceneData). The image environment is re-FETCHED from its URL (App.ts:278 → _loadImageEnvironment → engine.loadEnvironmentHDR(hdrPath)). The procedural sky is re-baked (App.ts:269-274). A restoring flag and refuseWhileRestoring guard four entry points (App.ts:476-480).
- why it matters: Four ways to answer one question ('re-register every extern the renderers read') make restore the most complex App path (App.ts:259-295) and hard to reason about. The owner withdrew an earlier 'HDR-recovery' batch, so any change here needs a discussion first.
- suggestion (thought-through-not-checked): Before any design, ask the owner whether context-loss recovery is a practical need. TiledRenderer.ts:6-8 cites GPU watchdog losses at 8K. If it is, one candidate is a single 'provision externs' function called by both initialize and restore.
- pros/cons: Pro: a single function would replace four policies. Con: retaining CPU copies of the scene data costs memory (hundreds of MB for 10^6-instance clouds). The withdrawn batch touched this area, so the owner has to frame it first.
- checker note: Accurate as a map. A small correction: refuseWhileRestoring guards five entry points, not four (start, resume, renderProduction, extendProduction and renderTiled; App.ts:460-503). The withdrawal is real (docs/claude-app-decisions.md:3-10 names the 'input-copying/HDR-recovery batch'), and AGENTS.md requires discussing this with the owner first, so the reader's 'ask before designing' framing is right.

### app-12 — Scene-data packing knows a light kind's parameter names and record layout (instanced sphere lights)

- kind: extension-friction; reader confidence: checked; checker: **confirmed**
- evidence: sceneData.ts:114-128: 'Each instance is a light of `kind` (a sphere)... its params-tier record (center.xyz, r)'; `const values = { center, radius: 0, radiance }`; `center[0] = recs[4 * k]; ... values.radius = recs[4 * k + 3]`. sceneData.ts:120 throws if the kind has no treeBounds function. The plan carries only `kind: string` (compiler/sceneData.ts:73).
- why it matters: A second instanced emitter kind (for example disks or quads in an instance cloud) needs App edits, which breaks the 'one folder + one registry line' rule for new occupants.
- suggestion (thought-through-not-checked): Have the plan, or the light descriptor, declare how its values decode from a params-tier record (field name → record offset), and have the packer apply that generically.
- pros/cons: Pro: new instanced light kinds stop touching the App. Con: adds a descriptor fact. Only spheres exist today, so per AGENTS.md this should wait until a second kind is actually wanted.
- checker note: Verified. sceneData.ts:114-137 decodes recs[4k..4k+3] as center.xyz and radius, and builds the values object with the field names center, radius and radiance. The plan type documents this as the packed sphere record (compiler/sceneData.ts:69-73). compiler/sceneData.ts:174-176 limits eligible batches to primitive prototypes ('a params-tier sphere'), so only spheres reach this code today. The reader's 'wait for a second kind' is right.

### app-13 — Attribute-driven batch emission falls back silently to zero power

- kind: guess; reader confidence: inferred; checker: **partly**
- evidence: sceneData.ts:124 `const radiance = 'constant' in emission ? [...emission.constant] : [0, 0, 0];` and :129 `if ('attribute' in emission && attrs !== undefined) {...}`. If the plan says attribute but the packed batch has no attributes, every instance gets zero power and is never chosen by the light tree.
- why it matters: A silent zero instead of an error breaks the no-guess rule. Whether the case can happen depends on packInstanceBatch always producing attributes when the plan requests them, which I did not verify.
- suggestion (thought-through-not-checked): Throw when attribute emission is planned but the attributes are missing.
- pros/cons: Pro: a missing declared fact becomes an error. Con: none, if the case is impossible today (then it is a cleanup).
- checker note: The silent zero cannot happen today. An emission AttributeValue exists only when the Planner patched the material from a non-empty b.attributeRows (Planner.ts:378-383, with attributeRows undefined when there are no rows, Planner.ts:166). Then compiler/sceneData.ts:108-110 passes those rows to the packer, and packInstanceBatch always emits `attributes` when the rows are non-empty (instancing.ts:162-207). So `attrs !== undefined` is a narrowing check that is always true. At most this is a cleanup that would let the types express the guarantee, not a guess or a defect.

### app-14 — Scene-data packing bounds and transforms are Euclidean (AABB + similarity)

- kind: euclidean-assumption; reader confidence: inferred; checker: **confirmed**
- evidence: sceneData.ts:77-81 resolveBox: `transformAABB(geometry[source.geometry].rootBox, (pt) => similarityApplyPoint(source.placement, pt))`. Light tree from AABB boxes and scalar powers (sceneData.ts:104-141). Instance TLAS from local AABB plus similarities (sceneData.ts:59-61).
- why it matters: In H3, S3 or H2xR, placements are isometries rather than similarities. Bounding volumes need a chart in which geodesics behave (for example, Klein-model AABBs stay valid because geodesics are straight lines there), and light-tree importance is not 1/d². The packer hard-codes the Euclidean versions.
- suggestion (thought-through-not-checked): No change now. When curved spaces start, the 'transform a box by a placement' and 'bound a light' operations should come from the ambient-space component, not be inlined in app/sceneData.ts.
- pros/cons: Pro: keeps the curved-space seam out of the App. Con: premature now. It is listed so the seam is known.
- checker note: Accurate as a note for later. Placements as Euclidean similarities is a current owner invariant (CLAUDE.md, docs/fable-transforms.md), so this is correct today. It matters only for the curved-space work, which the owner ranked first in docs/claude-2026-11-review/decisions.md item 8.

### app-15 — App, ProductionOrchestrator and TiledRenderer depend on each other in a cycle; 5–6 flags describe 'what the app is doing'

- kind: complexity; reader confidence: checked; checker: **confirmed**
- evidence: ProductionOrchestrator gets `app: App` and calls app.getPictureFormats, saveAll, quickSave, resize, setLayoutMode, setPixelOffset, setImageSize and enable/disableProfiling (ProductionOrchestrator.ts:66-222). TiledRenderer gets app and production (TiledRenderer.ts:69-73). The state is spread over RenderCoordinator mode/state (:35-36), ProductionOrchestrator phase/runId/tileView (:40-52), ParameterStore.locked, TiledRenderer.job, App.restoring and Engine.state. The runId token exists because stale promise finallys run after a stop (ProductionOrchestrator.ts:48-52).
- why it matters: Understanding the app's state means reading three files at once. This is the area the owner said the redesign was about, and the rewrite of it was withdrawn.
- suggestion (none): Do not propose a rewrite. If the owner reopens it, list for the owner, one at a time, the small concrete merges (for example, whether 'settled' and the coordinator's 'complete' state are the same fact).
- pros/cons: Recorded as a map of the tangle, not a recommendation.
- checker note: Verified. ProductionOrchestrator calls into App throughout (lines 66, 83-84, 133-139, 167-181, 198-216), and TiledRenderer receives both the App and the ProductionOrchestrator. The state flags and the runId guard are where the reader says. Recording this as a map rather than a proposal fits AGENTS.md.

### app-16 — Download and timestamp code repeated; quickSave revokes the URL immediately, which file-export warns against

- kind: duplication; reader confidence: checked; checker: **confirmed**
- evidence: App.ts:635-642 builds its own blob and anchor and calls `URL.revokeObjectURL(url)` right after click. file-export.ts:115-126 downloadBlob says 'revoking right after click() can cancel a large download in some browsers' and waits 60 s. Three timestamp formatters: App.ts:700-709, App.ts:856-865 and TiledRenderer.ts:151-155.
- why it matters: Small, but it is two answers to the same fact.
- suggestion (checked): Have quickSave call downloadBlob, and keep one timestamp helper.
- pros/cons: Pro: fewer lines, consistent behavior. Con: none.
- checker note: Verified. App.ts:637-642 revokes the object URL right after click(), while file-export.ts:115-126 downloadBlob deliberately waits 60 s. There are three timestamp formatters (App.ts:700-709, App.ts:856-865 and TiledRenderer.ts:151-155), and their formats differ slightly (seconds or none).

### app-17 — Comments and docs describing behavior that no longer exists

- kind: doc-code-mismatch; reader confidence: checked; checker: **confirmed**
- evidence: compiler/types.ts:810-811: 'camera.frame additionally carries a HIDDEN Float32Array coercion in ParameterStore.restore'. ParameterStore.restore (ParameterStore.ts:89-114) has no such coercion, and nothing sets camera.frame (docs/impl-plan-engine-app.md:69 calls it a dropped concept). docs/architecture.md:552 and :1293 say 'App is a thin facade (~400 lines)', but App.ts has 968 lines. App.ts:255-256 says parameter values are lost with the context (see app-2).
- why it matters: Readers get misled about where state lives.
- suggestion (checked): Fix the comment in compiler/types.ts and the App.ts:255 comment. Leave docs/architecture.md alone (CLAUDE.md already marks it as predating the current layout) or note the drift there.
- pros/cons: Pro: accurate docs. Con: none.
- checker note: Verified. The comment at compiler/types.ts:810-811 is false: ParameterStore.restore only copies arrays and never touches Float32Array, and nothing in src writes camera.frame. docs/architecture.md:552 and :1293 still say '~400 lines', but App.ts has 968. The reader missed two more false comments, Engine.ts:47-49 and Engine.ts:531, which also say the caller must re-send parameter values.

### app-18 — Public App methods with no current caller are scaffolding or facade conveniences, not dead code

- kind: in-progress; reader confidence: checked; checker: **reclassify-in-progress**
- evidence: Grep over src, pages, tools, scripts and tests finds no external caller for App.recompile (the compiler dev loop, RendererManager.ts:157-177), App.loadEnvironmentHDR (environment swap, App.ts:435-447), getElapsedTime, getRenderMode, getRenderState, getAllParameters, unuse, getExtensionNames, getEventBus, getLayout and resizeToWindow. The step-7 OIDN plan (docs/claude-outputs-step7-plan.md §A.3) builds on readExport, capture/saveAll and the picture list.
- why it matters: Several of these are seams for planned work: the dev-loop recompile, environment swapping, and an app API for exported scene programs (one of the owner's goals in docs/claude-app-decisions.md). They should not be deleted on 'unused' grounds.
- suggestion (thought-through-not-checked): Keep them. If the owner wants a smaller facade, decide with the owner which ones the exported scene programs will need.
- pros/cons: Pro: protects future work. Con: a larger API surface to understand.
- checker note: The grep was confirmed: none of the listed methods has an external caller. getElapsedTime, getRenderMode and getRenderState are used inside App.getStats (App.ts:552-555), so they are not idle in any case. The reader already classifies these as scaffolding or facade conveniences: RendererManager.recompile is the documented dev loop, loadEnvironmentHDR is the environment swap, and docs/claude-app-decisions.md lists exported scene programs as an owner goal. Keeping them is right.

### app-19 — App.ts mixes environment provisioning, context restore, sessions, saving/stamps, layout passthrough and the extension registry

- kind: complexity; reader confidence: checked; checker: **confirmed**
- evidence: App.ts:166-353 (initialize plus env bake/load, ~190 lines), :259-295 (restore), :584-709 (sessions), :776-865 (save/stamp), :909-929 (layout passthrough), :869-907 (extensions). The header still says 'facade over internal managers' (App.ts:1).
- why it matters: The facade is the largest file in the layer, and much of it is not facade. A reader looking for 'how the environment gets onto the GPU' has to read the App.
- suggestion (thought-through-not-checked): Consider moving only environment provisioning (envVariants, _loadImageEnvironment, _bakeProceduralEnvironment) next to _uploadSceneGeometry as an 'externs' module. Present it to the owner as one discrete change, especially if app-5 lands first.
- pros/cons: Pro: the App shrinks by about 140 lines and resource provisioning gets one home. Con: moving code without removing parts is the kind of change the owner distrusts ('smaller helper files do not prove a simpler whole app', AGENTS.md). It is worth doing only together with removing the duplicated decisions in app-5.
- checker note: The line ranges and responsibilities match. Fairly framed as a move worth doing only together with removing the decisions duplicated in app-5, which agrees with AGENTS.md ('Smaller helper files do not prove a simpler whole app').

**Checker: missed by the reader**

- Further evidence for app-1: tools/witness.mjs:358-370 works around an intermittent case where the RendererManager believes the new variance renderer is active, but engine.readExport hits the original renderer. The workaround deliberately toggles through the base renderer to defeat RendererManager.selectRenderer's early return. This is an observed failure of the duplicated active-renderer state, and its root cause has not been investigated.
- Engine.ts:47-49 (the onContextRestored doc) and Engine.ts:531 also claim the caller must re-send parameter values after a context restore. Engine.customParameters survives context loss, so these are the same false claim as App.ts:255-256 and should be fixed together (app-2/app-17).
- docs/layout-system.md:288-298 shows `import { App, STRATEGY_PRESETS }` and `STRATEGY_PRESETS['pathtracer-full']`, but STRATEGY_PRESETS no longer exists in src. The doc example is stale (related to app-7).
- App.loadEnvironmentHDR (App.ts:439-447) rebuilds variants from this.config.strategies too, so the narrowed strategy list in app-9 also affects an environment swap made after a second initialize, not only context restore.
- environment.ts:225-226 hard-codes the extern prefix `env_cdf_cond`/`env_cdf_marg`, although components/env/index.ts:39-42 says ENV_EXTERN_NAMES is the single declaration that the compiler, App and engine all use. The comment there is therefore currently false (part of app-5).

**Reader questions for the owner**

- Is recovering from a WebGL context loss a practical need, for example during 8K tiled renders? If not, the restore path (App.ts:259-295, the restoring flag and four guards) is the largest piece of App machinery you could choose to simplify. If yes, should every extern be re-supplied the same way?
- Should restoring a session also restore a production render (productionGoal), or should that field and its comment be removed?
- Is initializeWithPresets / StrategyPreset still wanted? It is broken for any scene with data or an environment (it skips packing and environment loading). It could become a one-line wrapper over initialize.
- Is there a planned store-backed parameter that should NOT reset accumulation (a debug toggle, for example)? If not, 'every store change resets' could replace the triggersReset flag and the prefix heuristic.
- May the compiler declare the environment tables it reads (chart, compensation, extern names, size parameter) in its scene output, so the App stops re-deriving envVariants? This adds to the compiler's output and needs your OK.
- The witness tool reports that the renderer selection is 'INTERMITTENTLY lost' after a second initialize (tools/witness.mjs:358-362). Do you want that investigated? The duplicated active-renderer state in RendererManager and Engine is a candidate cause, but I have not checked it.


## app-ui-extensions

Here an "extension" is any object with `name` and `install(app, bus)`. It can also have uninstall, saveState/restoreState, version and dependencies (src/app/types.ts:81-92). `app.use(ext)` stores it by name, checks dependencies, and passes it the whole App facade (about 90 public methods) plus the raw EventBus (App.ts:869-891). In practice extensions also reach `window` and `document` directly. Seven extensions exist. The lab (pages/scene-lab.ts) installs six of them together: OrbitControls, StatsPanel, ParameterPanelExtension, ProductionPanelExtension, RenderControlsExtension and AppShortcutsExtension. KeyboardControls (6-DOF flying) is exported but no page installs it. The UI extensions share a base class, UIExtension. It mounts a root element into one of six named regions that AppLayout creates (canvas, left, right, toolbar, statusbar, overlay), or into document.body with a `.standalone` class when the App has no layout. Visibility is a `hidden` class, and bus listeners are removed automatically on uninstall. The layout has four CSS modes (fullscreen, centered, editor, split). The lab uses fullscreen, and ProductionOrchestrator switches the page to centered during a production render. src/app/ui is a small widget toolkit (Panel/Folder/Window/Modal and Slider/Checkbox/NumberInput/ColorPicker/HdrColorInput/VectorInput/Dropdown/Button/TextInput). WidgetFactory turns the compiler's ParameterMetadata into a widget, so the parameter panel is built entirely from what the compiler declares. Grouping follows first appearance in the compiler's record. The panel rebuilds only when the renderer switches. Keyboard handling is spread over five separate window/document listeners: AppShortcuts, StatsPanel `i`, ParameterPanel Tab (capture phase), KeyboardControls and ErrorOverlay Escape. A production render passes through five pieces that talk by events: the `p` key, then the RenderControls setup dialog, then App.renderProduction or renderTiled, then ProductionOrchestrator (lock, switch layout, resize), then the ProductionPanel progress bar, while StatsPanel hides and ParameterPanel greys out. When it finishes, two completion UIs appear: export buttons in ProductionPanel and a modal from RenderControls. A standalone website program today has to be the ten-line README/lab recipe: App.create, initialize, app.use × N, start. There is no build entry for it (vite.config builds only the gallery and the lab). The result takes over the whole page: a global CSS reset under [data-layout], a fixed full-viewport canvas, Space and Tab captured on window, the canvas never resized after load, and the error overlay attached to document.body. No witness tool touches any extension; the tools use only `window.app` methods. So this layer can change without affecting the numeric gate, as long as the lab keeps exposing `window.app` before start() and keeps `__witnessDigest`. The main problems are these. The camera pose has three owners: the parameter store, Orbit's spherical coordinates and Keyboard's frame. They are never synchronised, the session saves the pose twice, and the orbit copy is applied last on restore. The plugin machinery has no consumers: dependencies, version, unuse, getExtension and the install/uninstall events. The keyboard map is scattered. Production layout policy lives in the app core. The camera controls compute Euclidean geometry on the CPU, and the GLSL-only ambient registry gives them nothing else to call. I found two small defects by reading the code (neither was run): StatsPanel's hide does nothing visible, and KeyboardControls' up arrow moves the camera backward.

### UI-1 — StatsPanel 'hide' freezes the panel instead of hiding it (no CSS rule for .stats-panel.hidden)

- kind: defect; reader confidence: checked; checker: **confirmed**
- evidence: UIExtension.ts:129 `this.root.classList.add('hidden')`; StatsPanel.ts:92 `if (!this.isVisible) return;` and :64-67 hides on production start; StatsPanel.ts:142-144 `i` toggles. Full grep of src/pages/public/html for `.hidden` rules finds only extensions.css:94 `.production-panel.hidden {` and :241 `.production-panel-tiles.hidden {`; stats-panel rules (extensions.css:315-357) have no hidden variant.
- why it matters: Pressing `i` or starting a production render leaves the stats overlay on screen with frozen numbers, which is misleading during long renders.
- suggestion (thought-through-not-checked): Add one `.stats-panel.hidden { display: none; }` rule, or give the toolkit one generic `.hidden` rule that UIExtension relies on.
- pros/cons: Pro: one CSS line, no TS change. Con: a generic `.hidden` rule could collide with the production panel's slide-out transition; the per-class rule avoids that. I have not run it in the browser.
- checker note: Complete grep of all project .css/.html (excluding dist/node_modules) finds `.hidden` rules only at extensions.css:94 and :241 (production panel). No global `.hidden`, no `.stats-panel.hidden`. UIExtension.hide() only adds the class, and StatsPanel.updateDisplay returns early when it is hidden, so the panel freezes. During production, ProductionOrchestrator switches to the 'centered' layout. There #region-left sits beside the canvas and stays visible because it is not :empty (layouts.css:143-156), so the frozen panel is on screen. Not run in a browser.

### UI-2 — KeyboardControls: ArrowUp moves the camera backward

- kind: defect; reader confidence: checked; checker: **confirmed**
- evidence: KeyboardControls.ts:237 `if (this.pressed.has('ArrowUp') ...) move[2] -= 1;`; localToWorld :358-360 maps local z to `this.forward[...] * local[2]`; forward is the view direction because updateParameters :291-295 sets `target = position + forward*5`. So ArrowUp moves by -forward. The header :13 says `↑ - forward`.
- why it matters: This is low-impact because no page installs KeyboardControls. It matters when the planned keyboard-navigation work starts from this file.
- suggestion (checked): Treat KeyboardControls as in-progress. Fix the sign when the owner's planned fresh navigation design is taken up (impl-plan-engine-app.md E8: 'a real keyboard NAVIGATION system designed fresh to complement OrbitControls').
- pros/cons: Pro: a one-character fix. Con: the owner plans a redesign, so fixing it in isolation may be wasted work. I did not run it.
- checker note: Confirmed, and the defect is larger than reported. forward is the view direction (lookAt sets forward = dir to target; updateParameters target = position + forward*5), so ArrowUp (move[2] -= 1) moves backward. I simulated vec3Rotate (standard Rodrigues) from the initial lookAt frame (right=+x, up=+y, forward=-z). W gives rotatePitch(-a), which tilts forward to y=-0.0998 (pitch DOWN). A gives rotateYaw(-a), which turns forward toward +x (yaw RIGHT). Both contradict the header (:17-19). The whole control set looks mirrored, as if written for an OpenGL back-vector frame. KeyboardControls is not installed anywhere (pages/scene-lab.ts:56-61 installs six others), and impl-plan-engine-app.md:57-58 E8 ledgers a fresh navigation design. In-progress, so do not delete it.

### UI-3 — Camera pose has three unsynchronised owners (ParameterStore, OrbitControls spherical state, KeyboardControls frame)

- kind: duplication; reader confidence: checked; checker: **confirmed**
- evidence: OrbitControls.ts:22-26 private `distance/azimuth/elevation/target`, read from params only at install (:122-132), never subscribes to anything; :216 writes `camera.position/target`. KeyboardControls.ts:38-39 private `position`/`frame`. Camera params are declared with metadata and shown in the panel (compiler/generate/features/camera.ts:129-130 `group: 'Camera'`). Session: App.ts:603-605 restores parameters, then :612-617 calls each extension's restoreState; OrbitControls.restoreState :112-118 calls updateCamera, which overwrites the params.
- why it matters: Failure scenario: the user types a Camera Position in the panel, then drags, and the camera jumps back to Orbit's old pose. Second scenario: the user types a pose and saves a session; the session holds the typed pose in `parameters` but the stale orbit pose in `extensions['orbit-camera']`, and restore applies the stale one last. This breaks the 'one answer per fact' rule, and it is exactly the state a curved-space camera will need to own cleanly.
- suggestion (thought-through-not-checked): Make the parameter store the only owner of the pose. Orbit would derive its spherical coordinates from `camera.position/target` at the start of each drag (or on `parameter.changed`) and would stop saving its own state.
- pros/cons: Pro: deletes saveState/restoreState from the controls, the session stores the pose once, and the panel, orbit and sessions agree. Con: Orbit's azimuth continuity across the pole clamp must be recomputed from Cartesian coordinates, which atan2/asin already do (cartesianToSpherical :227-234). Old session files with an `extensions` block would then ignore it.
- checker note: OrbitControls keeps private spherical state, reads params only in initializeFromParameters at install, and has no subscriptions. restoreSession restores parameters (App.ts:605), then calls ext.restoreState (:612-617), and Orbit.restoreState calls updateCamera, which overwrites camera.position/target. _buildSessionState (App.ts:676-690) saves extension state alongside parameters. In practice there are two live owners, not three, because KeyboardControls is not installed. Also note: tools/witness-spectral-live.mjs:50,61 uses saveSession/restoreSession, so any change to the session format touches a witness tool.

### UI-4 — Parameter panel never refreshes widget values after it is built

- kind: defect; reader confidence: checked; checker: **confirmed**
- evidence: ParameterPanelExtension.ts:73-86 subscribes only to RENDER_STARTED/COMPLETE/STOPPED and RENDERER_SWITCHED; values are read once in createWidgetForParam :249 `this.app.getParameter(path) ?? meta.default`. Input.setValue exists for external sync (core/Input.ts:53-62) but is never called by the panel.
- why it matters: After an orbit drag, a session restore without a renderer switch, or a setParameters call from code, the Camera Position/Target fields (and any other parameter) show stale values. Editing one field of a stale VectorInput then sends the stale other components.
- suggestion (thought-through-not-checked): Subscribe to `parameter.changed` and call `widget.setValue(newValue)` on the widget whose path matches, using a Map from path to widget.
- pros/cons: Pro: about 10 lines, and it uses setValue's documented 'no onChange' contract. Con: an update on every orbit tick touches the DOM for two VectorInputs per frame, which is cheap but not measured.
- checker note: The panel subscribes only to RENDER_STARTED/COMPLETE/STOPPED and RENDERER_SWITCHED (ParameterPanelExtension.ts:78-83). It never listens to PARAMETER_CHANGED, which App emits at App.ts:110. RendererManager.selectRenderer returns early for the same renderer id (:259-262), so restoring a session that keeps the active renderer emits no RENDERER_SWITCHED and the panel does not repopulate. Input.setValue (core/Input.ts:53-58) exists and has no caller in the panel.

### UI-5 — Plugin machinery with no consumers: dependencies, version, unuse, getExtension(Names), install/uninstall events

- kind: complexity; reader confidence: checked; checker: **confirmed**
- evidence: types.ts:81-92 Extension{name, version?, description?, dependencies?, install, uninstall?, saveState?, restoreState?}; App.ts:869-906. Full greps: no extension declares `dependencies`; `.unuse(` has no caller; `getExtensionNames`/`getEventBus` have no caller outside App; `EXTENSION_INSTALLED`/`EXTENSION_UNINSTALLED` are emitted at App.ts:887/:902 with no listener; `CAMERA_MOVED` is emitted by both controls with no listener. The only consumer is pages/scene-lab.ts:53-58, which installs six extensions together.
- why it matters: This is a general plugin framework for six built-in UI modules that one page installs together. It adds concepts (names, versions, dependency order, install events) that the owner has to read but nothing uses. Every extension still receives the entire App plus the bus, so the interface does not limit what an extension can touch.
- suggestion (thought-through-not-checked): Option to discuss with the owner, not a plan: make each control a plain function `orbitControls(app): () => void` (returns its disposer), and have a program call the ones it wants. Keep the UIExtension conveniences, or fold them into a tiny helper.
- pros/cons: Pro: removes the registry, the name map, dependency checking, two events and session extension state (if UI-3 is done). A program reads as a short list of function calls. Con: churn in 7 files and docs (production-rendering.md, layout-system.md, README); loses `getExtension` lookup, which docs/production-rendering.md:247 presents as API; the owner may want sessions to carry UI state later.
- checker note: Complete greps over src/pages/tools/tests/demos/scripts. No extension declares `dependencies`. `.unuse(`, App.getExtension, getExtensionNames and getEventBus have no callers (the only getExtension hits are gl.getExtension). EXTENSION_INSTALLED/UNINSTALLED and CAMERA_MOVED have emitters and no listeners. Corrections: the installs are at pages/scene-lab.ts:56-61 (root `pages/`, not src/pages). The owner's stated goal (claude-app-decisions.md: independent scene programs that 'can include controls') is the future consumer of composable controls, so present this as a simplification to discuss, not as removal of dead code. docs/production-rendering.md:247 documents getExtension.

### UI-6 — Production render UI spread over five pieces linked by events, with two competing completion UIs

- kind: complexity; reader confidence: checked; checker: **confirmed**
- evidence: AppShortcutsExtension.ts:161-163 emits `PRODUCTION_DIALOG_REQUESTED`; RenderControlsExtension.ts:49 listens and :118-222 builds the dialog; ProductionOrchestrator.ts:198-210 switches layout mode; StatsPanel.ts:64-67 hides; ParameterPanelExtension.ts:144-149 disables; on completion ProductionPanelExtension.ts:291-294 shows `Export PNG`/`Export HDR`/`Close` while RenderControlsExtension.ts:52-60 opens a 'Render Complete' Modal (`Return to Interactive`/`Extend Render`). RenderCoordinator.ts:274 forces the complete progress tick, so both UIs appear.
- why it matters: One user action, a production render, is split across five files, and following it requires following bus events. The two completion surfaces offer overlapping actions (Close vs Return to Interactive; one extends, the other exports). The withdrawn App redesign (docs/claude-app-decisions.md) was about exactly this responsibility.
- suggestion (thought-through-not-checked): Discuss with the owner one production UI module that owns the dialog, the progress and the completion actions in one place. The `p` key would call it directly instead of going through an event.
- pros/cons: Pro: removes PRODUCTION_DIALOG_REQUESTED, the placeholder RenderControls root, and one completion UI. Con: this touches the area whose earlier rewrite the owner withdrew on 2026-10-04, so it must be proposed as one concrete change, with the behavior changes listed.
- checker note: Verified: the `p` key emits PRODUCTION_DIALOG_REQUESTED (AppShortcuts:161-163), RenderControls listens (:49), and RenderControls' root is a display:none placeholder (:39-44). RenderCoordinator.complete forces a final progress tick with state 'complete' (:270-274), so ProductionPanel shows Export PNG/HDR/Close (:291-294). It then emits RENDER_COMPLETE, and RenderControls opens the 'Render Complete' modal 100 ms later (:52-60). Both completion UIs appear with overlapping Close / Return-to-Interactive actions.

### UI-7 — Keyboard map scattered across five global listeners; no single place lists the bindings

- kind: complexity; reader confidence: checked; checker: **confirmed**
- evidence: AppShortcutsExtension.ts:42 `window.addEventListener('keydown', ...)`; StatsPanel.ts:148 (`i`); ParameterPanelExtension.ts:310 `window.addEventListener('keydown', this.keydownHandler, { capture: true })` with stopPropagation for Tab; KeyboardControls.ts:62; ErrorOverlay.ts:145 `document.addEventListener('keydown', ...)` (Escape, which AppShortcuts :117-119 also uses to stop rendering).
- why it matters: Collisions cannot be detected: Escape closes the error overlay and stops the render. Space preventDefault and the window-level Tab capture hijack the keys of any host page that embeds a scene program.
- suggestion (thought-through-not-checked): One keymap table (key → action) owned by the program and attached to the canvas container, or a focused element, instead of the window.
- pros/cons: Pro: every binding is readable in one place, and embedding stops hijacking the page. Con: attaching to a focusable element changes behavior (the user must click the canvas first); the lab may prefer window scope.
- checker note: The global key listeners are at AppShortcuts:42, StatsPanel:148, ParameterPanel:310 (capture phase, stopPropagation for Tab) and ErrorOverlay:145 (document, Escape, only while the overlay is shown). KeyboardControls:62 is not installed, so four are active, not five. The Escape collision is real but low impact, because the overlay usually appears after the loop has already stopped on an error. The UI toolkit has no other keydown handlers (Modal has none).

### UI-8 — App-side camera controls and the pose contract are Euclidean; the ambient seam has no CPU side

- kind: euclidean-assumption; reader confidence: checked; checker: **confirmed**
- evidence: OrbitControls.ts:220-224 spherical→Cartesian `target + distance*(cos e sin a, sin e, cos e cos a)`; KeyboardControls.ts:271-276 `position += worldDir*distance` and :382 `worldUp = [0,1,0]`; compiler/types.ts:729-739 the pose is `position`/`target` Vec3, 'the OrbitControls/KeyboardControls contract'; components/camera/basis.ts cross products; components/ambient/index.ts:13-19 `AmbientDescriptor { type; glsl }`, GLSL only.
- why it matters: In H³, S³ and H²×R a camera pose is a point plus an orthonormal frame (an isometry), and moving it is the exponential map or parallel transport. Orbiting a target is a rotation in the target's isotropy group. With no CPU-side ambient math, every control would hard-code Euclidean formulas or duplicate geometry outside the ambient family.
- suggestion (thought-through-not-checked): When curved spaces are designed, give the ambient descriptor a small TypeScript twin (exp map, transport, frame-at-point), and have the controls move a pose expressed as an isometry/frame through it. Read thurston-rebuild first for how it represented the camera.
- pros/cons: Pro: the controls become geometry-agnostic, and the 'Point may become vec4' typedef has a CPU counterpart. Con: this is a contract change to CameraPose and the reserved params, which belongs to the curved-space design, not a UI cleanup.
- checker note: Verified OrbitControls.sphericalToCartesian, KeyboardControls' world up [0,1,0] and additive translation, the CameraPose doc (compiler/types.ts:725-740) naming the OrbitControls/KeyboardControls contract, and AmbientDescriptor {type, glsl} with only 'euclidean' registered. Curved spaces are planned and deferred, so this is a design input for that work, not a defect to fix now.

### UI-9 — Production presentation (layout mode) is decided inside the app core

- kind: complexity; reader confidence: inferred; checker: **partly**
- evidence: ProductionOrchestrator.ts:44 `private productionLayoutMode: LayoutMode = 'centered';` :198 saves `getLayoutMode()`, :208-210 `this.app.setLayoutMode(this.productionLayoutMode)`, :172-176 restores it; layouts.css:137 `aspect-ratio: var(--layout-canvas-aspect, 16/9);` with canvas `width:100%;height:100%` (:44-45); nothing sets `--layout-canvas-aspect` (grep).
- why it matters: The render-session logic depends on page layout. A standalone program without a layout takes a different path (`hasLayout()` checks). Also (inferred from CSS, not run): non-16:9 production sizes, including 'screen' on a 16:10 display, are shown stretched in the 16:9 box. Saved files are unaffected.
- suggestion (thought-through-not-checked): Let the production UI decide the view (or keep fullscreen and letterbox with CSS `object-fit`/aspect set from the render size). The orchestrator would then own only lock/resize/render/save.
- pros/cons: Pro: removes the layout dependency from ProductionOrchestrator, plus four App layout methods used only there. Con: changes what the screen looks like during production, which needs the owner's view; the stretched-display claim needs one browser check.
- checker note: The layout switching is as described (ProductionOrchestrator.ts:44, 172-176, 198, 208-210). Nothing sets --layout-canvas-aspect (grep). scene-lab creates the layout with no variables, so the centered container is 16:9 and the canvas fills it at width/height 100%. Non-16:9 sizes therefore stretch on screen (inferred from the CSS, not run). Correction: of the App layout methods, only getLayoutMode/setLayoutMode are used solely by the orchestrator. hasLayout and getRegion are used by UIExtension.ts:108,114 and ParameterPanelExtension.ts:59,130, so 'four App layout methods used only there' is overstated.

### UI-10 — No build or packaging path for standalone scene programs; the current recipe takes over the host page

- kind: extension-friction; reader confidence: checked; checker: **confirmed**
- evidence: vite.config.ts `rollupOptions: { input: { suite: 'index.html', lab: 'lab.html' } }`; AppLayout.ts:88 `this.root.dataset.layout = mode` on the container; layouts.css:18-24 resets margin/padding on `[data-layout] *`, :30-34 `overflow:hidden; min-height:100vh`, :74-77 fullscreen canvas `position: fixed; inset: 0`; App.ts:62-64 sizes the canvas once; no `resize` listener or ResizeObserver anywhere in src/pages (grep); App.ts:137 `new ErrorOverlay(document.body)`.
- why it matters: The owner's stated goal (docs/claude-app-decisions.md) is 'Export independent scene programs for the website and posterity. Each keeps its own code version.' Today a program must be full-page, has a fixed resolution after load, and has no per-program build entry.
- suggestion (thought-through-not-checked): Treat this as in-progress. A minimal path to discuss: one `programs/<name>.html` + `.ts` per scene (the ten-line recipe), added as a Vite input, built with a fixed git stamp; plus a canvas-container-scoped resize. Settle the embedding question (full page vs inside an article) with the owner first.
- pros/cons: Pro: uses the existing Vite multi-page build with no new machinery. Con: 'keeps its own code version' may mean a separate dist per program (copying the build), which this does not decide; layout CSS scoping is a separate decision.
- checker note: vite.config.ts inputs are only suite/lab. The App constructor sizes the canvas once from clientWidth/innerWidth (App.ts:62-63). There is no 'resize' listener or ResizeObserver in src or pages (grep). The ErrorOverlay is mounted on document.body (App.ts:137), and the layout CSS resets [data-layout] * and uses fixed positioning. This is correctly framed as in-progress toward the owner's standalone-programs goal.

### UI-11 — Heuristic fallbacks in the parameter/UI path

- kind: guess; reader confidence: checked; checker: **partly**
- evidence: events.ts:63-67 `shouldResetAccumulation` is a prefix rule, and 'everything else' returns true; App.ts:406-412 uses it when metadata lacks triggersReset. HdrColorInput.ts:36 `options.intensityMax ?? Math.max(4 * parts.intensity, 1)` when the compiler declares no range. WidgetFactory.ts:156-163 `default:` with `console.warn(... falling back to NumberInput)`. ParameterPanelExtension.ts:256-258 turns a scalar value of a `color`-typed parameter into [v,v,v].
- why it matters: The owner's rule: no guesses, and missing facts are declared or are errors. Each of these invents a fact (reset or not, slider ceiling, widget kind, value shape) instead of reading a declared one. For the color case, the declared type does not determine the value shape.
- suggestion (thought-through-not-checked): Have the compiler always declare `triggersReset` and a `range` for HDR colors, and make an unknown widget type an error. For the scalar-color case, decide in one place (the compiler's metadata or the spectrum kind) whether the value is a scalar or a triple.
- pros/cons: Pro: removes four small heuristics. Con: the reset fallback also covers engine builtins and `renderer.picture`, which have no metadata today; they would need declared metadata or an explicit list. The HDR ceiling is a UI nicety the owner may accept as display-only.
- checker note: The prefix fallback and the HDR slider ceiling are accurate. Corrections: (1) WidgetFactory's `default:` branch is unreachable. ParameterMetadata.type is the closed union float|int|bool|vec2|vec3|vec4|color (compiler/types.ts:825), and all seven are cases, so it invents no fact at runtime. The plain fix is a TypeScript exhaustiveness check, not a compiler change. (2) The compiler already declares triggersReset on camera, placement, environment, values and blackbody parameters, so the prefix rule serves only metadata-less engine./env./debug./renderer. paths, which is what its comment states. (3) The scalar-to-[v,v,v] conversion applies the documented spectrum-broadcast convention, which the uniform closure also applies. It is a duplicated decision (one answer per fact), not a guessed one. Editing does write back a triple where a scalar was stored.

### UI-12 — UI hard-codes the main picture name 'radiance'

- kind: duplication; reader confidence: checked; checker: **confirmed**
- evidence: AppShortcutsExtension.ts:130 `this.app.save('radiance', 'hdr')`; ProductionPanelExtension.ts:332 same; RenderControlsExtension.ts:207 and :214 `save: [{ picture: 'radiance', ... }]`. App.ts:741-750 already exposes `getPictures()` with 'The first is the main picture'; compiler/plan/pictures.ts:19 defines `name: 'radiance'`.
- why it matters: Two places answer 'which picture is the main one'. A future measurement whose main picture is not named 'radiance' (the `response?: 'radiance'` seam at compiler/types.ts:576-578) would break the UI's save actions.
- suggestion (checked): Use `app.getPictures()[0]` (or a `getMainPicture()` helper) in the four call sites.
- pros/cons: Pro: a trivial change with one source of truth. Con: none significant.
- checker note: Four sites hard-code 'radiance' (AppShortcuts:130, ProductionPanel:332, RenderControls:207,214). App.getPictures() documents 'the first is the main picture', and compiler/plan/pictures.ts RESPONSE_PICTURES names it from measurement.response. Using getPictures()[0] keeps the intended 'raw main picture as HDR, even while an AOV is displayed' behavior.

### UI-13 — Stale descriptions: RenderControls toolbar, toolbar CSS, camera.frame coercion, README App size

- kind: doc-code-mismatch; reader confidence: checked; checker: **confirmed**
- evidence: RenderControlsExtension.ts:1-13 says 'Toolbar with app title and render button / Sample count input', but :35-44 says 'No persistent UI, just a placeholder'. extensions.css:359-471 `.render-controls-toolbar` etc. style elements nothing creates (grep: `render-controls` appears only in the CSS and `name = 'render-controls'`). compiler/types.ts:809-811 says 'camera.frame additionally carries a HIDDEN Float32Array coercion in ParameterStore.restore', but ParameterStore.ts has no 'frame' (grep), and impl-plan-engine-app.md E11 deleted it. README.md says '`App` is a thin facade (~400 lines)'; App.ts is 968 lines.
- why it matters: Readers get the wrong picture of what exists. The owner relies on comments and docs to understand the code.
- suggestion (checked): Correct the headers and comments. Flag the toolbar CSS to the owner (it appears superseded by the modal dialog) rather than deleting it.
- pros/cons: Pro: comment-only. Con: the `camera.frame` reservation may be wanted for a curved-space camera frame; keep the reservation and fix only the comment.
- checker note: Verified: RenderControls header :6-11 (toolbar, sample input, mounts to region-toolbar) contradicts the placeholder root in region-overlay. The `.render-controls-*` CSS (extensions.css:363-431+) has no element that uses it; 'render-controls' appears in TS only as the extension name. ParameterStore.ts has no camera.frame or Float32Array coercion in restore; Float32Array appears only in serialize at :73. E11 deleted the coercion (impl-plan-engine-app.md:69), yet compiler/types.ts:809-811 still describes it. README.md:62 says App is '~400 lines', but App.ts is 968 lines. Keep the camera.frame reservation, which a curved-space frame may use.

### UI-14 — Two mount paths per UI extension, and the 'standalone' UI toolkit imports the extensions' CSS

- kind: complexity; reader confidence: checked; checker: **partly**
- evidence: UIExtension.ts:112-119 region vs `document.body` + `standalone` class; ParameterPanelExtension.ts:56-71 its own pair; CSS duplicates: `.param-panel-standalone` (extensions.css:40-64), `.stats-panel.standalone` (:334-339), `.production-panel.standalone`. ui/index.ts:9 says '**Standalone**: No dependency on App', yet ui/styles/components.css:8 `@import './extensions.css';`.
- why it matters: Each UI piece is written twice for layout and no-layout pages, and the layering is inverted (the toolkit carries App styles). The no-layout path is planned use: docs/claude-oidn-test-plan.md:200 '`new App(canvas)` works without a page layout'. That makes it in-progress, not dead, but it doubles every panel.
- suggestion (thought-through-not-checked): Option: a UI piece takes the parent element it mounts into (region or anything else) as an argument, so there is one path. Move extensions.css next to the extensions.
- pros/cons: Pro: removes the standalone branches and their CSS twins, and the toolkit becomes truly standalone. Con: the OIDN test page must then pass a parent, which is a minor change to a reviewed plan's assumption; check with the owner.
- checker note: The two mount paths, the standalone CSS twins (extensions.css:40-64, 100, 334, 379) and the inverted import (components.css:8 imports extensions.css, although ui/index.ts:9 claims 'no dependency on App') are verified. Correction: the cited planned use (claude-oidn-test-plan.md:200) concerns `new App(canvas)` without a layout, at the App and ProductionOrchestrator level. That OIDN test page installs no UI extensions (no .use/extension names in either OIDN plan). So the extensions' standalone branches have no cited planned consumer, and the 'Con: the OIDN page must pass a parent' does not apply. The owner's future standalone scene programs remain a possible consumer.

### UI-15 — Scaffolding to keep: KeyboardControls, Window, TextInput, layout modes editor/split, region show/hide, unit/help metadata

- kind: in-progress; reader confidence: checked; checker: **confirmed**
- evidence: Greps: `Window` and `TextInput` are referenced only inside src/app/ui (exported toolkit pieces, documented in docs/ui-components.md). Layout modes `editor`/`split` exist in layouts.css:203-300 and docs/layout-system.md:107-130; `showRegion/hideRegion/setVariables` have no callers. `ParameterMetadata.unit` is set only by blackbody (components/color/spectra/blackbody/blackbody.ts:123 `unit: 'K'`) and never displayed; `help` is never set or read. KeyboardControls is not installed (owner's planned navigation redesign, impl-plan-engine-app.md E8).
- why it matters: These are toolkit and future surfaces (future editors, documented layout modes, a units display, keyboard navigation), not dead code. Listing them prevents a refactor from deleting them.
- suggestion (checked): Keep them. If the panel is touched, displaying `meta.unit` next to the label is a one-line use of an already-declared fact.
- pros/cons: Pro: preserves planned work. Con: more surface for the owner to read; worth marking clearly in docs as 'toolkit, not yet used by a page'.
- checker note: Window and TextInput are referenced only inside src/app/ui. showRegion/hideRegion/setVariables have no callers outside src/app/layout. `unit:` is set only by blackbody.ts:123, and `help` is never set or read. KeyboardControls is uninstalled and ledgered in E8. Correctly classified as scaffolding to keep.

**Checker: missed by the reader**

- KeyboardControls rotations are mirrored as well as ArrowUp. Simulated with the repo's vec3Rotate: W pitches down and A yaws right, the opposite of the header (KeyboardControls.ts:17-19). The header and the install log ('WASD + QE', 'WASD/QE') still advertise the Q/E roll that E8 deleted (KeyboardControls.ts:17, :72, :262-286).
- The pending step-7 outputs plan (docs/claude-outputs-step7-plan.md:215-216) relies on the AppShortcutsExtension production-lock whitelist (Escape, \, m, M at AppShortcutsExtension.ts:67) and on the unbound `n` key. A keymap or extension refactor (UI-5/UI-7) must keep those assumptions or update that plan, which is awaiting owner decisions.
- tools/witness-spectral-live.mjs:50,61 drives app.saveSession()/restoreSession(), which includes OrbitControls' extension state. Changing session contents (UI-3, UI-5) changes what that witness tool restores.

**Reader questions for the owner**

- Should a website scene program be a full page (as the lab is today), or must it sit inside an article (its own canvas size, no global CSS reset, no window-level Space/Tab capture)? The answer decides most of the layout and keyboard design.
- What does 'each program keeps its own code version' mean in practice: a separate built dist folder per program, or one source tree with a git stamp per program?
- Should sessions carry UI state (camera-control internals, panel open/closed), or only parameters plus renderer? If only parameters, the camera controls can drop saveState/restoreState and the pose has one owner.
- During production, do you want the view to switch to the 'centered' layout, or stay fullscreen? That choice is currently made inside ProductionOrchestrator.
- When a production render completes, which single set of actions do you want: export PNG/HDR, extend, return to interactive, close? Today two UIs offer overlapping subsets.
- Is KeyboardControls the starting point for the keyboard-navigation system you planned, or will that be designed fresh (and, for curved spaces, together with the camera pose contract)?


## parameters

A field in a scene or strategy can be a constant, which is baked into the GLSL, or a slider `{param, default, min?, max?}` (ValueParam, compiler/types.ts:265). A slider becomes a uniform named `u_<path with dots replaced by underscores>` (paramToUniform, glsl-format.ts:38). Each compiler feature (materials, lighting, camera, environment, intersection/placement, and so on) returns a FeatureContribution with `uniforms: PlannedUniform[]` and `parameters: Record<path, ParameterMetadata>`. mergeContributions removes duplicate uniforms by name and combines the metadata with Object.assign. buildUniforms then turns each PlannedUniform into the locked engine type `UniformBinding {uniform, parameters, type, compute}`. A plain slider gets the closure `params[path] ?? default`. Derived values carry their own CPU closures over several paths: the camera basis, tan(fov/2), the light-selection CDF, driven-placement quaternions, majorants, blackbody normalization and the RGB stand-ins of named spectra.

At run time the App's ParameterStore holds the chosen values. Its single onChange callback copies each change into the Engine's own map (Engine.customParameters) and decides whether to reset accumulation (App._triggersReset). It uses the active renderer's `triggersReset` metadata, which is always true, and otherwise falls back to a guess from the path prefix (events.ts:63). Each frame the Engine merges its engine.* builtins with that map. ParameterManager runs a binding's closure only when its inputs changed, and uploads only when the value changed. The panel builds its widgets from the active renderer's metadata. A production render locks the whole store. Measured environment sizes and weights and the displayed-picture index skip the store and go straight to the engine.

The binding machinery is sound and not tied to any geometry: closures over several paths, with mat4 and float[] types available. The cost is in duplication around it:
- About 12 hand-built metadata rows.
- Three slider validators with different rules about defaults.
- Up to four copies of a default.
- Two value stores.
- Three array-equality helpers.
- Three places that broadcast a scalar to vec3.
- A positional minting signature whose arguments disagree between call sites.
- The reset field and the prefix guess, which carry no information today.

The owner already deferred a 'parameter system revamp' on the same diagnosis (claude-outputs-accumulation.md §8). A minimal clean model would give each live parameter one compiler record: path, shape, a required default, range, widget, label and group, and its section (measurement, estimator or view). One builder would produce it, and the App would read the section for both the reset decision and the lock.

### P1 — Reset decision is a field that is always true plus a name-prefix guess

- kind: guess; reader confidence: checked; checker: **confirmed**
- evidence: Every ParameterMetadata site sets `triggersReset: true` (values.ts:110,177; blackbody.ts:124; Planner.ts:779,803,816,837; lighting.ts:56; environment.ts:129,152,153,204,205; camera.ts:31,129,130) — grep finds no `false`. App._triggersReset (App.ts:406-412): `if (meta?.triggersReset !== undefined) return meta.triggersReset; return shouldResetAccumulation(path);` and events.ts:63-67 `if (path.startsWith('debug.') || path.startsWith('renderer.')) return false; if (path.startsWith('engine.') || path.startsWith('env.')) return false; return true;`. Metadata is looked up only in the ACTIVE renderer (RendererManager.ts:343-356). No src code sets debug.* through the store; renderer.picture and env.size/totalWeight go to engine.setParameter directly (App.ts:226-239,770).
- why it matters: The owner forbids guesses; the heuristic decides only for paths the active renderer does not declare (e.g. initialParameters for another strategy, console calls), and the metadata field carries no information. Owner already recorded this as deferred work: docs/claude-outputs-accumulation.md:239-258 ('one fact per parameter, changes the render or display only').
- suggestion (thought-through-not-checked): Replace triggersReset + heuristic with one declared fact per compiled parameter (its taxonomy section: measurement/estimator reset, view does not), and treat a store write to an undeclared path as an error or as resetting by rule, not by prefix. Use the same fact for the production lock.
- pros/cons: Pros: removes the only name-prefix guess, unifies reset and lock (owner's own §8 proposal), ties App behaviour to the pinned measurement/estimator/view taxonomy. Cons: every minter must supply the section (known where the field lives); needs owner discussion per AGENTS.md before touching App; today no 'view' live parameter exists (exposure is a #define, ShaderBuilder.ts:79-95), so the false branch is unexercised.
- checker note: Every ParameterMetadata literal in src sets triggersReset: true. A grep finds no false value in src or tests. App._triggersReset (App.ts:406-412) prefers the metadata and otherwise falls back to the prefix rule in events.ts:63-67. RendererManager.getParameterMetadata reads only the active renderer. Nothing in src writes debug.* through the store; only events.ts and types.ts:814 mention debug. The env.*, renderer.picture and measured values reach the engine through engine.setParameter (App.ts:226,227,239,348,770). The owner already deferred this in docs/claude-outputs-accumulation.md section 8 (lines 240-258). Because that is a recorded design item, the change belongs in owner discussion, not a refactor.

### P2 — ParameterMetadata rows hand-built at ~12 sites with three different label rules

- kind: duplication; reader confidence: checked; checker: **confirmed**
- evidence: values.ts:108-112 and :171-179 `name: capitalize(seg[seg.length - 1]), group: seg.length > 1 ? seg[0] : undefined, triggersReset: true`; blackbody.ts:122-128 repeats the seg/group logic with fixed name 'Kelvin'; Planner.ts:770 `const label = (path) => path.split('.').pop()` (not capitalized) group 'Placement' at :779,:803,:815,:836; camera.ts:30-33 group 'Camera'; environment.ts:129,152-153,204-205 fixed names; lighting.ts:54-57 'Env select P'. Range rule `min !== undefined && max !== undefined ? {range}` repeated at values.ts:111,178, Planner.ts:817,838, camera.ts:60.
- why it matters: One fact (how a slider is labelled/grouped/ranged) answered in many places; panels already differ (placement labels lowercase, material labels capitalized). Adding a new sliderable component means copying a row literal.
- suggestion (checked): One function `sliderRow(valueParam, shape, {role?, group?, label?})` returning ParameterMetadata, called by mintValueUniform, blackbody mint, buildDrivenPlacement, camera mintControl, environment and lighting.
- pros/cons: Pros: one place for label/group/range/hdr rules; digest-checkable refactor (metadata is in the digest). Cons: wide but shallow diff; label capitalization of placement sliders would change visibly (owner choice).
- checker note: Checked values.ts:108-112 and 171-179, blackbody.ts:121-129, Planner.ts:770 (label = last segment, not capitalized), and camera.ts:29-33 and 56-58, plus the environment and lighting literals. There is one more variant the reader did not list: blackbody computes a default slider range from its domain, [domain min, max(12000, default)], when min or max is missing. Every other site gives a range only when both min and max are present. A shared sliderRow helper would have to allow for that.

### P3 — mintValueUniform takes glslType, metaType, hdr and role positionally although three follow from (shape, role); call sites disagree

- kind: duplication; reader confidence: checked; checker: **confirmed**
- evidence: Signature values.ts:85-98 `(prop, glslType, metaType, uniforms, parameters, seen, hdr = false, color = 'rgb', role?)`. materials.ts:211-217 passes `isRadiometric(f.role) ? 'color' : 'float'` and hdr `f.source === EMISSION_KEY` (a name test, not the role); materials.ts:221-222 media σ pass hdr `true` but no color model or role; :225 medium emission no role; :235-241 phase rows no hdr/color/role; lighting.ts:163 hdr = isVec3; environment.ts:131 passes SETTING_ROLES.sky. SETTING_ROLES.medium exists (compiler/types.ts:475-478) but materials.ts does not use it for minting. values.ts:138 throws `a live ${kind.label} value in an RGB program needs its setting's role`.
- why it matters: The role already determines widget type and HDR (emission/coefficient are magnitudes, reflectance is [0,1]); hdr decided per call site is a duplicated decision. Media sites omitting role/color will block the pending spectral step 5 ('fog glow takes any light spectrum', memory spectral-next) the day a medium emission accepts a named kind (today propertyValidation.ts:60-66 rejects named kinds in media, so it is latent).
- suggestion (thought-through-not-checked): Make mintValueUniform take (value, {shape, role}, ctx) and derive glslType, metaType ('color' iff radiometric), hdr (role ∈ {emission, coefficient}) inside; ctx carries color model and the uniforms/parameters/seen sinks.
- pros/cons: Pros: removes 3 positional booleans/strings per call, fixes the media role gap before spectral media need it, the role becomes the one answer. Cons: changes hdr for any reflectance-role row currently marked hdr or vice versa (would show in digest; must be checked row by row).
- checker note: Verified the signature at values.ts:85-98 and the call sites: materials.ts:211-217 decides hdr with f.source === EMISSION_KEY, media sigma and emission at 221-225 pass hdr=true but no color model or role, phase rows at 235-241 pass none, and lighting.ts:163 decides hdr with isVec3. In practice the role agrees with these flags: every role:'emission' row is lambert.emission or a vec3 light row (grep). Two corrections. First, hdr only matters when metaType is 'color' (values.ts:174), so the blackbody scale's ctx.mint(scale,'float','float',true) ignores it. Second, the media gap is latent, as the reader says: propertyValidation.ts:60-74 rejects named kinds in media. SETTING_ROLES.medium is used only for emitSpectrum (materials.ts:596-599) and validation, not for minting.

### P4 — Three slider validators with different default rules; transform sliders get Planner-invented defaults

- kind: guess; reader confidence: checked; checker: **confirmed**
- evidence: param.ts:31 `{param} needs a default — the value the render starts with` (used by numberProblems, propertyValidation.ts:133-163, for materials/lights/env/expressions/kind fields). Camera 'value-number' has its own check (Validator.ts:786-822) requiring a finite default. Transforms: Validator.ts:1340 `const pos = isValueParam(t.position) ? t.position.default : t.position; if (pos !== undefined && …)` (default optional), :1626 `aa.angle.default ?? 0`, :1655 `scale.default !== undefined && …`. Planner then substitutes: Planner.ts:776 `pos.default ?? [0, 0, 0]`, :799 safeQuat(... , IDENTITY_QUAT), :812 `: 0`, :833 `scl.default > 0 ? scl.default : 1`. camera.ts:56 `fov.default ?? 0.8` (unreachable given the camera check).
- why it matters: Owner rule: no guesses, missing facts are errors. A transform slider without a default silently starts at an invented value, while the same omission on a material is an error. Three implementations of 'is this slider well formed' can drift.
- suggestion (thought-through-not-checked): Route transform and camera sliders through numberProblems (with shape 'vec3'/'scalar' and their domains: scale positive, fov interval) so default is required everywhere; delete the Planner fallbacks after the Validator guarantees defaults.
- pros/cons: Pros: one slider rule, no invented defaults, smaller Validator. Cons: scenes that relied on omitted transform defaults become invalid (needs a scan of scenes/demos); quaternion degeneracy and the scale-min warning remain transform-specific extras.
- checker note: param.ts:31 (valueParamProblems) requires a default, but it is reached only through numberProblems (propertyValidation.ts:97,123; Validator.ts:1754 expressions). Transform checks validate a default only when one is given: Validator.ts:1339-1345 position, 1617 quaternion ('validate the default if given'), 1626 angle `?? 0`, 1655 scale. The Planner then makes up values at :776 [0,0,0], :799 identity, :812 0 and :833 1. The camera check at Validator.ts:788-793 requires a finite default for value-number, so camera.ts:56 `?? 0.8` cannot be reached. The doc comment at Validator.ts:1615 suggests the optional quaternion default exists for the future graph runtime port. The owner should decide whether that port supplies the value, but even then the Planner's invented first frame is a guess.

### P5 — Scalar-to-vec3 broadcast of a color slider decided in three places

- kind: duplication; reader confidence: checked; checker: **confirmed**
- evidence: plan/values.ts:21-23 broadcasts a scalar default; generate/values.ts:162-167 compute closure `typeof value === 'number' ? [value, value, value] : value`; ParameterPanelExtension.ts:256-258 `if (meta.type === 'color' && typeof currentValue === 'number') currentValue = [currentValue, currentValue, currentValue]`.
- why it matters: One convention (a gray spectrum is a number) implemented at plan, engine-closure and UI layers; a new consumer (e.g. session export, OIDN, a scripted animation) must remember it too.
- suggestion (thought-through-not-checked): Normalize once at the store boundary for parameters whose compiled shape is vec3 (or have the compiled LiveParameter declare shape and coerce on set).
- pros/cons: Pros: one place; closures become plain reads. Cons: the store would need the compiled shape (it has none today); scalar values in initialParameters (witness scenes use 'lamp.power' scalars) must keep working.
- checker note: plan/values.ts:19-23 broadcasts a scalar {param} default, generate/values.ts:162-167 broadcasts in the compute closure, and ParameterPanelExtension.ts:256-258 broadcasts in the UI. Their comments explicitly state the same convention. The three run at different boundaries: the planned default, live values, and the widget.

### P6 — Two value stores (ParameterStore and Engine.customParameters); resendAll is a no-op on the engine

- kind: duplication; reader confidence: checked; checker: **confirmed**
- evidence: ParameterStore.ts:5 `private parameters = new Map`; Engine.ts:44 `private customParameters = new Map`, :259 setParameter, cleared only in dispose (:471). App.ts:100 copies every change. RendererManager.ts:247,275 and App.ts:279 call `parameterStore.resendAll()`, which re-sets identical values (oldValue === newValue → no reset, no event, App.ts:103-115). ParameterManager.initialize already clears caches on switch (ParameterManager.ts:72-75).
- why it matters: Two holders of one fact plus a re-sync routine that does nothing; readers must know which map is authoritative (App.getParameter reads the store, engine renders from its mirror, env.* exist only in the engine).
- suggestion (thought-through-not-checked): Either the engine reads values handed to renderFrame by the App (store + measured env values), or keep the engine map and drop the mirror semantics; then resendAll can go.
- pros/cons: Pros: one value holder; removes resendAll and its three call sites. Cons: Engine API change (setParameter is used for env.* and renderer.picture); measured env values then need a home on the App side (they are deliberately not in the store, App.ts:213-219).
- checker note: ParameterStore.resendAll emits old===new. App's onChange calls engine.setParameter with the identical value and skips the reset and the event. Engine.customParameters is cleared only in dispose (Engine.ts:471), which runs only at App teardown, so on recompile (RendererManager:247), switch (:275) and context restore (App.ts:279) the engine map already holds those values. Engine ParameterManager.initialize clears its own caches on a switch. The engine map is not a pure mirror: it also holds env.size, env.totalWeight, env.sizeOct and renderer.picture, which are never in the store. The reader acknowledges this.

### P7 — Three array-equality helpers for parameter values

- kind: duplication; reader confidence: checked; checker: **confirmed**
- evidence: ParameterStore.ts:116-129 valuesEqual; ParameterManager.ts:258-271 inputsChanged; shader-uniform-utils.ts:140-155 valuesEqualUntyped (+ arrayEquals :157). All do exact element-wise comparison of arrays/typed arrays.
- why it matters: Small, but three implementations of one predicate in a code base aiming for one answer per fact.
- suggestion (checked): One exported `sameValue(a, b)` in a shared util used by all three.
- pros/cons: Pros: trivial, no behaviour change. Cons: crosses the App/Engine boundary (App may import an engine util; direction App→Engine is allowed).
- checker note: ParameterStore.valuesEqual, ParameterManager inputsChanged, and shader-uniform-utils valuesEqualUntyped plus arrayEquals all compare exactly, element by element. Related, and missed by the reader: the comment above inputsChanged (ParameterManager.ts around line 247) says 'the epsilon tolerance belongs to the GPU-upload cache', but uniformValuesEqual is exact, so the comment is stale.

### P8 — Display-pass uniforms are declared by hand in ShaderBuilder and bound separately in Generator

- kind: duplication; reader confidence: checked; checker: **confirmed**
- evidence: ShaderBuilder.ts:91-93 `'uniform vec2 u_resolution;', … ...(pictures.length > 1 ? ['uniform int u_picture;'] : [])`; Generator.ts:56-62 appends `{ name: 'u_resolution', … parameterPath: 'engine.resolution' }` and `...(pictures.length > 1 ? [{ name: 'u_picture', type: 'int', parameterPath: 'renderer.picture', default: 0 }] : [])`. fable-compiler-contracts §2.10 says 'no GLSL template declares its own uniform'.
- why it matters: The condition `pictures.length > 1` and the uniform name/type must agree in two files; contradicts the contributions contract.
- suggestion (thought-through-not-checked): Let the display pass's uniforms come from one PlannedUniform list that ShaderBuilder declares from and buildUniforms binds from.
- pros/cons: Pros: one declaration per uniform. Cons: display program is built outside the feature merge; needs a small plumbing change in ShaderBuilder.
- checker note: ShaderBuilder.ts:91-93 declares u_resolution and, when pictures.length > 1, u_picture. Generator.ts:56-60 binds the same two with the same condition. fable-compiler-contracts.md section 2.10 (line 172) says the Generator emits every uniform declaration from the merged list, including the display pass's, so that no template declares its own uniform.

### P9 — Metadata precedence differs by layer: first-wins in a feature, last-wins across features, ??= for RGB kind sliders

- kind: complexity; reader confidence: checked; checker: **confirmed**
- evidence: values.ts:152 `if (seen.has(path)) return;` (first wins); values.ts:135 `parameters[path] ??= meta`; merge.ts:94 `Object.assign(parameters, c.parameters)` (later feature wins; order core, intersection, materials, lighting, …, camera, environment per features/index.ts:37-46). merge.ts:99 conflict check compares only `type` and `parameterPath` of uniforms, never metadata.
- why it matters: A path shared by a material albedo (non-HDR swatch) and a light emission (HDR) silently gets the lighting row; no diagnostic says the two declarations disagree.
- suggestion (thought-through-not-checked): Treat two declarations of one path with different shape/range/hdr as a merge diagnostic, same as uniform conflicts; or build the metadata from one LiveParameter per path.
- pros/cons: Pros: no silent choice. Cons: may reject existing scenes that share paths across roles (none found, not searched exhaustively).
- checker note: values.ts:152 lets the first declaration win within a feature's seen set, and values.ts:135 uses ??=. merge.ts:94 runs Object.assign(parameters, c.parameters), so the later feature wins in the order core, intersection, materials, lighting, pixel, camera, environment, aov, transport, accumulation (features/index.ts:36-46). merge.ts:99 compares only uniform type and parameterPath. A grep for conflict checks in analyze/ and plan/ finds nothing about one path declared with different metadata. The reader's example holds only for delta lights, because lighting mints only when regionId is undefined. Hittable lights use the material's row.

### P10 — Contract docs describe an older parameter pipeline

- kind: doc-code-mismatch; reader confidence: checked; checker: **confirmed**
- evidence: docs/compiler-engine-contract.md:978-1006 shows uniform `u_material_glass_roughness`, `parameterManager.updateUniforms(...)` and says 'the Compiler does NOT currently extract or forward this metadata' — code names `u_glass_roughness` (glsl-format.ts:38), has no updateUniforms, and ships CompiledRenderer.parameters (types.ts:1101). fable-compiler-contracts.md:165 types `parameters: ParameterMetadata[]` (code: Record) and :172 says engine builtins 'are not FeatureContribution uniforms' (code: core.ts:129, accumulation.ts:85-86, camera.ts:116 contribute engine.* bindings). compiler/types.ts:810 says camera.frame 'carries a HIDDEN Float32Array coercion in ParameterStore.restore' — ParameterStore.restore (:89-114) has none; camera.frame appears nowhere else in src.
- why it matters: compiler-engine-contract.md is listed as the locked-contract authority in CLAUDE.md; a reader designing against it gets the wrong pipeline.
- suggestion (checked): Update the §7 example and §2.10 wording to the current code; fix the types.ts comment.
- pros/cons: Pros: docs match code. Cons: none beyond editing time; contract doc edits may need owner sign-off since it is 'locked'.
- checker note: compiler-engine-contract.md:977-1006 shows u_material_glass_roughness and parameterManager.updateUniforms, and says the compiler does not forward metadata. The code uses paramToUniform → u_glass_roughness, has no updateUniforms anywhere in src, and has CompiledRenderer.parameters?: Record (types.ts:1101). fable-compiler-contracts.md:165 types parameters as an array. Line 172 says engine builtins are not contribution uniforms, but core.ts:129, accumulation.ts:85-86 and camera.ts:116,121 contribute engine.* bindings. types.ts:809-811 claims a camera.frame coercion in ParameterStore.restore. There is none, and tests/app/parameterStore.test.ts:94 states the coercion fossil is gone.

### P11 — Live placement and camera pose are Euclidean-shaped parameter payloads

- kind: euclidean-assumption; reader confidence: inferred; checker: **partly**
- evidence: Planner.ts:754-866: driven placement = position vec3 + quaternion/axis-angle + scale → two vec4 uniforms `u_object${index}PlacementQ/TS` from rigidInverse; camera.ts:76-103 pose is vec3 camera.position/target with cameraBasis (basis.ts: sub/cross/normalize); reserved paths camera.position/target (types.ts:815); OrbitControls.ts:209-216 spherical→Cartesian.
- why it matters: In H3/S3/H2xR a placement is an isometry (e.g. a 4x4 matrix in SO(3,1)/SO(4)) and a camera pose is a frame at a point; vec3 position + look-at target is not well defined there. The binding machinery itself (multi-path compute closures, 'mat4' in UniformType types.ts:777 and PlannedUniform.type) is geometry-neutral, so the change is in the closures and the authored spelling, not the pipeline.
- suggestion (thought-through-not-checked): When curved spaces start, define the placement/pose parameter as an ambient-provided 'isometry' value whose closure and uniform type come from the ambient family, keeping UniformBinding unchanged.
- pros/cons: Pros: keeps the parameter pipeline untouched; isolates Euclidean math in the ambient occupant. Cons: OrbitControls and reserved camera paths need per-space variants; not designed yet (ambient has only Euclidean).
- checker note: The code facts are correct: Planner.ts:754-866 builds position vec3 + quaternion/axis-angle + scale into two vec4 uniforms, and camera.ts:76-103 uses a vec3 look-at pose. The suggestion overlaps an existing design, though. docs/fable-transforms.md:33-42 already sets the contract as 'a placement is an element of the ambient space's structure group' (an SO(3,1) element for H3), and :313-316 says the two-vec4 record was chosen so an H3 SL(2,C) isometry, also 8 reals, keeps the same ABI and plumbing. The uniform footprint is therefore already planned to be geometry-neutral. What remains Euclidean is the authored TRS spelling (position, quaternion, scale), the rigidInverse closure, and the camera pose. The camera pose (look-at from vec3 position and target, plus OrbitControls) is the part with no written design.

### P12 — Compute closures make CompiledRenderer non-serializable

- kind: research-note; reader confidence: inferred; checker: **confirmed**
- evidence: UniformBinding.compute is a JS function (types.ts:797) closing over Planner data, e.g. lighting.ts:176 `compute: (p) => computeSelectPdf(plan.lights, selection, p)`, lighting.ts:67 `envSelectionProbability(plan, p)`, Planner.ts:865 evalQ. The digest writes closures as `[fn]` and had to evaluate them at two parameter sets (docs/claude-spectrum-spec.md:229-233). Owner goal: 'Export independent scene programs for the website and posterity' (docs/claude-app-decisions.md:17-18).
- why it matters: An exported standalone scene program must ship these closures as code (bundle the compiler modules they close over) or turn them into data + a small fixed set of evaluators. This shapes any parameter-model redesign.
- suggestion (thought-through-not-checked): Decide with the owner whether exported programs bundle the compiler (closures stay) or whether derived uniforms become declarative (named evaluator + data).
- pros/cons: Pros of bundling: no change now. Cons: exported program carries compiler code. Pros of declarative: JSON-serializable renderer. Cons: a registry of evaluators is new machinery the owner may not want.
- checker note: UniformBinding.compute closures are JS functions. tests/helpers/compiledJson.ts:16 writes them as '[fn]', and scripts/digest-compiled.ts:74 evaluates them separately. docs/claude-app-decisions.md:18 lists 'Export independent scene programs' as a goal, and a grep finds no decision there about bundling the closures or making them declarative. This is a correct research note and an open question for the owner.

### P13 — The env.* prefix holds both user sliders and measured load-time data

- kind: complexity; reader confidence: checked; checker: **confirmed**
- evidence: Sliders with metadata: environment.ts:129 'env.intensity', :153 'env.rotation', lighting.ts:54 'env.selectProb'. Measured values set straight on the engine: App.ts:226-227 'env.size', 'env.totalWeight', :239 'env.sizeOct'; MEASURED_ENV_PARAMS App.ts:968. events.ts:59-60 describes env. as 'compiler-owned plumbing (sizes, table totals) … load-time data'.
- why it matters: One namespace with two meanings; the heuristic's env. branch and the session-restore stripping exist because of it.
- suggestion (thought-through-not-checked): Name measured values in a separate reserved namespace (e.g. a data prefix) so env.* means only the environment's sliders.
- pros/cons: Pros: clearer; heuristic branch and compat stripping become unnecessary. Cons: renames uniform parameter paths (digest change), touches environment feature and App.
- checker note: env.intensity, env.rotation and env.selectProb are sliders with metadata. env.size, env.totalWeight and env.sizeOct are set on the engine directly (App.ts:226-227,239,348) and listed in MEASURED_ENV_PARAMS (App.ts:968). events.ts:59-60 describes env. as load-time plumbing. Since every env slider has metadata and the measured values never pass through the store, the env. branch of shouldResetAccumulation can matter only for an undeclared env path written through the store.

### P14 — Parameter surfaces built ahead of their producers (keep)

- kind: in-progress; reader confidence: checked; checker: **confirmed**
- evidence: ParameterMetadata step/values/options/help and types int/bool/vec2 (types.ts:824-842) have no compiler producer (grep of src/compiler and src/components finds none; unit used once at blackbody.ts:123) but WidgetFactory.ts:64-109 handles them (comment: display-mode selector). PARAMETER_CHANGED (App.ts:110) has no listener in src/tools/pages. engine.time kept for motion blur (Engine.ts:241-244). ParameterManager.getParameterBindings/getCacheStats (:178,:190) have no callers. fable-transforms.md:97,132-140: a future live authoring graph pushes TRS through the ParameterStore.
- why it matters: These serve future work (debug display modes, extensions, motion blur, the authoring runtime); they are not dead and should survive any simplification.
- suggestion (checked): Keep; a redesign should preserve the store as the single runtime channel the authoring graph will write into.
- pros/cons: Pros: no loss of planned capability. Cons: some unused UI branches stay untested until a producer exists.
- checker note: This is in-progress work to keep, as the reader says. No compiler or component producer emits step, values, options or help, or the types int, bool or vec2. The only extra field produced is unit:'K' (blackbody.ts:123). WidgetFactory.ts:64-109 handles all of them, with a comment naming the display-mode selector. No listener for PARAMETER_CHANGED or 'parameter.changed' exists outside docs/archive and docs/architecture.md. getCacheStats and getParameterBindings have no callers. Engine.ts:241-244 marks engine.time as reserved for motion blur. fable-transforms.md:97-99 and :132-140 name the ParameterStore as the runtime channel for the future authoring graph.

### P15 — Panel flush issues one store write per queued path, so one reset per path

- kind: defect; reader confidence: checked; checker: **confirmed**
- evidence: ParameterPanelExtension.ts:283-287 `for (const [path, value] of this.updateQueue) { this.app.setParameter(path, value); }` while App.ts:117-124 documents 'ONE reset per CHANGESET' and App.setParameters → store.batch exists (App.ts:569).
- why it matters: Two sliders moved inside one 16 ms window cause two accumulation resets (buffer clears + salt bumps); minor cost, contradicts the stated E3 intent.
- suggestion (checked): Flush with `this.app.setParameters(Object.fromEntries(this.updateQueue))`.
- pros/cons: Pros: one-line, matches orbit/keyboard behaviour. Cons: none known.
- checker note: ParameterPanelExtension.ts:283-287 calls app.setParameter once per queued path, and each call is a separate store.set that triggers its own onChange and reset. ParameterStore.batch (one onChange per changeset) is exposed as App.setParameters (App.ts:569), and Orbit and KeyboardControls already use it.

### P16 — Session restore strips measured env keys for sessions from older builds

- kind: complexity; reader confidence: checked; checker: **confirmed**
- evidence: App.ts:600-605 `// a session saved by an older build still carries them. … for (const key of MEASURED_ENV_PARAMS) delete params[key];`
- why it matters: A compatibility shim; owner prefers no compat shims in a single-user hobby project (memory: hobby-project-simplicity).
- suggestion (thought-through-not-checked): Raise with owner whether old sessions matter; if not, the stripping and MEASURED_ENV_PARAMS can go.
- pros/cons: Pros: less code. Cons: an old saved session would put measured values in the store (and then the engine) until reload.
- checker note: App.ts:600-605 deletes MEASURED_ENV_PARAMS keys from restored sessions, and the comment says it is for sessions saved by an older build. That is the only reader of MEASURED_ENV_PARAMS besides its declaration at :968. Removing it is the owner's call: a hobby-project compatibility shim.

**Checker: missed by the reader**

- RESERVED_PARAM_PATHS still reserves 'camera.frame' (src/compiler/types.ts:815), and CLAUDE.md:166 still lists it as reserved. Nothing in src sets or reads it: a grep shows only the types.ts comment and declaration. docs/fable-audit-2026-07-18.md:165 (F8) already recorded it as a reserved fossil. Removing the reservation or keeping it is the owner's call. The finding also goes beyond P10's comment-only fix.
- A stale comment in src/engine/ParameterManager.ts near the inputsChanged helpers says 'the epsilon tolerance belongs to the GPU-upload cache', but shader-uniform-utils.ts uniformValuesEqual is an exact comparison with no epsilon.
- camera.ts:76 defaults the pose to [0,0,8] and [0,0,0] when it is not authored. This default is declared in the type doc (types.ts:736 'Default [0, 0, 8]'), so it is not a hidden guess. KeyboardControls.ts:38 repeats [0,0,8] as its own initial position, which is a second copy of that fact.
- env.selectProb (lighting.ts:52-57) is an estimator parameter: by the taxonomy it must not change the converged image, yet it still needs a reset. Any section-based reset rule (P1 suggestion) must reset on estimator fields too, which the reader's suggestion does say. The blackbody slider is the only one whose default range comes from a domain (blackbody.ts:128), relevant to P2's helper.

**Reader questions for the owner**

- Do you want any live 'view' parameters (for example, exposure as a slider instead of the current #define)? If so, the reset rule needs each parameter's section (measurement, estimator or view) rather than a single always-true triggersReset.
- Should slider defaults be required everywhere? Transform sliders currently may leave out a default, and the Planner then starts them at [0,0,0], the identity, 0 or 1. Materials, lights and the camera already require one.
- For exported standalone scene programs, is it fine for them to bundle the compiler code that the uniform compute closures use, or do you want derived uniforms to become serializable data?
- Should the engine keep its own copy of the parameter values, or receive them from the App each frame so that only one value store exists?
- Do sessions saved by older builds need to keep loading? This decides whether the MEASURED_ENV_PARAMS stripping in restoreSession stays.


## compiler-front

The compiler's front end is a short pipeline in Compiler.ts (73 lines). It runs analyze(scene) once to build a small census of 8 fields. Then it runs validate(features, scene, strategy) once per strategy, and the first error throws. Planning and generation follow. Warnings come back as a deduplicated list of strings.

Both input languages are defined in compiler/types.ts (1183 lines). That file holds three things: the scene language, the strategy, and the locked compiler-to-engine contract. It also holds about a dozen runtime predicates for media routing.

**The scene language.** It is flat and registry-driven:
- Objects are primitives (a registry `type` plus constant `parameters`), meshes (typed arrays, optional `closed`) or instanced batches (a prototype plus `Transform[]` or packed struct-of-arrays placements, and per-instance attributes).
- Materials are a name-keyed Record with an open set of property keys, chosen by `model`.
- Lights are `{kind, emission, ...descriptor rows}`.
- There is an environment, an `ambientMedium` (the name of a material) and an `ambientSpace`.
- Values are constants, `{param}` sliders, GLSL expressions or named spectrum kinds.

**The strategy.** It follows the pinned taxonomy: measurement (camera, truncations, color, sensor, aovs), estimator (13 flat fields, a mix of sampling choices and acceleration-structure choices) and view (tonemap). Measurement defaults are resolved once (plan/measurement.ts). Estimator defaults have no resolver: they are re-applied with `??` in the Validator, the Planner, dataTenants and App.

**Value checking is well done.** propertyValidation.ts is one checker driven by roles and domains.

**The Validator is the weak spot.** It is a single function of about 1340 lines with about 170 diagnostics in one flat sequence. Rules for specific occupants are hardcoded there by name ('bvh', 'cwbvh', 'equiangular', 'delta-tracking', 'ggx'). It contains three copies of the "authored rows" loop (lights, cameras, primitives). Rules that depend only on the scene run again for every strategy. There are stale comments and two real gaps:
- A misspelled material property key is silently ignored, although a types.ts comment says it is warned.
- The camera pose and camera vec3 checks accept NaN and Infinity, although the messages say "finite".

**The errors module is mostly scaffolding.** Its code registry has categories that nothing reads, and 106 of the Validator's errors use the one code 'invalid-setting'.

**Readiness for curved spaces.** The way in exists: `scene.ambientSpace.type` is checked against a registry (only Euclidean is registered), and the ambient_* GLSL seam is in place. But the description types themselves are Euclidean:
- Transform and PackedPlacements are similarities with a `scale`. S³, H³ and H²×R have no scalings in their isometry groups.
- A full SO(3) rotation is not an isometry of H²×R.
- Positions, camera pose and light points are Vec3 with no declared chart.
- Directional lights and the "miss = environment at MAX_DIST" rule have no meaning in compact S³.
- `curvature` is declared but never read.
- Nothing says which objects, lights, environments or placements a space supports.

### CF-1 — Misspelled material property keys are silently ignored; types.ts says they are warned

- kind: defect; reader confidence: checked; checker: **confirmed**
- evidence: src/compiler/types.ts:506-510 'OPEN VOCABULARY ... the Validator warns on keys no present model declares.' But Validator.ts:1015-1031 only warns when a key is a registry-wide row source AND isValueParam: 'Constants on undeclared fields stay silent: harmless authoring slack.' The index signature at types.ts:513 '[key: string]: MaterialProperty | ...' also turns off TypeScript's excess-property check. So { model:'lambert', albdeo:[1,0,0] } passes TS and the Validator with no diagnostic. Lights (Validator.ts:97-103), cameras (768-774) and primitives (1498-1504) all warn on unknown keys.
- why it matters: Materials are the one authored family where a typo silently renders default values. The comment states the opposite of what the code does.
- suggestion (thought-through-not-checked): Warn on any material key that is not a row of the material's own model and not a reserved meta-key (model, medium, sampleAsLight). This is the same unknown-key rule lights, cameras and primitives use.
- pros/cons: Pro: one rule for every family; it catches typos and fixes the comment. Con: scenes that carry extra keys on purpose (sharing a material object across models) would start warning; how many fixtures do this was not measured.
- checker note: Validator.ts:1015-1031 warns only when a key is in the registry-wide union of material row sources AND is {param}-driven. A typo such as `albdeo` is in no row source, so it is silent even when it is {param}-driven. types.ts:506-510 states the opposite. Lights (97-103), cameras (768-774) and primitives (1498-1504) do warn on unknown keys. The silence is a stated choice in Validator.ts:1017 ('harmless authoring slack'), so the comment and the code disagree about a deliberate policy. The fix needs an owner decision, not just a code change. Note that the suggestion applies a per-model rule (for example, `roughness` on lambert would warn), which is stricter than the rule types.ts describes (keys that no present model declares).

### CF-2 — Camera pose and camera vec3 checks accept NaN/Infinity while their messages say 'finite'

- kind: defect; reader confidence: checked; checker: **confirmed**
- evidence: Validator.ts:1733-1735 'function isVec3(v) { return Array.isArray(v) && v.length === 3 && v.every((c) => typeof c === "number"); }' (NaN is a number). Used at 839 'measurement.camera.${field} must be a vec3 of finite numbers' and 791 (camera vec3 rows). Validator.ts:833-835 notes the strategy is outside the scene finiteness sweep. The coincidence test at 845-846 uses Math.hypot, so it is NaN and the comparison is false. docs/claude-review-2026-09-25.md:136 records this as 'a second shape check without the finiteness rule' (Reviewer).
- why it matters: An infinite or NaN pose (from JSON or computed poses) passes validation and reaches the camera.position/target uniforms. The message promises a check that does not happen.
- suggestion (checked): Make isVec3 require Number.isFinite, or reuse propertyValidation's isFiniteVec3 (propertyValidation.ts:202). Then there is one vec3 predicate in the analyze stage.
- pros/cons: Pro: a one-line fix that deletes a duplicate helper. Con: transform positions also use isVec3 (1341), but they are already covered by validateFinite, so their behavior does not change.
- checker note: isVec3 (Validator.ts:1733-1735) checks only `typeof c === 'number'`, so NaN and Infinity pass. It is used at 839/845 for the pose and at 791 for camera vec3 rows, and both messages say 'finite'. validateFinite (171-174) sweeps only the scene, and the strategy pose goes straight into a uniform closure (generate/features/camera.ts:96-100). The same weak isVec3 also guards validateValues at 1479 and the defineSDF bound check at 1538. In both places the separate finite shape check at 1515 still reports the error, but the coupled rules can run on NaN first. isFiniteVec3 exists at propertyValidation.ts:202, as cited.

### CF-3 — validate() is one ~1340-line function with ~170 diagnostics in one flat sequence

- kind: complexity; reader confidence: checked; checker: **confirmed**
- evidence: Validator.ts:50 'export function validate(' runs to 1387. Scene-only and strategy-dependent rules interleave: lights 75-154, objects 162-166, estimator axes 422-752, camera 754-851, environment 925-952, ambientMedium 954-973, materials again 976-1032, instanced 1080-1282, transforms 1319-1386. Material loops over Object.entries(scene.materials) appear at 240, 259, 298, 312 and 984.
- why it matters: This is the main place an author's mistakes get explained, and it is the hardest file in the area to read. A new rule has no obvious home, so related rules drift apart (materials are visited in five separate loops).
- suggestion (thought-through-not-checked): Split by subject into a few plain functions called in order, keeping the same rules and messages: validateLights, validateObjects, validateMaterials (incl. media), validateEnvironment, validateMeasurement, validateEstimator, validateInstanced, validateTransforms. Use digest/snapshot diagnostics (tests/compiler/spectrumDiagnostics.test.ts, validator.test.ts) to show nothing changed.
- pros/cons: Pro: each part fits on a screen and one family's rules sit together. No new abstractions. Con: churn in a heavily tested file, and some rules cross subjects (instanced emitters × lightSelection). Diagnostic order would change unless the call order keeps it.
- checker note: validate() runs from Validator.ts:50 to 1387, and the file has 169 bag.error/warning calls. The material loops over Object.entries(scene.materials) are at 240, 259, 298, 312 and 984, plus a sixth pass at 558 (.find). The split itself is an untested suggestion.

### CF-4 — Three copies of the authored-row schema loop (lights, cameras, primitives) over three row types

- kind: duplication; reader confidence: checked; checker: **confirmed**
- evidence: Lights Validator.ts:95-130 (unknown key warn, required, shape 'number'|'vec3', constraintViolation). Cameras 765-826 (same, plus 'enum' and 'value-number'). Primitives 1495-1525 (same). Row types: AuthoredParamSpec (components/descriptors.ts:160), PrimitiveParamSpec (descriptors.ts:337), AuthoredCameraParamSpec (camera/index.ts:102). The shape test is spelled inline at 114-116, 789-792, 1515-1517 and again at 1476-1480 and 1535-1539.
- why it matters: One fact (is this authored record well formed against its rows?) has three answers. Cameras already got a {param}-bound check the others lack, and a new family (pixel filters, ambient-space parameters) would add a fourth copy.
- suggestion (thought-through-not-checked): One function checkAuthoredRows(rows, record, label, bag) → wellShaped:boolean that handles number/vec3/enum/value-number plus constraint. All three call sites use it, and their coupled validateAuthored/validateValues run only when it returns true.
- pros/cons: Pro: deletes ~80 lines and gives one message voice, which docs/claude-improvements-2026-09.md item 4 also asks for. Con: the three row types differ slightly (kind on primitives, enum on cameras), so the shared function needs a small common supertype. Light rows apply defaults first (applyAuthoredDefaults) and the others don't.
- checker note: Three hand-written row loops (lights 95-130, camera 765-826, primitives 1495-1525), and the shape test is spelled inline five times. One correction: docs/claude-improvements-2026-09.md Part 4 item 4 asks for a declarative strategy schema interpreted the way descriptor rows are. It does not ask for 'one message voice'. The two are related, but the citation overstates it.

### CF-5 — Estimator defaults are re-applied with ?? in Validator, Planner, dataTenants and App

- kind: duplication; reader confidence: checked; checker: **partly**
- evidence: Validator.ts:502 'scattering ?? 'full''; 852 and 902 'color ?? 'rgb''; 1185 'lightSelection ?? DEFAULT_LIGHT_SELECTION'. Planner.ts:493 (lightSelection), 518 'volumeSampling ?? 'analytic'', 578 'envSampler ?? 'equirect'', 609-610. dataTenants.ts:272. App.ts:958 'envSampler ?? 'equirect''. Measurement defaults, by contrast, have one resolver: plan/measurement.ts:14 resolveMeasurement.
- why it matters: CLAUDE.md asks for one answer per fact. The literals 'equirect', 'analytic' and 'rgb' are repeated defaults, and a changed default would need edits in several layers.
- suggestion (thought-through-not-checked): Add resolveEstimator(strategy) next to resolveMeasurement. Name each default once as a constant beside its registry (as DEFAULT_LIGHT_SELECTION already is), and have the Validator (after its authored-value checks), Planner and App read the resolved values.
- pros/cons: Pro: one default per field, and the stamp can show resolved estimator fields. Con: the 'knob is inert' warnings must still look at the authored value (absent vs explicit), so the Validator keeps reading both. App's envVariants is a documented exception and would only switch to the shared constant.
- checker note: The duplication is real and wider than reported, but the finding mislabels part of it. Validator 502/852/902 re-apply MEASUREMENT defaults (scattering, color), not estimator ones. So 'measurement defaults have one resolver' is false: the Validator re-applies color ?? 'rgb' and scattering ?? 'full', App.ts:832 re-applies color ?? 'rgb', and resolveMeasurement itself repeats m.color ?? 'rgb' four times (measurement.ts:29-31). Estimator copies the reader missed: components/env/importance.ts:34 (chart ?? 'equirect'), Validator.ts:614 (vs ?? 'analytic'), and Planner.ts:579 / App.ts:959 (envCompensation ?? false). Planner 609-610 already use named DEFAULT_ constants, so they are not literal copies.

### CF-6 — 'Does NEE have anything to sample' is decided in the Validator and again in the Planner

- kind: duplication; reader confidence: checked; checker: **partly**
- evidence: Validator.ts:64-68: directLighting !== 'none' && totalLightCount === 0 && !features.environment.samplable && !hasBatchLightsUnderTree. Validator.ts:430-432 repeats the same three facts for envSelectWeight. Planner.ts:495 'const hasLights = features.lighting.totalLightCount > 0 || envKindSamplable || batchLights;'.
- why it matters: Three copies of one predicate. If a fourth kind of light source joins (e.g. emissive media sampled as lights), every copy must change together.
- suggestion (thought-through-not-checked): One function hasNeeTargets(features, scene, strategy) next to samplesBatchLights in plan/dataTenants.ts, called by both stages.
- pros/cons: Pro: a tiny change that removes drift risk. Con: none significant.
- checker note: There are two copies of the 'NEE has a target' predicate: Validator.ts:64-68 and Planner.ts:495 (totalLightCount>0 || env samplable || samplesBatchLights). Validator.ts:430-432 is a different predicate: envSelectWeight needs a samplable env AND finite lights (an AND of the facts, not the OR). So it is two copies plus one related rule, not three copies. The shared helper is still sensible for the first two.

### CF-7 — Occupant-specific restrictions are hardcoded by name in the Validator

- kind: extension-friction; reader confidence: checked; checker: **confirmed**
- evidence: Validator.ts:507 'mediumLightSampling === 'equiangular'' (rules 507-581); 595 'vs === 'delta-tracking''; 587 'raymarch'/'ratio-tracking'; 629 'lightSelection === 'bvh'' (pins 629-666); 714 'instanceAccel === 'cwbvh'' (pins 714-752); 696 'objectDispatch === 'unrolled''; 1007 'mat.model === 'ggx'' (acknowledged at 1003-1006); 1210 'proto.type === 'sphere''.
- why it matters: Adding an occupant is meant to be one folder plus one registry line, but an occupant with limits (most new estimators have v1 limits) also means editing the compiler's 1800-line Validator. The occupant's limits then live far from its math.
- suggestion (thought-through-not-checked): Let an estimator-axis occupant declare its own validate(scene, strategy, features) → messages, the same pattern light kinds use (validateAuthored) and primitives use (validateValues). The Validator then calls the selected occupant's rule.
- pros/cons: Pro: limits live beside the math, and the Validator shrinks. Con: CLAUDE.md says a descriptor never refers to other components, but these rules are mostly about how components combine (equiangular × bvh, cwbvh × tree lights). Those pairwise rules would still need a home in the compiler, so this only moves the single-occupant rules. Needs an owner decision.
- checker note: All cited name branches exist at the cited lines (507, 587, 595, 629, 696, 714, 1007, 1210). The ggx one is explicitly acknowledged at 1003-1006 with a 'rule of three' rationale. The finding's con is right that most of these are pairwise rules (equiangular×bvh, cwbvh×tree lights). Moving them is an owner decision.

### CF-8 — Placement types are Euclidean similarities: scale and full SO(3) rotation do not exist in S³/H³/H²×R

- kind: euclidean-assumption; reader confidence: checked; checker: **confirmed**
- evidence: types.ts:249-254 'interface Transform { position?: Value<Vec3>; rotation?: AxisAngle | Value<Quaternion>; scale?: Value<number>; }' and the doc at 238-241 'a Euclidean similarity'. PackedPlacements types.ts:207-212 (positions 3N, sizes N, orientations 4N). Validator validateScale 1640-1687 and placementProblem 1691-1714 check only Euclidean rules. ParamKind (descriptors.ts) has 'length'/'area' kinds that scale with the similarity.
- why it matters: Spherical and hyperbolic space have no scaling isometries, so the scale fold has no meaning there. In H²×R the point stabilizer is O(2)×Z/2, so an arbitrary quaternion rotation is not an isometry. A Vec3 position needs a declared chart (exponential coordinates, ball model, hyperboloid), and translations no longer commute. These types are the main thing standing between the ambient seam and a curved-space scene.
- suggestion (thought-through-not-checked): Before the first curved occupant: decide (1) how a placement is written per space, for example as an isometry (base point plus orthonormal frame, or a 4×4 matrix in the model) with size carried by primitive parameters; (2) which chart Vec3 points mean; (3) let the ambient descriptor declare which placement forms it accepts, so the Validator can reject `scale` or general rotations in spaces that lack them.
- pros/cons: Pro: settles the description layer before GLSL work, and the Euclidean path can stay as-is (a similarity is a legal Euclidean placement). Con: touches the placement fold, instancing and the light roster, which all assume similarities. This is a design conversation for the owner, not a refactor.
- checker note: The types are as cited. The reader did not cite that the design already anticipates this: docs/fable-transforms.md §1 'Forward-compatibility (non-Euclidean)' pins 'a leaf's placement is an element of the ambient space's structure group' (H³: SO(3,1), distance_scale ≡ 1). §5 (≈ line 314) notes that H³'s SL(2,C) also fits the 8-float record. The deferred ledger (≈ line 435) lists 'curved-space placement groups behind the structure-group contract'. So this is a known, planned gap with a pinned direction, not a new discovery. The H²×R stabilizer claim (O(2)×Z/2) is correct.

### CF-9 — Environment 'miss' semantics and directional lights assume a non-compact flat space; curvature is declared but unread

- kind: euclidean-assumption; reader confidence: checked; checker: **confirmed**
- evidence: types.ts:28 'What a ray sees when it hits nothing'; CLAUDE.md: 'MAX_DIST (1000) is an absolute far clip: the environment and the directional light are found there'. types.ts:43-46 'AmbientSpaceDescription { type: 'euclidean' | 'hyperbolic' | 'spherical'; parameters?: { curvature?: number } }'. A grep for 'curvature' finds it only at types.ts:45 (and an unrelated grin.test comment). AMBIENT_SPACES has only euclidean (components/ambient/index.ts:21-23).
- why it matters: In S³ every geodesic closes (length 2π/√K), so 'hits nothing' and 'at infinity' do not exist. In H³ an environment is a function on the ideal boundary, and a 'direction' light is an ideal point, not a parallel beam. The type union also omits product spaces (H²×R, S²×R) that the owner names as goals.
- suggestion (thought-through-not-checked): Have the ambient descriptor declare facts the Validator can check: which environment kinds and light kinds make sense (e.g. S³: no environment and no directional lights), and whether `curvature` is a parameter or fixed at ±1. Make the TS `type` a registry key (string), matching analyze/types.ts:9, which is already `string`.
- pros/cons: Pro: the 'reject, don't degrade' rule then holds for spaces too. Con: what the environment means in H³ and S³ is a physics and design question that needs the owner first.
- checker note: `curvature` is read nowhere in src (complete grep: only types.ts:45 and an unrelated grin.test comment). AMBIENT_SPACES has only euclidean. This is deliberate door scaffolding (components/ambient/index.ts header: 'the door exists BEFORE the first curved-space occupant'), not dead code, and the finding does not call it dead. The semantic points (closed geodesics in S³, ideal boundary in H³, product spaces missing from the union) are fair design questions for the owner.

### CF-10 — Stale statements in types.ts / Validator.ts / analyze/types.ts / taxonomy doc

- kind: doc-code-mismatch; reader confidence: checked; checker: **confirmed**
- evidence: (a) types.ts:54 'Only the analytic pair is implemented so far' — image and procedural environments are built (EnvironmentBake.ts, Validator 941). (b) types.ts:164-167 'SDF prototypes are Validator-rejected' and Validator.ts:1077 'SDF prototypes are rejected', but Validator 1156-1171 accepts bounded marched prototypes. (c) types.ts:129 'v0: thin surface (no interior containment)' while `closed` exists at 149-155; Validator 1284-1290 'v0 meshes (surface-only)... When meshes gain containment (winding-number v2)'. (d) types.ts:604 'Spectral currently supports the verified constant-RGB Lambert capability set' vs CLAUDE.md 'all six material models'. (e) docs/fable-strategy-taxonomy.md:90 "'spectral' (§8; reserved, Validator-rejected)" and §11 'spectral reserved-rejected', but Validator 852-870 accepts spectral. (f) taxonomy header lines 4-7 say the schema restructuring is still to come, but §11 says it is DONE. (g) analyze/types.ts:15 'hasMeshes: Validator-rejected until the BVH/mesh backend'.
- why it matters: These are the files a reader starts from to learn what the language supports, and several say features are missing that exist.
- suggestion (checked): Rewrite these comments to describe the present. Update the taxonomy's bias-ledger row for color and its status header.
- pros/cons: Pro: cheap, and no behavior change. Con: none.
- checker note: Each item checked. (a) types.ts:54 'Only the analytic pair is implemented', though image and procedural exist. (b) types.ts:164-167 and Validator.ts:1077 say SDF prototypes are rejected, but 1156-1171 accept bounded marched prototypes. (c) types.ts:127 'v0: thin surface' while `closed` is documented at 147-153, and Validator 1287-1288 still says 'When meshes gain containment (winding-number v2)' though fable-mesh-containment `closed` is built. (d) types.ts:604 'constant-RGB Lambert capability set' contradicts CLAUDE.md. (e) taxonomy:90 and :231 say spectral is 'reserved, Validator-rejected'. (f) taxonomy header lines 4-7 say the restructuring is still to come, while §11 (line 225) says 'Migration — DONE'. (g) analyze/types.ts:15 'Validator-rejected until the BVH/mesh backend'.

### CF-11 — Census field geometry.hasMeshes has no reader, contrary to the census file's own rule

- kind: other; reader confidence: checked; checker: **confirmed**
- evidence: analyze/types.ts:3-7 'census fields exist to feed Validator/Planner decisions ... A future decision re-adds its field WITH its reader'. Analyzer.ts:54 'hasMeshes: scene.objects.some((o) => 'kind' in o)' (also true for instanced batches). A full grep of src for 'hasMeshes' finds only the declaration and the Analyzer.
- why it matters: It breaks the file's stated rule, its comment is stale, and its predicate ('kind' in o) does not match its name. Flagged only; whether a planned reader exists was not established.
- suggestion (checked): Owner decision: give it a reader or drop it under the file's own rule. Not recommending deletion here.
- pros/cons: Pro: the census then matches its contract. Con: trivial either way.
- checker note: A complete grep of src finds hasMeshes only at analyze/types.ts:16 and Analyzer.ts:54. One reader exists outside src: tests/compiler/analyzer.test.ts:21-29 asserts it. Its original reader was the old mesh hard-reject (docs/impl-plan-meshes.md:36). The predicate `'kind' in o` is also true for instanced batches, so the name is inaccurate. The finding correctly leaves the decision to the owner.

### CF-12 — Scene-only rules run once per strategy, including expensive ones

- kind: complexity; reader confidence: inferred; checker: **confirmed**
- evidence: Compiler.ts:47-52 'for (const strategy of strategies) { ... validate(features, scene, strategy, bag); ...}'. Compiler.ts:1160-1163 in types.ts: 'Warnings from every stage, deduplicated (scene rules run once per strategy)'. Scene-only work inside validate: meshClosedness (Validator 1447-1459), defineSDF bound containment and conservativeness (~26³ twin evals per local object, 1534-1575), the packed-placement loops over up to 10⁶ instances (1107-1144), and validateFinite sweeps (171-174). The first strategy with an error throws, so the errors of later strategies are never shown.
- why it matters: Repeated work grows with the number of strategies (scenes commonly carry several for live A/B). The mixing is also why warnings need string deduplication. Cost was not measured.
- suggestion (thought-through-not-checked): Split into validateScene(scene, bag), run once, and validateStrategy(features, scene, strategy, bag), run per strategy. Collect all strategies' errors before throwing.
- pros/cons: Pro: clearer split (it matches the taxonomy's scene vs strategy), no repeated work, and it removes the need for string deduplication. Con: some rules mix both (instanced-emitter hints read lightSelection; transmissive-on-thin reads only the scene). Each rule has to be classified, and the order of diagnostics changes.
- checker note: Compiler.ts:45-50 calls validate once per strategy and throws on the first strategy with errors. Warnings are deduplicated by message string (Compiler.ts:28-29), and the comment at types.ts:1160 says why. meshClosedness, the defineSDF bound check and the finiteness sweeps have no caching, so they repeat per strategy. The cost is unmeasured, as the finding says (inferred).

### CF-13 — compiler/types.ts mixes the input languages, the locked engine contract and media-routing policy

- kind: complexity; reader confidence: checked; checker: **confirmed**
- evidence: types.ts:21-548 scene language; 554-761 strategy; 763-1183 CompiledRenderer/pipeline/uniform/export contract; plus runtime predicates 339-417 (isHeterogeneousMedium, mediumRoutesToTracking, mediumWeightsAbsorption with a long derivation comment). 231 files import compiler types.
- why it matters: The file a newcomer opens to learn 'what do I write' is 1183 lines, and its last third is engine plumbing. The media routing policy (which arm handles which medium) is a transport decision that lives in a types file.
- suggestion (thought-through-not-checked): Split into scene.ts (what an author writes), strategy.ts, and compiled.ts (the locked contract), with types.ts re-exporting all three so imports keep working. Move the media predicates beside the media generators or the volume component.
- pros/cons: Pro: each language becomes readable on its own, and with re-exports no import changes are required. Con: moving the predicates touches imports across plan/generate. Components may only import types from the compiler, so the predicates' new home must respect the purity test.
- checker note: The structure is as described: media predicates at types.ts:339-485, and the CompiledRenderer contract makes up the last third. Correction to the count: a resolve-based scan finds 66 src files and 114 test files (180 total) importing compiler/types.ts directly, not 231. The media predicates are read by Analyzer, Validator, analyze/spectral, Planner, plan/types and generate/materials (no components). So 'beside the media generators' would make the analyze stage import from generate. A compiler-level media module fits better. The purity test constrains only components, which do not read these predicates.

### CF-14 — Adding a named spectrum kind requires editing compiler/types.ts unions

- kind: extension-friction; reader confidence: checked; checker: **partly**
- evidence: types.ts:300-312 'CauchyIndex', 'SellmeierIndex', 'NamedSpectrumValue = BlackbodyValue | GaussianValue', and types.ts:334 'SpectrumValue = ... | BlackbodyValue'. These types are referenced from compiler/plan/types.ts, Planner.ts, dataTenants.ts, generate/features/lighting.ts and components/descriptors.ts, while the runtime registry is components/color/spectra/index.ts:13 'NAMED_KINDS = [cauchyKind, sellmeierKind, blackbodyKind, gaussianKind]'.
- why it matters: CLAUDE.md says a spectrum kind answers every question about its values and 'outside that folder nothing tests for a particular kind'. The static types still list kinds by name, so a new kind means one folder plus one registry line plus edits to the compiler's union types.
- suggestion (thought-through-not-checked): Have each kind folder export its value type, and build the union in spectra/index.ts (types only), which compiler/types.ts imports.
- pros/cons: Pro: the one-folder rule then holds for kinds. Con: compiler/types.ts would import a type from components, the opposite of today's direction. Allowed for type-only imports? Not checked against the purity test.
- checker note: The named unions are in compiler/types.ts as cited. But this is already documented as a known limit in src/components/color/spectra/README.md:56-60 ('a new kind also adds its type to the NamedSpectrumValue union'). The con is wrong. compiler/types.ts already imports from components (line 4 a VALUE import from components/color/values.js, line 7 a type import from components/descriptors.js). Compiler→components is the sanctioned direction. The purity test (tests/components/purity.test.ts) restricts only components→compiler, to type-only. A kind file importing its own value type would form a type-only cycle with compiler/types.ts. That cycle is legal in TS, though worth noting.

### CF-15 — Errors module: code registry and typed-error classes mostly unread

- kind: complexity; reader confidence: checked; checker: **partly**
- evidence: codes.ts (402 lines) gives each code a category and description. getErrorDefinition and ALL_ERROR_CODES are used nowhere outside src/errors (grep), and isKnownCode only in tests/compiler/diagnosticCodes.test.ts. Validator uses 'invalid-setting' (category 'strategy') for 106 errors and 27 warnings, most of them about the scene. RenderErrors.ts: RenderCompilationError, ResourceError, ParameterError and ExportError are used nowhere outside src/errors. There are two classes named CompilationError (core/DiagnosticBag.ts:322 and RenderErrors.ts, aliased in errors/index.ts:24-26).
- why it matters: The code and category layer adds machinery but carries almost no information: users see message strings, and Compiler.ts keeps only messages. Some of this may be scaffolding for an editor or JSON reporter (JSONReporter exists), so it is not called dead.
- suggestion (thought-through-not-checked): Owner decision on what diagnostics are for. If codes stay, either use a few meaningful codes (scene vs strategy vs incompatible) or reduce codes.ts to a plain list of ids. Keep the unused error classes until the App reorg (docs/claude-app-decisions.md) decides error handling.
- pros/cons: Pro: less ceremony per diagnostic. Con: the JSON reporter and future tooling may want codes. Low priority.
- checker note: Confirmed: getErrorDefinition and ALL_ERROR_CODES have no readers outside src/errors. isKnownCode is used only by tests/compiler/diagnosticCodes.test.ts, which is a real check that every code used is registered. RenderCompilationError, ResourceError, ParameterError, ExportError and JSONReporter have no readers. 'invalid-setting' (category 'strategy', codes.ts:118-121) appears 133 times. Overstated: 'users see message strings' is not the whole story. ConsoleReporter (used by RendererManager.ts and Engine.ts) prints `diagnostic.code: message` (DiagnosticReporter.ts:125), so codes do reach the console on failure. Only the successful-compile warning list (Compiler.ts:29) drops them. SessionError, RenderStoppedError and EnvironmentLoadError from RenderErrors.ts are in use.

### CF-16 — Reserved vocabulary and single-occupant seams in the description types

- kind: in-progress; reader confidence: checked; checker: **confirmed**
- evidence: types.ts:578 response?: 'radiance' (sole occupant; 'debug measurements ... arrive as new values'); 601 shadows?: 'opaque-dielectrics' (sole value; 'transparent shadow rays' is in CLAUDE.md Not built); 670 volumeSampling 'raymarch'|'ratio-tracking' are always rejected (Validator 587-594, 'rejected-not-removed'); 44 ambientSpace 'hyperbolic'|'spherical' gated by the registry; 45 curvature; 221 CustomSDF 'RESERVED (future custom-geometry door)'; components/pixel/index.ts 'a strategy knob arrives with the second occupant'; instanceAccel 'cwbvh' with v1 limits (Validator 714-752).
- why it matters: These are deliberate doors for planned work (curved spaces, debug measurements, transparent shadows, more pixel filters, the CWBVH experiment), not dead code. One exception is worth a look: CustomSDF appears only in types.ts and the historical docs/compiler-new-plan.md, while scene-local fields are delivered by defineSDF (components/geometry/custom.ts:75), which registers into the global PRIMITIVES registry.
- suggestion (checked): Keep them. Ask the owner whether CustomSDF is still the planned door or was replaced by defineSDF, and update its comment accordingly.
- pros/cons: Pro: keeps the doors and makes their status honest. Con: none.
- checker note: Each reserved door exists as cited. CustomSDF appears only in src/compiler/types.ts:221 and docs/compiler-new-plan.md (complete grep). fable-sdf-contract.md §5.2 (≈ lines 168-180) records 'Scene-local fields — BUILT as defineSDF'. fable-geometry-materials-target.md:220 approves 'Custom geometry' in principle, including custom analytic intersectors with a normal, which defineSDF does not cover. So the owner question is justified.

### CF-17 — resolveMeasurement falls back to 'euclidean' for a field the type declares required

- kind: guess; reader confidence: checked; checker: **confirmed**
- evidence: plan/measurement.ts:23 'ambient: scene.ambientSpace?.type ?? 'euclidean','. types.ts:24 'ambientSpace: AmbientSpaceDescription;' (required). Analyzer.ts:52 reads 'scene.ambientSpace.type' without a fallback.
- why it matters: Two readers answer the same fact differently. The owner's 'no guesses' rule says a missing fact is an error, not a silent default, and this one picks the geometry of space.
- suggestion (checked): Read features.ambientSpace (already registry-checked) in resolveMeasurement, or scene.ambientSpace.type with no fallback.
- pros/cons: Pro: one answer and no silent default. Con: none (the Analyzer would already throw on a missing field).
- checker note: measurement.ts:23 has `scene.ambientSpace?.type ?? 'euclidean'`. It is the only optional-chained read of ambientSpace in src or tests. In compileScene the Analyzer (Analyzer.ts:52, no fallback) runs first, so the fallback is unreachable there. resolveMeasurement is also called from App.ts:834 for stamps, where no `features` exists, so the 'read features.ambientSpace' form of the fix would not fit that caller. Dropping the fallback does.

### CF-18 — ambientMedium names a material wrapper, which costs two extra diagnostics

- kind: complexity; reader confidence: checked; checker: **confirmed**
- evidence: types.ts:30-34 'Material name of the AMBIENT medium ... material_of(-1) resolves to it.' Validator.ts:954-973: an error if the material has no medium block, and a warning if its surface model is not 'none' ('the surface model never runs').
- why it matters: The author has to wrap a medium in a material whose surface part is meaningless. Two rules exist only to police the wrapper.
- suggestion (thought-through-not-checked): Possibly author ambientMedium as a MediumDescription directly, with the Planner creating the region −1 material. This only makes sense if the region/material machinery truly needs a material; not checked.
- pros/cons: Pro: simpler authoring, and two diagnostics go away. Con: material_of(-1) and the material id table assume a named material, and fixtures would change. Small payoff; owner call.
- checker note: Validator.ts:954-973 is as cited. The finding leaves out that the wrapper is a pinned contract: fable-compiler-contracts.md:111-114 (§2.4: 'material name; material_of(-1) returns that material's ID'), and impl-plan-media.md:52-62 specifies exactly these two diagnostics. Changing it means revising a contract doc, which reinforces 'owner call'.

**Checker: missed by the reader**

- App.ts:832-834 calls resolveMeasurement(scene, strategy) again to build export stamps and re-applies `color ?? 'rgb'`. It does not read the ProgramDescription.measurement the Planner already resolved (Planner.ts:516). That is a second answer for the stamped measurement (one-answer-per-fact).
- Validator.ts:1475-1480 runs a primitive's coupled validateValues BEFORE the finite shape check at 1505-1520, gated on a rowsOk test that uses the non-finite isVec3. A NaN vec3 row can therefore reach the descriptor's coupled rule before its shape error is reported. This is the same root cause as CF-2, in the geometry path.
- Compiler.ts:29 keeps successful-compile warnings as bare message strings in a Set (code, severity detail and source path are dropped). CompiledScene.warnings therefore cannot carry the diagnostic codes that codes.ts and ConsoleReporter maintain (relevant to CF-15).

**Reader questions for the owner**

- Curved-space placements: in S³/H³/H²×R there is no scaling, and in H²×R a general rotation is not an isometry. Should a placement be written per space (e.g. base point + frame, or a model matrix), with object size carried only by primitive parameters? And what chart should Vec3 positions in scenes mean (exponential coordinates at an origin, Poincaré ball, hyperboloid)?
- What should 'environment' and directional lights mean in S³ (compact: rays never escape) and in H³ (ideal boundary)? Should the ambient descriptor declare which environment and light kinds a space allows?
- Is the curvature parameter meant to be authored, or will curvature be fixed at ±1 with the scene scaled to match?
- Is CustomSDF (types.ts:221) still the planned custom-geometry door, or has defineSDF replaced it?
- Should material property keys that no row declares warn, like lights, cameras and primitives do? A types.ts comment says they do; the code keeps them silent on purpose ('harmless authoring slack').
- What are diagnostic codes for? Codes and categories are never read outside one test; is a JSON/editor consumer planned?
- Would you accept splitting validate() by subject (plain functions, same rules and messages) and running scene-only rules once rather than once per strategy?


## compiler-plan

The Plan stage turns (SceneDescription, strategies) into one RenderPlan per renderer plus a shared scene-data plan, in three steps (Planner.ts:72 planRenderers). (1) planScene reads only the scene. It assigns material ids, region ids, mesh and batch ordinals and the light roster. It resolves every property through the schema rows, folds constant Euclidean similarities into canonical primitive parameters (or keeps a residual or driven placement), and turns authored area lights into synthesized emissive regions. The result is a ScenePlan. (2) planProgram builds one ProgramDescription per strategy. This is the decision record generators read: measurement / estimator / view, plus "link tables" saying which generated seams exist (intersection, materials, media, emitters, environment). (3) The data structures the programs read (CWBVH, light tree, object table) are unioned into DataReads. placeScene then calls dataTenantsOf (the scene→tenant-count adapter) and planDataLayout (the pure ledger in components/data), and attaches texture base addresses to the records. sceneDataPlanOf turns the placed scene into a SceneDataPlan that the App executes (BVH builds and byte packing). EnvironmentBake is a separate small compiler that the App calls to bake a procedural sky into a CDF table. Overall the design is sound: decisions are recorded once in ProgramDescription, shared predicates (light census, keepsLocalFrame, batch tiers) live in dataTenants.ts, and the ledger is pure. The main structural friction is that dataTenantsOf still re-derives facts from the raw SceneDescription. It was built for the time when the App also called it; today only placeScene calls it, so it could read the ScenePlan it sits next to. That leaves several facts with two spellings (table eligibility vs the placement fold, region count, SDF record budget). Other findings: two different scene-radius heuristics for infinite-light power (one in the Planner, one in the lighting generator), several "does the program contain X" decisions that still live in generators, the App's env-variant derivation, and stale comments that still say the App calls the ledger. The plan stage is Euclidean throughout: similarities with scale, AABBs, s²-area folding. The ambient-space choice is recorded only in measurement.ambient, which planScene never reads.

### plan-01 — Two different scene-radius heuristics for infinite-light power

- kind: duplication; reader confidence: checked; checker: **confirmed**
- evidence: Planner.ts:982-1014 `sceneWorldRadius` (AABBs of folded closed-form objects + closed meshes, skips SDFs/batches/planes, `return any ? Math.max(r, 1e-3) : 10`) feeds directional power via powerCtx (Planner.ts:340-341; directional.ts:29 `const r = ctx?.worldRadius ?? 10`). generate/features/lighting.ts:456-474 `sceneRadiusEstimate` ("max of |point rows| + Σ length-row extents, floored at 1", includes SDF objects and lights) feeds env power `phiEnv = 4π²r²·L̄` (lighting.ts:516).
- why it matters: pbrt uses one scene bound for both DistantLight and infinite-light power. Here env-vs-directional selection uses two radii from two heuristics, one of them in a generator. This affects variance only (no bias), but it is one physical quantity with two answers, plus a guessed fallback constant (10) that is mirrored in a second file.
- suggestion (thought-through-not-checked): Compute one world radius in planScene (or placeScene) and stamp it once, for example in a scene-level field. Have both the directional power and envSelectionProbability read it, and delete sceneRadiusEstimate. Decide explicitly (as a declared fact) what an unboundable scene's radius is.
- pros/cons: Pros: one answer, consistent selection between sky and sun, less generator logic. Cons: changes p_env and directional power values, so the compiled-output digest changes and the witness noise checks need a rerun. Choosing which geometry counts (SDFs? batches?) still needs a decision.
- checker note: Read Planner.ts:982-1015 (sceneWorldRadius, fallback 10, skips SDFs/batches/planes/placed objects), directional.ts:28-30 (`ctx?.worldRadius ?? 10`, comment says it twins the stamp-site constant), Planner.ts:340-341 (stamped on every light), and lighting.ts:456-474/516 (sceneRadiusEstimate over plan.objects incl. marched ones and lights, floored at 1; phiEnv = 4π²r²·L̄·intensity). Under selection 'power' both radii enter the same p_env formula (phiFin uses lightPower with powerCtx). Only 'power' selection is affected: 'uniform' and 'bvh' never read either radius.

### plan-02 — dataTenantsOf still re-derives facts from the raw SceneDescription although only placeScene calls it

- kind: complexity; reader confidence: checked; checker: **confirmed**
- evidence: Only caller: Planner.ts:359 `dataTenantsOf(scene, reads)` (grep over src/app finds no caller). Its header still says it is "called by the Planner ... AND the App" (dataTenants.ts:3-5). It recomputes table eligibility from the raw scene: dataTenants.ts:353 `isDrivenTransform(o.transform) || keepsLocalFrame(o, scene)`, :363 `d.similarityClosed !== true && !isIdentityRotation(...)`, :393 `classifyPlacement(...).residual.scale !== 1`. Those are the fold decisions planScene already made at Planner.ts:256-271 (cl/residualLive). It also recomputes batchPlacementRecordOf (:324; Planner.ts:199), lightRosterOf (:417; Planner.ts:287) and lightBatchesOf (:418; Planner.ts:348).
- why it matters: The same fact is spelled twice: "does this object keep a residual placement" is answered by planScene's records and again by restating the predicate. The Sep 25 note at dataTenants.ts:392 ("Tabling it drew the object at 1/s size") shows such a mismatch has already caused a wrong image. Each new primitive or placement tier has to update both.
- suggestion (thought-through-not-checked): Make dataTenantsOf take the ScenePlan (plus the raw mesh/batch data it needs for vertex and placement counts). Then table eligibility reads `o.placement === undefined` / `isDrivenPlacement` / `o.intersect`, and batch tiers read `prototype.record`.
- pros/cons: Pros: removes a class of drift and several re-derivations, and dataTenants.ts gets shorter. Cons: a refactor that needs digest before/after. The ScenePlan does not carry vertex counts or raw placements, so a few raw-scene reads stay. The Validator also calls some of these predicates on unvalidated scenes, so the shared predicates must stay scene-based.
- checker note: Only src caller is Planner.ts:359 (plus tests/compiler/sdfTable.test.ts). Header at dataTenants.ts:3-5 still says the App calls it. Small correction on the evidence: the SDF table check at dataTenants.ts:393 (`classifyPlacement(...).residual.scale !== 1`) duplicates resolveSDFPlacement (Planner.ts:921-922, which calls classifyPlacement and stores the residual), not lines 256-271, which handle analytic objects. batchPlacementRecordOf is the same function called twice, not a restated predicate. The restated predicates are the table-eligibility ones: isDrivenTransform/keepsLocalFrame, the identity-rotation test, and the residual-scale test.

### plan-03 — Light selection power computed in three places, one without powerCtx

- kind: duplication; reader confidence: checked; checker: **confirmed**
- evidence: generate/features/lighting.ts:353-356 `lightPower(l, params)` → `d.power(resolveLightValues(l, params), l.powerCtx)`; compiler/sceneData.ts:164 `return { box, power: d.power(l.values) }` (no ctx); app/sceneData.ts:135 `powers[li] = d.power(values)` for batch instances.
- why it matters: There is no bug today: the only ctx-reading kind (directional) has no treeBounds, so it never enters the tree. But the light tree's powers and the CDF's powers come from different call shapes. A future tree-eligible kind that reads ctx would silently get the fallback in the tree only.
- suggestion (thought-through-not-checked): Put one `lightPower(values, kind, ctx)` in components/lights/power.ts and call it from all three places, or have sceneData call the existing lightPower.
- pros/cons: Pros: one spelling. Cons: the App's batch-instance loop has no PlannedLight, so the helper must take raw values plus ctx.
- checker note: lighting.ts:353-356 passes l.powerCtx. compiler/sceneData.ts:164 calls `d.power(l.values)` on already-resolved values with no ctx. app/sceneData.ts:135 calls `d.power(values)` for batch instances. Only directional reads ctx (grep of src/components/lights), and directional has no treeBounds (the kinds with treeBounds are disk, mesh, point, quad, softbeam, sphere and spot), so nothing differs today. A related point: the tree powers are computed from default slider values (resolveLightValues(l) with no params), while the CDF uses live params.

### plan-04 — ProgramDescription claims to answer every 'does this program contain X' question, but generators still decide several

- kind: doc-code-mismatch; reader confidence: checked; checker: **confirmed**
- evidence: types.ts:28-31 "every 'does this program contain X' question is answered here, once". Counter-examples: intersection.ts:100 and :408 (the same gate twice) `plan.program.intersection.drivenPlacement || hasInstanced || placedAnalytic || tabledSdfPresent` widen the plan's drivenPlacement for placement.glsl. intersection.ts:331 and :388 decide the `ior_of` seam (`plan.materials.some((m) => modelTransmission(m.model))`) twice. intersection.ts:76 needDataRail and :284-289 needNodes. materials.ts:144-147 decides whether medium emission.glsl is included. lighting.ts:488 holds the env-selection policy (uniform/bvh/power formulas).
- why it matters: Contract §2.12 says generated seams are Planner decisions. Today the reader cannot know which inclusion questions live in the plan and which live in features, and the same predicate is repeated inside one feature file.
- suggestion (thought-through-not-checked): The owner should pick one of two options. (a) Move the cross-feature or seam-level existence decisions (ior_of, placement ABI, data rail) into ProgramDescription. (b) Narrow the doc to say "cross-feature decisions are recorded here; a feature may derive purely local inclusion from plan tables". At minimum, deduplicate the repeated predicates within intersection.ts into one local const.
- pros/cons: Option (a) gives one place to look but makes ProgramDescription bigger and churns the snapshot test. Option (b) is honest and cheap but leaves the rule fuzzier. The local dedup is free.
- checker note: types.ts:28-31 makes the claim as quoted. intersection.ts repeats the placement gate `drivenPlacement || hasInstanced || placedAnalytic || tabledSdfPresent` at ~100 and ~403. It tests `plan.materials.some(m => modelTransmission(m.model))` twice, for the ior_of block and for the ior_of provide. needDataRail is at :76 and needNodes at ~284-289. materials.ts:144-147 decides whether medium emission.glsl is included. The env-selection policy lives in lighting.ts envSelectionProbability.

### plan-05 — App still decides which environment CDF variants to build from raw strategies

- kind: in-progress; reader confidence: checked; checker: **confirmed**
- evidence: App.ts:955-964 `envVariants`: `st.estimator.envSampler ?? 'equirect'`, `st.estimator.envCompensation ?? false`, duplicating Planner.ts:578-579. It ignores `program.environmentSamplable` (Planner.ts:685), so tables are built even when no program samples the env. Documented as open in docs/claude-data-exact-linkage.md (status line: "which environment sampling tables to build (App `envVariants`, from strategy fields)").
- why it matters: This is the one remaining planning leak into the App, and it breaks "a data region exists only if some program reads it" for env tables. The documented reason it is still open: the procedural bake would have to run after the main renderers load.
- suggestion (thought-through-not-checked): Add env variants to DataReads (per program: `environmentSamplable ? {chart, compensation} : none`) and have the App read `CompiledScene` for them. This needs the bake reordering the doc already describes.
- pros/cons: Pros: finishes exact linkage for data and removes the App's duplicated defaults. Cons: needs the bake reordered, as the doc says; small benefit for scenes that already sample the sky.
- checker note: App.ts:955-964 applies its own `?? 'equirect'` / `?? false` defaults, which duplicate Planner.ts:578-579. It is called at App.ts:174, :232 and :272 without consulting environmentSamplable. docs/claude-data-exact-linkage.md lines 3-6 record this as the one open App-side derivation and say it needs the procedural bake reordered.

### plan-06 — Ledger/adapter comments still say the App calls the layout function, and that tables are allocated strategy-independently

- kind: doc-code-mismatch; reader confidence: checked; checker: **confirmed**
- evidence: ledger.ts:3-6 "the App calls the SAME function to pack payloads"; components/data/README.md:12-13 and :20-21 "the one function feeding the ledger from both Planner and App"; dataTenants.ts:3-5; lights/table.ts:5 "three readers ... the App packer". ledger.ts:66-69 sceneTable "Allocated whenever eligible objects exist (strategy-independent ... the always-upload precedent)", :71-74 lightTree "strategy-independent; 'power' programs never read it", types.ts:621-624 "allocated strategy-independently, the always-upload precedent". Code: allocation is gated on reads (dataTenants.ts:407 `reads.sceneTable && leaves.length > 0`, :420 `reads.lightTree && ...`). The App does not call dataTenantsOf or planDataLayout (grep src/app). dataTenants.ts:104-109 says batchPlacementRecord is read by "Planner ... and App", but nothing outside dataTenantsOf reads that field.
- why it matters: These are the first comments a reader meets in the data rail, and they describe the pre-stage-1 architecture. They also invite someone to "restore" App-side layout calls.
- suggestion (checked): Rewrite these comments to the current flow (Planner lays out; sceneDataPlanOf says what to pack; the App only executes) and to the reads-gated allocation. Decide whether SceneDataTenants.batchPlacementRecord should remain an output field.
- pros/cons: Pros: docs match the code. Cons: none beyond the edit.
- checker note: All the cited stale comments were verified: ledger.ts:3-6, ledger.ts:66-74, README.md:12-13/20-21, dataTenants.ts:3-5, lights/table.ts:5 ('the App packer'; packLightTable is now called from compiler/sceneData.ts, not src/app), types.ts:621-624 and dataTenants.ts:104-109. Allocation is gated on reads at dataTenants.ts:407/420. grep finds no dataTenantsOf, planDataLayout or lightTableLayout calls in src/app (the App imports only nodeTexelBound/assertFits from ledger). types.ts:306/395 carry the same 'App packs from too' phrasing. batchPlacementRecord is read only inside dataTenantsOf.

### plan-07 — SDF record budget re-implemented in the table-eligibility predicate

- kind: duplication; reader confidence: checked; checker: **confirmed**
- evidence: dataTenants.ts:383-388 `const rowFloats = [...d.params, ...(d.derivedFields ?? [])].reduce(...)`; `if (1 + Math.ceil(rowFloats / 4) + 2 > ANALYTIC_RECORD_TEXELS) return;` with the comment "Mirrors sdfTailTexel's alignment". generate/records.ts:54-57 `sdfTailTexel(d)` = `1 + Math.ceil(floats / 4)`.
- why it matters: Two spellings of the record wire format. If the record layout changes in records.ts, eligibility silently disagrees and sdfRecordPack throws at pack time. The plan module would also need to import from generate/ to share it.
- suggestion (thought-through-not-checked): Move records.ts (the record wire format, which both plan/sceneData and the generator use) out of generate/, for example to components/intersection or compiler/plan. Then call `sdfTailTexel(d) + 2 > ANALYTIC_RECORD_TEXELS` from dataTenants.
- pros/cons: Pros: one wire-format module, and it fixes the sceneData→generate import direction too (see plan-08). Cons: a file move that touches imports in several places.
- checker note: dataTenants.ts:383-388 recomputes `1 + ceil(rowFloats/4) + 2`. records.ts:53-56 has sdfTailTexel = 1 + ceil(Σ recordFields widths / 4), using the same params+derivedFields walk. records.ts is imported by compiler/sceneData.ts:23 and generate/features/intersection.ts:45, so the plan module cannot use it without an upward import.

### plan-08 — Scene-data plan imports generator modules

- kind: complexity; reader confidence: checked; checker: **confirmed**
- evidence: compiler/sceneData.ts:23 `import { recordPack, sdfRecordPack } from './generate/records.js';` and :24 `import { resolveLightValues } from './generate/features/lighting.js';`. resolveLightValues (lighting.ts:341) is a pure light-values resolver, not codegen.
- why it matters: The plan→generate direction is inverted for the data plan, and a reader looking for "how a light's numbers are resolved" finds it inside a 940-line generator.
- suggestion (thought-through-not-checked): Move resolveLightValues (and lightPower) to components/lights (next to power.ts/table.ts), and move records.ts as in plan-07.
- pros/cons: Pros: a clean dependency direction, and light math sits with the light family. Cons: an import-only refactor; check the components purity test (components may import only types from other layers, and projectRGB lives in components/color, which is fine).
- checker note: compiler/sceneData.ts:23-24 are the only plan-side imports from generate/ (Compiler.ts importing Generator is expected). resolveLightValues (lighting.ts:341-348) is pure value resolution.

### plan-09 — Region count, light count, scattering presence and media models each have a second source

- kind: duplication; reader confidence: checked; checker: **confirmed**
- evidence: Region count: `regionCountOf` dataTenants.ts:302-304 vs the Planner's objectIndex assignment Planner.ts:128-303 vs the sorted ids at sceneData.ts:185-188. Light count: planProgram :495 uses `features.lighting.totalLightCount` (Analyzer.ts:36 `scene.lights.length + samplableEmitterObjects(scene).length`) while `scenePlan.lights` is in hand. Scattering: Planner.ts:519 `features.media.hasScatteringMedia && scattering === 'full'` beside :531 `scatteringMedia` from planned materials. Media models: Planner.ts:671-674 reads raw `scene.materials` with its own `(m.medium.model ?? 'hg')` (also at :948) and is not restricted to scatteringMedia. drivenPlacement: Planner.ts:621 from raw scene vs intersection.ts:87-90 from planned placements.
- why it matters: Each pair agrees today on valid scenes, but each is a place to update when the rule changes. media.models can include a phase model used only by a non-scattering medium (generated dispatch arm with no scatter event; inferred, not observed in a scene).
- suggestion (thought-through-not-checked): Inside planProgram, derive from the ScenePlan only: `hasLights = scenePlan.lights.length > 0 || ...`, `scatteringArms = scatteringMedia.length > 0 && ...`, `models = distinct models of materials in scatteringMedia`, `drivenPlacement = planned records with isDrivenPlacement`. Size regionMaterials from the planned region records.
- pros/cons: Pros: planProgram's inputs shrink toward (ScenePlan, strategy), and SceneFeatures would matter only to the Validator. Cons: the media.models change can alter generated output for mixed scenes (digest diff expected). totalLightCount intentionally counts unregistered authored lights for Validator messages, so the Analyzer keeps its own count.
- checker note: Verified Planner.ts:495 (hasLights from features.lighting.totalLightCount), :519-521 (scatteringArms from features.media.hasScatteringMedia) beside :531-533 (scatteringMedia from planned materials), :671-674 (media.models from raw scene.materials with its own `?? 'hg'`, not restricted to scatteringMedia; resolveMedium at :948 repeats the default), :621 (drivenPlacement from the raw scene), and regionCountOf at dataTenants.ts:302-304. The suggestion's claim that totalLightCount intentionally counts unregistered lights for Validator messages was not checked.

### plan-10 — Plan stage hard-wires Euclidean similarities, scale folding, AABBs and s² areas; ambient is never consulted

- kind: euclidean-assumption; reader confidence: checked; checker: **confirmed**
- evidence: Planner.ts:749 `placementOf = similarityFromTransform`; :256-271 classifyPlacement folds T,s into canonical parameters; :764-870 buildDrivenPlacement uses `rigidInverse({rotation, translation, scale})` with a quaternion and a scale floor; :327 `meshWorldArea(o.positions, o.indices, (mesh.placement as Similarity).scale)`; :982-1015 sceneWorldRadius via Math.hypot about the origin; sceneData.ts:138-145 AABB leaf boxes via transformAABB. The ambient choice is recorded only at measurement.ts:23 `ambient: scene.ambientSpace?.type ?? 'euclidean'`, and planScene (which does all placement work) never reads scene.ambientSpace.
- why it matters: H³/S³/H²×R isometries have no uniform scale and do not act on primitive parameters the way Euclidean similarities do, and areas and light powers depend on the metric. Today, adding an ambient occupant would silently plan Euclidean folds. CLAUDE.md pins placements as Euclidean similarities, so this is by design for now, but the plan stage has no seam to ask the ambient space.
- suggestion (thought-through-not-checked): When the first curved occupant is designed: let the ambient descriptor declare its placement group (for example 4×4 isometry, no scale) and whether parameter folding is allowed, and have planScene read scene.ambientSpace to pick between fold and keep-a-frame (the keep-a-frame path already exists: driven/retained placements). Research note: axis-aligned boxes in a projective model (Klein for H³) are geodesically convex, and in H²×R a Klein box × interval is too (a product of convex sets), so the AABB-BVH data path may carry over in model coordinates.
- pros/cons: Pros: keeps the curved-space door honest at the plan level, not only in GLSL. Cons: premature until an occupant exists. The owner's rule is to design curved placement with them, not in a survey.
- checker note: grep of src/compiler/plan finds ambientSpace only at measurement.ts:23. AMBIENT_SPACES has only euclidean. One correction to the research note: geodesic convexity of a Klein box × interval in H²×R is not enough for the AABB data path. Slab tests need the ray to be a straight line in model coordinates. That holds for H³ in the Klein model, but in Klein×R the vertical coordinate is linear in hyperbolic arc length, not in the Klein line parameter, so the geodesic is not a straight segment and the slab test does not carry over as is. S³ has no single affine chart.

### plan-11 — planScene mutates materials/objects/region counter inside the light-roster map

- kind: complexity; reader confidence: checked; checker: **confirmed**
- evidence: Planner.ts:287-334: inside `lightRosterOf(scene).map(...)`, authored hittable lights `materials.push({ id: materialIndex++, name: `__light_${id}` ...})` and `objects.push({ index: objectIndex++ ...})`; emissive-object lights then look up `materials.find`, `meshes.find`, `objects.find` (:320, :325, :332).
- why it matters: The desugar of authored area lights into regions, which defines region ids and material ids, is hidden inside a `.map` with side effects. Readers must know the order (objects first, then the desugared light regions) to understand material_of and regionCountOf.
- suggestion (thought-through-not-checked): Split this into an explicit desugar step before the roster map ("append synthesized region + material for each authored hittable light"), and make the map pure.
- pros/cons: Pros: the id assignment reads top to bottom, and it pairs naturally with plan-09's region count from records. Cons: the desugar needs the light id (roster index), so the two loops must share the roster; digest must stay identical.
- checker note: Planner.ts:287-334: inside `lightRosterOf(scene).map(...)`, the callback pushes to materials and objects and increments materialIndex/objectIndex, and later entries use find() on those arrays. The comment at :278-286 explains the desugar, but the side effects are real.

### plan-12 — Scene-dependent heuristic defaults in planning

- kind: guess; reader confidence: checked; checker: **confirmed**
- evidence: Planner.ts:557-558 `objectDispatch = strategy.estimator.objectDispatch ?? (objects.filter((o) => o.intersect === 'march').length >= MARCHED_TABLE_THRESHOLD ? 'table' : DEFAULT_OBJECT_DISPATCH)` with MARCHED_TABLE_THRESHOLD = 9 (components/intersection/index.ts:186); the Validator counts marched objects separately (Validator.ts:697-699). dataTenants.ts:383-388 silently degrades an SDF object whose record would not fit to the residual marcher ("degrade-to-residual here so an exotic pinned type renders ... instead of erroring").
- why it matters: Both are estimator-only (image unchanged) and the threshold has measurements behind it, but they are implicit policy choices under the owner's no-guess / no-fallback rule. The silent degrade also has no diagnostic.
- suggestion (thought-through-not-checked): Keep both if the owner accepts them, but make them declared facts: give the dispatch default one shared counter that the Planner and the Validator both call, and have the SDF budget degrade emit a warning (or become a Validator error if the owner prefers reject-not-degrade).
- pros/cons: Pros: matches the owner's stated rules. Cons: the threshold default is useful convenience; making it an error would push the choice onto every large SDF scene.
- checker note: Planner.ts:557-558 counts planned objects with intersect==='march'. Validator.ts:696-699 counts sdf-backend primitive objects separately (it warns only on an explicit 'unrolled'). The threshold has an M1 Pro measurement behind it (Validator comment, intersection/index.ts:180-186). The SDF budget degrade at dataTenants.ts:383-388 produces no diagnostic.

### plan-13 — App hard-codes the sphere light kind's rows and the params-record layout for batch lights

- kind: other; reader confidence: checked; checker: **confirmed**
- evidence: app/sceneData.ts:124-131: `const values = { center, radius: 0, radiance }`; `center[0] = recs[4 * k]; ... values.radius = recs[4 * k + 3];` The plan only passes `kind` (sceneData.ts:177 `regionLightKind(pb.prototype.shapeType)`).
- why it matters: The App is meant to decide nothing about the scene. Here it knows a light kind's row names and the sphere params-record layout, so a second light-eligible prototype shape would need App edits.
- suggestion (thought-through-not-checked): Have the light kind (or the plan) supply a function from params-record floats + emission to kind values, for example a descriptor fact `valuesFromRecord`, and have the App call it.
- pros/cons: Pros: the App goes back to executing only. Cons: adds a descriptor fact for a case with one occupant today (sphere batches); might be premature.
- checker note: app/sceneData.ts:124-131 hard-codes `{center, radius, radiance}` and the 4-float params-record layout. The plan passes only the kind (compiler/sceneData.ts:177-180, which comments that a light-eligible batch is a params-tier sphere). There is one occupant today, so the suggestion may be premature, as the reader says.

### plan-14 — EnvironmentBake carries its own copies of env_rotate_cs and PI constants

- kind: duplication; reader confidence: checked; checker: **confirmed**
- evidence: EnvironmentBake.ts:44-57 defines `#define PI`, `#define TWO_PI` and `vec3 env_rotate_cs(vec3 d, vec2 cs) {...}`; the same body is in generate/features/environment.ts:30-35 (ROTATE_BLOCK) and the constants in glsl/core/math.glsl:6-7.
- why it matters: There are two GLSL copies of the rotation formula, and the bake compiler bypasses Analyze/Validate and the shader builder. Its comment records a past bug where its shim drifted from the main program ("the octahedral chart ... failed to compile at bake time").
- suggestion (thought-through-not-checked): Export ROTATE_BLOCK and include it (and math.glsl) in the bake source instead of re-typing them.
- pros/cons: Pros: one copy. Cons: math.glsl may carry more than the bake needs (fine, wholesale inclusion is the declared policy).
- checker note: EnvironmentBake.ts:44-57 retypes PI/TWO_PI and env_rotate_cs. The body is identical to ROTATE_BLOCK in generate/features/environment.ts:30-35, and the constants are in glsl/core/math.glsl:6-7. The comment records the past drift bug. ROTATE_BLOCK is not exported today.

### plan-15 — Unimplemented-primitive diagnosis split between Planner (objects) and Validator (prototypes)

- kind: other; reader confidence: checked; checker: **confirmed**
- evidence: Planner.ts:208-215 `bag.error('missing-geometry', ... is not implemented yet ...)` for plain objects; Validator.ts:1152-1154 does the same for instanced prototypes; Validator.ts:1492-1494 skips schema checks for unimplemented types saying "those carry their own diagnostics".
- why it matters: Validation happens partly in the Plan stage, so Planner code has to tolerate invalid scenes (the `continue` paths keeping region ids stable at :177-181 and :214).
- suggestion (thought-through-not-checked): Move the plain-object diagnostic into the Validator next to the prototype one. The Planner could then assume registered types.
- pros/cons: Pros: one stage validates, and the Planner is simpler. Cons: the diagnostics snapshot test may change ordering.
- checker note: Planner.ts:208-215 emits 'missing-geometry' for plain objects. Validator.ts:1152-1155 covers prototypes, and Validator.ts:1490-1492 skips schema checks for unimplemented types. Compiler.ts:47-57 throws on Validator errors before planning, so the Planner's batch `continue` at :177-181 is unreachable in the compile flow. Only the plain-object path is real invalid-scene tolerance in the Planner.

### plan-16 — Scaffolding in this area that is deliberate, not dead

- kind: in-progress; reader confidence: checked; checker: **reclassify-in-progress**
- evidence: measurement.ambient (measurement.ts:23) with one AMBIENT_SPACES occupant (components/ambient/index.ts:21); DataReads.cwbvh + nodesq channel (channels.ts:14-20, ledger.ts:148-152), an experiment selectable by `instanceAccel: 'cwbvh'`; RESPONSE_PICTURES with only 'radiance' (pictures.ts:18-20); `shadows: 'opaque-dielectrics'` single value (types.ts:57); pack.ts:84 uvec3 `.w` "RESERVED as the per-triangle material-group slot"; CompiledScene.dataReads has no App reader (only tests/digest).
- why it matters: These serve curved spaces, the CWBVH experiment, future responses, transparent shadows and multi-material meshes (CLAUDE.md "Not built / deferred"). They should not be removed in a cleanup.
- suggestion (checked): Leave them as they are.
- pros/cons: n/a
- checker note: Verified: measurement.ts:23 and the single AMBIENT_SPACES entry; NODESQ channel (channels.ts:14-20) and the cwbvh engine (intersection/index.ts:51-92); RESPONSE_PICTURES with only radiance (pictures.ts:18-20); shadows 'opaque-dielectrics' (types.ts:57); pack.ts:83-84 '.w RESERVED as the per-triangle material-group slot'; CompiledScene.dataReads read only by tests and scripts/digest-compiled.ts:78. All are deliberate scaffolding tied to CLAUDE.md 'Not built / deferred' items. Keep them.

**Checker: missed by the reader**

- Planner.ts:186 sets `record: backend === 'sdf' ? 'frame' : batchPlacementRecordOf(obj, scene)`, but batchPlacementRecordOf (dataTenants.ts:127) already returns 'frame' for sdf-backend prototypes. The ternary restates the rule (harmless today, a second spelling of the tier decision).
- The light-tree weights are frozen at default parameter values. compiler/sceneData.ts:153 calls resolveLightValues(l) with no params, and app/sceneData.ts packs the tree once. The 'power' CDF instead recomputes lightPower(l, params) live. Under selection 'bvh', a light with slider-driven emission keeps its default-emission tree weight. This affects variance only, not bias. Not checked: whether a doc already records this.
- plan-10's H²×R AABB claim needs correcting: convexity holds, but slab tests require straight-line rays in the chart, which Klein×R does not give (the R coordinate is not affine in the Klein line parameter).

**Reader questions for the owner**

- Should ProgramDescription be the only place that decides which generated seams and included files exist (moving ior_of, placement ABI, data-rail and medium-emission inclusion out of the generators)? Or should its doc be narrowed to cross-feature decisions, with features allowed to derive local inclusion from plan tables?
- Do you want one scene world radius, stamped once by the Planner, used by both the directional light's power and the environment's selection probability? If so, which geometry should count (SDF objects? instance batches? planes excluded?), and what should an unboundable scene declare instead of the constant 10?
- Now that only placeScene calls dataTenantsOf, may it read the ScenePlan instead of re-deriving folds, tiers and the roster from the raw scene? This is a refactor checked with the digest, with no output change expected.
- Are the scene-dependent objectDispatch default (9 or more marched objects → 'table') and the silent SDF-record-budget degrade acceptable under the no-guesses rule, or should they become declared facts or warnings?
- For curved spaces: should the ambient descriptor eventually declare its placement group (no uniform scale in H3/S3) and whether parameter folding is allowed, with planScene reading scene.ambientSpace? Or will curved scenes take a separate planning path?


## compiler-generate

Generate turns one renderer's RenderPlan into a CompiledRenderer, which holds two GLSL programs (main and display), the pass pipeline, uniform bindings with CPU compute closures, slider metadata, exports and block-level source maps.

The main fragment shader is built from ordered "feature contributions". The features are core, a generated interface header, intersection, materials, lighting, pixel, camera, environment, aov, transport and accumulation. Each contribution is {blocks, defines, uniforms, parameters, textures, provides, requires}.

A block is either a whole hand-written component file (a `?raw` import carried by a registry descriptor, included when that occupant is present) or a generated string.

mergeContributions concatenates the contributions and runs the link check: seam-conflict and seam-missing are errors, and seam-unused (a seam provided that nothing requires) is a warning. The interface header forward-declares every provided seam, so seams can be defined in any order.

Exact linkage works in three steps, all written by hand. The Planner records "does a caller exist" decisions (surfaceEval, surfacePdf, mediumEval, anyQuery, environmentPdf, …). Each feature then gates both its block and its provides entry on those decisions. Consumers list their requires under their own flags.

The transport loop (pt.ts) reads `flags(program)` and emits, in order:
- the light-query constructors;
- a PathState struct made of the fields its parts need;
- the MIS combiner bodies (pt, pt-nee and pt-mis are three sets of bodies);
- kernel_record, the roulette functions and the static technique files;
- a ~20–60 line `transport_trace` walk built from `lines.push` under the flags.

The accumulation feature writes main() and requires the roots: pixel_sample, camera_generateRay, wavelengths_sample, transport_trace and color_to_pixel.

The generated shaders read well. The dump opens with the interface header as a table of contents, every block carries its origin, and the pt-mis walk is about 20 lines. The generator source is harder to read: GLSL is built as string arrays, about 25–30% of lines are comments, and there are roughly 100 batch tags. intersection.ts alone is 1728 lines.

The open defect is measured: 229 of 274 synchronous suite scenes warn, and `light_query_medium` is the only seam-unused seam in the whole suite. It is emitted and provided unconditionally, but it is required only when scattering media exist. The GRIN walk also calls it without declaring the require, so 23 GRIN renderers get a false warning, and a naive fix would break them.

The main structural theme is that each seam's existence is written down three times (Planner field, feature gate plus provides entry, consumer requires), and the glslang static test (run without `-l`) cannot see drift that the interface header hides.

### F1 — light_query_medium is always emitted and provided but required only under scattering; the GRIN walk's call is undeclared

- kind: defect; reader confidence: checked; checker: **confirmed**
- evidence: pt.ts:47 `const blocks: ShaderBlock[] = [lightQueryFns(f), pathState(f)];` (unconditional); pt.ts:85 `{ name: 'light_query_medium', signature: 'LightQuery light_query_medium(Point p)' }` (unconditional); requirers: kernel.ts:73 `if (f.scattering) req.push('interaction_medium_sample', 'light_query_medium');`, light.ts:32-33 `if (f.scattering && !f.equiangular) { req.push('interaction_medium_eval', 'light_query_medium');`; the walk calls it at pt.ts:358 `kernel_record(s, 1.0, light_query_medium(ms.exit_p), true);` under f.deflecting, but walkRequires (pt.ts:98-112) never pushes it. Measured with a vite-node script over the suite (scratchpad seams.ts): 229/274 synchronous scenes warn, light_query_medium is the only seam-unused seam anywhere, the 45 non-warning scenes are exactly the scattering-media scenes, and 23 GRIN renderers without scattering (grin, grin-vacuum, maxwell, rough-grin, spectral-grin*, guides-grin-*) call it while still warning. Introduced in d6f3f0b (2026-08-10), after seam-unused existed.
- why it matters: The exact-linkage check has warned in most programs for 3 months, so nobody reads it and a real drift would hide in the noise. The obvious fix (gate on f.scattering) would delete a function 23 GRIN programs call, and the static tests would not catch that (see F3).
- suggestion (thought-through-not-checked): Emit and provide the medium constructor iff `f.scattering || f.deflecting`, and add 'light_query_medium' to walkRequires under f.deflecting. Optionally add a suite test asserting zero seam-unused warnings.
- pros/cons: Pro: a few lines; makes the warning meaningful again; removes the dead constructor from ~200 programs. Con: changes the shader text of most scenes (digest diffs everywhere, though only by deletion); needs a glslang plus targeted GRIN witness check.
- checker note: Checked. pt.ts:47 emits lightQueryFns(f) unconditionally, and pt.ts:85 provides light_query_medium unconditionally. The only requirers are kernel.ts:73 and light.ts:33, both gated on f.scattering. The GRIN walk calls it at pt.ts:358 under f.deflecting, and walkRequires (pt.ts:98-112) never lists it. merge.ts:76-89 warns on any non-componentScoped provide that nothing requires. `git log -S` confirms the GRIN call came in d6f3f0b (2026-08-10). I did not re-run the 229/274 count. CLAUDE.md records 221/265, so the gap is real and long-standing either way, and the reader's GRIN detail explains why the obvious fix would break GRIN. The suggested fix is sound in principle: the constructor block comes first in transport, so ordering is not a problem.

### F2 — Each seam's existence is hand-written in 3 places: Planner decision, feature block gate plus a separate provides list, and consumer requires

- kind: duplication; reader confidence: checked; checker: **confirmed**
- evidence: Planner.ts:629-630 `surfaceEval: lighting !== null, surfacePdf: mis,`; materials.ts:82-83 gates the dispatch block on surfaceEval and again at materials.ts:258-266 `if (surfaceEval) { provides.push(... 'interaction_surface_eval' ...` (comment at materials.ts:249: `Each entry mirrors its emission condition above`); light.ts:30 independently requires 'interaction_surface_eval' when f.nee. Self-provide/self-require ceremony exists only to satisfy the check, e.g. intersection.ts:399 `const requires = ['scene_region_at'];` and intersection.ts:410-424 (placement helpers provided and required by the same feature). Static GLSL headers repeat the dependency lists in prose too (kernel.glsl `Depends on: ... scene_material_properties, material_of`).
- why it matters: Every new seam or new caller means editing 3–4 places that must agree, and F1 is what happens when one is missed. It is the main friction in adding a technique or a material op, and it runs against the owner's 'one answer per fact' rule.
- suggestion (thought-through-not-checked): Two simpler alternatives. (a) Attach `provides` to the ShaderBlock that defines the seam, so emitting the block is what provides it (removes the mirrored provides lists). (b) Derive requires and provides from the emitted GLSL: collect the function definitions per block and the identifiers called, compute reachability from main(), and drop unreachable generated blocks. Planner 'caller exists' fields such as surfaceEval, surfacePdf, mediumEval, mediumPdf, anyQuery, environmentPdf and lightingPdf would then become outputs rather than hand-maintained inputs.
- pros/cons: (a) Pro: small, local, removes one of the three copies. Con: requires stays by hand. (b) Pro: deletes most bookkeeping, and the link map becomes a fact read off the program, never a guess. Con: needs a small GLSL function and call scanner (comment stripping, function boundaries), a deterministic parse that must be trusted. Some gates also change struct fields and uniforms, not just functions, so not every Planner field disappears. It is a larger refactor that touches every feature, so it needs owner discussion and digest before/after.
- checker note: Checked. materials.ts:82 gates the dispatch on surfaceEval/surfacePdf, and materials.ts:249-266 rebuilds the provides list ('Each entry mirrors its emission condition above'). intersection.ts:399-424 self-provides and self-requires the placement helpers and data_texel1d. Planner.ts:629-630 makes the decision. Suggestion (b) is a large untested design. Under the owner's rules it belongs in research and discussion, not a plan.

### F3 — The interface header plus glslang without `-l` hides missing seam definitions and signature mismatches

- kind: defect; reader confidence: checked; checker: **confirmed**
- evidence: features/types.ts comment: `signature ... must match the definition's parameter/return types exactly (glslang enforces this — T3)`. tests/helpers/glslangCheck.ts runs `execFileSync(bin, [file], ...)` with no `-l`. Experiments with the repo's glslangValidator (scratchpad glsltest/): a prototype `float f(vec2)` next to a definition `float f(vec3)` → exit 0 (a silent dangling overload); `main` calling a declared but never-defined `g` → exit 0 without -l and `ERROR: Linking fragment stage: No function definition (body) found` with -l. Return-type mismatch is caught. The two dumped main shaders link cleanly with -l (exit 0).
- why it matters: The static test is the only always-on gate (CI). Because every provided seam is forward-declared, a provides entry whose defining block was gated away compiles cleanly in CI and fails only in the browser's link step, or in the 45-minute witness sweep. The doc comment overstates what glslang guarantees.
- suggestion (thought-through-not-checked): Pass `-l` in glslangCheck, and correct the types.ts comment to say only return types are checked without linking.
- pros/cons: Pro: one flag, and it catches the exact drift class F1/F2 can produce. Verified on 2 sample shaders only. Con: must confirm the whole suite links (some wholesale files may define but never call functions, which is fine; but a declared-only prototype that is never called is also fine). Slightly slower test run.
- checker note: Reproduced with the repo's glslangValidator.darwin. A shader whose main calls a declared but never-defined h() exits 0 without -l and exits 3 with -l ('No function definition (body) found'). tests/helpers/glslangCheck.ts:61 passes no -l. The comment in features/types.ts:32 ('glslang enforces this') overstates the check: it holds for return types, not for a prototype that has no matching definition.

### F4 — Seam-existence decisions in the Planner restate call-graph reachability

- kind: complexity; reader confidence: checked; checker: **partly**
- evidence: Planner.ts:617 `anyQuery: lighting !== null && !features.media.hasMedia,`, :629-630 `surfaceEval: lighting !== null, surfacePdf: mis,`, :666-667 `mediumEval: scatteringArms && lighting !== null, mediumPdf: scatteringArms && mis,`, :686 `environmentPdf: envSamplable && mis,`. Comments say each is 'its only caller is …' (materials.ts:79-81 `eval's only caller is the light technique, pdf's the surface MIS weight`).
- why it matters: These fields are not measurement or estimator decisions. They record who calls whom, which is already known from what the transport feature emits. Keeping them by hand couples the Planner to transport internals, so a new technique calling interaction_surface_pdf means also editing the Planner condition.
- suggestion (thought-through-not-checked): See F2(b): derive these from reachability after generation, or at least have transport export its call needs as data the Planner reads, so one place answers 'who calls X'.
- pros/cons: Pro: one answer per fact; adding a technique touches one file. Con: the ProgramDescription snapshot changes, and the Planner currently uses these to plan data reads; check dataTenants before moving them.
- checker note: The fields and their 'only caller is…' comments exist as cited (Planner.ts:617, 629-630, 666-667, 686). The stated con is wrong. dataReadsOf (dataTenants.ts:27-32) reads only lighting.selection, instanceAccel and objectDispatch, none of these fields. A complete grep shows their readers are the generate features, transport/flags.ts and plan/types.ts. Moving them would not touch data planning. This is largely the same finding as F2.

### F5 — Some decisions are still made, and repeated, inside generator features

- kind: duplication; reader confidence: checked; checker: **confirmed**
- evidence: lighting.ts:84 `const bvh = selection === 'bvh' && (plan.lights.length > 0 || instanceLights.length > 0);` vs intersection.ts:75-76 `const bvhLighting = plan.program.estimator.lighting?.selection === 'bvh' && plan.lights.length > 0 && plan.lightTree !== undefined;` vs dataTenants.ts:30 `lightTree: program.estimator.lighting?.selection === 'bvh'`. ior_of provide: intersection.ts:388 `plan.materials.some((m) => modelTransmission(m.model))` vs flags.ts:28 `transmission: p.materials.models.some(modelTransmission)`. The emission.glsl inclusion condition is computed in the generator (materials.ts:144-146 `media.deflecting || plan.materials.some(m => ... isEmissiveMedium ... !mediumRoutesToTracking(...))`). materials.ts:118 `const wantsNullTable = media.nullInterfaces || media.shadowWalker;`.
- why it matters: CLAUDE.md says the Plan stage makes every decision and generators emit from the plan alone. Three slightly different 'bvh lighting' conditions must agree for the data rail to exist exactly when the light tree reads it. Today they agree only because instance lights imply instanced geometry, which is a subtle, unstated invariant.
- suggestion (thought-through-not-checked): Move these into ProgramDescription fields (e.g. `lighting.tree: boolean`, `media.analyticEmission`, `materials.transmission`) and have the features read them.
- pros/cons: Pro: one answer each; the generators get shorter. Con: grows ProgramDescription, and the snapshot test changes.
- checker note: Checked all four sites: lighting.ts:84, intersection.ts:75-76, dataTenants.ts:30, and intersection.ts:388 vs flags.ts:28. The emission.glsl condition at materials.ts:144-146 and wantsNullTable at materials.ts:118 are computed in the generator. The unstated invariant is real: under 'bvh' with only instance lights, intersection's bvhLighting is false and the data rail survives only through hasInstanced.

### F6 — Record layout field walk written three times, and its arithmetic mirrored in dataTenants

- kind: duplication; reader confidence: checked; checker: **confirmed**
- evidence: records.ts:22-27 `recordFields` (used by the reader), records.ts:33-42 `recordPack` and records.ts:65-74 `sdfRecordPack` each re-walk `d.params` then `d.derivedCtorFields?.(values)` on their own; the header claims `BOTH SIDES GENERATED FROM THE DESCRIPTOR ROWS ... derive from the same field walk and cannot drift`. dataTenants.ts:387-388 re-implements sdfTailTexel: `const rowFloats = [...d.params, ...(d.derivedFields ?? [])].reduce(...)`; `if (1 + Math.ceil(rowFloats / 4) + 2 > ANALYTIC_RECORD_TEXELS) return;` with the comment `Mirrors sdfTailTexel's alignment.`
- why it matters: The pack side writes from `derivedCtorFields(values)` while the reader's widths come from `derivedFields` shapes, which are two descriptor facts that must agree in order and width. The eligibility check is a third copy. A new primitive with a derived vec3 is where these could diverge.
- suggestion (thought-through-not-checked): Have recordPack and sdfRecordPack share one `packFields(d, values)`, and move recordFields and sdfTailTexel to a module both the Planner (dataTenants) and Generate can import (e.g. components/intersection), with dataTenants calling sdfTailTexel.
- pros/cons: Pro: deletes ~20 lines and two mirrors. Con: a module move; check the dependency direction (plan importing from generate is currently avoided).
- checker note: records.ts: recordPack (33-48) and sdfRecordPack (64-80) repeat the same params-plus-derivedCtorFields loop. recordFields (22-27) is a separate walk over derivedFields shapes. dataTenants.ts:385-388 recomputes sdfTailTexel inline ('Mirrors sdfTailTexel's alignment') rather than calling it. The header's claim that the two sides 'cannot drift' holds only if derivedFields and derivedCtorFields agree, and nothing in this file enforces that. The header mentions a contract test that pins float counts; I did not check it.

### F7 — Display program resources are spread over ShaderBuilder, Generator and Planner, each repeating a condition

- kind: duplication; reader confidence: checked; checker: **confirmed**
- evidence: ShaderBuilder.ts:93 `...(pictures.length > 1 ? ['uniform int u_picture;'] : [])` vs Generator.ts:59 `...(pictures.length > 1 ? [{ name: 'u_picture', ...`; ShaderBuilder.ts:86/94 `const dither = model.encodesToDisplay; ... 'uniform sampler2D u_blueNoise;'` vs Planner.ts:737 `...(tonemapModel(program.view.tonemap.type).encodesToDisplay ? { 'u_blueNoise': 'extern:blue_noise' } : {})`; u_resolution declared at ShaderBuilder.ts:91 and bound at Generator.ts:56.
- why it matters: The main program enjoys the 'declared where read, bound from the same record' discipline. The display program does not: declaration and binding are decided in different files and stages.
- suggestion (thought-through-not-checked): Give the display pass its own small contribution record ({blocks, uniforms, textures}) built in one function, and have the PipelineBuilder bind its textures the way it binds the pathtracer pass's extern textures.
- pros/cons: Pro: one place per display resource. Con: small gain; touches Planner's pass inputs and PipelineBuilder's pathtracer-only extern rule (PipelineBuilder.ts:39).
- checker note: ShaderBuilder.ts:86-94 declares u_resolution, u_picture (when there is more than one picture) and u_blueNoise (when dithering). Generator.ts:56-59 binds u_resolution and u_picture on the same pictures.length>1 condition. Planner.ts:737 adds the u_blueNoise extern on encodesToDisplay. That is three files deciding the display pass's resources. The gain is small, as the reader says.

### F8 — INTEGRATORS registry exists but collectFeatures imports pt directly

- kind: in-progress; reader confidence: checked; checker: **reclassify-in-progress**
- evidence: components/transport/integrators/index.ts: `export const INTEGRATORS = { pt: contributeTransport };` with the comment `One occupant today; the strategy-level integrator axis arrives with the second occupant`. grep shows no reader of INTEGRATORS; features/index.ts:15 `import { contributeTransport } from '../../../components/transport/integrators/pt/pt.js';`
- why it matters: This is scaffolding for future integrators (one-shot, Whitted, probes, and later curved-space walks), not dead code. When a second integrator lands, the selection should go through the registry rather than add a branch to features/index.ts.
- suggestion (thought-through-not-checked): Keep it. When the second integrator arrives, call `INTEGRATORS[program.estimator.integrator]` in collectFeatures.
- pros/cons: Pro: zero work now. Con: none.
- checker note: This is scaffolding for planned work, not dead code. integrators/index.ts says the axis 'arrives with the second occupant', and a full grep finds no reader of INTEGRATORS. Keep it. One correction to the suggestion: no `estimator.integrator` strategy field exists (grep finds 'integrator:' only in pt.md), so wiring the registry also needs a new strategy field declared in the estimator section.

### F9 — Seam signatures and generated intersection code assume Euclidean points, lines and directions at infinity

- kind: euclidean-assumption; reader confidence: inferred; checker: **partly**
- evidence: Seams take `vec3 p`, not `Point`: intersection.ts:382 `'int scene_region_at(vec3 p)'`, :389 `ior_of(int region, vec3 p, ...)`, materials.ts:253 `scene_material_properties(int id, vec3 p, ...)`, :280 `scene_medium_properties(int mat, vec3 p, ...)`, :286 `ior_at(int med, vec3 p, ...)`. The sky takes a bare world direction: environment.ts:251 `Radiance environment_radiance(vec3 dir, Wavelengths wl)`, called by the walk's miss with s.ray.direction. Object-local points use straight lines: intersection.ts:559 `${rayRef}.origin + t * ${rayRef}.direction`, :1343, :1052. Normals use Euclidean normalize: intersection.ts:906-907, 1025-1026. Emission cones use a raw dot: materials.ts:941 `dot(wo, ${formatVec3(cone.direction)})`. Placement ABI is a quaternion plus translation and scale (placement_rigid(vec4 q, vec4 ts, vec3 p)). By contrast, world hit points correctly use `ambient_geodesic` (intersection.ts:707) and the side test uses `ambient_dot` (:1694).
- why it matters: The `Point` typedef is the planned door to vec4 points in S³/H³, and the seams bypass it. In H³ the sky is a function on the ideal boundary reached along the geodesic, and in S³ there is no infinity at all, so 'direction at the ray's end' must become the geodesic's endpoint or tangent transported to a chart. Similarity placements must become isometries of the space (SO(4), SO(3,1), or H²×R products).
- suggestion (thought-through-not-checked): First a cheap, text-only step: type the seam signatures with Point/Direction (they are vec3 today, so the output is identical). Leave the environment and placement questions for the curved-space design, but list them in its doc as known Euclidean seams in Generate.
- pros/cons: Pro: the typedef step costs nothing and marks the seams. Con: the real work (environment at infinity, isometry placements, local-frame marching) is design work, not a rename.
- checker note: The evidence lines are right: intersection.ts:559 uses origin + t*direction, 707 uses ambient_geodesic, 1694 uses ambient_dot, and 906-907 use normalize. environment.ts:251 takes vec3 dir, materials.ts:941 uses a raw dot. Point is `#define Point vec3`. This is useful because components/ambient/README.md claims only two places are Euclidean-only beyond the seam (the analytic media bodies and equiangular placement), and these generated ones are undeclared. One claim is overstated: an object-local `origin + t*direction` is not necessarily Euclidean-only. In projective models (Klein for H³, gnomonic for S³), geodesics are straight lines in the chart, with a different parameter. The real Euclidean assumptions are the vec3 types, normalize, the similarity/quaternion placement ABI and the direction-at-infinity sky. The typedef-only step is safe because Point is vec3 today.

### F10 — Generator source readability: GLSL as `lines.push` strings, very large feature files, heavy commentary

- kind: complexity; reader confidence: checked; checker: **confirmed**
- evidence: intersection.ts 1728 lines (471 comment lines), materials.ts 954 (251), lighting.ts 940 (226), pt.ts 475 (104). About 100 batch-tag hits (T4, R2, A1, D2, C5, E2, N5, P1b …) across generate/. pt.ts:230-283 emits a 30-line comment into the GLSL, including history (`An earlier version of this rule passed ms.weight`), and pt.ts:16-21 has `roulette() USED TO BE one of those`. The emitted shaders themselves are clean (the dumped pt-mis walk is 20 lines).
- why it matters: The owner wants to understand the code alone. The hardest part to read is the TypeScript that writes GLSL, not the GLSL. Comments carrying history and batch codes break CLAUDE.md's comment rules and bury the math.
- suggestion (thought-through-not-checked): (a) Split intersection.ts by class (primitive arms, mesh, instances, table, region/material tables), and split materials.ts into surface and media files. (b) Where a generated body is mostly fixed text, write it as one template literal with `${cond ? ... : ''}` holes rather than dozens of pushes. (c) Rewrite history comments to present-tense math when a file is next edited.
- pros/cons: Pro: much easier to read; output can be held identical, verifiable with npm run digest. Con: a refactor with no behavior gain, which must not be mixed with feature work (CLAUDE.md), and needs owner approval of the file split.
- checker note: File sizes match: 1728, 954, 940 and 475 lines. Comment-line counts match: 471, 251 and 226. A tag regex over generate/ plus pt.ts gives about 103 hits, possibly with a few false positives. History comments are at pt.ts:16 ('USED TO BE') and pt.ts:255 ('An earlier version of'); the second is emitted into the GLSL. Splitting files is a pure refactor and needs owner approval of the split, per CLAUDE.md.

### F11 — Environment kinds are hard-coded branches, not a registry, with a silent fallback

- kind: extension-friction; reader confidence: inferred; checker: **partly**
- evidence: environment.ts:120 `if (env.type === 'constant') {`, :147 `if (env.type === 'image') {`, :195 `if (env.type === 'procedural') {`, :243 `// none (and the fallback)` returning `radianceFn('return SPECTRUM_ZERO;')`. Each branch re-declares u_envIntensity/env.intensity metadata with slightly different labels ('Sky intensity' vs 'Env intensity').
- why it matters: Every other family adds an occupant with one folder plus one registry line. A new sky (a physical sky model, or a curved-space 'ideal boundary' sky) means editing this function. The fallback makes an unknown type render black instead of failing, which is a guess. The Validator probably rejects unknown types upstream, but that was not checked.
- suggestion (thought-through-not-checked): Turn env kinds into descriptors (radiance GLSL builder, samplable?, textures, uniforms) in components/env, and replace the fallback with a thrown backstop like core.ts:27 does for ambient.
- pros/cons: Pro: consistent extension story; removes the silent fallback. Con: the env kinds differ a lot (CDF textures, chart variants, rotation forms), so the descriptor surface needs design. The digest must stay identical.
- checker note: The friction is real: environment.ts:119/144/191 branch on type, and the labels differ ('Sky intensity' vs 'Env intensity'). The fallback claim is wrong as stated. plan.program.environment is the closed union ResolvedEnvironment (plan/types.ts:12-16), so the generator's final return is reached only by type 'none' and never renders an unknown type black. The real guess is upstream: Planner.ts resolveEnvironment ends with `return { type: 'procedural', glsl: env.glsl, ... }` for any type that is not none, constant or image, and the Validator has no check on environment.type (grep of Validator.ts). Context the reader missed: components/env/README.md says the family is sampling charts by design and that 'environment.ts owns the radiance bodies', so turning sky kinds into a registry is a design change, not a fix for drift.

### F12 — mintValueUniform has 10 positional parameters, including booleans

- kind: complexity; reader confidence: checked; checker: **partly**
- evidence: values.ts:85-98 `mintValueUniform(prop, glslType, metaType, uniforms, parameters, seen, hdr = false, color = 'rgb', role?)`; call site materials.ts:197-203 `mintValueUniform(mat.values[f.source] as ..., f.glslType === 'Spectrum' ? 'vec3' : 'float', isRadiometric(f.role) ? 'color' : 'float', uniforms, parameters, seen, f.source === EMISSION_KEY, plan.program.measurement.color, f.role);`. `glslType` and `metaType` are both derivable from the schema row.
- why it matters: This is the one place every scene value becomes a uniform and a slider, so it is read often and misordered booleans are easy to write.
- suggestion (thought-through-not-checked): Pass an options object `{ row/role, color, hdr }` and a sink `{ uniforms, parameters, seen }`; derive glslType/metaType from the row's role and shape.
- pros/cons: Pro: clearer call sites. Con: touches materials, lighting, environment and spectrum-kind mint callbacks; it is cosmetic-level value.
- checker note: The count is wrong: it has 9 positional parameters, not 10 (prop, glslType, metaType, uniforms, parameters, seen, hdr, color, role). The core point stands and is stronger than stated. The media calls at materials.ts:221-227, 235 and the inner ctx.mint in values.ts:123 omit `color` and `role`, so they silently take the default color='rgb'. In a spectral program a named-kind medium value would be minted through the RGB stand-in path, or throw at values.ts for lack of a role. I did not check whether the Validator rejects named kinds in media today, which would make this currently harmless.

### F13 — 'Declaration order is not load-bearing' holds only for seams

- kind: doc-code-mismatch; reader confidence: checked; checker: **partly**
- evidence: features/index.ts:24-28 `Since T4, cross-feature declaration order is NOT load-bearing ... only declarations are order-free.` But non-seam helpers still need definition-before-use: pt.ts:48-50 `MIS math ... precedes them (definition-before-use keeps it out of the interface header)`; kernel.glsl calls generated combiner_w_* and kernel_record, which must precede it; and structs from core must precede everything.
- why it matters: Someone reordering features or blocks would trust the comment. Block order inside transport, and core-first ordering, are still contracts.
- suggestion (checked): Reword it to say seams are order-free, while structs and intra-feature helpers keep definition-before-use, with the feature array order as that contract.
- pros/cons: Pro: accurate. Con: none.
- checker note: The comment at features/index.ts:24-30 already says 'Definition order still follows this array; only declarations are order-free', and it names core's structs as the reason the header follows core. The reader's examples (MIS math before the combiner, kernel.glsl after combiner_w_*/kernel_record) are all inside the transport feature, which the 'cross-feature' wording does not claim to cover. The only real gap: core's non-struct helpers (math, random, ray) must also come first, and the comment mentions only structs. A small clarification, not a mismatch.

### F14 — The local generated-shaders/ dump is stale

- kind: research-note; reader confidence: checked; checker: **partly**
- evidence: generated-shaders/*.glsl dated Sep 28. Its average.glsl block contains `void main()`, but current src/components/accumulator/average/average.glsl has 0 `void main` and accumulation.ts (last changed Oct 1) emits `generated:accumulation-main`. The directory is git-ignored.
- why it matters: Anyone reviewing shader readability from that folder sees the old structure.
- suggestion (checked): Regenerate with `npm run dump:shaders` before any readability review.
- pros/cons: Pro: trivial. Con: none.
- checker note: Not reproducible now. At 22:54 on Nov 6, generated-shaders/ exists, is git-ignored and is empty (directory mtime 22:52 today), so another process probably just cleared or is regenerating it. The underlying facts hold: src/components/accumulator/average/average.glsl has 0 `void main`, and accumulation.ts was last changed 2026-10-01. The advice (regenerate before reading) stands.

### F15 — PipelineBuilder falls back to a made-up shader id for unknown pass roles

- kind: guess; reader confidence: checked; checker: **confirmed**
- evidence: PipelineBuilder.ts:17-20 `const roleToShader = { 'pathtracer': ..., 'display': ... }`, then :30 `shader: roleToShader[pass.role] ?? \`${rendererId}-${pass.role}\``. buildUniforms :59 `compute: u.compute ?? ((params) => params[u.parameterPath] ?? u.default)`.
- why it matters: Small, but it is the kind of silent fallback the owner forbids: an unplanned role would bind to a shader that ShaderBuilder never builds, failing later in the engine rather than at compile time.
- suggestion (thought-through-not-checked): Throw on an unknown role, since only two passes exist and both are built here.
- pros/cons: Pro: fails loudly. Con: a future bake/denoise pass must then register its shader explicitly, which is arguably the point.
- checker note: PipelineBuilder.ts:30 falls back to `${rendererId}-${pass.role}`, and the planned pass role is typed as plain `string` (plan/types.ts:300), so the type system does not rule out the fallback. Only 'pathtracer' and 'display' are planned (Planner.ts:717, 731). The second piece of evidence, `params[u.parameterPath] ?? u.default` at :59, is not a guess: it reads the uniform's declared default. Drop it from the finding.

**Checker: missed by the reader**

- Planner.ts resolveEnvironment maps any environment type other than none, constant or image to 'procedural' with env.glsl possibly undefined, and Validator.ts has no check on environment.type. This is a silent guess under the owner's 'no guesses' rule, and it sits upstream of the fallback F11 points at.
- mintValueUniform's defaulted `color = 'rgb'` and optional `role`: the media coefficient and phase calls (materials.ts:221-227, 235) and the nested ctx.mint (values.ts:123) never pass them, even in spectral programs. Whether this matters depends on the Validator rejecting named spectrum kinds in media, which I did not check.
- components/ambient/README.md says only two places are Euclidean-only beyond the seam (the analytic media bodies and equiangular placement). Generate has more that are undeclared: the vec3 seam signatures, the similarity/quaternion placement ABI, normalize on normals, raw dot in emission cones, and environment_radiance(vec3 dir). That README needs correcting whatever F9's outcome.
- F1's live warning count differs from CLAUDE.md's Known open defects line: the reader measured 229 of 274, CLAUDE.md says 221 of 265. When F1 is addressed, update that line, and also the spectrumDiagnostics snapshot, which records this warning 3 times (tests/compiler/__snapshots__/spectrumDiagnostics.test.ts.snap:153, 1148, 1162).

**Reader questions for the owner**

- Is a full call-graph-derived linkage, where requires and provides are read off the emitted GLSL and unreachable generated blocks are dropped, acceptable in principle? Or do you prefer the declared provides/requires ledger, even though it is written by hand in three places per seam?
- Should seam-unused be promoted to a test assertion (zero across the suite) once light_query_medium is fixed, so drift fails CI instead of becoming background noise?
- Do you want the glslang test to link (`-l`)? It checked out on two sample shaders, and it would catch a seam that is declared in the interface header but never defined.
- For curved spaces: should the environment be modeled as a function on the space's ideal boundary or sphere of directions at a chart origin (H³, H²×R), with S³ having no environment? This decides the shape of the environment_radiance seam.
- Would you accept splitting intersection.ts (1728 lines) and materials.ts (954 lines, surface plus media) into smaller files with byte-identical output checked by npm run digest, as a pure-refactor batch?


## engine

The Engine (2,887 lines across 15 files, including a 16.7 KB base64 blue-noise tile) runs a CompiledRenderer without knowing what it computes. A CompiledRenderer holds GLSL program strings, a pipeline (framebuffers that can be screen, texture or double_buffer with MRT; fullscreen-triangle passes; post-frame swaps), and uniform bindings. Each binding is {uniform, parameter paths, type, compute closure}. Optional fields: source maps, UI metadata, export targets, and an ldrRecipe that re-runs the display pass on demand.

Each frame, Engine.renderFrame merges its builtins (engine.resolution, imageSize, sampleCount, resetSalt, pixelOffset, time) with the values the App pushed through setParameter. RenderExecutor then runs each pass: bind the output FBO, set the viewport to that buffer's size, upload uniforms through ParameterManager, bind the input textures to units 0..k in declaration order, and draw. Inputs are framebuffer refs from ResourceManager, or extern:<name> refs from the TextureRegistry, a plain name-to-texture store. Swaps follow the passes. Buffer refs are a small string language (base[_current|_previous][:N]) that the compiler serializes from structured data and the engine parses back. ParameterManager memoizes closures on their inputs and skips uploads that would not change a uniform. ResourceManager keeps one framebuffer set per loaded renderer.

In practice the compiler emits one pipeline shape: an MRT accumulation double buffer with one rgba32f attachment per picture, a display pass to the screen, and an rgba8 'ldr' scratch target. The environment bake is the only other shape: one fixed-size texture and one pass. Every pass and swap is validated before load by errors/compiler/validation.ts.

Blindness is real for scenes, materials and geometry. Nothing in the engine is Euclidean, so curved spaces are purely a compiler and GLSL matter. The leaks are at the environment and texture seam. The engine still calls the estimator's importance-table builder, passing chart and compensation. It decides the 'default' environment variant. It owns the hard-coded global texture 'blue_noise'. It also chooses sampler state (filter and wrap) that component GLSL silently relies on.

The machinery is somewhat heavier than its one real use needs:
- The buffer-ref grammar is parsed in 3–4 places.
- Three different objects hold an 'active renderer' pointer.
- Per-renderer accumulation is kept, but the App always clears it on switch.
- The program map is flat across renderers, which is why the shader-id prefix convention exists.
- drawBuffers is set twice.
- Every accumulation reset clears the closure memo, which defeats the recompute-on-change design (E7) during interaction.

docs/compiler-engine-contract.md is marked LOCKED but is out of date in about ten places. One matters: its 'precompile to JSON' production mode cannot work, because uniforms carry closures. That bears on the owner's goal of exporting standalone scene programs.

No WebGPU port is planned. WebGPU appears only as a 'future tracer' for the declared non-goals (BDPT, light tracing, ReSTIR) and as a separate device in the OIDN step-7 plan. The relevant WebGL2 limits:
- Data rides 2D textures 4096 wide, above the 2048 guaranteed floor, and the upload is unchecked.
- The 16-sampler floor is checked by the compiler.
- Sampler precision defaults to lowp.
- Uniform-array budgets are not checked.
- There is one fullscreen draw per frame (watchdog risk); the App-level TiledRenderer is the existing mitigation.

### ENG-1 — Every accumulation reset clears ParameterManager's closure memo, so each interactive change re-runs every uniform closure

- kind: complexity; reader confidence: checked; checker: **confirmed**
- evidence: Engine.ts:301-309 `clearAccumulation(){ ... this.resourceManager.clearAllBuffers(); this.parameterManager.clearCache(); }`; ParameterManager.ts:152-157 clearCache clears `uniformValueCache`, `inputSnapshots`, `computedValues`; App.ts:96-106 a parameter change with triggersReset leads to RenderCoordinator.resetAccumulation, which calls engine.clearAccumulation() (RenderCoordinator.ts:138-139). E7 intent (docs/impl-plan-engine-app.md:51-55): 'camera basis/CDF/majorant closures run on pose/slider/resize changes only'.
- why it matters: During a camera drag or slider drag, every frame resets, so every closure runs again: driven placements, light CDFs, materials, all of them. The memo only helps in steady accumulation, where nothing changes anyway. This is the 'hundreds of driven objects' case E7 targeted. The memo compares input snapshots by copy, and GL uniform state lives in the program and survives a reset, so the clear protects nothing visible in the engine code.
- suggestion (thought-through-not-checked): Drop the clearCache() call from Engine.clearAccumulation. Keep clearCache for selectRenderer (initialize already clears) and context loss (reset).
- pros/cons: Pro: one line removed; E7 then works as designed during interaction. Con: if any of the ~15 compute closures (Planner.ts:865-866, values.ts:146/163, camera.ts:46/99/122, lighting.ts:66/176/182, materials.ts:367/810, environment.ts:45, blackbody.ts:119) reads state other than its declared parameters, it would now stay stale until its parameters change. They need a purity audit first, and the performance gain has not been measured.
- checker note: Read Engine.ts:301-309, ParameterManager.ts:36-157 and the five closures' bodies. clearAccumulation calls clearCache, which empties inputSnapshots and computedValues. Every reset (RenderCoordinator.ts:139, RendererManager.ts:248/278, App.ts:718) therefore re-runs every closure and re-uploads every uniform. Under the E7 design, a camera drag would re-run only the closures whose inputs changed. The closures I read (lighting.ts:66/176/182, environment.ts:45, Planner.ts:865) read only their params argument and plan data captured at compile time. The measurements the App sets (env.totalWeight, env.size) arrive as engine parameters, so the memo sees them change. Nothing outside ParameterManager writes these uniforms (the executor sets only sampler units). renderView overrides go through the same memo and are seen as a change on the next frame. One small rewording: without the clear, the memo would also help during interaction, which is the point of the finding, so 'only helps in steady accumulation' describes today's behavior, not a limit of the memo. A purity audit of all closures is still worth doing, as the finding says.

### ENG-2 — Engine still runs environment-estimator math and decides the 'default' table variant, a fact also encoded in the App

- kind: guess; reader confidence: checked; checker: **partly**
- evidence: loaders/build-environment-sampler.ts:9 `import { buildEnvImportanceTable } from '../../components/env/importance.js'`; Engine.ts:450-460 `registerEnvironmentTable(..., opts: { names; chart?; compensation? })`; HDREnvironmentLoader.ts:120-127 calls buildEnvironmentSampler with no opts, so importance.ts:33-35 defaults apply (`chart ?? 'equirect'`, `compensation ?? false`, `blur ?? true`); App.ts:233-234 `if (suffix === '') continue; // default already built by the loader`, with envVariantSuffix at compiler/generate/features/environment.ts:50-52. docs/impl-plan-engine-app.md:44-49 (E6): 'estimator math leaves the engine… the engine loader keeps only texture upload/registration'.
- why it matters: Two answers to one fact. Which variant is the default is set by the defaults in importance.ts and separately by App's empty-suffix rule; if either changes, the App skips a table nobody built, or builds one twice. The engine also always builds the equirect, uncompensated tables, even when no strategy reads them (for example, all strategies octahedral). That is data nothing reads. And the engine is not blind to the estimator here, which contradicts E6 and the CLAUDE.md engine rule.
- suggestion (thought-through-not-checked): Move HDR fetch/parse and the importance-table build to the App, or to a components-side helper the App calls. The App computes the CDF arrays for exactly the variants envVariants() lists, and registers each array through a generic engine call like registerDataTexture with a format. The engine keeps only texture upload.
- pros/cons: Pro: the engine becomes fully blind; the 'default variant' fact disappears; only variants that are read get built; HDREnvironmentLoader and build-environment-sampler.ts (204 lines) leave the engine. Con: touches the env loading path, which needs the env witnesses (GPU-verified); App.ts grows slightly; tests/engine/buildEnvironmentSampler.test.ts would move.
- checker note: Confirmed: the engine calls buildEnvImportanceTable (build-environment-sampler.ts:9/30). The default variant is fixed in two places: the defaults in importance.ts:33-35 and App.ts:233 `if (suffix === '') continue`. Correction 1: E6 did move the math. It lives in components/env/importance.ts, and the engine only calls it, so the engine runs it but no longer owns it. Correction 2: the default table is not 'data nothing reads'. Its totalWeight is the only value the App ever writes to env.totalWeight (App.ts:227), and the derived u_envSelectProb reads that parameter for every chart and compensation variant (lighting.ts:504-511). Only its GPU CDF textures can go unread, for example when every strategy is octahedral. If the table builds move to the App, totalWeight has to be taken per variant, which leads to the defect listed under 'missed'.

### ENG-3 — Sampler state (filter/wrap) of extern textures is decided in the engine but relied on by component GLSL; the contract cannot declare it

- kind: duplication; reader confidence: checked; checker: **partly**
- evidence: utils/TextureFactory.ts:84-91 env map: `const filterMode = linearExt ? LINEAR : NEAREST` with `WRAP_S REPEAT`; components/env/equirect/equirect_map.glsl comment 'The radiance lookup would survive an unwrapped u: the map texture repeats horizontally'; compiler/generate/features/environment.ts:162 `texture(u_envMap, equirect_uv(dir))`; loaders/blueNoise.ts:22-25 NEAREST+REPEAT relied on by glsl/shared/noise.glsl:9 `texture(u_blueNoise, fragCoord * (1.0 / 64.0))`.
- why it matters: There are two problems. First, the image environment's radiance depends on the device: bilinear when OES_texture_float_linear exists, nearest otherwise. That is a hardware-dependent fallback, which conflicts with the owner's no-guesses rule and with bit-reproducible stamps. Second, a fact the GLSL needs (repeat wrap, nearest) lives in a different layer with nothing linking them. An `extern:` ref is just a name.
- suggestion (thought-through-not-checked): Either (a) have the texture's declaring feature state its sampling (filter, wrap) in the PlannedTexture or asset fact, which the uploader applies and the validator checks, or (b) make the GLSL independent of sampler state by using texelFetch with explicit wrap and interpolation (the CDF path already uses texelFetch). Option (b) for the env map would be a deliberate decision about filtering, made in one place.
- pros/cons: Pro: removes a cross-layer implicit fact and device-dependent output. Con: (a) adds a field to the locked contract's texture refs or the App upload path; (b) changes env-map GLSL and needs env witnesses; manual bilinear in GLSL costs four fetches.
- checker note: Confirmed: the env map is filtered LINEAR only when OES_texture_float_linear exists, otherwise NEAREST (TextureFactory.ts:84-90), so the image environment's converged radiance depends on the device. The blue-noise tile needs REPEAT, because fragCoord/64 runs past 1 (noise.glsl:9). Overstated: for the env map the GLSL does not depend on REPEAT for addressing. equirect_uv wraps u with fract() (equirect_map.glsl), and the comment the finding quotes says the wrap is required for exactly that reason. REPEAT only changes the bilinear blend at the φ seam texel when LINEAR is on. Also, noise.glsl is in glsl/shared (compiler-owned), not in component GLSL. The device-dependent filter is the real issue.

### ENG-4 — Buffer-reference string grammar is serialized by the compiler and parsed again in 3–4 places

- kind: duplication; reader confidence: checked; checker: **confirmed**
- evidence: compiler/plan/pictures.ts:45-52 builds `{bufferId, attachment}` then `bufferRef()` stringifies it; parsers: engine/ResourceManager.ts:648-669 `parseResourceId`; errors/compiler/validation.ts:320-347 `parseBufferRef` (same algorithm, separate copy); engine/RenderExecutor.ts:444-456 `computeDrawBuffers` parses ':N' again; validation.ts:139 `ref.replace(/:\d+$/, '')` plus endsWith('_current').
- why it matters: CLAUDE.md asks for one answer per fact. Here three copies decode one string format, and a fourth piece of code produces it. A grammar change, such as a buffer id that legitimately contains '_current', must be made in all of them. The naming rule also makes `_current`/`_previous` reserved words (a CLAUDE.md convention).
- suggestion (thought-through-not-checked): Minimum: have validation.ts import parseResourceId (or the reverse), so one parser exists. Larger option (touches the LOCKED types): structured refs `{buffer, which?: 'current'|'previous', attachment?}` in RenderPass inputs/outputs and ExportTarget, which would remove the parsers and the reserved suffixes.
- pros/cons: Pro (minimum): deletes ~30 lines and a duplicate algorithm with no contract change. Pro (larger): no string language, no reserved suffixes. Con (larger): a locked-contract change touching PipelineBuilder, pictures.ts, the validator, ResourceManager and tests; generated-pipeline snapshots change.
- checker note: parseResourceId (ResourceManager.ts:648-669) and parseBufferRef (validation.ts:320-347) implement the same algorithm. computeDrawBuffers (RenderExecutor.ts:444-456) and validation.ts:139 (`ref.replace(/:\d+$/, '')` plus endsWith) parse the string again. pictures.ts:45-52 and Planner.ts:722-727 build it, the latter with an inline template string as well as bufferRef. So there are two producers and four parsers.

### ENG-5 — Per-renderer framebuffers and sample counts are retained for 'instant switching', but every switch clears accumulation

- kind: complexity; reader confidence: checked; checker: **confirmed**
- evidence: Contract §6: 'Each renderer maintains its own accumulation state. Switching between renderers is instant.' ResourceManager.ts:51 `renderers: Map<string, Map<string, FramebufferResource>>`; Engine.ts:38 `sampleCounts = new Map`; RendererManager.ts:265-278 selectRenderer → engine.selectRenderer → parameterStore.resendAll() → `this.engine.clearAccumulation()`; RendererManager.ts:245-248 same after recompile; Engine.ts:326-335 resize zeroes all counts.
- why it matters: Every loaded renderer keeps full-resolution rgba32f MRT double buffers alive. That is pictures × 2 × W×H×16 bytes per renderer, around 66 MB per picture at 1080p. Its preserved accumulation is never shown because switching clears it. Three objects also track the active renderer (Engine.activeRendererId, ResourceManager.activeRenderer, RendererManager.activeRendererId), and there are two renderer maps.
- suggestion (thought-through-not-checked): Keep compiled programs for all loaded renderers (that is the costly, instant part) but allocate framebuffers only for the selected renderer, or share them when the pipeline's framebuffer configs are equal. Keep one active pointer in Engine.
- pros/cons: Pro: memory scales with one renderer; fewer maps and pointers; matches actual App behavior. Con: changes contract §6 semantics, which needs owner approval; reallocation costs a few ms on switch; the bake renderer's load/select/unload dance in App.ts:329-350 must still work; context-restore code changes.
- checker note: ResourceManager keeps a framebuffer map per renderer, created at load. Both RendererManager switch paths (selectRenderer :265-278 and recompile :245-248) call engine.clearAccumulation right after selecting, and resize zeroes every count. The kept accumulation is never shown. The 66 MB figure (1920×1080×16 B×2) checks out. Changing this means changing contract §6, so the owner decides.

### ENG-6 — Program map is flat across renderers, forcing the 'prefix shader ids with renderer id' convention

- kind: extension-friction; reader confidence: checked; checker: **confirmed**
- evidence: RenderExecutor.ts:34 `private programs: Map<string, WebGLProgram>`; loadShaders RenderExecutor.ts:80-83 overwrites an existing id (deleting the old program); CLAUDE.md: 'Shader ids are prefixed with the renderer id… the engine's program map is flat and collisions silently overwrite'; ResourceManager is already namespaced per renderer (ResourceManager.ts:51).
- why it matters: Every renderer producer (PipelineBuilder.ts:18-21, EnvironmentBake.ts:35) must remember the convention, or another renderer's program is silently replaced. The engine already knows the renderer id at load.
- suggestion (thought-through-not-checked): Key programs by (rendererId, shaderId) inside the engine, e.g. Map<rendererId, Map<shaderId, program>>, and look them up through the active renderer, as ResourceManager does. The contract types do not change.
- pros/cons: Pro: removes a convention and a silent-overwrite class; symmetric with ResourceManager. Con: a small engine-internal change; ParameterManager.initialize and selectRenderer's program lookup change accordingly; existing prefixed ids keep working.
- checker note: RenderExecutor.programs is one flat Map. loadShaders deletes and replaces any program with the same id (lines 80-83). The finding misses one point: unloadShaders deletes by id, so unloading one renderer would also delete a colliding program that belongs to another renderer still loaded. The fix stays engine-internal.

### ENG-7 — MRT drawBuffers state is set at FBO creation and again every pass from a cache with a fallback; the per-pass path would be invalid for non-contiguous attachments

- kind: complexity; reader confidence: inferred; checker: **confirmed**
- evidence: ResourceManager.ts:516-520 `if (isMRT) { gl.drawBuffers(textures.map((_, i) => COLOR_ATTACHMENT0 + i)); }` (drawBuffers is per-framebuffer-object state); RenderExecutor.ts:40, 132-141, 181-189 (drawBuffersCache + 'Fallback: compute on the fly'); computeDrawBuffers RenderExecutor.ts:444-456 sorts and maps attachments, so outputs [':0', ':2'] → [ATT0, ATT2].
- why it matters: About 30 lines (cache, fallback, helper, test file) re-issue state the FBO already holds, because the compiler always writes every attachment in order (Planner.ts:722-727). If a future pass wrote a subset, WebGL2 requires entry i to be COLOR_ATTACHMENTi or NONE, so [ATT0, ATT2] would be an INVALID_OPERATION with no visible error. That WebGL2 rule is from memory of the spec, not checked against it here.
- suggestion (thought-through-not-checked): Rely on the FBO's creation-time drawBuffers and remove the per-pass cache. If subset writes are ever needed, compute [ATT0, NONE, ATT2]-style arrays at that time.
- pros/cons: Pro: deletes the cache, fallback and helper; one place sets MRT state. Con: tests/engine/drawBuffers.test.ts goes away; any future pass that writes a subset of an MRT buffer needs the NONE-padded form.
- checker note: _createFramebuffer sets drawBuffers([ATT0..ATTn-1]) on every MRT FBO (ResourceManager.ts:516-520). Nothing else changes FBO draw state (a complete grep of drawBuffers/readBuffer in src finds only these sites and the executor cache). The planner writes every attachment in order (Planner.ts:722-727). The GLES 3.0 / WebGL2 rule (bufs[i] must be COLOR_ATTACHMENTi or NONE for an FBO, otherwise INVALID_OPERATION) is correct, so the 'inferred' part holds.

### ENG-8 — Uniform upload falls back to guessing the GL call from the value's shape

- kind: guess; reader confidence: checked; checker: **confirmed**
- evidence: utils/shader-uniform-utils.ts:18-22 `if (type) setUniformTyped(...) else setUniformInferred(...)`; :84-86 unknown type → `console.warn` then `setUniformInferred`; :99-106 infers by array length (3 → uniform3fv, 9 → mat3, 16 → mat4). The contract makes `type` required (compiler/types.ts:796).
- why it matters: The owner's rule is that the system never guesses. A `float[]` of length 3, 4, 9 or 16 reaching the inferred path would upload as vec3/vec4/mat3/mat4. Other lengths silently upload nothing. The path is reachable only through a type outside the union, but it hides a contract violation instead of reporting it.
- suggestion (checked): Make `type` required in setUniformValue and throw on an unknown type; delete setUniformInferred.
- pros/cons: Pro: ~25 lines removed; a contract violation becomes a named error. Con: none found; check tests/engine/shaderUniformUtils.test.ts for calls without a type.
- checker note: shader-uniform-utils.ts:18-22 and :84-86 fall back to setUniformInferred. UniformBinding.type is required (compiler/types.ts:796), and the only caller (ParameterManager.ts:142) always passes it. tests/engine/shaderUniformUtils.test.ts imports only uniformValuesEqual, never setUniformValue. That file does test untyped equality (lines 34, 37), so valuesEqualUntyped, the matching untyped path in uniformValuesEqual, would go too, along with those two expectations.

### ENG-9 — docs/compiler-engine-contract.md ('LOCKED') no longer describes the contract the code implements

- kind: doc-code-mismatch; reader confidence: checked; checker: **partly**
- evidence: Doc §1 `sourceMap: SourceMap` vs compiler/types.ts:1100 `sourceMaps?: Map<string, SourceMap>`; doc §2 FramebufferConfig `'depth'`, `multisampled?`, RenderPass `inputs.uniforms?`, `output: string`. Code (types.ts:851-975) has none of the first three, has `output: string | string[]`, and has `size?` (T4, recorded only in a code comment, types.ts:869-874). Doc §4 `type: 'accumulation'` is invalid. Doc §8 'the Compiler does NOT currently extract or forward this metadata' vs `CompiledRenderer.parameters`. Doc §8 'Renderer-specific parameters… scoped to renderer ID' vs Engine.ts:44 one global `customParameters`. Doc §9 'Exactly one screen framebuffer' vs validation.ts:85-96 (zero allowed). Doc §6 sketch methods (prepareFrame, finalizeFrame, setupFramebuffers) do not exist. Engine builtins, `extern:` refs, ExportTarget and `float[]` are not described.
- why it matters: It is listed in CLAUDE.md as the authority for the 'locked' compiler↔engine types, yet someone reading it to understand the seam gets a 2025 sketch. The rule 'where code and doc disagree, the code runs' means every reader must re-derive the real contract from types.ts.
- suggestion (thought-through-not-checked): Rewrite the doc as a short description of the current types (or point to compiler/types.ts:766-1150 as the definition), listing the extensions with their rationale. Archive the 2025 design discussion (Project, Dev/Prod split, accumulation examples).
- pros/cons: Pro: one accurate source for the seam; shorter. Con: doc work only; needs owner sign-off because the doc is marked LOCKED.
- checker note: Most mismatches confirmed: sourceMap vs sourceMaps (:78), 'depth' and multisampled (:254-268), inputs.uniforms (:303), output: string (:307), type 'accumulation' (:696), the 'NOT currently extract' note (:1009), scoping (:1011), 'Exactly one screen' (:1033) against validation.ts:84-96, and prepareFrame/finalizeFrame/setupFramebuffers (:832-858). Overstated: the doc is not purely a 2025 sketch. It records the E5 ldrRecipe extension (:92-111) and the Sep 29 ExportTarget.picture extension (:115-131). It does not describe the base ExportTarget, extern: refs, engine builtins, float[] or size?.

### ENG-10 — The contract's 'pre-compile to static data' production mode cannot work, because CompiledRenderer carries closures

- kind: doc-code-mismatch; reader confidence: checked; checker: **confirmed**
- evidence: docs/compiler-engine-contract.md §11 `fs.writeFileSync(... JSON.stringify(compiled))` and §12 'Prod: Pre-compile, load static data'; compiler/types.ts:793-798 `compute: (params: Record<string, any>) => any`; 15 compute closures in src/compiler and src/components (Planner.ts:865-866, camera.ts:46/99/122, lighting.ts:66/176/182, materials.ts:367/810, values.ts:146/163, environment.ts:45, blackbody.ts:119, PipelineBuilder.ts:61); `shaders: Map` (types.ts:1094).
- why it matters: The owner's stated goal (docs/claude-app-decisions.md) is to 'export independent scene programs for the website and posterity'. A CompiledRenderer cannot be frozen to data, so an exported scene must ship the compiler, or at least the planner code behind the closures. That bears directly on how the App and export get designed.
- suggestion (thought-through-not-checked): Decide explicitly with the owner. Either (a) exported programs bundle the compiler (simplest; the closures stay), or (b) closures become declarative (named transforms from a small registry, plus data), which would make CompiledRenderer serializable. The doc should state whichever is chosen.
- pros/cons: (a) Pro: no code change; con: larger export bundles that carry compiler versions. (b) Pro: frozen, versioned programs; con: substantial redesign of every uniform-producing feature, possibly over-engineering for one user.
- checker note: Doc §11-12 (:1210, :1264) describe serializing the compiled output. The CompiledRenderer carries compute closures (types.ts:797, plus the 15 sites I found by grep) and Maps. docs/claude-app-decisions.md:18 states the export goal and adds 'Each keeps its own code version', which leans toward option (a). That is my reading of the doc, not a decision.

### ENG-11 — Global 'blue_noise' texture: name hardcoded in the engine and the planner, size repeated in GLSL; a different provisioning route from other built-in assets

- kind: duplication; reader confidence: checked; checker: **partly**
- evidence: engine/loaders/blueNoise.ts:28 `registry.register('blue_noise', tex)`; compiler/plan/Planner.ts:737 `'u_blueNoise': 'extern:blue_noise'`; glsl/shared/noise.glsl:9 `fragCoord * (1.0 / 64.0)   // 64 = BLUE_NOISE_SIZE`; app/BuiltinAssets.ts:9-31 provisions other component assets on demand by scanning `extern:` refs (RGBA32F only); loaders/blueNoise.ts:3 comment says the 'blue-noise sampler' also binds it, but only the display dither does (grep of src/components and src/compiler finds only Planner and ShaderBuilder).
- why it matters: It is the one place the engine knows a compiler-side resource name, so the blindness rule is broken here. Built-in textures have two routes: engine-global and App BuiltinAssets. The tile size is stated twice.
- suggestion (thought-through-not-checked): Treat the blue-noise tile as a BuiltinAsset declared by components, with its format and sampling as facts, so the App provisions it like the spectral tables. Use textureSize()/texelFetch in noise.glsl instead of the literal 64.
- pros/cons: Pro: the engine becomes fully name-blind; one provisioning route; one size fact. Con: BuiltinAsset must learn format (RGB8) and wrap (REPEAT), which ties in with ENG-3; context-restore must re-upload it (BuiltinAssets.upload already runs on restore, App.ts:279); generated-shader snapshot changes for noise.glsl.
- checker note: The facts are right. The engine registers 'blue_noise' (loaders/blueNoise.ts:28), Planner.ts:737 hard-codes 'extern:blue_noise', and the size 64 appears in noise.glsl as well as BLUE_NOISE_SIZE. The finding misses that keeping it outside the data rail, as a loader-owned image, was a documented decision (docs/fable-data-rail.md:71-73). docs/claude-spectral-implementation-plan.md:364 calls blue noise 'already an instance' of a declared built-in asset, which matches the suggested direction. The 'blue-noise sampler' that the blueNoise.ts:3 comment mentions is deferred work (docs/deferred-owen-sobol-sampler.md Phase 2, Heitz & Belcour). It is not a mistake, but the comment describes deferred work as built. The tile is also not a component: noise.glsl is in glsl/shared, so 'declared by components' would need a home in compiler/shared.

### ENG-12 — Contract scaffolding not yet emitted: 'loop' passes, 'rotate' swaps, clearBeforeRender, rgba16f/r32f, samplerCube, engine.time

- kind: in-progress; reader confidence: checked; checker: **confirmed**
- evidence: PipelineBuilder.ts:39 always `execution: { type: 'once' }`; RenderExecutor.ts:239-243 loop re-runs executePass with identical parameters, no swap, no sampleCount bump; ResourceManager.ts:190-193 `throw new Error('Rotate swap not yet implemented')` (rejected at load, validation.ts:218); RenderExecutor.ts:399 always binds TEXTURE_2D (so 'samplerCube', types.ts:785, would need executor work); Engine.ts:241-244 'engine.time has zero shader consumers… kept for the deferred motion-blur seed field'.
- why it matters: These are deliberate seams (multi-sample frames, temporal history, motion blur), so keep them. Two design notes for when they get built. (1) As executed, a 'loop' pass on the accumulation buffer would overwrite the same output N times from the same previous buffer, so 'multiple samples per frame' needs a per-iteration swap and sampleCount, or an in-shader loop. (2) engine.time is wall-clock time since engine construction, which is not reproducible under a pinned salt; motion blur needs a per-sample shutter time instead.
- suggestion (thought-through-not-checked): Keep as is. Record the two notes in the contract doc next to 'loop' and engine.time, so whoever builds them does not assume they already work.
- pros/cons: Pro: avoids building on a wrong assumption later. Con: none (doc note only).
- checker note: Confirmed. 'loop' re-runs executePass with the same parameters and no swap (RenderExecutor.ts:239-243). 'rotate' throws (ResourceManager.ts:190-193) and the validator rejects it at load (validation.ts:212-219). Textures are bound only as TEXTURE_2D (:399). engine.time is performance.now() minus the start time, with a comment marking it reserved for motion blur. A complete grep finds nothing in compiler/components that emits rgba16f, r32f or samplerCube. Correctly kept as in-progress scaffolding.

### ENG-13 — WebGL2 limits that matter for planned work, and WebGPU status

- kind: research-note; reader confidence: inferred; checker: **partly**
- evidence: components/data/pack.ts:12 `DATA_TEX_WIDTH = 4096` (WebGL2 MAX_TEXTURE_SIZE floor is 2048); Engine.registerDataTexture (Engine.ts:438-448) and TextureFactory do no size or gl.getError check (the only getError is errors/resources/validation.ts:175, on the HDR path); Generator.ts:41-47 checks the 16-sampler floor; ShaderBuilder.ts:224 emits highp only for usampler2D or a texture that asks, so RGBA32F data defaults to lowp sampler2D in fragment shaders; lighting.ts:169-183 `float[]` uniform arrays of length n lights, and no MAX_FRAGMENT_UNIFORM_VECTORS check was found (grep 'UNIFORM_VECTORS' in src/compiler is empty); fable-compiler-contracts.md:33 and impl-plan-interaction-reshape.md:85 reserve BDPT/light tracing/ReSTIR for 'a future WebGPU tracer'; docs/claude-outputs-step7-plan.md adds a separate WebGPU device for OIDN; fable-webgpu-handoff.md §10 says 'Data tables are baked into GLSL… runtime-sized scene data isn't a concept here', which the data rail has since changed.
- why it matters: Curved-space marching and large meshes increase per-pixel work and data size. On a device with a 2048 texture limit, an over-limit data texture fails to upload with no reported error and reads as zeros. The precision default is a known open item. Uniform-array budgets could hit the 224-vector floor with many lights on the uniform-CDF path. No WebGPU port is planned. The engine's small surface (about 35 methods used by the App) and data-only pipeline would allow a sibling backend, but GLSL strings and per-name uniform closures would need WGSL and uniform-buffer packing.
- suggestion (thought-through-not-checked): Have the engine compare data-texture sizes against MAX_TEXTURE_SIZE at upload and throw a named error, the same way the HDR path does. Leave the rest as notes for the precision audit and any future backend decision.
- pros/cons: Pro: turns a silent black-geometry failure into a named error, one comparison. Con: none significant. It is a declared-fact check, not speculative hardening, but it does add a line the owner may consider unnecessary on desktop GPUs.
- checker note: Checked: DATA_TEX_WIDTH = 4096 (pack.ts:12). registerDataTexture runs no size check or getError (the only checks are on the HDR path, errors/resources/validation.ts:175/184). The fragment preamble sets precision highp float but not sampler precision, so float sampler2D defaults to lowp in ES 3.00 (ShaderBuilder.ts:179, :224). The two float[] arrays have length n lights. A complete grep finds no UNIFORM_VECTORS check. Correction: the width is a fixed 4096, so on a device with a 2048 limit every data texture fails, not only oversized ones. The uniform-budget figure is an estimate.

### ENG-14 — Small redundancies inside the per-pass path and texture factory

- kind: complexity; reader confidence: checked; checker: **confirmed**
- evidence: useProgram issued twice per pass (RenderExecutor.ts:197 and ParameterManager.ts:92); two uniform-location caches (RenderExecutor.ts:44 WeakMap for samplers, ParameterManager.ts:27 for bindings); ParameterManager.parameterToBindings and updateStats are maintained but read only by getParameterBindings/getCacheStats, which have no callers outside the engine; TextureFactory.ts has four near-identical create functions, and its constructor (l.15-17) requires EXT_color_buffer_float, which sampling float textures does not need; GPUProfiler.update() is a no-op 'API compat' (GPUProfiler.ts:81) called every frame (RenderExecutor.ts:225-227); ResourceManager.loadRenderer 'Reusing resources' branch (l.83-86) is unreachable because Engine.loadRenderer unloads first.
- why it matters: Each item is small, but together they add state and lines a single reader has to hold in mind. None is a correctness bug.
- suggestion (thought-through-not-checked): Fold the duplicate useProgram and location caches into one place (the executor), and collapse TextureFactory into one create(format, data, w, h, sampling) table. Keep the debug accessors (cheap, possibly useful) unless the owner wants them gone.
- pros/cons: Pro: fewer maps and paths in the hot loop; a shorter factory. Con: low payoff by itself; best done together with ENG-3/ENG-11 if sampling becomes a declared fact.
- checker note: Confirmed. useProgram runs at RenderExecutor.ts:197 and again at ParameterManager.ts:92. GPUProfiler.update is an empty method called every frame. parameterToBindings has no reader outside ParameterManager (complete grep). The TextureFactory constructor requires EXT_color_buffer_float. The 'Reusing resources' branch in ResourceManager.loadRenderer cannot be reached: Engine.loadRenderer unloads first, and context restore clears both maps (ResourceManager.handleContextLoss :240-243; Engine._handleContextRestored :499-501) before reloading.

### ENG-15 — History tags and stale comments are pervasive in engine files

- kind: doc-code-mismatch; reader confidence: checked; checker: **confirmed**
- evidence: Engine.ts:52-56 '§2.11', Engine.ts:331 '(fable-review Engine #4)', Engine.ts:416 'E6', types.ts:11 '(E11: was a stale two-state copy…)', TextureRegistry.ts:10-11 '(audit F1/F10; deleted in env-as-light T1)', ParameterManager.ts:36 'E7', shader-uniform-utils.ts:38 '(cacheUniformLocations deleted — E11…)'; HDREnvironmentLoader.ts:41-45 and 64-65 name fixed textures 'env_map'/'env_cdf_cond' and a registry 'bind() method', but names are now caller-supplied and no bind() exists; Engine.ts:426-432 is an orphaned doc comment ('Register a tabulated environment…') sitting above registerDataTexture.
- why it matters: CLAUDE.md forbids history in comments and asks that comments explain the present. In the engine most files carry such tags, and a few comments now describe code that no longer exists, which misleads a reader.
- suggestion (checked): When the engine is next touched, rewrite these comments to the present-tense standard, and move the orphaned comment onto registerEnvironmentTable.
- pros/cons: Pro: comments match code. Con: comment-only churn; best bundled with a real change rather than done alone.
- checker note: Seen directly: Engine.ts '§2.11' (:52-55), '(fable-review Engine #4)' (:331), 'E6' (:416), the orphaned 'Register a tabulated environment…' doc comment above registerDataTexture (:426-431), and the HDREnvironmentLoader header that names fixed 'env_map'/'env_cdf_*' textures and a 'bind() method' (:41-45, :59-65), although callers now supply the names. Also blueNoise.ts:3 says the 'blue-noise sampler' binds the tile; that sampler is deferred (see ENG-11).

**Checker: missed by the reader**

- Checked by reading: env.totalWeight, the input to the derived u_envSelectProb (lighting.ts:496-511, deps at :521-531), comes only from the default table, equirect and uncompensated (App.ts:227). (1) With an octahedral image environment, lighting.ts:511 computes meanL = total/(w·h), with w and h set to env.sizeOct = octaN². That formula assumes the octahedral table's own total (w = 1), but it receives the equirect Σ Y·sinθ. For a W×H map, the mean comes out 2WH/(π·octaN²) times too large; this is my arithmetic, not a measurement. (2) Compensated variants also get the uncompensated mass, although importance.ts:10-12 says this parameter is 'the COMPENSATED mass, deliberately'. (3) Procedural environments never set env.totalWeight: the App logs the totalWeight returned at App.ts:342-346 and discards it. The code then falls back to meanL = 1.0, a guess the no-guesses rule forbids. All three change only the env-vs-lights selection probability, which the sampler and the pdf share, so they cost variance, not bias. This is not GPU-verified.
- ENG-6 extension, checked: RenderExecutor.unloadShaders deletes programs by id from the same flat map. If two renderers' ids collide, unloading one also deletes the program the other still uses.

**Reader questions for the owner**

- Should loaded-but-inactive renderers keep their own accumulation buffers? Contract §6 promises this, but the App always clears accumulation on a switch (RendererManager.ts:270-278), so today it only costs memory.
- For exporting standalone scene programs, is it acceptable for the export to bundle the compiler? CompiledRenderer cannot be frozen to JSON, because uniforms carry closures. Or do you want frozen, data-only programs?
- Should HDR parsing and environment importance-table building move out of the engine into the App/components, leaving the engine only texture upload, as E6 intended?
- Should the image environment map be bilinear-filtered on every device, nearest everywhere, or filtered in GLSL? Today it is bilinear only when OES_texture_float_linear exists, otherwise nearest.
- docs/compiler-engine-contract.md is marked LOCKED but describes a 2025 sketch. May it be rewritten to describe the current types, with the old design discussion archived?
- Is a WebGPU backend ever in scope for this repository, or only as a separate future tracer (and as the OIDN denoise device)?


## geometry-accel

Objects describe shapes. Each shape is one folder: a GLSL file with its signed field `<type>_sdf`, plus `<type>_intersect/_normal/_interval/_uv` when a closed form exists, and a TS descriptor of facts (param rows with a geometric `kind`, similarityClosed, thin, marchBound, stepBudget, refine, bounds, canonicalize, fold). The registry in geometry/index.ts (518 lines) generates the GLSL struct and constructor, the march loop (sign-tracked, with an optional refine step), and the 4-tap gradient normal from that one field. Scene-local fields come in through defineSDF, which writes into the same registry when the scene module loads.

compiler/generate/features/intersection.ts (1728 lines, the largest file in the area) emits scene_intersect, scene_intersect_any and scene_region_at (containment: the innermost signed distance wins), plus material_of and ior_of. The work is a matrix:
- three geometry classes: closed-form or marched primitive, triangle mesh, instanced batch
- three dispatch regimes: unrolled per-object arms; per-batch TLAS (or linear, or CWBVH); a scene "table" of typed records under one scene TLAS, with an unrolled residual for driven or unbounded objects
- three queries per cell: nearest, any-hit, containment

After the nearest hit, one probe along `hit.ng` at EPS_INTERFACE classifies region_from and region_to.

Placement is a Euclidean similarity, applied four ways:
- constant placements fold into the params of similarity-closed shapes
- otherwise a mat3 rigid wrapper is emitted
- driven placements use the two-vec4 rigid-frame ABI (placement.glsl), with params multiplied by s so t stays a world distance
- meshes divide the ray by s into an unscaled BLAS frame

Meshes are a binned-SAH BVH (2 texels/node) with a Möller–Trumbore leaf; closed meshes get containment. Instances use a per-batch TLAS over world AABBs, with params-tier records (one texel) or frame-tier records (two texels). The data rail has six RGBA32F channels plus an integer CWBVH channel. Its one layout function, planDataLayout, runs once in Planner.placeScene, and the region bases are baked into the GLSL as literals.

The core contract: Point and Direction are #defined as vec3. Ray has no interval. Hit carries ng, a positional uncertainty `eps` (fp-relative for analytic and triangle hits, MARCH_CLEARANCE for marched hits) and `element`. ray_spawn offsets along ng through ambient_geodesic. MAX_DIST is an absolute far clip of 1000.

The engineering is careful and heavily documented. The size comes from the 3×3×3 arm matrix and from several parallel implementations of one fact: five placement-lowering functions, six copies of BVH node decoding, epsilon constants kept in agreement only by a test, and bound fields written twice.

For curved spaces, the `ambient_*` seam is used at hit points, spawning and region probes. Everything below that is Euclidean: the generated march itself, closed-form primitives, local hit points, the AABB/BVH/triangle tests, placement, MAX_DIST, fp_uncertainty, and the side test and `wo`, which use the ray's starting direction rather than its arrival direction. The docs claim the opposite: they say the march loop and every point along a ray follow from swapping the ambient file.

### GA-1 — Generated march and local hit points step along straight lines instead of calling ambient_geodesic

- kind: euclidean-assumption; reader confidence: checked; checker: **confirmed**
- evidence: src/components/geometry/index.ts:234 `const f = (at) => `${d.type}_sdf(ray.origin + ${at} * ray.direction, s)``; intersection.ts:559 `const lp = `${rayRef}.origin + t * ${rayRef}.direction``; same at 763-765, 1052-1053, 1062, 1343. Hit points do use the seam: intersection.ts:707 `hit.p = ambient_geodesic(ray.origin, ray.direction, t)`.
- why it matters: The SDF marcher is the planned first curved-space target (claude-improvements Part 6: 'restrict the first scenes to SDF geometry'). With a vec4 hyperboloid Point, these samples leave the manifold. Swapping ambient/euclidean.glsl alone will not move the march.
- suggestion (thought-through-not-checked): Emit `ambient_geodesic(ray.origin, ray.direction, X)` in emitSdfIntersect, emitSdfNormal's caller and the local-point expressions. In Euclidean space it inlines to the same arithmetic, so the digest should differ only in text.
- pros/cons: Pro: makes the documented swappability claim true for marching, and costs nothing in flat space. Con: changes generated shader text (a digest diff to review). In the local rigid frame of a curved space a 'local ray' has no meaning, so placed arms would also need the structure-group placement first.
- checker note: geometry/index.ts:234 `${d.type}_sdf(ray.origin + ${at} * ray.direction, s)` and the straight-line local-point expressions at intersection.ts:559, 763, 765, 1052-1053, 1062, 1343 are all there. Hit points do use ambient_geodesic (707, 904, 1023). The docs already say this is curved-space follow-up work: trace-loop-contract.md:147-148 calls 'the straight-ray march itself' a follow-up, and reference-implementations §10 says 'the SDF primitives must also be hyperbolic-distance functions, the real work of an H³ backend'. So this is a known gap, not a hidden one.

### GA-2 — Side test and wo use the ray's starting direction, not its direction on arrival

- kind: euclidean-assumption; reader confidence: checked; checker: **confirmed**
- evidence: intersection.ts:1694 `if (ambient_dot(ray.direction, hit.ng, hit.p) < 0.0)` compares the seed direction (a tangent at the origin) with ng at hit.p. components/transport/integrators/pt/pt.ts:420 `Direction wo = -s.ray.direction;`. Hit has no arrival-direction field (structs.glsl:24-58). reference-implementations §10 lists 'the ray's direction at a far hit' as Open.
- why it matters: In any curved space the velocity at t differs from the seed direction. Entering/exiting classification, BSDF wo and MIS would mix tangent spaces at two points. This is a contract gap, not just a missing occupant.
- suggestion (thought-through-not-checked): Have every hit arm fill an arrival direction, either `Hit.dir` or a companion `ambient_geodesic_dir(o,d,t)` (in Euclidean space it equals ray.direction), and read it in the side test and for wo. This is the shape of the old repo's `flow(Vector,t) -> Vector`.
- pros/cons: Pro: closes the Open item before the first curved occupant. In flat space it is free (the copy folds away). Con: a locked-contract edit (trace-loop-contract), and every arm fills one more field.
- checker note: intersection.ts:1694 compares the seed direction ray.direction with hit.ng at hit.p, pt.ts:420 sets `Direction wo = -s.ray.direction;`, and Hit (structs.glsl:24-58) has no arrival-direction field. reference-implementations.md:694-696 already records this as Open ('the ray's direction at a far hit … needed for wo in curved space … resolved when the first curved backend is built'). The finding should cite that and add the side test as a second reader of the same missing fact. It is a known, deferred contract item.

### GA-3 — Point/Direction typedefs live in core, and the geometry layer is written in raw vec3

- kind: euclidean-assumption; reader confidence: checked; checker: **confirmed**
- evidence: src/glsl/core/structs.glsl:4-5 `#define Point vec3` / `#define Direction vec3` (core, not the ambient occupant). Every geometry .glsl uses vec3 signatures (counts: mesh.glsl 83 vec3 / 0 Point; sphere 9/0; box 17/0; placement.glsl 8/0). intersection.ts:404,1122 emit `int scene_region_at(vec3 p)`.
- why it matters: The plan is that Point becomes vec4 per space. The occupant cannot define its own Point today, and the seam signatures would not type-check against vec4.
- suggestion (thought-through-not-checked): Move the two #defines into the ambient occupant, and spell seam signatures (scene_region_at, placement_*) with Point/Direction. Primitive bodies stay vec3, because they are per-space math anyway (see GA-6).
- pros/cons: Pro: small and mechanical; makes the door real. Con: the typedef has to come before every struct, so the ambient block moves up in core.ts ordering, and its body still needs structs. That probably means splitting the occupant into types and functions.
- checker note: structs.glsl:4-5 has `#define Point vec3` / `#define Direction vec3` in core. No geometry .glsl file, placement.glsl or mesh.glsl uses Point at all (mesh.glsl has 79 vec3 tokens by word-boundary count, not 83). The scene_region_at signature is at intersection.ts:382 (the provides entry) and 1123, not 404. ambient/README says to 'write against the typedef', but the geometry layer does not.

### GA-4 — Absolute far clip MAX_DIST = 1000, with the environment and directional lights placed 'at MAX_DIST'

- kind: euclidean-assumption; reader confidence: checked; checker: **confirmed**
- evidence: src/glsl/core/math.glsl:11 `#define MAX_DIST 1000.0`; intersection.ts:1682 `hit.t = MAX_DIST`; components/env/sampler_cdf.glsl:78 and lights/directional/directional.glsl:22 `ls.distance = MAX_DIST`; transport/shadow/opaque/opaque.glsl:17 `length(light_p - shadow_ray.origin) - SHADOW_BACKOFF`.
- why it matters: S³ geodesics close after 2π, so a 1000-unit search wraps about 159 times. In H³ the hyperboloid coordinates overflow (cosh 1000). 'Environment at infinity' has no meaning in a compact space. The far bound and light distance must come from the ambient occupant.
- suggestion (thought-through-not-checked): Make the far clip an ambient-occupant constant, and add `ambient_distance(p,q)` (the trace-loop-contract already names it as the follow-up for the shadow length() calls).
- pros/cons: Pro: one answer per space. Con: the S³ environment semantics (what a 'miss' means) is a measurement-design question for the owner, not a refactor.
- checker note: Every citation checks out: math.glsl:11, intersection.ts:1682 area, sampler_cdf.glsl:78, directional.glsl:22 and opaque.glsl:17's length(). trace-loop-contract.md:147-148 already names 'a geodesic ambient-distance helper' as the curved-space follow-up, so ambient_distance is planned, not new.

### GA-5 — fp_uncertainty is coordinate-relative over x, y, z only

- kind: euclidean-assumption; reader confidence: checked; checker: **confirmed**
- evidence: src/glsl/core/math.glsl:54-56 `float fp_uncertainty(Point p) { return max(FP_UNCERTAINTY_ABS, FP_UNCERTAINTY_REL * max(abs(p.x), max(abs(p.y), abs(p.z)))); }` — Hit.eps for all analytic and triangle hits comes from it (spawn_eps_fp).
- why it matters: With a vec4 Point it ignores w, and in the hyperboloid model the coordinate size grows like cosh(distance). The spawn offset would stop matching the true position error.
- suggestion (thought-through-not-checked): Treat the position-error bound as part of the ambient occupant (or the chart), next to ambient_geodesic.
- pros/cons: Pro: keeps the Wächter–Binder discipline per space. Con: the occupant then needs a derivation of the error, not just a closed form.
- checker note: math.glsl:54-56 matches. Hit.eps comes from spawn_eps_fp for analytic and triangle hits (structs.glsl comment and the mesh fills at 905 and 1024).

### GA-6 — A primitive has exactly one GLSL body: no slot for per-space variants

- kind: extension-friction; reader confidence: checked; checker: **confirmed**
- evidence: descriptors.ts PrimitiveDescriptor `glsl: string` (one source). All closed forms are Euclidean: sphere.glsl:28-51, plane.glsl:14-19, quad.glsl:14 `ray.origin + ray.direction * t - q.corner;  // Euclidean backend`, disk.glsl:15, box/cylinder slab/quadratic forms, `<type>_interval` used for march bounds. boundCheck.ts:24-40 and the conservativeness gate use Math.hypot.
- why it matters: An H³ sphere or slab is a different field, closed form and bound. Today there is nowhere to put it beside the Euclidean one, and the Lipschitz and containment gates measure the Euclidean metric.
- suggestion (none): Decide with the owner whether shapes are per-space occupants (geometry/hyp/ball, as the old thurston-rebuild repo does) or carry a per-space map {euclidean: glsl, hyperbolic: glsl}. This needs a design discussion, not a refactor.
- pros/cons: Open structural question; per CLAUDE.md it needs research and a written design before code.
- checker note: PrimitiveDescriptor has a single `glsl: string` (descriptors.ts:390 area), quad.glsl:14 carries the '// Euclidean backend' comment, and BOUND_FIELDS uses Math.hypot. The old repo has per-space folders (thurston-rebuild/src/geometries/{euc,hyp,sph,h2e,s2e,nil,sl2,sol}). Correctly framed as an open design question.

### GA-7 — Projective models would keep the BVH/triangle/slab machinery for H³ and S³ but not for H²×R

- kind: research-note; reader confidence: inferred; checker: **confirmed**
- evidence: bvh.glsl:28-53 slab tests on straight rays; mesh.glsl:41-59 Möller–Trumbore; instancing.ts:139-155 world AABB by 8-corner similarity; trace-loop-contract.md:159 lists 'BVH under non-straight geodesics' as open. The old repo (thurston-rebuild/src/geometries/hyp/geometry/shaders/part1.glsl) uses a vec4 hyperboloid Point and a Vector{Point pos; vec4 dir}, with flow(v,t) returning both point and direction.
- why it matters: The owner wants meshes in curved space. In the Klein model of H³ and a gnomonic chart of S³, geodesics are straight lines and totally geodesic planes are affine planes. So geodesic triangles are flat triangles, and SAH BVHs, slab tests and Möller–Trumbore work unchanged on chart coordinates, with t a monotone reparameterization of arc length. S³ needs two charts, and a ray crosses the line at infinity at arc length π/2. H²×R geodesics are not straight in Klein×R coordinates (vertical plane, nonlinear z versus chart parameter), so its box test must be a space-specific interval.
- suggestion (thought-through-not-checked): Consider `ambient_box_interval(Ray, bmin, bmax)` as the seam instead of committing everything to a vec4 hyperboloid Point. Compare against Weeks' Curved Spaces (projective rendering) and the old repo before deciding.
- pros/cons: Pro: could keep meshes, TLAS and the data rail nearly intact for H³ and S³. Con: chart singularities (S³ hemispheres, Klein boundary precision near the ideal sphere), non-arc-length t in every epsilon, and H²×R still needs custom bounds. Unverified.
- checker note: Research note; the math holds. Klein and gnomonic charts make geodesics straight lines, and H²×R in Klein×R does not (the vertical coordinate is linear in arc length, not in the chart parameter). trace-loop-contract.md:159 lists 'BVH under non-straight geodesics' as deferred. thurston-rebuild hyp part1.glsl:98-170 defines a vec4 Point struct and Vector{Point pos; …}. The confidence label 'inferred' is right.

### GA-8 — Ambient docs say swapping the ambient file carries every point-along-ray and the march loop

- kind: doc-code-mismatch; reader confidence: checked; checker: **partly**
- evidence: components/ambient/euclidean/euclidean.md:16-19 'every metric product and point-along-ray in the library follows without edits'; docs/fable-reference-implementations.md §10 'the march loop, the transport loop, and every contract above are untouched'. Contradicted by GA-1 (index.ts:234), GA-2, GA-4, and Euclidean primitives and placement. ambient/README.md:26-28 lists only two Euclidean holes (medium bodies, equiangular).
- why it matters: The owner will plan curved-space work from these docs. The real blast radius is the whole geometry layer: primitives, march, placement, BVH, far clip, eps, arrival direction.
- suggestion (checked): Update the ambient README hole list to the audit table in the notes file (E1–E17).
- pros/cons: Pro: a docs-only change, and it prevents a mistaken plan. Con: none.
- checker note: The overclaims are real in euclidean.md:16-19 ('every … point-along-ray in the library follows without edits'), in ambient/README's list of only two holes, and in ref §10 ('the march loop … untouched'). But the docs contradict each other rather than all understating: ref §10 itself says the SDF primitives must become hyperbolic-distance functions ('the real work') and lists wo as Open, and trace-loop-contract.md:147-148 and :159 name the straight-ray march, the distance helper, Point→vec4 and the BVH as follow-ups. The fix is to reconcile euclidean.md and ambient/README with what trace-loop-contract and ref §10 already admit, and add the reader's E-list.

### GA-9 — Epsilon couplings are separate constants kept in agreement by a test

- kind: duplication; reader confidence: checked; checker: **confirmed**
- evidence: math.glsl:12 `#define EPS_INTERFACE 0.001   // ... 10× MARCH_EPSILON`; math.glsl:28 `#define MARCH_CLEARANCE 0.001`; march.glsl `MARCH_EPSILON 0.0001`, `MARCH_EPSILON_MAX 0.0005`; tests/components/epsilonCoupling.test.ts:26-54 asserts `EPS_INTERFACE ≈ 10*MARCH_EPSILON`, `MARCH_CLEARANCE ≈ 2*MARCH_EPSILON_MAX`. fable-sdf-contract §4 'any tolerance that must CONTAIN another is COMPUTED from it, never restated'.
- why it matters: This is the 'mirror the logic and assert the copies agree' pattern that CLAUDE.md's one-answer-per-fact rule forbids, in the most coupling-sensitive constants in the tracer.
- suggestion (thought-through-not-checked): Put the four lengths in one place (math.glsl) as expressions: `#define MARCH_EPSILON_MAX (0.5 * EPS_INTERFACE)`, `#define MARCH_CLEARANCE (2.0 * MARCH_EPSILON_MAX)`, and so on. The test then becomes a check of the base values only.
- pros/cons: Pro: the derivation is the code. Con: march.glsl is linked only when something marches, so the march constants move into always-included math.glsl (defines cost nothing). The shader text changes, so check with the digest; the GRIN pull-back coupling (test lines 62-71) needs the same treatment.
- checker note: math.glsl:12 (EPS_INTERFACE), math.glsl:28 (MARCH_CLEARANCE), march.glsl:13/19 and epsilonCoupling.test.ts:26-71 are as cited. The test header itself says 'Until the constants are emitted from one derivation, this test IS the coupling', so the authors meant it as an interim measure. One caveat: EPS_INTERFACE ≥ 2·MARCH_EPSILON_MAX is an inequality in the test, and deriving MARCH_EPSILON_MAX = 0.5·EPS_INTERFACE turns it into the equality that march.glsl's comment ('CAPPED at half of EPS_INTERFACE') already describes.

### GA-10 — Six copies of BVH node decoding (four hand-written walks in mesh.glsl plus two emitters)

- kind: duplication; reader confidence: checked; checker: **confirmed**
- evidence: mesh.glsl:162-191 mesh_nearest_bvh, 203-228 mesh_inside_bvh, 266-298 mesh_closest_bvh, 300-321 mesh_any_bvh each restate `n0.w >= 0.0` leaf test, `int(-n0.w - 1.0)` axis, `L = ni + 1, R = int(n1.w)`; bvh.ts:59-81 bvhWalkLines and 399-424 bvhPointWalkLines repeat it. bvh.ts:411-417 records a past bug from exactly this: 'This walk read n1.w as the left child ... NEVER VISITED THE LEFT ONE'.
- why it matters: The node format is one fact with six readers, and one of them has already drifted once.
- suggestion (thought-through-not-checked): Add one GLSL decode helper in bvh.glsl (e.g. `bool bvh_node(uint nbase, int ni, out vec3 bmin, out vec3 bmax, out int a, out int b)`) that all six walks call. Or generate mesh.glsl's four walks from the existing emitters.
- pros/cons: Pro: the node format has one reader. Con: performance-sensitive inner loop. Drivers normally inline, but it needs a perf check on the cloud/mesh scenes; the generated-walk option makes mesh.glsl partly generated.
- checker note: mesh.glsl has four hand-written walks (nearest 162, inside 203, closest 266, any 300), each with the `n0.w >= 0.0` / `int(-n0.w - 1.0)` / `L = ni + 1, R = int(n1.w)` decode. bvh.ts bvhWalkLines (59-81) and bvhPointWalkLines (399-424) repeat it. The past-bug comment at bvh.ts:411-417 is real. bvh.glsl offers only box tests (bvh_aabb_hit, _range, _contains), no node-decode helper.

### GA-11 — Five placement-lowering functions each re-dispatch the identity/translation/rigid/similarity tiers

- kind: duplication; reader confidence: checked; checker: **confirmed**
- evidence: intersection.ts:601 emitSdfPlacement (ray, params ×s), 639 emitPlacementQuery (point, p/s then s·d), 864 emitMeshPlacement (ray ÷s), 1300 emitMeshPointQuery (point ÷s, ms), 723 placementRefs (constant vec4 ABI). Three scale conventions (params ×s; p/s with s·d; ray ÷s) for one fact.
- why it matters: Most of the placement complexity sits here, and it is what a curved-space structure-group occupant would have to replace. placementRefs already shows that a constant placement can use the same two-vec4 ABI as a driven one.
- suggestion (thought-through-not-checked): Lower every non-folded placement through the rigid ABI (constant vec4 literals via placementRefs). Keep only two conventions: params ×s for primitives, and ÷s for the unscaled mesh BLAS.
- pros/cons: Pro: two lowering paths instead of five; a curved occupant swaps placement.glsl only. Con: changes compiled output for constant rotated objects (mat3 literal becomes quaternion rotate, slightly more ALU unless the driver folds), and the dumps are less readable. Needs a digest and perf check.
- checker note: emitSdfPlacement 601 (rigid frame, scale on params), emitPlacementQuery 639 (p/s), emitMeshPlacement 864 (÷s on the ray), emitMeshPointQuery 1300 (÷s, ms) and placementRefs 723 (constant vec4 ABI via rigidInverse) each re-dispatch identity/translation/rigid/similarity through classifySimilarity. Accurate.

### GA-12 — Bound-primitive TS fields written twice (shipping gate and test twins)

- kind: duplication; reader confidence: checked; checker: **confirmed**
- evidence: src/components/geometry/boundCheck.ts:24-40 BOUND_FIELDS {sphere, box, cylinder}; tests/components/fieldTwins.ts:19-38 FIELDS {sphere, box, cylinder} — the same formulas. fieldTwins.ts header: 'a twin copied per test is a twin that drifts per test'.
- why it matters: Two transcriptions of the same fields that gate silent clipping.
- suggestion (checked): Have fieldTwins import sphere/box/cylinder from BOUND_FIELDS.
- pros/cons: Pro: trivial, tests only. Con: none.
- checker note: boundCheck.ts:24-40 BOUND_FIELDS and fieldTwins.ts:19-38 hold the same sphere/box/cylinder formulas (box differs only in a temporary variable). boundCheck.ts's own header says the registry twins 'stay test-side', so having two copies was a decision, but nothing stops fieldTwins from importing these three.

### GA-13 — Instance packing re-implements the kind fold and quaternion rotation inline

- kind: duplication; reader confidence: checked; checker: **partly**
- evidence: instancing.ts:238-268 packParamsRecords: 'the per-instance form of foldPlacementIntoParameters' re-derives point → s·R·p + t and length → ×s (index.ts:356-385 derivedFold is the original). Three hand-expanded quatRotate blocks at 147-152, 219-225, 256-261.
- why it matters: The fold rule has two authors. The stated reason (no per-instance allocation at 10⁶ instances) is real, and a vitest twin gates it.
- suggestion (thought-through-not-checked): Extract one allocation-free `applySimilarityInto(out, offset, d, x, y, z)` used by all three loops, and drive the per-row kind switch from the descriptor kinds as derivedFold does.
- pros/cons: Pro: one fold rule, shorter file. Con: the byte-identical-output gates must still pass, and per-call overhead in a 10⁶ loop needs measuring.
- checker note: The duplication is real: three hand-expanded quaternion rotations at instancing.ts:144-152 (box corners), 219-225 (inverse t, conjugate q) and 256-261 (params rows), with packParamsRecords re-deriving the fold. One correction: packParamsRecords already drives the row switch from descriptor kinds (`p.kind === 'point'`), and the tier predicate limits rows to point and length, so the 'drive from the descriptor kinds' half of the suggestion is mostly already done. The remaining duplication is the rotation arithmetic.

### GA-14 — Whether a scene-local field authored its own normal is decided by a regex over its GLSL

- kind: guess; reader confidence: checked; checker: **partly**
- evidence: intersection.ts:175-176 `const authoredNormal = (d) => d.local === true && new RegExp(`vec3\\s+${d.type}_sdf_normal\\b`).test(d.glsl);`; custom.ts comments call it experimental and do not declare it in SceneSDFSpec.
- why it matters: The owner's rule is that decisions come from declared facts. Source-text sniffing is an inferred fact: a comment or a differently spaced signature changes which normal is linked, and nothing reports it.
- suggestion (thought-through-not-checked): Add a declared spec field (e.g. `normal: 'authored'`), have defineSDF check the symbol exists iff declared (as it does for uvChart), and let the generator read the flag.
- pros/cons: Pro: matches the uvChart declare-and-verify pattern. Con: one more spec field on an experimental feature.
- checker note: The regex at intersection.ts:175-176 is real. defineSDF (custom.ts:121-123) only comments that authoring <name>_sdf_normal suppresses the generated one, with no declared field (uvChart, by contrast, is declared and then verified by regex at 124). The claim 'nothing reports it' is overstated, though. A false match (for example a commented-out signature) suppresses the generated normal and leaves an undefined function, and a missed match (for example `Direction name_sdf_normal`) emits a duplicate definition. Both fail the GLSL compile loudly; neither silently changes the normal. It is still inference from source text, against the no-guesses rule.

### GA-15 — BVH and CWBVH stack overflow silently drops subtrees; the builders only console.warn

- kind: defect; reader confidence: checked; checker: **confirmed**
- evidence: bvh.ts:367-371 `if (maxDepth >= BVH_STACK_DEPTH) { console.warn(...) }`; every walk guards `if (ptr + 2 < BVH_STACK_DEPTH)` and otherwise skips the children (mesh.glsl:184, bvh.ts:77). cwbvh.ts:364-369 same, with its own comment: 'A step limit may never decide the picture'.
- why it matters: Missing geometry would be a silent wrong image. Unlikely with SAH and the median fallback, but the owner forbids silent degradation.
- suggestion (thought-through-not-checked): Throw instead of warning. The App would then report it like an assertFits failure.
- pros/cons: Pro: one line; consistent with assertFits. Con: a scene that renders 'fine' today with an unreachable deep subtree would now refuse to load.
- checker note: bvh.ts:367-371 and cwbvh.ts:364-370 only console.warn. The walks guard with `ptr + 2 < BVH_STACK_DEPTH` and skip pushes beyond it. BVH_STACK_DEPTH = 64 and CWBVH_STACK_DEPTH = 24. The cwbvh comment ('A step limit may never decide the picture') argues for a hard failure, and the neighboring checks already throw. The warn threshold (maxDepth ≥ STACK_DEPTH) does cover the push guard's real cutoff.

### GA-16 — The arm matrix: 3 classes × 3 regimes × 3 queries, with the table leaf written twice

- kind: complexity; reader confidence: checked; checker: **confirmed**
- evidence: intersection.ts: analyticObjectArm 739, sdfObjectArm 544, generateMeshDispatch 889, instanceLeafItem 981, sdfLeafArm 1338, generateSceneTable 1366 (scene_table_leaf at ~1411 and scene_table_leaf_any at ~1468 are separate hand-written copies), generateSceneRegionAt 1121, instanceContainmentItem 1241. Mesh hit-fill duplicated at 904-911 and 1022-1028. The instance mesh arm hard-codes mesh_nearest_bvh/mesh_any_bvh instead of the MESH_TRAVERSALS registry (1007-1013).
- why it matters: This file (1728 lines) is where a new shape class, regime or space touches the most code. Most arms already take a `bound` parameter to share nearest and any; the table leaf does not.
- suggestion (thought-through-not-checked): Smallest step: parameterize scene_table_leaf by bound like the other arms, and add a meshHitFill twin of primitiveHitFill. Larger step, for discussion only: one 'leaf item' emitter per class that every regime calls.
- pros/cons: Pro: removes about 50 duplicated lines and a drift surface. Con: the larger restructuring touches the most-tested generator, which per CLAUDE.md needs an owner discussion before any work.
- checker note: scene_table_leaf (1411) and scene_table_leaf_any (1472) are separate hand-written copies of the analytic, mesh, SDF and batch dispatch. The SDF part already shares sdfLeafArm(k, chartUv, bound); the analytic part does not. The mesh hit-fill is duplicated at 904-911 and 1022-1028. instanceLeafItem hard-codes mesh_nearest_bvh/mesh_any_bvh (1017, 1020) instead of MESH_TRAVERSALS, which may be deliberate because instance prototypes always carry a node tree, but nothing in the code says so.

### GA-17 — defineSDF mutates the global PRIMITIVES registry when a module loads

- kind: complexity; reader confidence: checked; checker: **confirmed**
- evidence: custom.ts:154 `PRIMITIVES[spec.name] = d;` and the error at custom.ts:91 'scene-local names are global to the session'.
- why it matters: Registry contents depend on which scene modules have been imported. Two scenes cannot reuse a name, and test order or imports can change what compiles.
- suggestion (thought-through-not-checked): Carry scene-local descriptors on the SceneDescription (or a per-compile registry overlay) instead of writing the global.
- pros/cons: Pro: compile is a pure function of the scene. Con: every PRIMITIVES lookup (Validator, Planner, generator, dataTenants) must take the overlay, which is a broad plumbing change.
- checker note: custom.ts:154 `PRIMITIVES[spec.name] = d;` and the error message at custom.ts:91 ('scene-local names are global to the session') confirm it. Registering globally is a documented choice, with a hot-reload path at 86, but the impurity is as described.

### GA-18 — Stale docs: twin required, 8 bisections, App calls the ledger, deleted data_textures.ts, six channels, transform §5.3/§6

- kind: doc-code-mismatch; reader confidence: checked; checker: **confirmed**
- evidence: fable-sdf-contract.md:177 'the TWIN IS PART OF THE DEFINITION' and descriptors.ts:488 'REQUIRED by defineSDF' vs custom.ts:36-42 (optional, owner Aug 11). descriptors.ts:456 and fable-sdf-contract.md:118 'then 8 bisections' vs index.ts:267-272 (14). data/README.md:12-13, ledger.ts:4-5 and dataTenants.ts:3-5 say the App calls planDataLayout/dataTenantsOf; the only caller is Planner.ts:361 (no match in src/app). intersection/README.md:35 and accel/README.md:30 cite deleted components/data_textures.ts. fable-data-rail §3 'six, forever' vs channels.ts:14-20 nodesq. fable-transforms.md:211-214 and 243-246 describe ÷s local frame and mat4 w2l uniforms vs the built rigid ABI. light_tree.glsl:7-10 header formula vs body 58-76.
- why it matters: CLAUDE.md says the code wins and the disagreement should be flagged. These are what a reader would plan from.
- suggestion (checked): One docs pass correcting each line listed.
- pros/cons: Pro: cheap. Con: none.
- checker note: I checked each item. descriptors.ts:456 and sdf-contract:118 say 8 bisections, but index.ts:267-272 does 14. sdf-contract:177 and descriptors.ts:488 say the twin is REQUIRED, but custom.ts:37-43 makes it optional. data/README:12-13, ledger.ts:4-5 and dataTenants.ts:3-5 say the App calls planDataLayout/dataTenantsOf, but the only callers are Planner.ts:359/361. data_textures.ts is cited but deleted. fable-data-rail §3 says 'six, forever', but channels.ts adds nodesq. fable-transforms describes `_w2l` mat4 uniforms, which grep finds nowhere in src; placement.glsl uses the two-vec4 rigid ABI. light_tree.glsl:7-14 gives the θu sphere formula, but the body (58-76) uses the corner/center cosine. Additional citations of the deleted data_textures.ts that the reader missed: src/glsl/core/data_texture.glsl:3 and src/components/intersection/mesh/mesh.md:19.

### GA-19 — Unused or single-occupant scaffolding that serves planned work

- kind: in-progress; reader confidence: checked; checker: **confirmed**
- evidence: euclidean.glsl:25 ambient_parallel_transport (no caller; curved-space seam); AMBIENT_SPACES single occupant (ambient/index.ts:21); data_indices .w reserved for per-triangle material groups (pack.ts:84) and Hit.element per-triangle refs (structs.glsl:44-50), both for multi-material meshes (CLAUDE.md Not built); CWBVH maintained non-default (accel/README.md:23); brute/linear engines as A/B baselines for estimator-equality witnesses.
- why it matters: These must not be read as dead code: they are the doors for curved spaces, multi-material meshes and accel research.
- suggestion (checked): Keep them. Optionally mark each with a one-line 'reserved for X' comment where one is missing.
- pros/cons: Pro: protects them from future cleanup passes. Con: none.
- checker note: Correctly classed as in-progress. euclidean.glsl:25 ambient_parallel_transport has no caller and is part of the documented seam. AMBIENT_SPACES has a single occupant (ambient/index.ts:21-23). pack.ts:83-84 reserves .w as the per-triangle material-group slot. Hit.element documents per-triangle refs as a future tenant. accel/README:23 marks CWBVH 'maintained-but-non-default'. MESH_TRAVERSALS keeps brute as an alternative. None of this should be deleted.

### GA-20 — SDF gradient normal is a coordinate finite difference

- kind: euclidean-assumption; reader confidence: checked; checker: **confirmed**
- evidence: index.ts:337-348 `${sw} * ${d.type}_sdf(p + ${sw} * NORMAL_EPSILON, s)` summed and `normalize`d in coordinates.
- why it matters: In a non-orthonormal or embedded model (hyperboloid) the taps must move along a tangent frame (the old repo's smallShift), and the gradient needs the metric (raised index, projected to the tangent space).
- suggestion (thought-through-not-checked): Route tap offsets through ambient_geodesic along ambient_frame axes when the curved occupant arrives; in Euclidean space it is the same arithmetic.
- pros/cons: Pro: a one-site change, since the normal is generated. Con: four more geodesic evaluations per normal in curved space.
- checker note: emitSdfNormal (index.ts:337-348) does a 4-tap tetrahedral difference `p + k * NORMAL_EPSILON` in coordinates, then normalize. Accurate as a curved-space assumption. It is a single generated site.

**Checker: missed by the reader**

- Further stale citations of the deleted components/data_textures.ts: src/glsl/core/data_texture.glsl:3 ('DATA_TEX_WIDTH is emitted by the compiler from components/data_textures.ts') and src/components/intersection/mesh/mesh.md:19. These go with GA-18.
- The instanced-mesh leaf (intersection.ts:1011-1029) scales the ray direction (`rd = placement_dir(q, ray.direction) / s`) while the SDF/analytic convention keeps directions unit and scales the params. That is a third placement convention, inside instanceLeafItem, which GA-11's list of five lowering sites leaves out (it uses placementRefs-style q/ts from records with its own ÷s).
- The ambient docs contradict each other, not just the code: trace-loop-contract.md:147-148/159 and reference-implementations §10 (lines 690-696) already list the straight-ray march, the geodesic distance helper, Point→vec4, BVH under curved geodesics and the arrival direction as follow-ups, while euclidean.md:16-19 and ambient/README:24-28 claim near-complete swappability. A curved-space plan should start from the trace-loop-contract's Deferred list.

**Reader questions for the owner**

- For H3/S3, do you want the hyperboloid (vec4 Point, as in thurston-rebuild and reference-implementations §10) or a projective (Klein/gnomonic) chart, which would let meshes, BVHs and triangle tests carry over almost unchanged? H2xR fits neither cleanly.
- Should a shape be one occupant per space (geometry/hyp/ball, like thurston-rebuild) or one occupant with per-space GLSL bodies? Today PrimitiveDescriptor has a single glsl string.
- In S3 there is no 'infinity'. What should a ray that hits nothing measure: environment after one full great circle, after distance π, or something else? This decides what replaces MAX_DIST.
- May Hit gain an arrival direction (or ambient_* a velocity-at-t companion) before any curved occupant is built? Both the side test and wo currently use the ray's starting direction.
- Is the regex-detected authored normal for scene-local fields (intersection.ts:175) still wanted? If so, should it become a declared spec field?
- Should a BVH/CWBVH depth overflow be a hard error instead of console.warn?


## materials-lights-color

These five families define the integrand, and the compiler composes them into GLSL.

**Materials (6 models).** Each model is one GLSL file plus one descriptor. The GLSL defines `<id>_eval/sample/pdf/emission`: eval returns f without the cosine, `sample.weight` is f|cos|/pdf, and delta lobes report pdf 0. The descriptor declares:
- property rows (float or Spectrum, a spectrum role, a default, field or region-table storage);
- host-computed derived rows, such as alpha;
- capabilities (nonDeltaLobes, transmission, support hemisphere/sphere, emissive, readsUv);
- an albedo fact for the albedo guide.

The compiler builds one `MaterialProperties` struct from the union of the rows of the models present. It also generates an if-chain resolver over material id (rows can be constants, `{param}` uniforms, GLSL expressions in p/uv, or per-instance attributes) and dispatchers that route each id to its model. The index of refraction lives in a per-region table, read on both sides of a hit.

**Lights (9 kinds).** Each kind is functions only. `<kind>_light_sample(<Kind>Light, Point p, xi)` returns wi, distance, radiance and a pdf in solid-angle measure at p. Hittable kinds also define a `<kind>_light_pdf` next to it that mirrors the sampler. The struct is generated from the descriptor's rows. Descriptors also carry:
- desugar facts: authored area lights become synthesized emissive lambert regions;
- pbrt power formulas;
- light-tree bounds;
- the equiangular delta query fact.

Light selection has three options. `power` and `uniform` use a compile-time CDF with one accessor function per light. `bvh` packs lights into a data-texture table with a stochastic tree walk and bit-trail pmf replay. The environment joins selection through a two-stage draw.

**Environment.** Only the sampling chart (equirect, octahedral) is a registry. It uses a shared CDF sampler with a 1/16 uniform-sphere mixture, and the CPU builds the tables. Environment kinds (constant, image, procedural) are if-branches in the generator.

**Color.** `rgb` and `spectral` are pick-one models, switched by `#define Spectrum vec3/vec4`. Spectral uses 4 wavelengths, a CIE film, and the Jakob–Hanika lift chosen by role (reflectance, coefficient, emission×D65). A second registry of *spectrum kinds* (rgb, blackbody, cauchy, sellmeier, gaussian) answers every question the compiler asks about an authored value. Index kinds produce a single float at the hero wavelength, and a dispersive index forces a hero collapse.

**AOVs.** Two RGB-only first-hit guides: albedo and normal.

**Assessment.** The per-occupant contracts are clean and the math is well tested (TS twins plus witnesses). The complexity sits in lighting.ts (940 lines) and materials.ts (954 lines, about half of it media code). Specific problems:
- two light-selection code paths that repeat the env wrapper;
- chart-name and mesh-kind special cases that the registries' docs say no longer exist;
- two scene-radius estimates;
- several doc/code mismatches.

**Curved spaces.** The surface frame math already goes through the metric function (`ambient_dot`), and the transport light technique already uses the geodesic functions. Every light sampler, both env charts and the light tree are Euclidean closed forms, and nothing yet selects a per-space implementation. For state-of-the-art materials, the main gaps are: emission tied to the BSDF model (only lambert can emit), the index role being float-only (blocks the planned η/k conductor), the light sampler seeing only p, and no way to compose models (layered).

### MLC-1 — Lights README/registry claim no per-kind branches, but 'mesh' and 'sphere' are special-cased in Planner and lighting generator

- kind: doc-code-mismatch; reader confidence: checked; checker: **confirmed**
- evidence: src/components/lights/README.md:54 "No Planner/Validator/Analyzer branches exist per kind"; src/compiler/plan/Planner.ts:321 `if (entry.kind === 'mesh') {`; src/compiler/generate/features/lighting.ts:445 `if (l.mesh !== undefined) {`, :664 same, :848 `if (kind === 'mesh') {`, :918 `if (kind === 'mesh') {`; :106 `(kind === 'sphere' && batchArms.length > 0)`
- why it matters: A reader trusting the README will not find where mesh lights differ; a second data-driven light kind (textured emitter, multi-material mesh emitter) would add a fifth branch set.
- suggestion (thought-through-not-checked): Either update the README to name the mesh exception honestly, or remove the cause (see MLC-5: a uniform pdf signature taking `Hit light_hit`, and a descriptor fact for rail-resident sampler args).
- pros/cons: Doc fix: zero risk, no code change. Removing the cause: fewer branches, but it touches every kind's pdf signature and the bvh loaders; needs a digest-before/after check.
- checker note: lights/README.md:54 says no per-kind Planner/Validator/Analyzer branches. The code has them: Planner.ts:321 `if (entry.kind === 'mesh')` (desugaring an emissive mesh object into a light), and in lighting.ts mesh branches at :445 (sampleCall), :664 (CDF pdf), :848 (bvh sample) and :918 (bvh pdf), plus the sphere batch-arm case at :106. The README's door-test claim may still hold for a new non-data kind; for mesh the statement is false.

### MLC-2 — Lights docs describe hoisted consts and a struct declared in the kind GLSL; code generates struct + accessor functions

- kind: doc-code-mismatch; reader confidence: checked; checker: **confirmed**
- evidence: src/components/lights/README.md:71 "`const <Kind>Light light_<id>` per light (a single construction site..."; :95 "the generated struct + hoisted const are the ready ABI"; src/components/descriptors.ts:200-201 "the file declares `struct <Kind>Light`"; actual: lighting.ts:430-437 `lines.push(`${structName} light_get_${l.id}(Wavelengths wl) { return ${lightCtor(l, color)}; }`)` and lighting.ts:108-116 generates the struct; point.glsl declares no struct.
- why it matters: The contract docs are what a new occupant author reads; two of them describe a superseded ABI.
- suggestion (checked): Rewrite the two passages to describe accessors `light_get_<id>(wl)` and generated structs.
- pros/cons: Pure doc edit; no risk.
- checker note: README.md:71 still says 'one hoisted `const <Kind>Light light_<id>`' and :95 'generated struct + hoisted const'. descriptors.ts:200-209 says 'the file declares `struct <Kind>Light`' and 'hoisted consts'. In the code, the struct is generated (lighting.ts:108-116, structFromRows) and each light has an accessor `light_get_<id>(wl)` (lighting.ts:430-437). Each kind's GLSL header says 'struct GENERATED from descriptor rows'. lighting.ts:126-127 also has an orphaned stale comment, 'Hoisted light consts (struct-alignment batch, the N5 pattern): every light is', which runs straight into the accessor comment.

### MLC-3 — Environment chart knowledge is spread across 5 files as chart-name tests, though env/index.ts says those ternaries are dead

- kind: duplication; reader confidence: checked; checker: **confirmed**
- evidence: src/components/env/index.ts:4 "(D3: the name-ternaries in generate/features/environment.ts and EnvironmentBake.ts are dead)"; still present: environment.ts:51 `(chart === 'octahedral' ? '_oct' : '')`, :63 `chart === 'octahedral' ? 'env.sizeOct' : 'env.size'`, :170, :230; EnvironmentBake.ts:22 `if (chart === 'octahedral')`; importance.ts:56 `const wrapU = chart === 'equirect'`, :78, :109 `chart === 'octahedral' ? 1.0 : Math.sin(theta)`; lighting.ts:505, :511, :528 (size path + mean-radiance formula); app/App.ts:236, :348, :958 (default 'equirect' again, also Planner.ts:578).
- why it matters: Adding a third chart (e.g. the deferred hierarchical warping, or a curved-space chart) requires edits in ~12 places; the size-path fact `env.sizeOct` vs `env.size` alone is answered in three files.
- suggestion (thought-through-not-checked): Put the per-chart facts on EnvChartDescriptor: tableSuffix, sizeParam, tableSize(env), cpuTexelWeight(j,H) (sinθ or 1), blurWrapU, meanRadianceFromTotal(total,w,h), rotation rail. Callers read the descriptor.
- pros/cons: Pro: one answer per fact, true one-folder chart door. Con: moves CPU estimator code into descriptors (fine under the component rule); touches App, bake, generator — needs digest compare and the chart witnesses.
- checker note: A complete grep finds chart-name tests at App.ts:236 and :348, importance.ts:56, :78 and :109, EnvironmentBake.ts:22, lighting.ts:505, :511 and :528, and environment.ts:51, :63, :170 and :230. The 'equirect' default appears at App.ts:958 and Planner.ts:578. Correction on framing: the env/index.ts:4 'D3: … dead' note most plausibly means the chart GLSL is now picked from the registry rather than by name. It does not mean these size, suffix, rotation and weight ternaries are dead. The note is stale history wording, not a claim the code contradicts. The duplication itself is real.

### MLC-4 — Two different scene-radius estimates for pbrt's worldRadius (directional power vs environment power)

- kind: duplication; reader confidence: checked; checker: **confirmed**
- evidence: src/compiler/plan/Planner.ts:975-1008 `function sceneWorldRadius(...)` (analytic bounds + meshes, `return any ? Math.max(r, 1e-3) : 10;`); src/compiler/generate/features/lighting.ts:459-474 `function sceneRadiusEstimate(plan)` (|point rows| + Σ length rows, includes SDF objects and lights, floored at 1); fallback restated in src/components/lights/directional/directional.ts:29 `const r = ctx?.worldRadius ?? 10;`
- why it matters: Both feed one selection decision (env vs directional vs area lights all compete in the same draw) but with different radii; two answers for one fact, and the 10 constant lives twice. Variance-only, so not a correctness bug.
- suggestion (thought-through-not-checked): Compute worldRadius once in the Planner (the stamped `powerCtx.worldRadius`) and have envSelectionProbability read the same value; drop the `?? 10` fallback (the Planner always stamps).
- pros/cons: Pro: one fact, one place; removes a guess. Con: changes p_env numerically for some scenes (noise only, not mean); digest will differ, witnesses' noise checks may shift.
- checker note: There are two radius estimates. Planner.ts:975 sceneWorldRadius covers closed-form analytic bounds and meshes; it returns 10 when nothing can be bounded and floors at 1e-3. It is stamped as powerCtx at :340-341. lighting.ts:459 sceneRadiusEstimate takes |point rows| + Σ length rows over plan.objects and lights, floored at 1, and is used only for Φ_env. directional.ts:29 repeats `?? 10`. The Planner comment admits the fallback 'twins' the stamp site. Both are variance-only, so this is not a correctness bug.

### MLC-5 — Light pdf signature cannot express mesh needs, so the generator special-cases mesh four times

- kind: extension-friction; reader confidence: checked; checker: **confirmed**
- evidence: descriptors.ts uniform pdf signature `float <kind>_light_pdf(<Kind>Light l, Point p, Point light_p, Direction wi)`; mesh.glsl `float mesh_light_pdf(MeshLight l, Point p, Point light_p, Direction light_n, Direction wi)`; lighting.ts:664-667 `return ${select} * mesh_light_pdf(..., light_hit.p, light_hit.ng, wi)`; mesh sampler takes extra textures/bases `mesh_light_sample(MeshLight l, sampler2D idxTex, sampler2D wposTex, sampler2D cdfTex, int tbase, int wposBase, int cdfBase, int triCount, Point p, vec2 xi)`
- why it matters: Normal-mapped or textured emitters, multi-material mesh emitters, and curved-space Jacobians all want the full emitter hit; today each needs a generator branch.
- suggestion (thought-through-not-checked): Make every kind's pdf take `(l, LightQuery q, Hit light_hit, Direction wi)`; the mesh's rail bases become struct rows (or a descriptor `railArgs` fact) so the call is uniform.
- pros/cons: Pro: deletes 4 branches, ready for ng-dependent emitters. Con: touches all 6 hittable kinds' GLSL + twin tests; struct rows for ints need a row shape 'int'.
- checker note: Checked. mesh.glsl:70 is `mesh_light_pdf(MeshLight l, Point p, Point light_p, Direction light_n, Direction wi)` and :18 is a sampler taking 3 samplers and 4 int bases. The generator special-cases mesh at lighting.ts:445, :664, :848 and :918. Small correction: the bvh pdf arm needs no rail bases, only light_hit.ng. Only the samplers need the rail arguments. The suggestion is untested.

### MLC-6 — Light kind samplers receive only the point p, not the LightQuery (normal) the dispatcher holds

- kind: extension-friction; reader confidence: checked; checker: **confirmed**
- evidence: lighting.ts:444-450 `return `${lightKind(l).kind}_light_sample(${lightRef(l, 'wl')}, q.p, ${xiExpr})`;` — `q` (LightQuery with n, two_sided, structs.glsl) is in scope but only q.p is passed; sampler contract in lights/README.md: `LightSample <kind>_light_sample(<Kind>Light l, Point p, vec2 xi)`.
- why it matters: State-of-the-art area-light sampling (spherical rectangles/triangles with projected-solid-angle warping, pbrt-v4's use of LightSampleContext n) needs the receiver normal; the deferred 'spherical-rectangle quad sampling' item lands on this seam.
- suggestion (thought-through-not-checked): Pass `LightQuery q` instead of `Point p` to every `<kind>_light_sample` (kinds ignore what they don't use).
- pros/cons: Pro: one-time signature change, future samplers need no contract edit. Con: touches every kind and the bvh/batch dispatchers; byte-identical output otherwise (digest-checkable).
- checker note: sampleCall (lighting.ts:444-450) and the bvh arms (:850, :861, :870) pass only q.p. LightQuery (structs.glsl:83) carries p, n and two_sided. The contract text is in descriptors.ts:203.

### MLC-7 — Emission is coupled to the BSDF model; only lambert can emit

- kind: extension-friction; reader confidence: checked; checker: **confirmed**
- evidence: materials/README.md requires `<id>_emission` in every model; lambert.ts:20 `emissive: true` is the only true (ggx.ts:29, mirror.ts:20, dielectric.ts:25, checker.ts:23, rough_dielectric.ts:37 all false); five `<id>_emission` bodies `return SPECTRUM_ZERO;`; Planner.ts:296-300 synthesizes `model: 'lambert'` for every authored area light.
- why it matters: A glowing glossy or glass surface (OpenPBR emission layer, emissive textures on any material) needs every model to add an emission row and function; most occupants carry dead-by-design boilerplate.
- suggestion (thought-through-not-checked): Make emission a material-level row independent of the model (one generated emission resolver + one gate), removing `<id>_emission` from the per-model contract; directional profiles stay on the emitter-profile axis.
- pros/cons: Pro: fewer functions per model, any model can emit, matches how pbrt/Mitsuba attach emission to shapes rather than BSDFs (from memory, not re-read). Con: contract change across 6 models + dispatch + desugar; must keep pt≡pt-nee (hit-side and sampled Le from one row); needs owner design discussion.
- checker note: Only lambert.ts:20 has emissive:true; checker, ggx, mirror, dielectric and rough_dielectric are false. All six .glsl files define `<id>_emission`. Planner.ts:299 synthesizes `model: 'lambert'` with albedo 0 for authored area lights. The materials README:22 contract requires `<id>_emission`. The emission-cone gate (materials.ts:941) also composes `${model}_emission`. The redesign is the reader's untested proposal and needs owner discussion.

### MLC-8 — Spectrum role 'index' is float-only and hero-collapsed; planned complex-IOR conductor has no role/kind path

- kind: extension-friction; reader confidence: checked; checker: **confirmed**
- evidence: spectrumKind.ts emit doc: "a Spectrum for radiometric roles, a float for index"; generate/color.ts:51-58 `emitIndex` emits the kind at the hero; cauchy.ts emit `cauchy_index(..., wavelengths_hero(${ctx.wl}))`; docs/claude-improvements-2026-09.md §2.5 plans "A `conductor` occupant with rows `eta` and `k` (Spectrum)".
- why it matters: Conductor η and k are per-wavelength and must NOT collapse to the hero (no refraction). They are neither reflectance, coefficient nor emission, so a Spectrum row today would have to misuse 'coefficient', and Cauchy/Sellmeier/tabulated metal data could not be authored for them.
- suggestion (thought-through-not-checked): Before building the conductor, add a Spectrum-valued, non-collapsing index role (e.g. 'optical-constant') whose kinds emit per lane; RGB lift = unbounded lift.
- pros/cons: Pro: conductor lands as one folder; measured metal data becomes a spectrum kind. Con: one more role in the vocabulary; validator domain rules (η>0, k≥0) to add.
- checker note: RadiometricRole is 'reflectance'|'coefficient'|'emission' and SpectrumRole adds 'index' (descriptors.ts:43-47). emitIndex (generate/color.ts:55) emits the kind's index at the hero wavelength. docs/claude-improvements-2026-09.md:256 plans a conductor with Spectrum `eta` and `k`. There is no role for a per-lane, non-collapsing optical constant.

### MLC-9 — All light samplers, both env charts and the light tree are Euclidean closed forms with no per-space selection mechanism

- kind: euclidean-assumption; reader confidence: checked; checker: **confirmed**
- evidence: 14 files declare it, e.g. quad.glsl "METRIC EXEMPTION (trace-loop contract): raw dot() ... light samplers are Euclidean closed forms; curved spaces get new bodies (§5.3)"; quad.glsl `ls.pdf = d2 / (l.area * cos_l);`; point.glsl `ls.radiance = l.intensity / d2;`; sphere.glsl `float sin2_max = r * r / dc2;`; light_tree.glsl `float base = phi / max(d2raw, ...)` with AABB/plane cull (no exemption note); LightKindDescriptor has a single `glsl` field.
- why it matters: In S³/H³ the area→solid-angle Jacobian is s_κ(d)²/cosθ (s_κ = sin, sinh), point falloff 1/s_κ(d)², the sphere's visible cone changes (sinh r/sinh d), and H²×R spreading is anisotropic. With one glsl per kind, 'new bodies' means N_kinds × N_spaces files or an unspecified selection mechanism.
- suggestion (thought-through-not-checked): Research option: write kinds against ambient functions (`ambient_direction_to`, `ambient_distance`, `ambient_spreading(p, q)` = the Jacobi-field factor) so one body serves all constant-curvature spaces; product spaces supply their own spreading. Compare with per-space body files before deciding.
- pros/cons: Pro: one body per kind, Euclidean byte-identical when spreading = d². Con: H²×R and Nil spreading are direction-dependent and the sphere-cone sampler has no simple analogue; needs a math write-up first.
- checker note: Lines up with the code. quad.glsl:10-11 has the METRIC EXEMPTION that promises 'curved spaces get new bodies'. LightKindDescriptor has a single `glsl: string` field (descriptors.ts:216). light_tree.glsl uses raw dot() for d², the AABB/plane cull and the cone (lines 32-75) and has no exemption note. No mechanism exists for choosing a body per space. The proposed fix (ambient_spreading) is untested.

### MLC-10 — Light sample contract assumes one connecting geodesic; false in S³

- kind: euclidean-assumption; reader confidence: inferred; checker: **confirmed**
- evidence: structs.glsl `struct LightSample { Direction wi; float distance; ... }` (one direction, one distance); transport light.glsl:20-22 `Point light_p = ambient_geodesic(hit.p, ls.wi, ls.distance); shadow_ray.direction = ambient_direction_to(shadow_ray.origin, light_p);`
- why it matters: In S³ every light point is reached along the short and the long great circle (antipode is a caustic); an unbiased NEE must account for both (two images, or a stochastic choice with its probability). This is a contract-level question, not a body swap.
- suggestion (thought-through-not-checked): Record as an open design question for the S³ ambient: either sample one of the two geodesics with known probability folded into pdf, or treat each light as two virtual lights.
- pros/cons: Pro: decided before S³ code exists. Con: none to deciding now; implementation affects MIS pdf replay (lighting_pdf must know which geodesic was hit).
- checker note: LightSample holds one wi and one distance (structs.glsl:89-96). light.glsl:20-22 builds light_p = ambient_geodesic(hit.p, ls.wi, ls.distance) and aims the shadow ray with ambient_direction_to. The S³ point is mathematically sound: each light point arrives from two distinct directions, wi along the short arc and −wi along the long arc. This is still a design question, not a defect; nothing in S³ exists yet. Nil and other product geometries can also have several connecting geodesics, so the question is broader than S³.

### MLC-11 — Environment is keyed on a world direction alone; directional/beam and MAX_DIST sky have no S³ meaning and are point-dependent in H³

- kind: euclidean-assumption; reader confidence: checked; checker: **confirmed**
- evidence: environment.ts:91-94 `'Radiance environment_radiance(vec3 dir, Wavelengths wl)'`, `'float environment_pdf(vec3 dir)'`; sampler_cdf.glsl:76 `LightSample environment_sample(Point p, vec2 xi, Wavelengths wl)` ignores p; directional.glsl `ls.distance = MAX_DIST;` `ls.wi = -l.direction;`
- why it matters: In H³ the ideal-boundary point a ray reaches depends on (p, dir); in S³ rays return and there is no infinity. A direction-only env and 'parallel' delta-direction lights are Euclidean concepts; the env pdf/radiance seams will need a point (and a frame) argument.
- suggestion (thought-through-not-checked): When the curved-space design starts, add Point to environment_radiance/pdf (Euclidean ignores it) and decide whether H³ env lives on ∂H³ or in the camera frame; mark directional/beam as Euclidean-only in the Validator.
- pros/cons: Pro: seam change is mechanical in E³. Con: changes a provided signature; env-chart bake tables would need re-thinking for ∂H³.
- checker note: environment.ts:95 and :101 give signatures keyed only on `vec3 dir`. sampler_cdf.glsl:66 (not :76) `environment_sample(Point p, …)` does not use p. directional.glsl:21-22 sets wi = -l.direction and distance = MAX_DIST. Only the line number is off.

### MLC-12 — Material and microfacet GLSL use Euclidean normalize/reflect on world Directions

- kind: euclidean-assumption; reader confidence: inferred; checker: **confirmed**
- evidence: lambert.glsl:23 `s.wi = normalize(f.t * (...) + f.b * (...) + n * cos_theta);`; dielectric.glsl:31 `s.wi = normalize(2.0 * cos_i * n - wo);`, :39; microfacet.glsl `Direction microfacet_from_local(Frame f, vec3 v) { return normalize(f.t * v.x + f.b * v.y + f.n * v.z); }`; materials.ts:941 emission gate `dot(wo, ${formatVec3(cone.direction)})`
- why it matters: With vec4 Directions in the hyperboloid model, GLSL normalize uses the Euclidean 4-norm, so the result is not metric-unit and ambient_geodesic(o, d, t) distances go wrong. Local-frame math (via ambient_dot) is already correct.
- suggestion (thought-through-not-checked): Route these through an `ambient_normalize(v, p)` seam (Euclidean = normalize), or drop normalize where the combination is already unit in the metric.
- pros/cons: Pro: small, mechanical, byte-identical in E³. Con: one more seam function; easy to forget in new occupants unless a lint/test scans for raw normalize.
- checker note: Raw normalize/reflect on world Directions: lambert.glsl:23, checker.glsl:34, mirror.glsl:27, dielectric.glsl:31 and :39, microfacet.glsl:26 (microfacet_from_local), and rough_dielectric.glsl:110 and :118 (these work in local coordinates, so they are fine). The materials emission gate uses raw dot (materials.ts:941). The reader's list misses checker.glsl:34 and mirror.glsl:27. Euclidean ambient_direction_to itself uses normalize, which is correct for that occupant. The claim about the hyperboloid model is inferred, not tested, but follows from the math.

### MLC-13 — Two-stage env selection wrapper emitted by two near-identical code blocks

- kind: duplication; reader confidence: checked; checker: **confirmed**
- evidence: lighting.ts:609-625 (CDF regime) and lighting.ts:880-895 (bvh regime) both push `'LightSample lighting_sample(LightQuery q, vec2 xi, Wavelengths wl) {'`, `'    if (xi.x < u_envSelectProb) {'`, ... `'    ls.pdf *= (1.0 - u_envSelectProb);'` line for line.
- why it matters: The byte-match invariant between sampler and lighting_pdf / miss-MIS depends on these staying identical; a fix in one would silently miss the other.
- suggestion (checked): Extract `envTwoStageWrapper(): string` called by both regimes.
- pros/cons: Pro: one copy; output byte-identical (digest-provable). Con: none material.
- checker note: lighting.ts:609-625 and :884-899 emit the same lighting_sample wrapper line for line; only the leading comment differs. The `stage0` expression is also built twice, at :645 and :908.

### MLC-14 — Smaller duplications: struct-name derivation ×4, env_rotate_cs GLSL ×2, CIE Simpson quadrature ×2, two rotation rails

- kind: duplication; reader confidence: checked; checker: **partly**
- evidence: lighting.ts:113, 408, 434 `kind[0].toUpperCase() + kind.slice(1) + 'Light'` while lightStructName exists at :708; environment.ts:33 and EnvironmentBake.ts:55 both define `vec3 env_rotate_cs(vec3 d, vec2 cs)`; blackbody.ts:25-37 and gaussian.ts:27-41 identical `for (let interval...) for (let sample = 0; sample <= 10; ...)` Simpson loops; equirect uses additive `u_envRotation` (equirect.glsl), octahedral/procedural use `u_envRotCS` matrix (environment.ts:39-45).
- why it matters: Each pair must be kept in step by hand; the two rotation rails forced the bake shader to shadow both uniforms (EnvironmentBake.ts:44-53).
- suggestion (thought-through-not-checked): Use lightStructName everywhere; one ROTATE_BLOCK constant imported by the bake; a `integrateCIE(fn)` helper in spectral/; consider making equirect use env_rotate_cs too (one rail).
- pros/cons: First three: trivial, byte-identical. Single rotation rail: removes u_envRotation but changes equirect GLSL (needs chart witnesses X-CHART).
- checker note: Confirmed: the struct name is derived inline at lighting.ts:113, :408 and :434 even though lightStructName exists at :707. env_rotate_cs is written in both environment.ts:33 and EnvironmentBake.ts:55. There are two rotation rails (u_envRotation vs u_envRotCS), and the bake shadows both (EnvironmentBake.ts:46-53). Overstated: the blackbody.ts and gaussian.ts loops are not identical. They share the Simpson node and weight scheme, but blackbody integrates XYZ of a Planck shape while gaussian computes D65-weighted RGB ratios (num/den). A shared helper could only be the quadrature skeleton, a callback over (lambda, weight, fraction). It cannot be one integrateCIE(fn).

### MLC-15 — Inconsistent policy for unknown models/kinds: some lookups throw, others fall back to a guessed value

- kind: guess; reader confidence: checked; checker: **confirmed**
- evidence: materials/index.ts:64-69 `if (d === undefined) return true;` (unknown model assumed two-sided); materials.ts:425-443 unknown model treated as non-delta ("Fail SAFE"); lighting.ts:355 `: 1e-8;   // backstop; the Validator rejects unregistered kinds`; versus materials/index.ts `materialModel()` throws and lighting.ts `lightKind()` throws.
- why it matters: Owner rule: the system never guesses; missing facts are errors. These paths are claimed unreachable, so a throw costs nothing and makes the policy uniform.
- suggestion (thought-through-not-checked): Replace the fail-safe fallbacks with the throwing lookups (materialModel / lightKind).
- pros/cons: Pro: one policy, fewer comments defending polarity. Con: if any path is reachable today (e.g. 'none' handling), it becomes a crash — check callers first.
- checker note: materials/index.ts:64-69 (modelTwoSidedShading returns true for an unknown model), materials.ts:32-35 and :428-430 (modelNonDeltaLobes returns undefined, which is treated as non-delta) and lighting.ts:355 (1e-8 backstop) all fall back. materialModel (index.ts:44) and lightKind (lighting.ts:358) throw. 'none' is handled explicitly before each fallback, so throwing would not break the 'none' path. Note that the fail-safe polarity was a deliberate answer to an earlier review finding (comment at materials.ts:426-429). Changing it reverses a documented decision, now in tension with the owner's later no-guesses rule, so take it to the owner rather than silently 'fixing' it.

### MLC-16 — materialReadsUv assumes every GLSL-expression row reads uv

- kind: guess; reader confidence: checked; checker: **partly**
- evidence: src/compiler/plan/dataTenants.ts:54-55 `return (MATERIAL_MODELS[mat.model ?? '']?.capabilities.readsUv ?? false) || Object.values(mat).some(isGlslExpression);`
- why it matters: An expression of p only still forces keepsLocalFrame (no fold, no table dispatch, frame-tier instance records). Conservative, so never wrong, but the decision is not from a declared fact.
- suggestion (thought-through-not-checked): Low priority: decide from whether the expression source references `uv` (or let expressions declare it).
- pros/cons: Pro: exact fact. Con: source scanning is fragile; may not be worth it.
- checker note: The code is as cited (dataTenants.ts:54-55). It is not an undeclared guess, though. The docstring says 'COARSE by choice (owner Jul 21) … correctness-safe, slightly over-eager … Precise per-formula uv-detection is the noted follow-up.' This is an owner-chosen, documented conservative rule with a planned follow-up. The genuinely undeclared part is `?.capabilities.readsUv ?? false` for an unknown model, the same pattern as MLC-15.

### MLC-17 — Ambient README understates where Euclidean code lives; octahedral header names a nonexistent twin path; occupant/kind lists stale

- kind: doc-code-mismatch; reader confidence: checked; checker: **confirmed**
- evidence: src/components/ambient/README.md:25 "Two places are DECLARED Euclidean-only beyond the seam" vs 14 files with METRIC EXEMPTION (grep) plus light_tree.glsl; octahedral.glsl header "LINE-FOR-LINE TWIN of src/engine/loaders/octahedral.ts" — engine/loaders contains only blueNoise.ts, build-environment-sampler.ts, hdr-loader.ts; materials/README.md:59 occupant list lacks rough_dielectric and checker; CLAUDE.md and color/README.md omit the registered `gaussian` kind (color/spectra/index.ts:13).
- why it matters: The curved-space planner will read the ambient README to size the work; it would miss the lights, charts and light tree.
- suggestion (checked): Update the four docs.
- pros/cons: Doc-only; no risk.
- checker note: ambient/README.md:25-28 names only two Euclidean-only places (analytic media and equiangular). METRIC EXEMPTION appears in 14 files: 9 light GLSL files, 3 env GLSL files, equirect.md and math.glsl. light_tree.glsl uses raw dot() with no note. octahedral.glsl:9 names src/engine/loaders/octahedral.ts, which does not exist; the twin is src/components/env/octahedral/octahedral.ts. materials/README.md:59-62 lists only lambert, dielectric, ggx and mirror. color/README.md and CLAUDE.md never mention the gaussian kind (added in f720e64); spectra/README.md does list it.

### MLC-18 — No way to compose BSDF models (layered/coated, principled) and a single-purpose shared-library flag

- kind: extension-friction; reader confidence: checked; checker: **confirmed**
- evidence: descriptors.ts guardrail: "a descriptor declares facts about ONE model ... may NOT reference other descriptors"; model GLSL is included only when that model is present (materials.ts `for (const model of plan.program.materials.models) blocks.push(...)`); `usesMicrofacet?: boolean` is the only shared-library include gate (descriptors.ts).
- why it matters: A coated-diffuse or OpenPBR-style model must re-implement lambert/ggx lobes inside its own file, and each new shared library (Kulla–Conty tables, conductor Fresnel, sheen) would add another boolean.
- suggestion (thought-through-not-checked): Generalize `usesMicrofacet` to `uses: string[]` over glsl/core BSDF libraries, and move reusable lobes (cosine hemisphere, Schlick/conductor Fresnel) there, as was done for microfacet.
- pros/cons: Pro: keeps the no-cross-component rule while allowing composition through core libraries. Con: grows glsl/core; decide with the layered-material design, not before.
- checker note: descriptors.ts:10-12 has the one-model guardrail. usesMicrofacet (descriptors.ts:116) is the only shared-core include gate on MaterialModelDescriptor. Composition is a future design question (improvements §2.6 layered). Correctly framed as 'decide with the layered design'.

### MLC-19 — Curved-space, normal-mapping, multi-material and emitter-profile scaffolding in this area (not dead)

- kind: in-progress; reader confidence: checked; checker: **confirmed**
- evidence: ambient/ has one occupant (euclidean); structs.glsl Hit.ng comment "later normal/bump maps"; Hit.element "Future tenants: per-triangle index (multi-material meshes)"; interaction.glsl:11 "deferred LOBE_GLOSSY/DIFFUSE"; docs/fable-emitter-profiles.md "FUTURE POSSIBILITY" with softbeam as v0; spectral/README "compile-time coefficient folding has not been implemented"; claude-improvements-2026-09.md §2.4–2.7 (Kulla–Conty, conductor, layered, light-tree orientation cones).
- why it matters: These are deliberate seams for planned work; a cleanup must preserve them.
- suggestion (checked): Keep; reference them from the relevant README 'Deferred' lines so they are not mistaken for dead code.
- pros/cons: No code change.
- checker note: Verified: structs.glsl:33 (Hit.ng, 'later normal/bump maps'), structs.glsl:47 (Hit.element, 'Future tenants'), interaction.glsl:11 (deferred LOBE_GLOSSY/DIFFUSE) and spectral README:125 (coefficient folding not implemented). These are deliberate scaffolding for planned work and must be kept.

### MLC-20 — lighting.ts carries two full selection regimes and materials.ts carries all media codegen

- kind: complexity; reader confidence: checked; checker: **confirmed**
- evidence: generate/features/lighting.ts 940 lines: generateLightSampling/generateLightingPdf (CDF) and generateLightSamplingBvh/generateLightingPdfBvh/generateLightRowLoaders/generateLightTreeWalks (bvh), plus env selection probability and radius; generate/features/materials.ts 954 lines of which lines ~498-860 are media tables, medium properties, medium sample/survival/transmittance, majorants.
- why it matters: The owner wants code easy for one person to read; the materials feature file is half about media, and the two light regimes duplicate the outer structure (dispatch, two-stage wrapper, pdf composition).
- suggestion (thought-through-not-checked): Split media codegen into its own feature file (generate/features/media.ts); consider expressing both selection regimes as one dispatcher with a pluggable 'select(q, xi) -> (id, pmf)' / 'pmf(q, id)' pair, so per-kind sample/pdf arms are written once.
- pros/cons: File split: pure move, digest-identical. Unified selection: fewer lines, but bvh table loaders vs CDF accessors differ in how the struct is obtained; needs a careful design and digest compare.
- checker note: lighting.ts is 940 lines and materials.ts 954. In materials.ts, generateMediaTables (:503) through generateMediumTransmittance (ending about :866) are all media codegen, about 360 lines. The two light regimes repeat the wrapper and the stage0 code (see MLC-13).

### MLC-21 — Spectral lift cost: constant colors are re-lifted per evaluation by an 8-fetch trilinear atlas lookup

- kind: research-note; reader confidence: checked; checker: **partly**
- evidence: lookup.glsl `spectral_coefficients` (6-step binary search + 8 texelFetch) called from `color_lift_reflectance` for every lifted value; spectral/README: "Production constants currently use the GLSL lookup too; compile-time coefficient folding has not been implemented"; benchmark there: table lookup 1.479–1.879 vs polynomial-only 0.146–0.254 ms/draw (SwiftShader).
- why it matters: Constant colors could be folded to 3 polynomial coefficients at compile time (lookup.ts already exists on the CPU), likely a large spectral-mode speedup for typical scenes.
- suggestion (thought-through-not-checked): When spectral performance matters, have the rgb spectrum kind emit folded coefficients for constants (spectral program only).
- pros/cons: Pro: CPU lookup already matches GPU bytes. Con: only constants benefit; live sliders/expressions still look up.
- checker note: The mechanism is right: spectral_bounded calls spectral_coefficients for every lift, and lookup.glsl:14-34 does 6 binary-search fetches, 2 z fetches and 8 node fetches (16 texelFetch, not 8). Folding is documented as not implemented (README:125). The 'likely large speedup for typical scenes' is overstated. The README:163-168 benchmark is a SwiftShader draw/readback microbenchmark of one repeatedly accessed color, and the README explicitly says it is 'not native GPU shader timings or a scene-level speed estimate'. Scene-level benefit is unmeasured.

**Checker: missed by the reader**

- lighting.ts:126-127 has an orphaned comment fragment, 'Hoisted light consts (struct-alignment batch, the N5 pattern): every light is', which runs straight into the accessor comment. It is a leftover from the superseded hoisted-const ABI (same cause as MLC-2), and descriptors.ts:209 also still says 'hoisted consts'.
- The bvh selection regime has the same stage0 expression and per-kind `kind === 'mesh'` arm twice (sampler :848, pdf :918), and the sphere instance-batch arm three times (presentKinds :106, sampler :870, pdf ~:928). Sphere is a second per-kind special case beside mesh, which the README's no-branches claim also misses.
- The env-chart bake shader (EnvironmentBake.ts:46-53) carries history in comments ('compiler-pass C1', 'retired env_rotate_y contract'), against the CLAUDE.md no-history rule. The same applies to env/index.ts:4 ('D3: … are dead'), which is probably why MLC-3 misread it.

**Reader questions for the owner**

- Curved spaces: for light sampling, do you prefer one body per light kind written against ambient functions (direction-to, distance, a 'spreading' Jacobian factor), or separate per-space bodies? H2xR and S3 (two geodesics per light point) make the first harder.
- Should emission become a material-level property independent of the BSDF model (so glossy/glass surfaces can glow), or stay a per-model function with only lambert emissive?
- For the planned eta/k conductor: is a new Spectrum-valued, non-collapsing 'optical constant' role acceptable in the spectrum-role vocabulary?
- In H3, should the environment live on the ideal boundary (radiance depends on where the geodesic ends, hence on the point) or be attached to the camera frame? In S3 is there an environment at all?
- Is the checker model meant to stay as a separate occupant now that expression albedo rows on lambert can express the same pattern (kept as a uv-path test occupant)?
- Should 'unreachable backstop' fallbacks (unknown model assumed two-sided / non-delta, unknown light power 1e-8) become throws to match the no-guesses rule?


## transport-media-camera

One sample per fragment runs a generated main() (accumulation.ts:14-26): rng_init (pcg4d), then pixel_sample (box), then camera_generateRay (6 cameras), then transport_trace (the generated walk), then color_to_pixel (sensor), then the accumulator's update rule. A separate display pass applies the tonemap curve. The image-pipeline families (camera, pixel, sensor, sampler, accumulator, tonemap) are small and uniform: a descriptor, one GLSL function, one registry line. Their only problems are stale READMEs.

Transport is the core. flags.ts reads about 20 decisions once from ProgramDescription. pt.ts (475 lines of TS that emit GLSL) generates the walk, PathState, both roulette rules and the light-query constructors. combiner.ts generates the NEE/MIS weight functions, so pt, pt-nee and pt-mis are three sets of function bodies. Static technique GLSL holds the math: kernel/ (BSDF and phase sampling, scored one vertex late through the generated kernel_record), light/ (NEE at surface and medium vertices) and equiangular/. The walk per bounce runs: medium segment (medium_sample, which returns weight, scatter, GRIN deflection or emission), then a null-interface pass-through, then surface emission, NEE, continuation, medium tracking, roulette and spawn. maxBounces=N counts surface events, medium scatters and GRIN traversals. Null crossings have their own budget, which shadow rays share. There is no medium stack: one current_medium is self-healed from hit.region_from.

The volume arms come in a 2x2 plus GRIN: Beer-Lambert, analytic channel-MIS, ratio tracking, delta tracking (Kutz), and a Verlet GRIN walker. They are static GLSL with no descriptor or registry. The compiler's materials.ts includes and routes them per medium using shared predicates. The estimator.volumeSampling knob does not select an arm; the scene does, and the Validator forces the knob to agree.

The ambient seam (euclidean only) supplies geodesic point, dot, frame, direction_to and parallel_transport. parallel_transport is never called. Point and Direction are fixed to vec3 in core structs.glsl. These go through the seam: ray_spawn, NEE light-point reconstruction and aiming, the medium arms' point stepping, and intersection hit points. These bypass it: the arrival direction (wo = -s.ray.direction is the direction at the ray origin, and there is no geodesic-tangent flow), shadow distance (length()), the light samplers' Jacobians (declared exempt), equiangular, GRIN (all vec3), phase functions (raw dot plus build_basis), the cameras, and MAX_DIST used as a geodesic parameter. A curved ambient would need these new pieces: the types, the flow of (p,v), distance, a two-endpoint area-to-solid-angle Jacobian, handling of non-unique geodesics in S3, an asymptotic environment direction, and position-aware phase frames. The 1-D media math (arc length) is already curved-correct.

Concrete defects found: the known 'light_query_medium seam-unused' warning is explained (pt.ts provides and emits it unconditionally, and the GRIN branch calls it without declaring the require). Several docs contradict the code.

### F1 — Root cause of the known 'light_query_medium provided, nothing requires it' warning

- kind: defect; reader confidence: checked; checker: **confirmed**
- evidence: pt.ts:85 provides light_query_medium unconditionally; pt.ts:136-138 always emits its body. Only kernel.ts:73 (`if (f.scattering) req.push('interaction_medium_sample', 'light_query_medium')`) and light.ts:33 require it. The walk itself calls it in the GRIN branch (pt.ts:358 `kernel_record(s, 1.0, light_query_medium(ms.exit_p), true);`), but walkRequires (pt.ts:98-112) never pushes it for f.deflecting. merge.ts:80-87 warns on any non-componentScoped provide that nothing requires.
- why it matters: CLAUDE.md lists this as an uninvestigated defect in 221 scenes. Media-free programs carry an uncalled function, and a GRIN-only (non-scattering) program gets a false 'dead code' warning for a function it does call. The same defect can recur wherever hand-written requires lists drift.
- suggestion (thought-through-not-checked): Emit and provide light_query_medium only when f.scattering || f.deflecting, and add it to walkRequires when f.deflecting. The digest should change only for programs that drop the dead function.
- pros/cons: Pros: a few lines; removes the warning and the dead code, following the existing exact-linkage pattern. Cons: changes the shader text of about 221 programs (expected; check with the digest that only that block disappears). I have not counted which scenes are affected.
- checker note: Checked. pt.ts:85 provides light_query_medium unconditionally and lightQueryFns (pt.ts:136-138) always emits its body. The walk's GRIN handoff calls it (pt.ts:358, emitted under f.deflecting), but walkRequires (pt.ts:98-112) never adds it. The only requirers are kernelRequires (f.scattering, kernel.ts:73) and lightRequires (f.scattering && !f.equiangular, light.ts:33). merge.ts is at src/compiler/generate/features/merge.ts:80-87, not compiler/generate/merge.ts. It warns on any provide that is not componentScoped and that nothing requires. The diagnosis follows from the code. I did not compile a GRIN-only, non-scattering scene to watch the false warning appear.

### F2 — No arrival direction: the seam flows points, not tangents, so wo and the event and escape directions use the ray's ORIGIN direction

- kind: euclidean-assumption; reader confidence: checked; checker: **confirmed**
- evidence: ambient_geodesic returns only a Point (euclidean.glsl:6-8). Hit has no arrival-direction field (structs.glsl:24-56). Uses of the origin direction at the far end: pt.ts:420 `Direction wo = -s.ray.direction;`; intersection.ts:1694 `ambient_dot(ray.direction, hit.ng, hit.p)` (tangent at the origin dotted with the normal at hit.p); kernel.glsl:13 `environment_radiance(s.ray.direction, ...)`; analytic.glsl:32 and delta_tracking.glsl:111 `exit_dir = ray.direction`; grin.glsl:325 same. Documented as open in fable-reference-implementations.md §10: 'the ray's direction at a far hit ... needed for wo in curved space ... resolved when the first curved backend is built'. That same section says 'the march loop, the transport loop ... are untouched', which overclaims.
- why it matters: This is the single biggest gap between the seam and H3, S3 and H2xR. Every BSDF evaluation, region classification, medium event and sky lookup would be wrong in curved space.
- suggestion (thought-through-not-checked): Make the geodesic flow return the full state (point and unit tangent at t), as the old thurston-rebuild repo does (`Vector flow(Vector v, float t)`, src/geometries/hyp/geometry/shaders/part2.glsl:78). Then have scene_intersect record the arrival direction on Hit (or a Ray at the hit), and have the walk, classification and the medium arms read that instead of ray.direction.
- pros/cons: Pros: one concept (tangent-bundle flow) fixes six call sites. In Euclidean space the arrival direction equals ray.direction, so a digest comparison can show it is byte-identical if the field is just assigned. Cons: it touches the Hit contract (which the owner must approve) and every intersection arm that fills Hit. ambient_parallel_transport could serve instead, but it is ambiguous in S3.
- checker note: Checked. ambient_geodesic returns only a Point (euclidean.glsl:6-8), and Hit has no arrival-direction field (structs.glsl). All the cited uses are as described: pt.ts:420 wo; intersection.ts:1694 ambient_dot(ray.direction, hit.ng, hit.p); kernel.glsl:13; analytic.glsl:32; delta_tracking.glsl:111; grin.glsl:325. One more site uses the origin direction: pt.ts:410 `ray_spawn(hit, s.ray.direction)` at null crossings. fable-reference-implementations.md:688-696 does say both 'the transport loop ... untouched' and that the far-hit direction is open, so the overclaim is real.

### F3 — estimator.volumeSampling selects nothing; the scene decides the arm and the Validator forces the knob to agree

- kind: duplication; reader confidence: checked; checker: **confirmed**
- evidence: No generator reads estimator.volumeSampling (full grep: only Planner.ts:518,572, Validator.ts:586-616, types). The arms are routed per medium by mediumRoutesToTracking(med, scatters) in materials.ts:700-718. Validator.ts:612-615 errors when 'the scene has media that need the null-collision arms but volumeSampling is analytic', and Validator.ts:605-608 warns that 'delta-tracking controls nothing here' otherwise.
- why it matters: The user must author a value that has exactly one legal answer, which is derived from the scene: two places answer one fact. It also cannot express a real estimator choice, such as delta-tracking a constant medium.
- suggestion (thought-through-not-checked): Either (a) drop the knob and record the per-medium arm in ProgramDescription.media (e.g. arms: {matId: 'beer'|'analytic'|'ratio'|'delta'|'grin'|'grin-scatter'}) so the generators look it up, or (b) make the knob a real estimator choice that, when set to delta-tracking, routes constant scattering media to tracking too.
- pros/cons: (a) Pros: deletes the knob, three Validator rules, and the re-evaluation of predicates in generators. Cons: it is an authoring-surface change, so existing strategies that set the field need migration or a reject message. (b) Pros: gives the knob meaning, as the taxonomy intends. Cons: it adds a case (tracking constant media) that has to be witnessed.
- checker note: Checked. No generator reads program.estimator.volumeSampling; the only uses are Planner.ts:518,572 and the type. Routing is per medium (mediumRoutesToTracking, materials.ts:701). Validator.ts:604-615 warns when 'delta-tracking' controls nothing and errors when the scene needs tracking but the knob says 'analytic'. One nuance: 'delta-tracking' on a constant-media scene is legal, with a warning, so there is not strictly one legal answer, but either value selects the same arms. The knob also gates the MIS rejection (Validator.ts:599-603), which is again a fact derived from the scene.

### F4 — Contradictory claims about whether the medium bodies are curved-correct

- kind: doc-code-mismatch; reader confidence: checked; checker: **confirmed**
- evidence: ambient/README.md:25-28 and euclidean.md:22-25 say 'the analytic medium bodies (distances along segments) ... need new bodies, not just a new metric, in curved space'. delta_tracking.glsl:27 says 't is an extrinsic distance'. fable-volumetric-component.md:196-199 says the opposite: 'because the component speaks only arc length and advances via ambient_geodesic, homogeneous media are already correct in curved spaces'. The code (analytic.glsl, delta_tracking.glsl) uses only the 1-D parameter t and ambient_geodesic.
- why it matters: A future curved-space plan could budget rewrites of the media arms that are not needed. The volumetric doc is right, provided scene_intersect returns arc length and the exit direction issue (F2) is fixed.
- suggestion (thought-through-not-checked): Correct ambient/README.md, euclidean.md and the delta_tracking.glsl header to say that the 1-D media math is curved-correct given arc-length t. The truly Euclidean pieces are equiangular, shadow distance, exit_dir and GRIN.
- pros/cons: Pros: documentation only. Cons: none, beyond confirming the arc-length assumption about intersection when a curved space is designed.
- checker note: Checked. ambient/README.md says the analytic medium bodies 'need real work, not just a new occupant'. euclidean.md:22-25 says they 'need new bodies'. delta_tracking.glsl:27-29 calls t 'an extrinsic distance' and curved tracking 'a research item'. fable-volumetric-component.md:196-199 says homogeneous media are already correct in arc length. The code uses only the 1-D parameter t and ambient_geodesic, so the volumetric doc is right, assuming unit-speed geodesics and that hit.t is arc length. The exit_dir and wo problem (F2) remains.

### F5 — Shadow-ray distance uses Euclidean length(); there is no ambient distance

- kind: euclidean-assumption; reader confidence: checked; checker: **confirmed**
- evidence: shadow/opaque/opaque.glsl:17 `float maxDist = length(light_p - shadow_ray.origin) - SHADOW_BACKOFF;` and shadow/media/media.glsl:39 `float remaining = length(light_p - seg_ray.origin) - SHADOW_BACKOFF;`. The comment at media.glsl:23-24 acknowledges it ('a geodesic-distance ambient helper is the curved-space follow-up'), as does trace-loop-contract.md:147-148.
- why it matters: This is one of the two-point-problem functions that every curved ambient must supply. In H3 the hyperboloid points are vec4 and the chord length is meaningless.
- suggestion (thought-through-not-checked): Add ambient_distance(p, q) to the ambient contract (Euclidean: length(q-p)) and call it in both shadow bodies.
- pros/cons: Pros: two-line call-site change; byte-identical in Euclidean space if inlined the same way. Cons: adds a fifth function to every future occupant (which it needs anyway: the old repo has dist(p,q)).
- checker note: Checked: opaque.glsl:17 and media.glsl:39 use length(light_p - origin). The code comment at media.glsl:23-24 and trace-loop-contract.md:147-148 both name a geodesic-distance ambient helper as the curved-space follow-up.

### F6 — The NEE geometric term (area to solid angle) lives inside the light samplers as Euclidean d^2

- kind: euclidean-assumption; reader confidence: inferred; checker: **confirmed**
- evidence: quad.glsl:30 `ls.pdf = d2 / (l.area * cos_l);`, quad.glsl:40, point.glsl:18 `ls.radiance = l.intensity / d2;`, equiangular.glsl:56 `intensity / d2`. The light samplers declare 'METRIC EXEMPTION' (point.glsl:6, quad.glsl:10, sphere.glsl:7). light.glsl:20 rebuilds the light point from (wi, distance) via ambient_geodesic instead of receiving it.
- why it matters: In H3 the falloff is sinh^2(d) and in S3 sin^2(d). In H2xR it depends on direction (along a horizontal geodesic one transverse Jacobi field grows like sinh and one like t), so a function of distance alone is not enough. As things stand, every light kind would need a new occupant per space.
- suggestion (thought-through-not-checked): Have area lights sample a point (and normal) on the emitter, and add LightSample.p. Let the ambient supply direction_to, distance and a two-endpoint Jacobian ambient_area_to_solid_angle(p, q, n_q), so light samplers stay space-independent for area lights. Directional and environment lights stay direction-sampled.
- pros/cons: Pros: one Jacobian per space instead of N light kinds per space; removes the reconstruct-from-direction step at light.glsl:20 (pbrt's LightLiSample carries pLight). Cons: it touches the LightSample struct and nine light samplers (the lights area); solid-angle samplers (sphere cone sampling) do not fit an area-point form; and it is a design question for the owner, not a refactor.
- checker note: Checked. quad.glsl:17-30 (d2, with pdf = d2/(area·cos_l) at line 30), point.glsl:18, equiangular.glsl:45-56 and light.glsl:20 (light_p rebuilt via ambient_geodesic(hit.p, ls.wi, ls.distance)). Nine samplers carry the METRIC EXEMPTION note. Context: euclidean.md:26-28 already states the current design choice, that light samplers 'get new occupants per space'. The suggestion therefore revisits a documented position and is not a fix for an oversight. The owner should decide it as a design question.

### F7 — S3 has many geodesics between two points: single-direction NEE would break pt and pt-nee equality

- kind: research-note; reader confidence: inferred; checker: **confirmed**
- evidence: ambient_direction_to returns one direction (euclidean.glsl:31-33), and light.glsl / light_medium.glsl make one shadow connection per sample. The estimator-equality invariant (CLAUDE.md: pt, pt-nee and pt-mis must converge to the same image) requires NEE to cover every path the BSDF walk can find.
- why it matters: In S3 light from q reaches p along the short great-circle arc, the long arc, and wraps (MAX_DIST=1000 is about 159 circumferences). BSDF paths find all of them, while NEE finds one. H3 and H2xR are uniquely geodesic (nonpositive curvature), so this matters only for S3 and other positively curved spaces.
- suggestion (thought-through-not-checked): When designing the S3 occupant, decide explicitly: either enumerate connecting geodesics in NEE (and the MIS pdf), or declare a measurement truncation (for example, 'paths whose segments are shorter than pi'), applied to BSDF paths too.
- pros/cons: Pros: forces the decision into the bias ledger, where the taxonomy wants it. Cons: either choice is real work. Enumerating makes the light interface plural; truncating changes what S3 images mean.
- checker note: Reasoning checked against the code: one shadow connection per sample (light.glsl via ambient_direction_to, a single direction), and MAX_DIST=1000 (≈159 great circles at unit radius). This is a valid research note for S3. Nothing in the docs addresses the conjugate or multiple-geodesic issue. H3 and H2xR have nonpositive curvature and unique geodesics, so they are unaffected, as the finding says.

### F8 — MAX_DIST is used both as a far clip and as a geodesic parameter for points 'at infinity'

- kind: euclidean-assumption; reader confidence: checked; checker: **partly**
- evidence: structs.glsl:91 `float distance; // ... (MAX_DIST for the environment and directional lights)`, so light.glsl:20 evaluates `ambient_geodesic(hit.p, ls.wi, ls.distance)` at t=1000. The walk passes `boundary ? hit.t : MAX_DIST` to medium_sample (pt.ts:331). kernel_score_miss treats escape as reaching the environment (kernel.glsl:11-14).
- why it matters: In the H3 hyperboloid model ambient_geodesic is cosh(t)o + sinh(t)d, and cosh(1000) overflows float32 (cosh(89) is about 2e38), giving inf or NaN. The environment there should be indexed by the asymptotic boundary point, not the initial direction. In S3 nothing escapes, so the miss branch never fires.
- suggestion (thought-through-not-checked): Give 'at infinity' its own representation: for example, a flag on LightSample so the walk aims by direction and skips the point reconstruction, plus an ambient_direction_at_infinity(p, v) for the environment lookup.
- pros/cons: Pros: removes a numeric landmine before any curved occupant exists, and is cheap in Euclidean space. Cons: more surface on the ambient contract; must be designed together with F2 and F6.
- checker note: Confirmed: LightSample.distance = MAX_DIST for environment and directional lights (structs.glsl), light.glsl:20 evaluates ambient_geodesic at that t, and the walk passes MAX_DIST to medium_sample (pt.ts:331). cosh(1000) overflows float32, even with the sketched renormalization in reference-implementations §10 (inf/inf gives NaN). Overstated: 'in S3 nothing escapes, so the miss branch never fires' is wrong. A closed geodesic that misses everything once misses on every lap, so after MAX_DIST scene_intersect returns false and kernel_score_miss does fire. The S3 problem is that the 'environment' it scores has no meaning, not that the branch is unreachable.

### F9 — Point and Direction are defined in fixed core, not by the ambient occupant; vec3 is hard-wired in signatures and literals

- kind: euclidean-assumption; reader confidence: checked; checker: **confirmed**
- evidence: glsl/core/structs.glsl:4-5 `#define Point vec3` / `#define Direction vec3`. AmbientDescriptor is only {type, glsl} (ambient/index.ts:14-19). Hard-wired vec3: pt.ts:137 `LightQuery(p, vec3(0.0), false)`, kernel.ts:35 the same, materials.ts:280 `scene_medium_properties(int mat, vec3 p, ...)`, materials.ts:665 `ior_at(int med, vec3 p, ...)`, environment.ts:95 `environment_radiance(vec3 dir, ...)`, grin.glsl throughout (`vec3 r = ray.origin`), equiangular.glsl:25,44.
- why it matters: The swappability claim ('a curved occupant replaces this file and Point may widen to vec4', euclidean.md:16-20) cannot hold while the occupant does not own the type and generated signatures spell vec3.
- suggestion (thought-through-not-checked): Let the ambient occupant's GLSL (or descriptor) define Point and Direction, include it before structs.glsl, and replace the vec3 spellings in generated signatures and the two literals with the typedefs.
- pros/cons: Pros: mechanical, and byte-identical after preprocessing in Euclidean space (check with the digest). Cons: the include order in core.ts changes (the ambient block currently comes after structs); GRIN and equiangular would still be Euclidean in their bodies, but they are declared Euclidean-only.
- checker note: Checked. `#define Point vec3` / `#define Direction vec3` are in glsl/core/structs.glsl:4-5. AmbientDescriptor is {type, glsl} only (ambient/index.ts:14-19). core.ts includes structs.glsl before the ambient block. vec3 is hard-wired in pt.ts:137, kernel.ts:35, materials.ts:253 (scene_material_properties, also vec3 p), 280, 286/665, environment.ts:70 (environment_pdf) and 95, and in equiangular.glsl:25,44. One addition: scene_material_properties (materials.ts:253,378) also spells vec3 p.

### F10 — ambient_parallel_transport and ambient_frame are curved-space scaffolding; parallel_transport has no caller yet

- kind: in-progress; reader confidence: checked; checker: **confirmed**
- evidence: euclidean.glsl:25-27 provides ambient_parallel_transport; a full grep finds no caller outside components/ambient. ambient_frame is called by intersection.ts:709,906,1025,1707. ambient/index.ts:2-6 describes 'the door exists BEFORE the first curved-space occupant'.
- why it matters: Deliberate scaffolding for H3, Nil and Schwarzschild. Do not delete it. Its natural first reader is the arrival-direction problem (F2), but in S3 'transport from p to q' needs a chosen geodesic.
- suggestion (thought-through-not-checked): Keep it. When F2 is designed, decide whether arrival direction comes from a flow of (p,v) or from transporting the seed direction; the flow is unambiguous in every space.
- pros/cons: Pros: no change now. Cons: none.
- checker note: A full grep of src and tests finds no caller of ambient_parallel_transport outside components/ambient; the only other matches are the snapshot copies of the occupant file. ambient_frame is called at intersection.ts:709,906,1025,1707. This is deliberate curved-space scaffolding (ambient/index.ts header 'the door exists BEFORE the first curved-space occupant'). Keep it.

### F11 — Volume arms and shadow bodies have no descriptors or registry; adding one means editing compiler generators and predicates

- kind: extension-friction; reader confidence: checked; checker: **confirmed**
- evidence: transport/volume/{analytic,delta_tracking,grin} and transport/shadow/{opaque,media} contain only .glsl/.md. They are imported directly by compiler/generate/features/materials.ts:23-26 and lighting.ts:24-25. Routing is in materials.ts:675-726 (generateMediumSample) and 820-850 (generateMediumTransmittance), using predicates in compiler/types.ts:351-417, the Planner (Planner.ts:513-560) and Validator rules (Validator.ts:497-616). transport/README.md:14 calls them 'pick-one bodies'.
- why it matters: The deferred ledger names more arms (decomposition tracking, Kettunen transmittance, grid media; fable-heterogeneous-media.md §6). Each one touches four compiler files, against the house rule 'adding an occupant = one folder + one registry line'.
- suggestion (thought-through-not-checked): Only when the next arm is planned: give each arm a small descriptor (which medium shapes it accepts, the GLSL function names for seams 1 and 2, whether it weights absorption or uses a lottery, its RNG use) and let one Planner function pick the arm per medium from those declared facts, recorded in the plan (see F3).
- pros/cons: Pros: fits the rest of the component library; makes F3's per-medium record natural. Cons: the arms are not uniform (the GRIN arms need ior_at and region tests; tracking needs a majorant), so the descriptor could grow fields. With only five arms, the current explicit code is arguably easier to read; do it when the sixth arrives, not before.
- checker note: Checked. volume/{analytic,delta_tracking,grin} and shadow/{opaque,media} have no .ts descriptor or index. They are imported raw by materials.ts:23-26 and lighting.ts:24-25, and routed in materials.ts:675 (generateMediumSample) and 823 (generateMediumTransmittance) using the predicates in compiler/types.ts:351-417. The finding's own 'wait for the sixth arm' framing is appropriate.

### F12 — Seam requirements are written by hand in three places that can drift

- kind: duplication; reader confidence: checked; checker: **confirmed**
- evidence: For each technique the called seams appear in: the GLSL header 'Depends on:' comment (e.g. kernel.glsl:6-9, light.glsl:4-6, equiangular.glsl:13-16), the TS list (kernelRequires kernel.ts:69-76, lightRequires light.ts:28-37, equiangularRequires equiangular.ts:18-21, walkRequires pt.ts:98-112), and the actual calls. F1 is a drift between the walk's call (pt.ts:358) and walkRequires.
- why it matters: One fact, three copies. The link check (merge.ts) is only as good as these hand lists.
- suggestion (thought-through-not-checked): Derive 'requires' from the emitted text: tokenize each block with comments stripped, and intersect its identifiers with the set of provided seam names. The *Requires functions and the header lists then go away.
- pros/cons: Pros: removes about 40 lines and a whole class of defects (F1); it is an exact fact, not a heuristic, if comments are stripped. Cons: it changes merge.ts, a central compiler file. It also weakens a deliberate design choice (declared requires as documentation), so it needs owner discussion.
- checker note: Checked: kernel.ts:69-76, light.ts:27-37, equiangular.ts (equiangularRequires), pt.ts:98-112, and the GLSL 'Depends on:' headers. F1 is a real instance of drift between a call and the hand-written list. The '~40 lines' figure is an estimate. Removing the hand-written requires is a design change to merge.ts and needs owner discussion, as stated.

### F13 — Equiangular restates Beer-Lambert instead of calling the medium_transmittance seam

- kind: duplication; reader confidence: checked; checker: **confirmed**
- evidence: equiangular.glsl:40-42 `Spectrum T_seg = spectrum_exp(-(m_evt.sigma_a + m_evt.sigma_s) * t);` with the comment 'the analytic arm's closed form, restated at this second site'. medium_transmittance(med, ray, len) is generated whenever media and NEE are both present (materials.ts:196, 826), which includes every equiangular program. Validator.ts:576-580 rejects equiangular with tracking media because 'its transmittance factor is the analytic closed form (deferred: ratio-tracked T along the sampled segment)'.
- why it matters: Two answers for segment transmittance. The seam call would give the ratio-tracked estimate for heterogeneous media automatically. That estimate is unbiased and independent of the other factors, so the product stays unbiased, which might lift a Validator restriction listed in the deferred ledger ('Equiangular × heterogeneous').
- suggestion (thought-through-not-checked): Replace T_seg with medium_transmittance(med_mat, s.ray, t).
- pros/cons: Pros: one line; one answer for transmittance; may enable a combination the docs list as deferred. Cons: for homogeneous media it recomputes MediumProperties at ray.origin rather than p_evt (same value when homogeneous); lifting the Validator rule needs a witness; tracking draws random numbers, so equiangular witness streams would change (but not their expected values).
- checker note: Checked. equiangular.glsl:38-42 restates Beer-Lambert, with the comment saying so. medium_transmittance is emitted when media.shadowWalker (= hasMedia && lighting !== null, Planner.ts:665), which every equiangular program satisfies. Signature: Spectrum medium_transmittance(int med, Ray ray, float len). The Validator rule is at Validator.ts:576-580. fable-volumetric-component.md §2 (Seam 4) already says 'transmittance is reconstructed independently', which supports the change. Caveat: equiangularRequires would need medium_transmittance added (the shadow walker already requires it, so no link change), and lifting the heterogeneous restriction needs a witness.

### F14 — The two GRIN arms each carry their own copy of the Verlet step, step limiters, capture and exit bisection

- kind: complexity; reader confidence: checked; checker: **confirmed**
- evidence: grin.glsl:215-282 (medium_sample_grin) and grin.glsl:345-407 (medium_sample_grin_scatter) repeat: grin_round_survives, `float n = length(T)`, capture, `h = min(GRIN_STEP, GRIN_DS_MAX / n); h = min(h, GRIN_DTOL * n / max(length(F), 1e-6));`, `T_half = T + 0.5*h*F; r_next = r + h*T_half`, the bisection loop, and the second half-kick.
- why it matters: This is the largest file in the area (411 lines). The integrator is the part most likely to change (analytic gradient, curved metric, Schwarzschild), and it would have to change in two places.
- suggestion (thought-through-not-checked): Extract a grin_step(inout state) helper returning the drift segment and whether the wall was crossed, plus a grin_bisect_exit helper; each arm keeps only its own bookkeeping.
- pros/cons: Pros: one integrator, roughly 50 fewer lines. Cons: GLSL has no closures, so the state goes in a struct. Floating-point operation order must be preserved or the GRIN witnesses will shift slightly (digest compare plus targeted GRIN witnesses). The owner asks that refactors not be mixed with feature work.
- checker note: Checked: grin.glsl is 411 lines. Both arms repeat grin_round_survives, the h limiters (lines 232/350), T_half/r_next (235-236/352-353), the bisection loop (251/362) and the second half-kick (279/404). The refactor caveats about floating-point order and witnesses are correct.

### F15 — Transport docs still say roulette is one function covering both sites

- kind: doc-code-mismatch; reader confidence: checked; checker: **confirmed**
- evidence: transport/README.md:46-47 'Single-emitter rule: RR (`roulette`) and the MIS record (`kernel_record`) are ONE generated function each — agreement between sites by construction.' pt.md:20-23 'the generated `roulette` — ... ONE function for both call sites.' The code: roulette() is called only at the surface site (pt.ts:456), and the medium site uses the separate roulette_interior (pt.ts:230-283, 385). pt.ts:16-21 explains the split.
- why it matters: The README is the contract a reader trusts. It describes an invariant that no longer holds, and the code explains why.
- suggestion (checked): Update README.md and pt.md to describe the two rules and when each exists (weightedAbsorption).
- pros/cons: Pros: documentation only. Cons: none.
- checker note: Checked. transport/README.md:46-47 and pt.md:20-23 still say one roulette covers both sites. The code calls roulette() only at the surface site (pt.ts:456) and roulette_interior at the medium site (pt.ts:385, emitted only under f.rr && f.weightedAbsorption). Tracking-arm medium events get no roulette call; that is deliberate (the tracking lottery). The pt.ts:14-22 explanation itself carries history phrasing ('USED TO BE', 'owner-approved') that CLAUDE.md's comment rules forbid.

### F16 — fable-volumetric-component.md (a design authority) is stale on the struct, the axis and what is built

- kind: doc-code-mismatch; reader confidence: checked; checker: **confirmed**
- evidence: §2 (lines 41-49) shows MediumSample without deflected/exit_p/exit_dir/eta_scale (compare structs_media.glsl:12-29). §2 lines 75-79 say 'Seam 4, named but unbuilt' (equiangular is built). §5 lines 183-192 list volumeIntegrator 'none'|'analytic'|'raymarch'|'delta-tracking'|'ratio-tracking' with delta-tracking 'Rejected-not-removed', while the code has volumeSampling 'none'|'analytic'|'delta-tracking' with delta tracking built (plan/types.ts:75). The §4 listing has the old signature without `ray` and `min(int(xi.x*3.0),2)` instead of spectrum_sample_channel (analytic.glsl:9,12).
- why it matters: CLAUDE.md names this doc the authority on media seams, so readers will be misled about which arms exist.
- suggestion (checked): Update the doc in place (the CLAUDE.md rule: update or archive superseded docs), marking §4's listing as the historical normative transcription and pointing to analytic.glsl as built.
- pros/cons: Pros: documentation only. Cons: the doc is owner-pinned, so edits need owner sign-off.
- checker note: Checked. The §2 MediumSample listing (lines 40-48) lacks deflected/exit_p/exit_dir/eta_scale. Lines 75-79 say 'Seam 4, named but unbuilt', but equiangular is built. §5 (lines 183-192) lists volumeIntegrator with delta-tracking 'Rejected-not-removed', while the code has volumeSampling 'none'|'analytic'|'delta-tracking' (plan/types.ts:75; the authoring type in compiler/types.ts:670 still has the raymarch/ratio-tracking values, which the Validator rejects). Line 147 has `min(int(xi.x * 3.0), 2)` versus spectrum_sample_channel in analytic.glsl:12.

### F17 — Smaller stale READMEs and comments in the image-pipeline and phase families

- kind: doc-code-mismatch; reader confidence: checked; checker: **confirmed**
- evidence: volume_scattering/README.md:3-5,41-42 says 'one occupant today ... medium events call hg_* directly (v1 — a generated phase dispatch arrives with the second occupant)', but rayleigh exists and the dispatch is generated (materials.ts:620-645). structs_media.glsl:10-11 says 'NO v1 strategy declares it' about radiance, but the emission arms fill it. camera/README.md:17,21,53-54 refer to a `TAN_FOV` define and `params(cam)`, but the code uses the u_tanFov uniform and controls()/derived() (camera/index.ts:83-92). tonemap/README.md:29 lists an `origin` descriptor field that TonemapDescriptor lacks (tonemap/index.ts:25-35). pixel/README.md:16-17 refers to a `film/` family that does not exist. trace-loop-contract.md:53 says make_ray spawns the continuation, but the walk uses ray_spawn (pt.ts:458).
- why it matters: Each is small, but these READMEs are the per-family contracts that a new occupant author reads first.
- suggestion (checked): One documentation pass correcting each line.
- pros/cons: Pros: cheap. Cons: none.
- checker note: Checked each one. volume_scattering/README.md:3-5,41-42 says HG is the sole occupant and hg_* is called directly, but rayleigh/ exists and the dispatch is generated. structs_media.glsl:10-11 says 'NO v1 strategy declares it'. camera/README.md:17,21,53-54 refer to TAN_FOV/params(cam); TAN_FOV appears only in docs and comments, including equirect.glsl:3 and the equirect/orthographic .md files, while index.ts uses u_tanFov and controls()/derived. tonemap/README.md:29 lists `origin`, which TonemapDescriptor lacks. pixel/README.md:16 refers to `film/`, which does not exist under src/components. trace-loop-contract.md:53 says make_ray spawns the continuation.

### F18 — Phase functions take no position, use raw dot and the Euclidean build_basis

- kind: euclidean-assumption; reader confidence: checked; checker: **confirmed**
- evidence: hg.glsl:8-9 'Raw dot() is forced here: the pinned §3.5 signature carries no Point, so the metric seam (ambient_dot) waits for the phase interface to gain a position argument'. hg.glsl:13 `dot(wi, -wo)`, hg.glsl:30 `build_basis(-wo, t, b)`; rayleigh.glsl:11,25 the same. interaction_medium_* signatures (materials.ts:299-305) carry no Point.
- why it matters: In a model where tangent vectors are vec4 at a base point (the H3 hyperboloid), the phase sampler cannot build a frame without p. It is acknowledged, but it is an interface change for every phase occupant.
- suggestion (thought-through-not-checked): When curved space is planned, add Point p to the interaction_medium_* signatures and route frame building through ambient_frame (as surfaces already do via hit.frame).
- pros/cons: Pros: makes the phase family match the surface family. Cons: the signature changes for every occupant and twin test, and adds no Euclidean value, so it should be done with the first curved occupant, not now.
- checker note: Checked: hg.glsl:8-9 states the limitation itself, and hg.glsl:13/30 and rayleigh.glsl:11/25 use raw dot and build_basis. interaction_medium_* signatures (materials.ts:298-305) take no Point. Defer this to the first curved occupant, as the finding says.

### F19 — GRIN is already a geodesic integrator for a conformally flat metric, written in Euclidean coordinates

- kind: research-note; reader confidence: inferred; checker: **partly**
- evidence: grin.glsl:3-12 integrates the ray ODE of the optical metric n^2(x)·delta by velocity Verlet. Its strong-field limiters and capture come from a black-hole reference (grin.glsl:78-95, 'Majumdar–Papapetrou'). trace-loop-contract.md:124-127 instead plans black holes as an ambient occupant whose ambient_geodesic integrates an ODE internally.
- why it matters: There are two planned homes for 'light bends by integrating an ODE': a medium arm (built, Euclidean vec3) and an ambient occupant (planned). For curved ambients without closed-form geodesics (Schwarzschild, Nil), it is an open design question whether the GRIN walker is the template, and how GRIN behaves inside a curved ambient (n^2 g).
- suggestion (thought-through-not-checked): Record the question in the curved-space design discussion: which integrator, and whether ambient_geodesic(o,d,t) with no carried state is affordable when every call re-integrates from t=0 (the delta-tracking loops call it once per tentative collision, delta_tracking.glsl:75).
- pros/cons: Pros: it surfaces a cost issue early. A stateless ambient_geodesic is O(t) per call for ODE spaces, and the tracking loops call it O(lambda) times, so the cost becomes quadratic. Cons: none now; this is a research note.
- checker note: The GRIN facts are correct (grin.glsl:3-12, a Verlet integrator for n²δ; Majumdar–Papapetrou at :79), and so is the trace-loop-contract plan (lines 124-127, a black hole integrated inside ambient_geodesic). The relationship is not an unrecorded open question, though. fable-variable-ior.md:66-72 says GRIN 'is deliberately the tracer's first curved-space feature ... It builds the geodesic-integrator machinery that H³/Nil/Schwarzschild will reuse', and :314-315 says it 'de-risks' the global ambient_* generalization. The new and valuable part is the cost point: a stateless ambient_geodesic(o,d,t) re-integrates from 0 on every call, and delta tracking calls it once per tentative collision (delta_tracking.glsl:75,143,168), so the cost is quadratic in ODE spaces.

### F20 — flags.ts re-derives the equiangular decision the Planner already folded, and lighting.ts reads the raw field

- kind: duplication; reader confidence: checked; checker: **confirmed**
- evidence: Planner.ts:574-576 sets mediumLightSampling to 'vertex' unless lighting !== null && scatteringArms. flags.ts:43-44 recomputes `lighting !== null && p.media.scatteringArms && p.estimator.mediumLightSampling === 'equiangular'`. lighting.ts:197,230 read `plan.program.estimator.mediumLightSampling === 'equiangular'` directly.
- why it matters: It is harmless today because the Planner already folds the condition, but it is two spellings of one decision, against the 'one answer per fact' rule.
- suggestion (checked): flags.ts: `equiangular: p.estimator.mediumLightSampling === 'equiangular'`.
- pros/cons: Pros: one line; no output change (the Planner guarantees equivalence). Cons: none.
- checker note: Checked. Planner.ts:574-576 already folds the condition to 'vertex' unless lighting !== null && scatteringArms. flags.ts (src/components/transport/flags.ts, not under integrators/pt) re-tests lighting !== null && p.media.scatteringArms. lighting.ts:197,230 read the raw field. This is a one-line simplification with no change to the output.

### F21 — Single-occupant families with no strategy knob yet (integrators, pixel, sampler, ambient) are deliberate scaffolding

- kind: in-progress; reader confidence: checked; checker: **confirmed**
- evidence: integrators/index.ts:1-4 ('the strategy-level integrator axis arrives with the second occupant'). pixel.ts:14-15 hardcodes `PIXEL_MODELS.box`. sampler/index.ts:11-13 (Owen–Sobol built once and reverted, to return). ambient/index.ts:21-23 (euclidean only).
- why it matters: These are seams carved ahead of need, for one-shot or probe integrators, tent and Gaussian filters, QMC samplers and curved spaces. They are not dead code and should not be removed.
- suggestion (checked): Keep as is.
- pros/cons: Pros: preserves the planned seams. Cons: none.
- checker note: Checked: integrators/index.ts:1-4, pixel.ts:15 `PIXEL_MODELS.box`, sampler/index.ts:11-13 (Owen–Sobol reverted, to return), and ambient/index.ts. All are deliberate seams for planned occupants. Keep them.

### F22 — The walk is about 165 lines of TypeScript string-pushing gated by about 12 flags; the readable form exists only per program

- kind: complexity; reader confidence: checked; checker: **confirmed**
- evidence: pt.ts:299-464 builds the walk with `if (f.media) lines.push(...)`, `if (f.equiangular)`, `if (f.deflecting)`, `if (f.scattering)`, `if (f.nulls)`, `if (aovs.length > 0)`, `if (f.dispersion)`, `if (f.nee)`, `if (f.transmission)`, `if (f.rr)`. pt.md:3-6 and trace-loop-contract.md:8-13 tell readers to dump a shader to read a concrete loop.
- why it matters: The owner wants code one person can read. The full estimator (every branch) never exists as one readable text, and correctness depends on reasoning across the flag combinations.
- suggestion (thought-through-not-checked): No restructuring recommended without owner discussion. A low-cost aid: a checked-in 'everything on' dump of the walk (generated by test or script) beside pt.md, so the whole loop can be read in one place.
- pros/cons: Pros: improves readability without changing the design; any drift shows up as a snapshot diff. Cons: one more generated artifact to keep current, and 'everything on' is not a legal program for every flag pair (equiangular excludes mis).
- checker note: Checked: the walk builder spans pt.ts ~299-464, with ~37 push and flag-gate lines. pt.md:3-6 tells readers to dump a pair to read the loop. The aid suggested is optional and low-risk; the caveat about illegal flag pairs is right.

**Checker: missed by the reader**

- grin.glsl:79 and fable-variable-ior.md:303 cite docs/curved-light-blackhole.md, which is not in this repo. docs/HANDOFF-2026-07-22-grin-session.md:121 shows it lives in ~/Code/PathTracer/docs/, so the path is dangling as written.
- fable-variable-ior.md:66-72 already names the GRIN walker as the template for the curved-space geodesic integrator (relevant to F19, and to any curved-space design work). The reader did not cite it.
- Hand-written vec3 also appears in the generated scene_material_properties signature (materials.ts:253,378: `vec3 p`) and environment_pdf(vec3 dir) (environment.ts:70). These are additional F9 sites.
- The walk's null-interface re-spawn `ray_spawn(hit, s.ray.direction)` (pt.ts:410) is one more far-end use of the origin direction (F2) that the reader did not list.
- The authoring type compiler/types.ts:670 still offers volumeSampling 'raymarch' | 'ratio-tracking', values the Validator always rejects (Validator.ts:587-593). This is deliberate 'reject-not-remove' per its comment, not dead, but it is part of the F3/F16 picture.

**Reader questions for the owner**

- Curved-space arrival direction: should the ambient seam move to a flow of the full tangent state (p,v) -> (p(t),v(t)), like thurston-rebuild's flow(Vector,t), with Hit recording the arrival direction? Or do you prefer transporting the seed direction with ambient_parallel_transport? The flow is unambiguous in S3; transport is not.
- For S3, which has many geodesics between two points: should NEE enumerate the connecting geodesics, or should the measurement declare a truncation (for example, segments shorter than pi) that BSDF paths also obey? Without one of these, pt and pt-nee disagree there.
- Should area lights move to 'sample a point on the emitter' with an ambient-supplied two-endpoint area-to-solid-angle Jacobian, so light kinds are written once for all spaces? Or do you want one light occupant per space, as the current METRIC EXEMPTION notes imply?
- estimator.volumeSampling currently has exactly one legal value per scene. Should it be removed (with the per-medium arm recorded in the plan), or should it become a real choice (for example, delta-tracking constant media)?
- Is a black-hole ambient meant to replace the GRIN-walker approach to black holes (the Majumdar-Papapetrou demo), or are both kept? If ambient_geodesic stays stateless, ODE spaces pay O(t) per call, and delta tracking calls it once per tentative collision.
- May the stale documents (fable-volumetric-component.md §2/§4/§5, transport README and pt.md on roulette, and the volume_scattering, camera, tonemap and pixel READMEs, plus the ambient README's claim about medium bodies) be corrected in place?


## authoring-scenes

A scene is a plain TypeScript object of type SceneDescription (src/compiler/types.ts:21). It holds an id, an ambientSpace, a flat objects[] array, a materials record keyed by name, lights[], and an optional environment and ambientMedium. An object is a primitive ({type, parameters, material, transform?}), a mesh ({kind:'mesh', typed arrays}) or an instanced batch ({kind:'instanced', prototype, placements}). Objects, materials and lights refer to each other by string names. The compiler's Validator checks those names later against the component registries.

A scene alone does not fix the picture. The camera pose is measurement data that lives on the strategy, so each registry entry wraps its strategies with withPose/posed. An entry (SceneSuiteEntry in tests/witnesses/types.ts) holds:
- the scene
- strategies (keys 1–9 in the lab)
- prose fields `exercises` and `expected`
- optional initialParameters
- machine checks, for witnesses only

Registries:
- demos/index.ts (530 lines, mostly prose) registers 51 demos.
- tests/witnesses/index.ts (2558 lines) registers 230 witnesses.
- pages/registry.ts merges the two for the gallery and lab.
- pages/sections.ts files every id into a gallery section.

Adding a demo touches three files: the scene file, demos/index.ts (import, entry, pose, prose) and pages/sections.ts.

src/authoring/ is 850 lines in 7 files. Each helper runs when the scene is defined and returns ordinary description data; nothing downstream knows the helpers exist:
- flattenGroups (flatten.ts): turns trees of groups into flat objects. Only one witness uses it.
- instancing (instance.ts): instance, grid and seeded scatter, plus instanceCloud, which turns a .inst table into one packed batch with CPU size/color hooks.
- parseOBJ (loadOBJ.ts): an OBJ parser with corner deduplication and optional area-weighted smooth normals.
- .inst reader (loadInstances.ts): a strictly validated binary reader that returns typed-array views without copying.
- subsurfaceMedium (subsurface.ts): the van de Hulst/OpenPBR albedo inversion.
- N_BK7 and N_SF11 (opticalGlass.ts): Sellmeier constants for two optical glasses.
- withPose (strategy.ts).

The scene-local SDF door, defineSDF, lives in components/geometry/custom.ts. It takes one call with the GLSL field, an optional TS twin and the declared bound. It registers the shape into the global PRIMITIVES registry and returns the type name.

Three authoring experiences:
- **Cornell box:** clean literals. The pose and prose live in another file, and the plane convention n·x+offset=0 needs a comment on every wall.
- **Meshes and instances:** parseOBJ of a ?raw import, plus one-line instance(scatter(...)). .inst scenes are async thunks.
- **SDF and fractal scenes:** registry SDFs are used exactly like analytic shapes, and defineSDF is the most principled door.

Main frictions:
- One picture is spread over 3 files, and the registry prose has gone stale in places.
- 74 strategy literals, mostly the same fields.
- A constant material key that the model does not read is accepted silently. Four scenes set `albedo` on dielectric glass, where it has no effect.
- Several facts have two spellings: light `position` vs primitive `center`; a `center` parameter vs `transform.position`; a quad light vs an emissive quad.
- A small path-naming inconsistency in flattenGroups.
- Duplicated constants and helpers: the HG anisotropy cap, 14 copies of the LCG, `posed`.
- Registry keys and scene.id disagree in 8 entries. A test header says this is checked; no test checks it.

Curved space: authoring is Euclidean throughout:
- The Transform type is TRS with a scale.
- PackedPlacements, the .inst format, grid and scatter are Euclidean.
- Primitive and light parameters are Euclidean coordinates (center, corner+edge vectors, normal+offset).
- The camera look-at is target−position.
- defineSDF's regex requires `vec3 p`.
- The ambientSpace type union is hardcoded and has neither product geometries nor a quotient slot.

Assets that carry over:
- ParamKind (point/direction/length… declared per row).
- The canonical-shape + placement idiom that defineSDF already enforces.
- The documented intent that placement is "an element of the space's structure group" (fable-transforms §1).
- The draft "geometry first" authoring language.

thurston-rebuild places objects with Isometry.makeTranslationFromDir(vector), which is exp at the origin. That spelling is the identity in E³, so it could keep `position: [x,y,z]` meaningful in every space. Quotients there are TeleportationSets: generators plus a fundamental domain. A quotient belongs with ambientSpace because it changes the integral.

### AS-1 — One picture is spread over three files; registry prose has gone stale

- kind: complexity; reader confidence: checked; checker: **confirmed**
- evidence: Pose and prose for a demo live in demos/index.ts, not the scene file: e.g. demos/index.ts:233 `posed([0, 1, 4], [0, 1, 0], cornellStrategy, ...)`; gallery filing in pages/sections.ts (import-time guard). Stale prose: demos/index.ts:128 'Brute-force traversal (no BVH yet)' while meshScene.ts:121 strategy sets no meshTraversal (default 'bvh'); demos/index.ts:478 'Chiang 2016 α(A) + Christensen-Burley σ_t = 1/(d·s(A))' while sssLabScene.ts:59-60 says 'This file previously used the Chiang/Burley pair' (now subsurfaceMedium/van de Hulst). Pose placement is itself split: withPose inside cactiScene/dataScenes/grandBazaarScene, posed() in index.ts for the rest.
- why it matters: To understand or change one scene you must read 2–3 files, and the descriptive text drifts from the code it describes. The owner's stated goal (docs/claude-app-decisions.md) is independent, exportable scene programs, which want one self-contained unit per scene.
- suggestion (thought-through-not-checked): Have each scene file export its whole entry (scene, posed strategies, exercises/expected, initialParameters); demos/index.ts becomes a short list of imports. Leave pages/sections.ts as the gallery's view.
- pros/cons: Pros: one file = one picture; prose sits next to the numbers it describes; index.ts shrinks from 530 lines to a list; matches 'export independent scene programs'. Cons: touches every demo file (mechanical); scenes reused by several entries (cornell in cornell, cornell-fisheye, cornell-oneshot) need the entry to import the scene from another file; does not by itself fix stale prose already present.
- checker note: Checked. demos/index.ts:54 defines posed() and line 233 calls it for cornell. Line 128 says 'Brute-force traversal (no BVH yet)', but meshDemoNeeStrategy (meshScene.ts:118-123) sets no meshTraversal, so Planner.ts:609 falls back to DEFAULT_MESH_TRAVERSAL. Line 478 still names Chiang/Burley, while sssLabScene.ts:59-60 says that pair was replaced. withPose is imported in cactiScene, dataScenes and grandBazaarScene as well as index.ts. The suggestion was not checked.

### AS-2 — Constant material keys the model does not read are silently accepted; four scenes author a no-op glass tint

- kind: defect; reader confidence: checked; checker: **confirmed**
- evidence: Validator.ts:1016-1018: '(Constants on undeclared fields stay silent: harmless authoring slack.)' Only {param}-driven unread keys warn (Validator.ts:1027). Measured with a script over all sync registry entries: `albedo` on model 'dielectric' in demo glass-lab, custom-fields, sdf-shapes and witness field-glass, e.g. customFieldsScene.ts:125 `glass: { model: 'dielectric', ior: 1.5, albedo: [0.94, 0.97, 0.95] }`. dielectric's rows are only transmittance and ior (components/materials/dielectric/dielectric.ts:13-14).
- why it matters: The author's intent (a slight green tint) renders nothing, with no message. This is the 'C5 silent-inert class' the authoring-language draft calls out; it is the most likely authoring mistake once there are many material models.
- suggestion (thought-through-not-checked): Make a constant key that is not a row of the material's own model (and not a meta-key) a Validator warning or error, same rule as the driven case; fix the four scenes (likely `transmittance`).
- pros/cons: Pros: one rule instead of two (driven vs constant); kills a real, observed mistake. Cons: reverses a written decision ('harmless authoring slack'), so it needs the owner; fixing the four scenes changes their images if the tint is moved to transmittance (field-glass is a witness).
- checker note: Validator.ts:1015-1027 warns only when an unread key is {param}-driven; constants stay silent by the stated rule. The dielectric rows are transmittance and ior only. `albedo: { row: 'transmittance' }` at dielectric.ts:16 is the descriptor's albedo-picture mapping, not a material key. Occurrences: sdfShapesScene.ts:100, customFieldsScene.ts:125, customFieldWitness.ts:84 (field-glass), and glassLabScene.ts:85, which is a multi-line literal so a one-line grep misses it. glassLab's no-op albedo is [0.98,0.98,0.98] next to roughglass's transmittance [0.98,...], which is clearly the intended key. field-glass's witness checks are estimator equalities (nee ≡ mis), so moving the tint to transmittance should not break them, but the image would change.

### AS-3 — Registry key and scene.id are two identities; a test header claims a check that does not exist

- kind: doc-code-mismatch; reader confidence: checked; checker: **confirmed**
- evidence: tests/compiler/suiteIntegrity.test.ts:5-7 lists 'scene-id mismatches between registry key and the scene's own id' among the guarded spaces, but the file's tests (lines 17-39) only check key collisions, section filing and strategy-id uniqueness. Measured: 8 entries differ — demo cornell-fisheye, cornell-oneshot → 'cornell', tonemap → 'sky'; witness thinlens-zero → 'cornell', driven-theta2 → 'driven', light-driven-theta2 and light-off → 'light-driven', het-driven-theta2 → 'het-driven'.
- why it matters: Two names for one thing; renderer ids are `${strategy.id}-${scene.id}` while the lab resolves by registry key. The comment promises a guard nobody wrote.
- suggestion (checked): Either fix the comment (the mismatches are intentional reuse of one scene under several entries), or decide that the registry key is the only identity and derive it from scene.id.
- pros/cons: Fixing the comment is trivial and honest. Making scene.id the only key would forbid reusing one scene under several entries, which the 8 cases rely on — so likely just correct the comment.
- checker note: suiteIntegrity.test.ts lines 5-7 promise a key-vs-scene.id check, but the three tests only cover key collision, section filing and strategy-id uniqueness. I spot-checked the 8 entries: cornell-fisheye and cornell-oneshot use cornellBox, tonemap uses tonemapScene, thinlens-zero uses camCornell, driven-theta2 uses drivenScene, light-driven-theta2 and light-off use drivenLightScene, het-driven-theta2 uses hetDrivenScene. I did not print each scene.id at runtime (the script timed out). Fixing the comment is the right call.

### AS-4 — flattenGroups does not path-prefix the names of driven leaves (D5 rule applied inconsistently)

- kind: defect; reader confidence: checked; checker: **confirmed**
- evidence: flatten.ts:109 `out.push(atRoot ? node : { ...node, name: node.name ?? [...path, `#${i}`].join('/') });` keeps a bare authored name, while constant leaves get `name: [...path, node.name ?? `#${i}`].join('/')` (flatten.ts:126) under the comment 'two `ball` leaves in different groups flatten to distinct provenance paths — the old name-replaces-path rule collided them'. tests/authoring/flatten.test.ts:121-123 only covers an UNNAMED driven leaf ('rig/#0').
- why it matters: Two named driven leaves under different identity groups get the same name; names flow into emitted symbols, so the compiler's symbol-clobber guard fires with the worse message the comment says D5 fixed.
- suggestion (checked): Use the same naming expression for driven leaves as for constant ones.
- pros/cons: Pros: one rule, one line. Cons: none known; no current scene uses a named driven leaf inside a group (only transformWitness uses groups).
- checker note: flatten.ts:109 is `node.name ?? [...path, `#${i}`].join('/')`, so a named driven leaf keeps its bare name, while constant leaves (line 126) always get the path prefix. The only test (flatten.test.ts:121-123) uses an unnamed driven leaf. The only non-test caller is transformWitness.ts:154, so no scene is affected today.

### AS-5 — HG anisotropy cap 0.99 declared twice

- kind: duplication; reader confidence: checked; checker: **confirmed**
- evidence: src/authoring/subsurface.ts:78 `const MAX_ANISOTROPY = 0.99;` with comment 'the Validator caps |g| at 0.99 — mirrored here'; src/compiler/analyze/Validator.ts:36 `const MAX_PHASE_G = 0.99;`. hg descriptor (components/volume_scattering/hg/hg.ts) declares phase_g with no constraint.
- why it matters: Owner rule 'one answer per fact'; the two can drift.
- suggestion (thought-through-not-checked): Export the cap from the hg component (or declare it as the phase_g row's constraint) and import it in both places (authoring may import component values).
- pros/cons: Pros: one fact, one place, and it lives with the math that needs it. Cons: whether PropertySchema rows accept a RowConstraint the Validator interprets was not checked; the plain exported constant is the zero-risk version.
- checker note: subsurface.ts:78 MAX_ANISOTROPY = 0.99 and Validator.ts:36 MAX_PHASE_G = 0.99 (used at :404-411); the hg row has no constraint. The constraint vocabulary already includes `closed-interval` (descriptors.ts:29-34), which supports the 'declare it on the row' option. I did not check whether the Validator applies row constraints to volume-scattering rows.

### AS-6 — Seeded LCG copied 14 times; posed() and hueRGB copied twice

- kind: duplication; reader confidence: checked; checker: **confirmed**
- evidence: `(s * 1664525 + 1013904223) >>> 0` in src/authoring/instance.ts:147, demos sdfFieldScene.ts:19, embersScene.ts:15, grandBazaarScene.ts:23, gyroidFieldScene.ts:16, spheresScene.ts:23, and 8 witness scenes (perfCloud, hundredSpheres, tableWitness, solidsWitness, instanceLightsWitness, accelTriple, instanceGlassWitness, sdfTableWitness). `const posed =` at demos/index.ts:54 and tests/witnesses/index.ts:147. `function hueRGB` in grandBazaarScene.ts:14 and spheresScene.ts:11.
- why it matters: Small, but it is the kind of boilerplate that makes procedural scenes longer than they need to be.
- suggestion (thought-through-not-checked): Add `seededRandom(seed)` (and export `posed`) from src/authoring; replace copies. Both arithmetic forms (/4294967296 and /0x100000000) are identical, so sequences and images are unchanged; `npm run digest` before/after would confirm.
- pros/cons: Pros: fewer lines, one RNG for reproducible scenes. Cons: touches witness fixtures (needs the digest check); low value per line.
- checker note: 14 scene and authoring copies confirmed exactly: instance.ts, 5 demos and 8 witness fixtures. The reader undercounted overall: there are more copies in src/components/geometry/boundCheck.ts:78, about 9 test files (ggx/equiangular/octahedral tests, bvh*, cwbvh, lightTree, instancingPacked), tools/make-inst-fixture.mjs, and Math.imul variants in tests/helpers/halfspace.ts and scripts/*. posed() duplicates (demos/index.ts:54, tests/witnesses/index.ts:147) and hueRGB duplicates (grandBazaar:14, spheres:11) confirmed. The float form s*1664525 stays below 2^53, so it matches the integer LCG.

### AS-7 — Several authoring facts have two spellings

- kind: complexity; reader confidence: checked; checker: **partly**
- evidence: Sphere/disk LIGHTS take `position` (components/lights/sphere/sphere.ts:15, disk/disk.ts:22) while sphere/disk PRIMITIVES take `center` (components/geometry/sphere/sphere.ts:11, disk/disk.ts:24). Primitives may be placed by a `center` point row (132 occurrences of `parameters: { center:` in demos+witness scenes) or by `transform.position` (72 occurrences). Mesh transform via parseOBJ opts (loadOBJ.ts:159) or spread (modelsScene.ts:31 `{ ...teapot, transform: ... }`). instance() third arg is `string | {name, attributes}` (instance.ts:19). Area light as `lights:[{kind:'quad',...}]` or an emissive quad object.
- why it matters: Every second spelling is something the owner has to remember and read; for curved spaces the coordinate spellings (center, corner/edges) are the ones that do not port.
- suggestion (thought-through-not-checked): Settle on canonical shape + transform for placement in new scenes (keep point rows working); rename light `position` to `center` for the sphere and disk kinds; drop the parseOBJ transform option or the spread habit.
- pros/cons: Pros: fewer things to know; canonical+placement is already enforced for defineSDF and is the curved-space-ready idiom. Cons: renames touch many scenes (mechanical, digest-checkable); quad lights fundamentally need corner/edges, so 'one idiom' cannot be total; the owner may value center params for readability.
- checker note: The facts are right: light sphere/disk authoredParams use `position` and map to the row `center`, while primitives use `center`. The counts reproduce (132 / 72), as do parseOBJ opts.transform (loadOBJ.ts:159) and the string|object third argument of instance(). But the light `position` spelling is a deliberate recorded choice: sphere.ts:12-13 says 'authored `position` maps to the registry row `center` in toValues — the proof the authored language needs its own schema'. Renaming it reverses a design decision rather than tidying slack, and the finding should say so.

### AS-8 — Placement in authoring is Euclidean TRS end to end

- kind: euclidean-assumption; reader confidence: checked; checker: **confirmed**
- evidence: Transform = {position, rotation, scale} (types.ts:249-254); PackedPlacements = positions/sizes/orientations (types.ts:207-212); flattenGroups composes `Similarity` (flatten.ts:17-32, 77); grid/scatter generate flat-plane TRS (instance.ts:31, 140-156); .inst blocks are positions/sizes/quats (loadInstances.ts:85-88). fable-transforms.md §1 'Forward-compatibility': 'a leaf's placement is an element of the ambient space's structure group … We do not build that seam now'.
- why it matters: H³/S³ have no scale; H²×R's group is Isom(H²)×Isom(R). Every authored placement, the .inst format and the flatten algebra would need a per-space placement type.
- suggestion (thought-through-not-checked): Define the authored `position` triple as exp at the origin of a tangent vector (thurston-rebuild's `new Isometry().makeTranslationFromDir(new Vector(x,y,z))`). In E³ this is the identity, so every existing scene keeps its meaning; `scale` exists only in E³; the space's placement type supplies compose/inverse. Keep the space-specific algebra behind the similarity.ts-style module per space.
- pros/cons: Pros: no Euclidean scene changes; authored triples stay meaningful in every space; matches the owner's earlier project. Cons: rotation order and composition conventions must be pinned per space; .inst clouds in curved space need a new record (fable-transforms mentions an 8-real SL(2,C) payload); not designed with the owner yet.
- checker note: types.ts:249-254 Transform, :207-212 PackedPlacements and the flatten Similarity algebra all confirmed. fable-transforms.md:34-41 'Forward-compatibility (non-Euclidean)' says the structure-group seam is deliberately not built yet, so this is an acknowledged, deferred Euclidean assumption rather than an oversight. The suggestion is unchecked design.

### AS-9 — Shape and light parameters are Euclidean coordinates; lights cannot be placed or grouped

- kind: euclidean-assumption; reader confidence: checked; checker: **partly**
- evidence: Rows: sphere `center` (point), quad `corner`+`edge1`/`edge2` (kind 'vector'), plane `normal`+`offset`, box `center`+`halfSize` (geometry/*/*.ts). ParamKind (descriptors.ts:332) includes 'vector' (sR·v), 'length' (s·ℓ) and 'area' (s²·A) — similarity-only notions. LightDescription has no transform (types.ts:535-544); flattenGroups walks objects only; fable-authoring-language.md §10.4 lists light folding as open.
- why it matters: In H³ a 'quad with edge vectors' or a plane 'normal + offset' has no direct meaning; the canonical-shape + isometry idiom is what ports. Lights placed by raw coordinates block prefabs/rigs and curved placement.
- suggestion (thought-through-not-checked): Treat ParamKind as the bridge: point and direction rows transform under isometries unchanged in meaning; vector/length/area rows become space-scoped. The space should scope the shape vocabulary (the draft's 'geometry first'), and lights should accept the same placement as objects.
- pros/cons: Pros: reuses declared facts already in every descriptor; no Euclidean change needed. Cons: what 'quad' or 'plane' means in H³ is a math design question for the owner; light placement touches the compiler's light rows.
- checker note: ParamKind (descriptors.ts:332) and LightDescription having no transform (types.ts:535-544) are confirmed, and fable-authoring-language §10 item 4 lists light folding in flatten as open. Overstated: emissive objects (quad/sphere/mesh objects with emissive materials) are sampled as lights and do take transforms. So only the `lights:` array kinds cannot be placed or grouped, not 'lights' in general.

### AS-10 — Ambient-space type is a hardcoded union without product geometries or a quotient slot

- kind: euclidean-assumption; reader confidence: checked; checker: **confirmed**
- evidence: types.ts:43-46 `type: 'euclidean' | 'hyperbolic' | 'spherical'; parameters?: { curvature?: number }`; Validator.ts:56 gates on the AMBIENT_SPACES registry (components/ambient/index.ts:21, euclidean only). Every other family uses `type: string` + registry (the 'B1 door', e.g. MaterialModel = string, types.ts:427).
- why it matters: Adding H²×R (an owner target) means editing a type union, unlike every other family; there is nowhere to state a lattice/quotient (thurston-rebuild's TeleportationSet: generators + fundamental domain), which is part of the manifold and therefore of the integral.
- suggestion (thought-through-not-checked): Make `type: string` like the other doors; let the space descriptor declare its parameters; reserve an optional `quotient` description on ambientSpace for when teleportation is designed.
- pros/cons: Pros: matches the existing registry pattern; tiny change. Cons: the quotient field should not be added before its trace-loop design exists (owner rule against unbuilt data); only the string change is free now.
- checker note: types.ts:43-46 is a literal union with an unused `curvature` parameter. Validator.ts:56 already gates on the AMBIENT_SPACES registry (components/ambient/index.ts, euclidean only), and every other family uses the B1 `string` door (MaterialModel = string at types.ts:427). This is in-progress scaffolding (the ambient seam), not dead code. The finding's own caution against adding a quotient field before its design exists is right.

### AS-11 — Authored GLSL (defineSDF fields, expressions) is typed vec3 and uses Euclidean distance

- kind: euclidean-assumption; reader confidence: checked; checker: **confirmed**
- evidence: custom.ts:115 regex requires `float <name>_sdf(vec3 p, <Struct> …)` and the error at :116 says so; demos write `dot(p - vec3(-0.35, 1.1, -0.5), p - vec3(...))` as squared distance (mediaScenes.ts:209-210); CLAUDE.md: '`Point` may become vec4 for curved spaces'. Camera look-at (components/camera/basis.ts) is normalize(target − position) with a +Y up reference.
- why it matters: Scene-local fields and expressions are the owner's fastest creative door; they will be the first thing to break when Point becomes vec4.
- suggestion (thought-through-not-checked): Accept `Point` in the defineSDF signature regex and use `Point` in new authored fields; document that expressions should use ambient distance helpers once they exist; compute the camera frame via the space's two-point direction.
- pros/cons: Pros: cheap now (regex + convention), avoids rewriting fields later. Cons: no ambient distance helpers exist for expressions yet; in E³ Point == vec3 so nothing is tested until a curved space lands.
- checker note: custom.ts:114 regex requires `vec3`, and the error at :116 says so. structs.glsl:4 has `#define Point vec3`, so accepting `Point` in the regex is cheap. mediaScenes.ts:209-210 and :259-260 use dot(p-c,p-c). camera/basis.ts:51-53 uses normalize(target-position) with a +Y up reference (+Z fallback).

### AS-12 — Unused loaders, groups and the authoring-language draft are scaffolding, not dead code

- kind: in-progress; reader confidence: checked; checker: **reclassify-in-progress**
- evidence: loadOBJ(url) at loadOBJ.ts:166 has no callers (demos use ?raw + parseOBJ); loadInstances(File) arm (loadInstances.ts:102-108) unused — fable-instance-clouds.md:117,239 'Drag-drop File … deferred'. flattenGroups used only by tests/witnesses/scenes/transformWitness.ts:154 (flatten.ts:13-14 says 'fixtures and demos call flattenGroups()'; no demo does). docs/fable-authoring-language.md is a DRAFT (classes, freeze, prefabs, invisible Source lights), nothing built. CustomSDF (types.ts:221) 'RESERVED (future custom-geometry door)'.
- why it matters: These serve runtime loading/drag-drop, the planned authoring tree and prefabs. Deleting them would undo planned work; but the flatten.ts header slightly overstates current use.
- suggestion (thought-through-not-checked): Keep them. Fix only the flatten.ts header wording. Before building the draft language, ask the owner whether its class-heavy design (freeze, single-parent errors, mutable handles) still fits the simplicity goal, or whether plain literals + small helper functions are the target.
- pros/cons: Pros: preserves future work; flags a large design that may conflict with 'no machinery for hypothetical uses'. Cons: none.
- checker note: The reader already classifies these as in-progress, and I agree. loadOBJ(url) has no callers (complete grep). The loadInstances File arm is the drag-drop path deferred in fable-instance-clouds.md:117 and :239. flattenGroups' only non-test caller is transformWitness.ts:154, so the header's 'fixtures and demos call flattenGroups()' overstates use (no demo calls it). The flatten.ts header also carries history ('owner-decided July 16 2026'), which the comment rules forbid. Keep all of it.

### AS-13 — InstancedObject docs say SDF prototypes are rejected; they are instanced today

- kind: doc-code-mismatch; reader confidence: checked; checker: **confirmed**
- evidence: types.ts:167-168 'SDF prototypes are Validator-rejected (SDF instancing is the deferred domain-repetition generalization)'; Validator.ts:1077 repeats it; but Validator.ts:1157 'A marched prototype is instanceable (impl-plan-sdf-as-shape T7…)' and demos/sdfKnotScene.ts instances 3000 marched links.
- why it matters: The type an author reads first tells them a working feature does not exist.
- suggestion (checked): Correct the two comments.
- pros/cons: Pure comment fix.
- checker note: types.ts:166-167 and Validator.ts:1076-1077 say SDF prototypes are rejected. Validator.ts:1157 says marched prototypes are instanceable, and only unbounded shapes are rejected. sdfKnotScene.ts:77-83 calls instance().

### AS-14 — Authoring-language draft says materials are sorted by name; Planner uses insertion order

- kind: doc-code-mismatch; reader confidence: checked; checker: **confirmed**
- evidence: docs/fable-authoring-language.md §10.1b: 'the Planner sorts materials BY NAME and the sort order assigns ids (Planner.ts:32)'; src/compiler/plan/Planner.ts:96 `for (const [name, mat] of Object.entries(scene.materials))`, and no `sort` in Planner.ts; CLAUDE.md 'Ids follow insertion order (materials, lights, regions)'.
- why it matters: The draft's 'hard naming problem' rests on a fact that changed; anyone reviving the draft would design against stale code.
- suggestion (checked): Update or annotate the draft's §10.1b.
- pros/cons: Doc-only.
- checker note: fable-authoring-language.md:241-242 says the Planner sorts materials by name. Planner.ts:96 iterates Object.entries(scene.materials) in insertion order, and Planner.ts contains no `sort`. The doc is marked DRAFT, so this is a stale-doc item.

### AS-15 — .inst converter location and octic load time disagree across comments

- kind: doc-code-mismatch; reader confidence: checked; checker: **confirmed**
- evidence: loadInstances.ts:3 'radius laws etc. live OFFLINE in tools/convert-*.mjs' and dataScenes.ts:4 'tools/convert-pointset.mjs' — neither exists in tools/ (ls tools: gen-bluenoise, inst-format, make-inst-fixture, …); docs/fable-instance-clouds.md:196 places it at 'test-data/convert-pointset.mjs (untracked)'. dataScenes.ts:77 'one-time TLAS build at load is ~4s' vs dataScenes.ts:231 'One-time TLAS build at load takes tens of seconds'.
- why it matters: Points a reader to a file that is not there; two contradictory performance claims a few lines apart.
- suggestion (checked): Point the comments at the doc's location (untracked test-data/) and keep one load-time statement.
- pros/cons: Comment-only.
- checker note: loadInstances.ts:3 points to tools/convert-*.mjs and dataScenes.ts:4 to tools/convert-pointset.mjs. ls tools has no convert-* file, and fable-instance-clouds.md:196 puts it at test-data/convert-pointset.mjs (untracked; test-data/ is absent in this checkout). Both load-time statements are about the same octic scene and contradict each other: :77 says '~4s off-thread', :231 says 'tens of seconds'.

### AS-16 — GLSL expressions use mangled uniform names and redeclare shared parameters

- kind: extension-friction; reader confidence: checked; checker: **confirmed**
- evidence: mediaScenes.ts:147 source 'u_fog_gain * exp(-u_fog_falloff * p.y) …' with params [{param:'fog.gain'…},{param:'fog.falloff'…}] — the author must know paramToUniform's mangling; `blob.sharp` declared in two expressions (mediaScenes.ts:290 and :299) with identical defaults.
- why it matters: Two names for one parameter in the same literal, and a duplicated declaration whose defaults could disagree (what the compiler does then was not checked).
- suggestion (thought-through-not-checked): Let expression sources name parameters by their dotted path (or a short alias) and substitute the uniform name at generation; declare a shared parameter once at scene level.
- pros/cons: Pros: author writes one name; no duplicate declarations. Cons: needs a substitution rule in the compiler (dotted names are not GLSL identifiers); changes an established, working convention.
- checker note: mediaScenes.ts:147 uses u_fog_gain / u_fog_falloff alongside params fog.gain / fog.falloff, and blob.sharp is declared at :214, :290 and :299 with identical defaults. On what happens when duplicates disagree: merge.ts:94 merges parameter metadata with Object.assign (last contribution wins, silently). Uniform dedupe errors only on a different type, path or source. No Validator or Plan check for conflicting {param} defaults or ranges turned up in grep (thought-through, not run).

### AS-17 — How thurston-rebuild authors curved scenes (for comparison)

- kind: research-note; reader confidence: checked; checker: **confirmed**
- evidence: /Users/stevetrettel/Code/thurston-rebuild: scenes are built against a TeleportationSet (src/core/teleportations/TeleportationSet.js: 'Set of teleportations … implicitly a set of generators of a discrete subgroup and a fundamental domain'), one per geometry in src/geometries/<g>/groups (h2e: genus2, cuspedTorus, …; hyp: seifert-weber, whitehead, honeycombs…). Example examples/h2e/genus2Lattice/index.html: `new ThurstonLite(genus2Set, …)`, `new Point(0, 0, 1, 0)`, `LocalBallShape`, `complement(...)`, `new Solid(shape, material)`. Placement idiom (counted in examples/hyp, examples/h2e): `new Isometry().makeTranslationFromDir(new Vector(...))` 25 uses.
- why it matters: Shows the owner's prior vocabulary: space-scoped geometry modules, quotients as a scene-level group, local vs global shapes, placement by exp of a tangent vector. A curved-space authoring design here should read like that, but as plain data.
- suggestion (none): Use this as the reference when designing ambientSpace + placement for H³/S³/H²×R (see AS-8, AS-10).
- pros/cons: Research only.
- checker note: thurston-rebuild has src/core/teleportations/TeleportationSet.js and src/geometries/{euc,h2e,hyp,nil,s2e,sl2,sol,sph}. examples/h2e/genus2Lattice/index.html uses genus2Set, ThurstonLite, new Point(0,0,1,0), LocalBallShape, complement and Solid. makeTranslationFromDir( appears 25 times in examples/hyp + examples/h2e (23 with the stricter '(new Vector' pattern).

**Checker: missed by the reader**

- Duplicate {param} declarations with different default/min/max are not detected. src/compiler/generate/features/merge.ts:94 merges parameter metadata with Object.assign (last contribution wins, silently), and uniform dedupe compares only type/path/source. A grep of analyze/ and plan/ found no conflict check. This is the real risk behind AS-16's repeated blob.sharp declarations: a typo in one default would change the slider with no message.
- AS-2 has a fourth instance the reader's list names only by scene: glassLabScene.ts:82-87 (`albedo: [0.98,0.98,0.98]` on a dielectric) sits next to roughglass, which uses `transmittance: [0.98,...]`. That pairing is direct evidence the intended key was transmittance.
- The light-kind `position`→`center` mapping (lights/sphere/sphere.ts:12-13, disk/disk.ts:18) is documented as deliberate ('the authored language needs its own schema'), so AS-7's rename proposal reverses a recorded decision and needs the owner, like AS-2.
- The LCG duplication reaches beyond scenes: src/components/geometry/boundCheck.ts:78 (library code), about 9 vitest files, tools/make-inst-fixture.mjs, and Math.imul variants in tests/helpers/halfspace.ts and scripts/audit-spectral.ts / witness-spectral.ts. A shared helper in src/authoring would not serve the components layer (components import only types), so boundCheck would need its own copy or a home in components.

**Reader questions for the owner**

- Should each scene file export its whole gallery entry (scene, posed strategies, prose, initial parameters), so one file is one picture and demos/index.ts becomes a list? This would also fit your goal of exportable scene programs.
- A constant material key that the model doesn't read is silently ignored today (Validator.ts:1016-1018). Four scenes set `albedo` on dielectric glass expecting a tint. Should this become a warning or an error? It would reverse the 'harmless authoring slack' decision.
- For curved spaces, should `transform.position: [x,y,z]` mean exp at the origin of a tangent vector? That is thurston-rebuild's makeTranslationFromDir, and it is the identity in E³, so no existing scene changes. Or do you want authored points in model coordinates (for example hyperboloid vec4)?
- Should a quotient or lattice be part of `ambientSpace`, as a group with generators plus a fundamental domain like the TeleportationSet? Or would you rather start with finite tilings authored as instance batches?
- Is docs/fable-authoring-language.md (classes everywhere, freeze, single-parent errors, prefabs) still the target? Or do you prefer plain object literals plus a few small helper functions?
- For new scenes, should canonical shapes placed by a transform be the one placement idiom, as defineSDF already enforces? Should `center` and `corner` parameters stay as Euclidean conveniences?


## tests-tooling

The project checks itself at five levels, each slower and closer to the real picture than the one before. (1) `tsc` (6 s) and `vitest` (114 files, 4229 tests, all passing; 87 s on this Mac, of which 65 s is glsl-compile) test the compiler's structure and decisions very thoroughly: validator diagnostics, a snapshot of each (scene, strategy) pair's ProgramDescription (all ~506 pairs), a 3.5 MB snapshot of the generated GLSL for 50 pairs, packed-data fingerprints, a check that strategy order changes nothing, family contract tests, and a glslang ES static compile of every pair under RGB and under a two-channel "canary" color model. vitest also holds hand-copied TypeScript twins of five pieces of GLSL math (ggx, rough_dielectric, equiangular, GRIN, octahedral), tested with χ² histograms. No GLSL runs in vitest. (2) `npm run digest` (2.8 s) hashes the full compiled output of all 274 synchronous suite scenes (shaders, uniforms, closure values at two parameter points, the packed scene-data plan, warnings). Run before and after a change with `--compare`, it is the main proof that a compiler refactor changed nothing. (3) `npm run frames` (~40 s) renders 8 fixed cases through the real App and engine on SwiftShader at a pinned salt and compares them bit for bit. (4) About ten probe scripts (scripts/witness-*.ts, tools/witness-color.mjs) run real GLSL in a float framebuffer through a shared 63-line harness (tools/render-glsl-probes.mjs) and compare against independent quadrature. Each also runs deliberately broken shaders that must fail. All of them cover color, spectral and environment code; none covers BSDF or transport math. (5) `npm run witness` (45–90 min, run by hand) renders 180 witness scenes (330 non-perf checks: 175 exact derived means, estimator equality with χ² or RMSE gates, cross-backend twins, bit-identical pairs, tiling) through the lab page and caches frames. CI runs levels 1–2 of vitest/tsc on every push. The GPU job runs only when started by hand and covers only 6 of the 10 probe scripts. Main weaknesses: the GLSL is never run against its TS twins, though the probe harness that could do it already exists. scripts/ is never typechecked (14 errors). The untyped witness runner calls about 24 App methods by name, so the planned App reorg can break it unnoticed until a sweep. There are two separate compiled-output digests and three overlapping snapshot mechanisms. Many helpers are copy-pasted (LCG, χ², spectral .bin reader). Status counts in the docs are stale: the suite has grown by 19 fixture files and 128 commits since the last full sweep. For curved spaces, the estimator-equality and closed-furnace gates carry over unchanged. No contract test covers the ambient family, and the derived values (slab, half-space, MAX_DIST far clip) are Euclidean.

### TT-1 — Shipped BSDF/technique GLSL is never executed against its TS twin, although a GLSL-execution harness already exists

- kind: other; reader confidence: checked; checker: **partly**
- evidence: CLAUDE.md:202 'It never executes GLSL, and nothing checks a GLSL file against its twin.' ggx.test.ts:7 'change one, change both'; equiangular.test.ts:10 '// ── The twin (change equiangular.glsl, change this)'. tools/render-glsl-probes.mjs:1 'Run small GLSL programs in a float framebuffer, without an app or dev server.' is used by 9 files (witness-color, witness-spectral, -wavelengths, -bindings, -majorant, -environment, -dispersion, -blackbody), none of which includes ggx.glsl, rough_dielectric.glsl, microfacet.glsl, equiangular.glsl or grin.glsl (/usr/bin/grep over scripts/ tools/). Small drift already visible: equiangular.glsl clamps 'float h2 = max(dot(D, D) - t_c * t_c, 1e-8);' while the twin sampleT takes h2 as given.
- why it matters: The χ² tests prove that the TypeScript math is a valid estimator. They do not prove that the GLSL the renderer runs is the same math. A one-character edit to ggx.glsl passes every vitest test and is caught only by the 45-minute sweep, if a witness happens to exercise it. The same gap will matter more for curved-space BSDF frames and geodesic code.
- suggestion (thought-through-not-checked): Add one probe script, e.g. scripts/witness-twins.ts, that runs <model>_sample/_eval/_pdf from the shipped GLSL on a fixed grid of (wo, u1, u2, roughness, eta) through renderProbes. It compares the output to the TS twin to float tolerance and adds a mutation shader that must fail, as witness-color does. Once that exists the twins can import shared code instead of being transcribed by hand.
- pros/cons: Pros: closes the stated gap using existing machinery (renderProbes, the mutation pattern), runs in seconds, and turns 'change one, change both' into a test that fails. Cons: it needs GLSL stubs for the Frame, Spectrum and ambient_dot includes per model, and it runs only in the manual GPU job, not on every push, unless SwiftShader is added to the push job.
- checker note: The core gap holds: no test compares shipped GLSL output with the TS twins (CLAUDE.md:202, and ggx/rough_dielectric/equiangular .test.ts carry hand-copied twins). The evidence overstates it in two ways. (1) It says no probe includes ggx.glsl or rough_dielectric.glsl. In fact scripts/witness-spectral-bindings.ts:122-136 compiles full programs and executes the shipped `${model}_sample(...)` for mirror, ggx, checker, dielectric and rough_dielectric. It does this only at normal incidence with u=(0.9,0), against closed forms rather than the twin. scripts/witness-dispersion.ts also renders rough_dielectric scenes. (2) The equiangular 'drift' is not drift. The twin starts after the clamp, takes h2 as input, and tests the clamped value explicitly: CONFIGS has 'near-axis (clamped h)', h2: 1e-8, equiangular.test.ts:47. Also, 8 files import renderProbes (7 scripts plus tools/witness-color.mjs), not 9.

### TT-2 — scripts/*.ts is outside the typecheck and has 14 type errors

- kind: defect; reader confidence: checked; checker: **confirmed**
- evidence: tsconfig.json:24 '"include": ["src", "tests", "pages"]'. Nothing imports scripts/. Running tsc with the project's flags on scripts/*.ts gives 14 errors, e.g. 'scripts/witness-wavelengths.ts(126,53): error TS18048: 'records' is possibly 'undefined'.', 'scripts/witness-spectral-majorant.ts(97,62): error TS7006', and TS7016 on '../tools/render-glsl-probes.mjs' in 7 scripts. The scripts run through vite-node (esbuild, no type check).
- why it matters: The digest script (the refactor proof) and the probe witnesses import compiler and App internals. A rename in src/ breaks them silently until someone runs them by hand. CI runs only audit:spectral.
- suggestion (checked): Add "scripts" to tsconfig include, add a .d.ts (or JSDoc types) for tools/render-glsl-probes.mjs, and fix the 14 errors.
- pros/cons: Pros: one config line and every push catches script breakage. Cons: the 14 existing errors need fixing first, and the dense spectral scripts may need some reformatting to type cleanly.
- checker note: tsconfig include is [src, tests, pages]. I typechecked scripts/ with the project config plus node typeRoots. Inside scripts/ there are 14 errors not caused by the missing vite ?raw types: TS7016 on render-glsl-probes.mjs x7, TS18048 x3 and TS2769 x1 in witness-wavelengths, TS7006 x3 in witness-spectral-majorant. CI runs only `npm run audit:spectral` from scripts/ on push (ci.yml:49-52). The tools/*.mjs runners are untyped JS by construction.

### TT-3 — Witness runner and probe tools drive ~24 App methods by name from untyped JS; the App reorg plan does not mention this contract

- kind: extension-friction; reader confidence: checked; checker: **partly**
- evidence: tools/witness.mjs and scripts call app.stop, pinResetSalt, renderProduction, readExport, selectRendererByStrategy, initialize, resize, getCanvas, setParameters, save, renderTiled, getResetSalt, getPictures, getActiveStrategy, getActiveRenderer, saveSession, restoreSession, getStats, getCanvasSize, getAvailableExports, getActiveRendererId, extendProduction, capture, buildRenderStamp. They also use window.app/sceneSuite/witnessSuite/__witnessDigest (pages/scene-lab.ts:52-54, 82). /usr/bin/grep -i 'witness' docs/claude-app-decisions.md finds nothing.
- why it matters: The App redesign is the next big refactor. Its only end-to-end proof (frames plus the sweep) depends on these names, and a rename fails only at runtime, after a dev-server start and a browser launch.
- suggestion (thought-through-not-checked): Make the page-side surface the runner needs one typed module, e.g. pages/witnessHooks.ts exporting an interface implemented against App. Expose that object instead of the raw `app`, so tsc catches App renames. Record it as an explicit input to the App reorg decisions.
- pros/cons: Pros: the App API that tooling depends on becomes explicit, small and type-checked, and the reorg can change App freely behind it. Cons: one more small file, and the runner still calls the hooks by string in page.evaluate, so only the page side is typed.
- checker note: The 24 App methods are confirmed (grep of app.X( over tools/*.mjs and scripts/*.ts), as are window.app/sceneSuite/witnessSuite/__witnessDigest at pages/scene-lab.ts:52-54,82. The framing is wrong, though. docs/claude-app-decisions.md is now a 39-line 'Withdrawal — 2026-10-04' notice: the reorg plan and its decisions were withdrawn and there is no approved App reorg plan. So the finding cannot say 'the reorg plan does not mention this'. The doc does say 'The lab and scene gallery are development/testing infrastructure; they should not dictate the app's design' (line 22). That bears on the suggestion: a typed hooks module keeps tooling from constraining App, but it should be raised with the owner per AGENTS.md, not attached to a reorg plan.

### TT-4 — Runner works around an unexplained App race with a retry and a selection toggle

- kind: guess; reader confidence: checked; checker: **confirmed**
- evidence: tools/witness.mjs:303-308 'RETRIES ONCE on a fresh page: an intermittent app-layer race (~once per full sweep, scene varies…) flips the engine's active renderer back'; :328 'RETRY … (active-renderer race'; :363-370 'go through the base renderer to defeat the idempotence guard'. README:70-73 documents a second flake ('Cannot read properties of undefined (reading 'readExport')').
- why it matters: An App defect (the active renderer changes during a production render) is hidden by test-side hardening rather than found. The owner's rules forbid this kind of defensive workaround and want missing facts to be errors. The App reorg should either remove the race or make it reproducible.
- suggestion (thought-through-not-checked): Treat this as an App bug for the reorg: find out why initialize() followed by a selection can be lost (likely the renderer-manager idempotence guard or an async initialize), fix it, then delete the retry and toggle.
- pros/cons: Pros: removes about 30 lines of hack and one source of flaky rows. Cons: the race is intermittent (~1 per sweep), so confirming the fix needs a few sweeps or a targeted stress script.
- checker note: tools/witness.mjs:303-308 (retry-once comment), :325-329 (catch, then re-render on 'Export target variance'), and :360-370 (probe readExport, then toggle selection through the base renderer to defeat the idempotence guard). These are exactly as described. The underlying App race is undiagnosed.

### TT-5 — Two compiled-output digests, and the variance-strategy clone written three times

- kind: duplication; reader confidence: checked; checker: **confirmed**
- evidence: scripts/digest-compiled.ts uses compiler.compileScene and hashes shaders+rest+closures+sceneData+warnings. pages/scene-lab.ts:82-112 (__witnessDigest) uses 'compiler.compile(scene as any, strategy)' (line 90) and hashes shader text + JSON. The variance clone ('strategy.estimator.accumulation = {...variance: true}; id += "__var"') appears in pages/scene-lab.ts:103-105, tools/witness.mjs:350-352 (renderVarianceOnce) and tools/witness.mjs:836-839 (openCase, commented 'The witness runner's way of recording variance').
- why it matters: Two answers to 'did the compiled output change' can disagree: the in-page one hashes per-strategy layouts the App never runs (see TT-8) and no closure values. The clone is a decision (what a variance arm is) kept in three copies.
- suggestion (thought-through-not-checked): Have the witness cache key reuse the digest's per-scene text (tests/helpers/compiledJson + compileScene), and export one `withVariance(strategy)` from a shared module used by the page and both runner paths.
- pros/cons: Pros: one definition of a program's identity and of a variance arm. Cons: the runner computes digests in-page to avoid loading TS in Node; moving to the Node digest means running vite-node from the runner (the scripts already do this).
- checker note: Three copies of the variance clone, verified: pages/scene-lab.ts:103-105, tools/witness.mjs:351-352 and :839-840. The in-page digest uses compiler.compile(scene, strategy) per strategy (scene-lab.ts:90). The Node digest uses compileScene and also hashes closures and sceneData. The two digests can therefore disagree: they differ in layout, as TT-8 reproduces, and the in-page one hashes no closures.

### TT-6 — Overlapping snapshot and compile gates with high churn

- kind: complexity; reader confidence: checked; checker: **partly**
- evidence: generated-glsl.snapshot.test.ts (3,546,059-byte .snap, 50 hand-picked pairs, compile() surface). program-description.snapshot (1,098,211 bytes, every pair). digest-compiled (all 274 scenes, a superset of the GLSL snapshot's content plus closures and packed data). sceneSuite.test.ts asserts only 'renderer.shaders.size > 0' and 'pipeline.passes.length > 0' for 506 pairs that glsl-compile also compiles. git log: the GLSL .snap changed in 74 of 491 commits, the ProgramDescription .snap in 77.
- why it matters: Each intended codegen change rewrites megabytes of snapshot that CLAUDE.md says to review 'by the kinds of lines that changed', so the snapshot mostly detects change rather than finding bugs. The owner wants fewer moving parts. The digest already proves 'unchanged' when that is the claim.
- suggestion (thought-through-not-checked): Option to discuss: keep the ProgramDescription snapshot (decisions, readable diffs) and the digest (refactor proof). Treat the 50-pair GLSL snapshot as replaceable by the digest plus glslang. Keep sceneSuite.test as the cheap smoke test for Macs without glslang.
- pros/cons: Pros: removes the largest change-detector and its update churn, and one fewer mechanism to explain. Cons: the GLSL snapshot runs automatically in CI and the digest does not. Dropping it means a refactor's proof depends on remembering to run digest before and after (a CI job comparing against a committed digest could restore that).
- checker note: Sizes and churn confirmed: 3,546,059 and 1,098,211 bytes, with 74 and 77 of 491 commits touching them. sceneSuite.test asserts only shaders.size>0, passes.length>0 and the id. Corrections: the GLSL snapshot has 47 cases, not 50 (47 exports in the .snap). The digest is also not a strict superset. The snapshot compiles each pair with compile() (per-strategy layout) and the digest uses compileScene (shared layout), so for hundred-spheres+nee-power/mis-power the text differs. The snapshot also captures pipeline/exportTargets/sourceMaps, which the digest covers as well (digest-compiled.ts:9). This is an option for discussion, not a defect.

### TT-7 — No contract test for the ambient (curved-space) family; witness derivations mostly Euclidean

- kind: in-progress; reader confidence: checked; checker: **confirmed**
- evidence: src/components/ambient/index.ts:21 'export const AMBIENT_SPACES … = { euclidean: … }'. /usr/bin/grep finds AMBIENT_SPACES only in src (core.ts, Validator.ts, types), never in tests/. Other families have contract tests: cameraContract.test.ts, volumeScatteringContract.test.ts, lightsContract.test.ts, geometryContract.test.ts, materialsContract.test.ts. 53 witness fixture files state `ambientSpace: { type: 'euclidean' }`. Euclidean expectations include shaderConstants.test.ts:17 'Math.exp(-FOG_SKY_SIGMA * MAX_DIST)', the slab and half-space values, and equiangular.glsl's extrinsic t_c/h.
- why it matters: This is deliberate scaffolding for H³/S³/H²×R, not dead code. When the second occupant arrives, nothing will check that it provides ambient_geodesic/frame/dot/parallel_transport/direction_to with the right signatures, and none of the derived witness values apply. Estimator equality (pt≡nee≡mis), identical/tiled checks and the closed-box furnace E/(1−ρ) do carry over.
- suggestion (thought-through-not-checked): When curved spaces start: add ambientContract.test.ts iterating AMBIENT_SPACES for the five symbols (a copy of the cameraContract pattern). Plan curved-space witnesses around space-independent gates first (furnace in a closed region, estimator equality, cross-backend twins of analytic vs marched SDF), and only then add derived values per space.
- pros/cons: Pros: the contract test is ~15 lines and the gates already exist. Cons: closed-form witnesses in H³/S³ need new derivations (e.g. MAX_DIST far-clip semantics in S³), which is research work.
- checker note: AMBIENT_SPACES appears only in src (ambient/index.ts:21, core.ts, Validator.ts, plan/types.ts) and never in tests. tests/components has contract tests for camera, color, geometry, lights, materials and volumeScattering, but none for ambient. 53 witness fixtures state ambientSpace euclidean. Tests touching ambient only check that non-euclidean types are rejected or recorded (validator/analyzer/compiler tests). This is deliberate scaffolding (ambient/index.ts header: 'the door exists BEFORE the first curved-space occupant'), and the kind 'in-progress' is correct. Euclidean's symbols are checked implicitly, because glslang compiles every linked program.

### TT-8 — glslang, the GLSL snapshot and the in-page digest compile per strategy, not the shared-layout program the App runs

- kind: defect; reader confidence: checked; checker: **confirmed**
- evidence: tests/compiler/glsl-compile.test.ts:75 'const renderer = compiler.compile(entry.scene, strategy);' Compiler.ts:14-15 compile() = compileScene(scene,[strategy]). The App compiles all strategies together. A scratch script over all 139 multi-strategy scenes found 2 pairs whose fragment text differs (hundred-spheres + nee-power, + mis-power): 'data_texel1d(uint(600 + (region >> 2)))' alone vs 'uint(1000 + …)' together.
- why it matters: The difference today is one data-address constant, so it is harmless. But the static compile never checks the exact text the App runs once layouts depend on sibling strategies (CWBVH, the light tree, the object table).
- suggestion (checked): Iterate compileScene(entry.scene, entry.strategies).renderers in glsl-compile.test.ts (and the GLSL snapshot, if kept) instead of compile() per strategy.
- pros/cons: Pros: tests what ships, and is a few-line change. Cons: the snapshot file would churn once for those pairs.
- checker note: Reproduced with a scratch vite-node script over witnessSuite+demoSuite. 139 multi-strategy scenes. Fragment text differs between compile() and compileScene(all) for exactly hundred-spheres+nee-power and hundred-spheres+mis-power. glsl-compile.test.ts:75 uses compile(). The App uses compileScene (RendererManager.ts:99,193).

### TT-9 — Tests that pin the twin or history rather than the shipped code

- kind: other; reader confidence: checked; checker: **confirmed**
- evidence: rough_dielectric.test.ts:307-327 'index-matched interface (η = 1)' asserts the twin's own hard-coded branch at :121 'if (eta === 1.0) return { wi: neg(wo), … delta: true }', so it checks the twin, not the GLSL (also listed in docs/claude-review-2026-09-25.md:159). shaderConstants.test.ts:2-4 'These pins record the values they had when the constants were still copied into the fixtures'. bvhFlat.test.ts:4 'The OLD implementation lives here verbatim as the reference twin'.
- why it matters: These are migration proofs kept as permanent tests. They cannot catch a GLSL regression (η=1), and they fail on intended future changes (a better BVH builder, a deliberate MAX_DIST change), which pushes toward 'update the expected value' habits.
- suggestion (thought-through-not-checked): Label them clearly as refactor-equivalence pins in a README, or retire each once its refactor is done. The η=1 case becomes meaningful under the TT-1 GLSL-vs-twin probe.
- pros/cons: Pros: the suite says honestly what it guards. Cons: retiring pins removes a safety net the owner may still value. That is the owner's call, not a recommendation to delete.
- checker note: The rough_dielectric twin's `if (eta === 1.0)` branch (test.ts:121) is what the η=1 test (:307-327) exercises. The GLSL has its own `if (n_i == n_t)` branch (glsl:52,96,141), which the test never runs. This was already listed in docs/claude-review-2026-09-25.md:159. shaderConstants.test.ts:1-4 and tests/components/bvhFlat.test.ts:1-7 are refactor-equivalence pins, as described. Retiring them is the owner's call.

### TT-10 — Stale counts and references in status docs

- kind: doc-code-mismatch; reader confidence: checked; checker: **confirmed**
- evidence: CLAUDE.md:268 '221 of the 265 synchronous suite scenes'. The digest now reports 'digested 274 scenes … (7 async skipped)'. tests/witnesses/README.md:48 and CLAUDE.md:279 '181 exact checks', while the live registry has 330 non-perf checks. c5f3543..HEAD is 128 commits, and 19 scene files were added since (mostly spectral*). demos/dataScenes.ts:4 'tools/convert-pointset.mjs', but no such file exists (docs/fable-instance-clouds.md:196 says it is untracked in test-data/).
- why it matters: The owner and future agents use these numbers to judge what a sweep has proven. Most current checks have never been in a full sweep.
- suggestion (checked): Update the counts and state plainly that the spectral suites (19 files) have never been in a full sweep. Fix the convert-pointset path.
- pros/cons: Pros: trivial. Cons: none.
- checker note: I ran the digest: 'digested 274 scenes … (7 async skipped)', against CLAUDE.md:268's '265'. README:46-47 and CLAUDE.md:279 say 181 exact checks. c5f3543..HEAD is 128 commits, and 19 witness scene files were added since. tools/convert-pointset.mjs does not exist (demos/dataScenes.ts:4). docs/fable-instance-clouds.md:196 puts it at untracked test-data/. I did not independently verify the '330 non-perf checks' count.

### TT-11 — CI's GPU job omits four probe witnesses

- kind: other; reader confidence: checked; checker: **confirmed**
- evidence: .github/workflows/ci.yml:71-81 runs witness:color, :spectral, :spectral-bindings, :spectral-majorant, :environment, :wavelengths. package.json also defines witness:dispersion, witness:blackbody, witness:spectral-lifecycle and witness:spectral-live, which nothing runs automatically (lifecycle and live need a running server: tools/witness-spectral-lifecycle.mjs:1 'Run against a running Vite dev or preview server.').
- why it matters: Dispersion and blackbody have probe gates that exist but are never run as a set. witness-dispersion is cited as the source of witness values (tests/witnesses/scenes/spectralDispersion.ts).
- suggestion (thought-through-not-checked): Add witness:dispersion and witness:blackbody to the manual GPU job. Lifecycle and live need the dev server the sweep starts anyway, so they could run after it.
- pros/cons: Pros: no new code. Cons: a longer manual job, with run times not measured here.
- checker note: ci.yml:70-81 runs color, spectral, spectral-bindings, spectral-majorant, environment and wavelengths. It does not run dispersion, blackbody, spectral-lifecycle or spectral-live, and lifecycle says 'Run against a running Vite dev or preview server.' This is a known, previously recorded item: docs/claude-design-review-2026-09-28.md:431 and docs/claude-spectral-review-2026-09-28.md:373 already say dispersion/blackbody are not in the manual GPU job.

### TT-12 — Copy-pasted test helpers: spectral .bin reader x10, LCG x~15, chi2Crit x3, the §11.3 harness x2, RESERVED_KEYS x2

- kind: duplication; reader confidence: checked; checker: **confirmed**
- evidence: /usr/bin/grep: 'spectral/data/${name}.bin' in 10 scripts. 'function lcg'/'function rng' in ggx, rough_dielectric, equiangular and octahedral tests, bvh, bvhFlat, cwbvh, lightTree, halfspace.ts and 5 witness fixtures. 'function chi2Crit' in ggx.test.ts:130, rough_dielectric.test.ts:212, equiangular.test.ts:35. volumeScatteringContract.test.ts:18 'RESERVED_KEYS … (mirrors materialsContract's list)', with no source constant for the meta-keys.
- why it matters: 'One answer per fact' (CLAUDE.md). Adding a twin test for a new material means copying about 100 lines of histogram harness, which is friction for every new occupant. Lambert, mirror, dielectric, HG, Rayleigh and the light samplers have no twin test.
- suggestion (thought-through-not-checked): tests/helpers/random.ts (one LCG), tests/helpers/stats.ts (chi2Crit, the adaptive-bin hemisphere histogram as `checkBsdfSampler(twin, configs)`), and scripts/lib/spectralData.ts. The witness fixtures' LCGs define scene geometry, so their exact constants must not change; the digest proves that.
- pros/cons: Pros: a new BSDF's sampler test is one call, and less code to read. Cons: the fixture LCGs may differ slightly in constants, so check them before merging. It is a test-only refactor, kept separate from feature work.
- checker note: Fixed-string grep: 10 scripts/tools read 'spectral/data/${name}.bin'. lcg/rng functions appear in 14 files (4 component twin tests, bvh, bvhFlat, cwbvh, lightTree, helpers/halfspace.ts and 5 witness fixtures). chi2Crit appears 3 times (ggx:130, rough_dielectric:212, equiangular:35). RESERVED_KEYS is duplicated in materialsContract.test.ts:13 and volumeScatteringContract.test.ts:19, with no src constant for the meta-keys (src has only RESERVED_PARAM_PREFIXES/PATHS). The fixture-LCG caveat is correct: they define geometry.

### TT-13 — Witness frame cache is invalidated by any src/**/*.ts edit

- kind: complexity; reader confidence: checked; checker: **confirmed**
- evidence: tools/witness.mjs:1196 'const globalHash = hashTree([src], ['.ts'])'. README:258-260 'any `.ts` edit under `src/` invalidates everything (coarse but sound)'.
- why it matters: A pure TS refactor whose digest is identical still forces a full 45–90 minute re-render, so cleanup refactors are expensive to prove at the numeric level.
- suggestion (thought-through-not-checked): Key frames on the digest parts (shaders, closures, sceneData, which are already computed) plus a hash of src/app and src/engine only, since those are the TS that reaches frames outside the compiled output.
- pros/cons: Pros: compiler and component refactors re-render nothing when the digest is unchanged. Cons: soundness depends on the digest covering everything compile-side that affects pixels. Packing code in src/app is covered by the app hash, but this needs a careful argument and a check.
- checker note: witness.mjs:1196-1198: globalHash = hashTree(src,'.ts') + glsl/shared .glsl + public .hdr/.png. README:257-260 says the same. Any suggested replacement must keep the glsl/shared term (the env-bake template compiles outside the per-pair digests) and the public/ assets.

### TT-14 — Literal NUL/control bytes in pages/scene-lab.ts make the file 'binary' to search tools

- kind: defect; reader confidence: checked; checker: **confirmed**
- evidence: pages/scene-lab.ts:93-95 template literals contain raw \x00, \x01, \x02 separators (python scan). `file pages/scene-lab.ts` reports 'data', and /usr/bin/grep prints 'Binary file pages/scene-lab.ts matches'. During this survey a ripgrep-backed search for '__witnessDigest' returned nothing, and the hook was found only by reading the file.
- why it matters: Code search silently skips the page that defines the runner hooks. That is how an agent wrongly concludes that something 'does not exist' or 'is dead'.
- suggestion (checked): Write the separators as escapes ('\u0000', '\u0001', '\u0002'). The hashed strings are identical, so cache keys do not change.
- pros/cons: Pros: a one-line change with no behavior change. Cons: none.
- checker note: `file pages/scene-lab.ts` reports 'data'. cat -v shows raw ^@ ^A ^B inside the template literals at lines 93-95.

### TT-15 — A test pins the App's prefix-based reset fallback

- kind: guess; reader confidence: checked; checker: **confirmed**
- evidence: tests/app/events.test.ts:8 "describe('shouldResetAccumulation (fallback heuristic)'". src/app/events.ts:63-67 decides by path prefix. src/app/App.ts:406-411 'falls back to the path-prefix heuristic only for parameters without metadata'.
- why it matters: The owner's rule is that the system never guesses: missing facts are declared or are errors. The test enshrines the guess. (The App area reviewer may cover the source side.)
- suggestion (thought-through-not-checked): In the App reorg, have engine builtins and display parameters declare triggersReset, and make missing metadata an error. Then the test checks that declaration.
- pros/cons: Pros: removes a heuristic. Cons: every engine/env builtin needs metadata.
- checker note: tests/app/events.test.ts:8 describe('shouldResetAccumulation (fallback heuristic)'). events.ts:63-67 decides by prefix, and App.ts:400-412 falls back to it when metadata is missing. One correction: there is no active 'App reorg' to put the fix in (docs/claude-app-decisions.md withdrawal). It would be a separate simplification to discuss with the owner.

### TT-16 — How a refactor is proven behavior-preserving today: strong for the compiler, thin for App/engine

- kind: research-note; reader confidence: checked; checker: **confirmed**
- evidence: digest (2.8 s, 274 scenes, measured) → vitest (87 s) → frames (8 cases, ~37 s, docs/claude-outputs-accumulation.md:403) → sweep (45–90 min). FRAME_CASES at tools/witness.mjs:759-770 cover average, variance (zero and noisy), oneshot, spectral, medium, grin and tiled, all through cornell-area/furnace/fog-area/grin-furnace/spectral-materials. UI extensions are covered only by appShortcuts.test.ts.
- why it matters: A compiler refactor can be proven unchanged in seconds. An App/engine refactor (the next planned work) has only 8 bit-exact cases plus unit tests with fakes. Interactive paths (parameter upload without recompile, session restore, renderer switching) are covered only by witness-spectral-live/lifecycle, which are manual and need a server.
- suggestion (thought-through-not-checked): Before the App reorg, decide which interactive behaviors need a bit-exact frames case (e.g. a parameter change mid-accumulation, renderer switching, session save/restore) and add them to FRAME_CASES.
- pros/cons: Pros: reuses the existing bit-exact tool. Cons: each case adds ~5 s of SwiftShader time and must be deterministic at the pinned salt.
- checker note: FRAME_CASES at witness.mjs:759-770 are the 8 cases listed. docs/claude-outputs-accumulation.md:403 gives 37 s, but also records one 338 s run. tests/app has unit tests with fakes (rendererManager, productionOrchestrator, parameterStore, tiledRenderer, etc.), and none drives interactive paths bit-exactly. As in TT-3, App/engine refactoring is not 'the next planned work': the plan was withdrawn 2026-10-04.

**Checker: missed by the reader**

- docs/claude-app-decisions.md is now a withdrawal notice (2026-10-04): the App reorg plan and its decisions are withdrawn, AGENTS.md governs, and there is no approved App refactor. Several findings (TT-3, TT-15, TT-16) present 'the App reorg' as an active plan, and that should be corrected. The doc also says the lab and gallery are testing infrastructure that should not dictate App design.
- scripts/witness-spectral-bindings.ts:119-136 already executes the shipped mirror/ggx/checker/dielectric/rough_dielectric `_sample` GLSL against closed forms at normal incidence. This is the natural place to extend a GLSL-vs-twin probe (TT-1) and should be cited as existing partial coverage.
- Several of these findings (rough_dielectric η=1 test that cannot fail; dispersion/blackbody missing from the CI GPU job) were already recorded in docs/claude-review-2026-09-25.md:159, docs/claude-design-review-2026-09-28.md:431 and docs/claude-spectral-review-2026-09-28.md:373. The survey should link them rather than present them as new.

**Reader questions for the owner**

- Should the 3.5 MB generated-GLSL snapshot stay as an automatic CI gate, or should the digest (all 274 scenes, run before and after a change) plus the ProgramDescription snapshot be the codegen proof? If the snapshot goes, should CI compare against a committed digest?
- Do you want a GPU probe that runs ggx/rough_dielectric/equiangular GLSL against their TS twins, closing the 'nothing checks a GLSL file against its twin' gap with the existing renderProbes harness?
- For the App reorg: should the App API that the witness runner and scripts depend on (about 24 methods plus window hooks) become an explicit, typed module that the reorg must preserve?
- Should witness:dispersion, witness:blackbody, witness:spectral-lifecycle and witness:spectral-live join the manual GPU CI job?
- For curved spaces, which witnesses should come first? Space-independent gates (closed furnace, estimator equality, analytic vs marched twins) work unchanged; derived values such as slabs and the far clip need new derivations per space.


## docs-inventory

docs/ is a flat folder of 140 Markdown files, about 38,000 lines in all. They come in four generations:
- **Jan 2025 "locked" architecture docs:** compiler-engine-contract, architecture-decisions, architecture.md, compiler-system.
- **July–Aug 2026 "fable-*" designs:** design authorities plus about 45 impl-plan-* build records.
- **Sep–Oct 2026 "claude-*" plans and reviews:** spectral, outputs/pictures, review batches.
- **Session handoffs.**

Most of these are history: executed plans, reviews, audits, research records. About 20 docs still govern the code, and roughly a dozen are open or in-progress designs. The open ones must be kept: subsurface step 4, imagery P2–P5, expression machinery, authoring language, emitter profiles, OIDN step 7, spectrum-fields step 5, Owen-Sobol, the realistic camera, and driven-light stage B.

The live contracts for the component families have moved into the 26 src/**/README.md files. Nothing in docs/ points to them.

**The index is out of date.** docs/README.md lists 61 of the 140 docs. It leaves out 5 of the 15 design authorities named in CLAUDE.md, including the owner-pinned strategy taxonomy and the trace-loop contract. It also gives the wrong build status for several docs.

**The authority table is partly stale.** Most entries in CLAUDE.md's Design authority table still hold. Five have stale sections:
- **compiler-engine-contract §1:** shows RenderStrategy as {algorithms, settings}, and §7 describes a Project/compileProject that the code doesn't have.
- **fable-compiler-contracts:** its non-goals, its v1 constraints and §8 ("spectral planned") are out of date, and it names ambient_transport where the code has ambient_parallel_transport.
- **fable-components §4:** the folder tree still shows film/, phase/ and transport/pt/transport.ts.
- **fable-module-anatomy:** its descriptor sketch has drifted from descriptors.ts.
- **fable-reference-implementations:** its "normative" Lambert uses raw dot; the built code uses ambient_dot.

trace-loop-contract.md also has one false line saying spectral rendering is unimplemented.

**Three overview docs are badly stale.** architecture.md, compiler-system.md and architecture-decisions.md still describe the compiler as a "minimal vertical slice", and they point to files that no longer exist.

**Moving docs is costly.** Code comments cite docs by file name 306 times, across 74 files. Moving or renaming docs would break those pointers, so the cheapest cleanup is to rewrite the index and the stale status lines, not to reorganize folders.

**One record is lost.** The owner's App decisions 1–17 are no longer anywhere in the repo or in the /private/tmp backup, which has been deleted. Only a summary in the model's memory remains.

### DOC-1 — docs/README.md index omits 79 of 140 docs, including 5 CLAUDE.md design authorities, and mislabels build status

- kind: doc-code-mismatch; reader confidence: checked; checker: **confirmed**
- evidence: A loop over `ls docs/*.md` checking for `(name)` in docs/README.md gave 80 unindexed files (79 plus README itself). Unindexed authorities: fable-strategy-taxonomy.md, trace-loop-contract.md, fable-components.md, fable-data-rail.md, fable-light-bvh.md. Wrong rows: README.md:15 "Step 6 of the outputs plan (PROPOSED)" (CHANGELOG 2026-10-01 says built); README.md:49 fable-rough-dielectric "(Aug 11 2026, NOT built)" (impl-plan-rough-dielectric is BUILT); the fable-epsilon-discipline row says "NOTHING BUILT" (impl-plan-epsilon-discipline says BUILT). architecture.md is listed as "Full system reference" even though CLAUDE.md says to prefer CLAUDE.md. The step-7 plan, claude-app-decisions.md and the 2026-11 review folder are not indexed. The Sep 28 design review (Part 7.4) already reported this at 47/117.
- why it matters: A newcomer, human or model, cannot tell from the index which documents govern the code and which are history. This is the owner's main readability pain.
- suggestion (thought-through-not-checked): Rewrite docs/README.md as four tables: Authorities first (about 20, each with what it governs and any known stale sections), then Open plans and in-progress designs, Guides, and History grouped by topic. Keep every file name.
- pros/cons: Pros: no broken pointers, small diff, reviewable in one sitting, nothing deleted. Cons: the index stays hand-maintained and the folder stays flat at 140 files.
- checker note: Re-ran the loop: 141 docs/*.md, 80 have no '(name)' link in docs/README.md (README itself included). fable-strategy-taxonomy, fable-components, fable-data-rail, fable-light-bvh, claude-app-decisions and claude-outputs-step7-plan have no mention at all. trace-loop-contract.md is named once, inside the fable-compiler-contracts row, but has no row of its own. Wrong rows confirmed: README.md:15 step 6 'PROPOSED' (commit 9e9dbdc built it), :49 rough-dielectric 'NOT built', :52 epsilon 'NOTHING BUILT', and :18 architecture.md 'Full system reference'. The claude-outputs-accumulation row also still says 'steps 0–5 built'. The design review's 7.4 does report 47 of 117 at claude-design-review-2026-09-28.md:502.

### DOC-2 — compiler-engine-contract.md (listed as locked authority) has stale core types and a Project API that doesn't exist

- kind: doc-code-mismatch; reader confidence: checked; checker: **confirmed**
- evidence: docs/compiler-engine-contract.md:31-60 `interface RenderStrategy { id; name?; algorithms: {transport; sampling?; accumulation?}; settings?: {...} }` vs src/compiler/types.ts:561-566 `RenderStrategy { id; measurement; estimator; view }`. The doc's SceneDescription {objects, materials[], lights} vs types.ts:21-41 (id, ambientSpace, materials: Record, environment, ambientMedium, provenance). Doc `sourceMap: SourceMap` vs types.ts:1097 `sourceMaps?: Map<string, SourceMap>`. §7 `type Project` / `compileProject` have no match in src (grep); the code uses Compiler.compileScene (Compiler.ts:26). §2 RenderPipeline does match types.ts:980-991, and the ldrRecipe and picture extensions are kept current.
- why it matters: CLAUDE.md calls these types "locked" and points to this doc. Its first section teaches a strategy shape that contradicts the owner-pinned measurement/estimator/view taxonomy.
- suggestion (checked): Replace §1's type sketches with the current types, or with a pointer to types.ts plus a summary. Mark §7 Project as superseded by compileScene. Keep §2 and the extension notes.
- pros/cons: Pros: brings the locked contract back in line with the code it locks. Cons: editing a 'locked' doc needs owner sign-off, though this is a documentation correction, not a contract change.
- checker note: Confirmed. The doc has RenderStrategy{id,name?,algorithms,settings?} and SceneDescription{objects,materials[],lights}. types.ts:563 has RenderStrategy{id,measurement,estimator,view}, and SceneDescription at types.ts:21 has id, ambientSpace, materials as a Record, environment, ambientMedium and provenance. The doc has sourceMap; the code has sourceMaps?: Map (types.ts:1098, not 1097). §7 Project/compileProject (doc line 876+) has no match anywhere in src, and doc line 944 says 'compile one strategy at a time', while Compiler.ts:26 has compileScene(scene, strategies[]). The doc does label its §1 sketches 'Deferred... will evolve', but it still teaches the old shape under a 'LOCKED IN' header dated January 2025.

### DOC-3 — fable-compiler-contracts.md has stale scope sections and seam names relevant to curved space

- kind: doc-code-mismatch; reader confidence: checked; checker: **confirmed**
- evidence: Top status line: "item 9 (transport split) deliberately last"; §10.1 item 9 says "DONE (July 2026, impl-plan-transport-split.md)". §1 non-goals list "mesh/BVH geometry" (built). §1.1 V1-C1 (homogeneous only), V1-C2 (analytic lights only) and V1-C3 (SDF-marching only) are all relaxed in code. §5.1 declares `Direction ambient_transport(...)`; src/components/ambient/euclidean/euclidean.glsl:25,31 has `ambient_parallel_transport` and `ambient_direction_to`. §8: "Spectral rendering ... remain planned" (built Sep 27). §5.3: "NEE/MIS in general spacetimes is analytically hopeless ... curved scenes select BSDF-sampling".
- why it matters: This is the main GLSL contract doc. For the owner's goal (S³, H³, H²×R, where the two-point geodesic is analytic) the §5 ambient seam is the most relevant section. That section uses the wrong names, and its NEE stance was written for black holes.
- suggestion (thought-through-not-checked): Add short status notes at §1, §1.1 and §8, and correct the §5.1 names to match euclidean.glsl and the ambient README. Leave the §5.3 NEE stance to the curved-space design work rather than editing it now.
- pros/cons: Pros: small edits, and the curved-space seam doc then matches the one occupant. Cons: a 754-line doc patched with status notes stays hard to read; a later rewrite may be better.
- checker note: Line 3 says 'item 9 (transport split) deliberately last'. Line 701 says 'item 9 remains', and line 714 says 'DONE... §10.1 is COMPLETE'. The doc contradicts itself. Line 33 lists mesh/BVH geometry as a non-goal. V1-C1/C2/C3 (lines 39-52) are stated as current Validator rejections, though the code has heterogeneous media, mesh lights and analytic intersection. Line 457 has ambient_transport; euclidean.glsl:25,31 has ambient_parallel_transport and ambient_direction_to. Lines 656-657 say spectral rendering 'remain planned'. Line 480 has the 'analytically hopeless' NEE stance.

### DOC-4 — trace-loop-contract.md says spectral rendering is unimplemented

- kind: doc-code-mismatch; reader confidence: checked; checker: **confirmed**
- evidence: docs/trace-loop-contract.md:24 "RGB uses an initialized placeholder; spectral rendering remains unimplemented." CLAUDE.md Status lists four-wavelength spectral rendering, the CIE 1931 sensor and Cauchy/Sellmeier dispersion as built. The struct shapes in the doc do match src/glsl/core/structs.glsl:11-38 (Ray {origin, direction, wl}; Hit with wl, t, p, frame, ng, region_from, region_to).
- why it matters: An owner-decided authority with a false status sentence makes readers doubt the whole document.
- suggestion (checked): Replace the sentence with a pointer to src/components/color/spectral/README.md.
- pros/cons: Pros: one-line fix. Cons: none.
- checker note: docs/trace-loop-contract.md:24 reads exactly 'RGB uses an initialized placeholder; spectral rendering remains unimplemented.' That contradicts the CLAUDE.md Status section and the spectral code.

### DOC-5 — Normative reference Lambert violates the ambient_dot rule the code follows

- kind: doc-code-mismatch; reader confidence: checked; checker: **confirmed**
- evidence: docs/fable-reference-implementations.md ~line 368: `if (dot(wi, hit.frame.n) * dot(wo, hit.frame.n) <= 0.0)`. src/components/materials/lambert/lambert.glsl:10: `if (ambient_dot(wi, hit.frame.n, hit.p) * ambient_dot(wo, hit.frame.n, hit.p) <= 0.0)`. trace-loop-contract.md says "Lambert works in world space, so every dot it takes is ambient_dot". The doc's §10 also uses `ambient_transport` (the code name is ambient_parallel_transport).
- why it matters: CLAUDE.md says to "transcribe, don't re-derive" from this doc. A new material transcribed from it would have exactly the Euclidean assumption the curved-space seam exists to prevent.
- suggestion (checked): Update the §1 Lambert block and the §10 names to match the built code, or state at the top that the built occupant files are normative where they differ.
- pros/cons: Pros: closes a curved-space trap in the transcription source. Cons: other sections (GGX, dielectric) may have the same drift; I checked only Lambert.
- checker note: The substance holds, but the line is wrong: the bare-dot Lambert test is at fable-reference-implementations.md:19, not ~368. The drift is wider than Lambert. The reference dielectric (line 40, `dot(wi, hit.frame.n) * sign(dot(wo, ...))`) also uses bare dot, while src/components/materials/dielectric/dielectric.glsl:24 uses ambient_dot. §10 uses ambient_transport (lines 671, 684, 696), while the code uses ambient_parallel_transport. trace-loop-contract.md:103 has the 'every dot it takes is ambient_dot' rule.

### DOC-6 — Three overview docs describe the compiler as an unbuilt 'vertical slice' and cite missing paths

- kind: doc-code-mismatch; reader confidence: checked; checker: **confirmed**
- evidence: docs/architecture.md (1344 lines): "The Compiler layer holds a minimal vertical slice ('step zero')... The real compiler is the work ahead" (Current Status). It cites TODO.md, src/math/, src/compiler/scenes/ and src/compiler/__tests__, none of which exist (ls). docs/compiler-system.md:412-521 lists library files rng.glsl, raymarch.glsl, lambert.glsl, templates path_trace.glsl/main_accumulate.glsl, and "Current Limitations: SDF sphere, plane, box; Lambert; point lights". docs/architecture-decisions.md: "Simple, one-at-a-time compilation" vs Compiler.compileScene(scene, strategies[]) (Compiler.ts:26), plus a dev/prod `compiled.js` mode with no match in src. architecture.md calls compiler-system.md "the authoritative current documentation" for the compiler.
- why it matters: These are the docs a newcomer would open first for the big picture, and they describe a much smaller, older system. CLAUDE.md's Architecture section is the accurate overview.
- suggestion (thought-through-not-checked): Mark all three as superseded by CLAUDE.md's Architecture section, with a status line at the top. Later, decide with the owner whether to fold the still-useful App/Engine detail from architecture.md (data flows, ping-pong, MRT, sessions) into one short present-tense overview. Do not delete them.
- pros/cons: Pros: removes the most misleading entry points. Cons: architecture.md's App/Engine sections were not checked in depth and may still be accurate and useful; that content needs a home before the doc is demoted.
- checker note: architecture.md:267, 1278 and 1280 ('The real compiler is the work ahead'), and its tree at 1319-1335 (compiler 'vertical slice', __tests__/, scenes/, math/), cite TODO.md, src/math, src/compiler/scenes and src/compiler/__tests__. None of those exist (ls). architecture.md:5 calls compiler-system.md authoritative. compiler-system.md:213-269 and 423-448 list rng.glsl, raymarch.glsl, path_trace.glsl and main_accumulate.glsl, and :502 says 'Current Limitations: SDF sphere, plane, box; Lambert; point lights'. architecture-decisions.md:17 says one-at-a-time compilation and :66 has compiled.js; src has no compiled.js.

### DOC-7 — fable-components §4 tree and fable-module-anatomy §2 descriptor sketch drifted from the code they govern

- kind: doc-code-mismatch; reader confidence: checked; checker: **confirmed**
- evidence: docs/fable-components.md:91-106 tree lists `film/ accumulate_average.glsl tonemap_reinhard.glsl`, `phase/`, and `components/transport/pt/transport.ts` (line 14). Actual: src/components/{accumulator,tonemap,volume_scattering,aov,color,sensor,pixel,...} and transport/integrators/pt/pt.ts (ls). docs/fable-module-anatomy.md:35-44 has `capabilities: { deltaLobes; transmission; emissive }`; src/components/descriptors.ts:104-158 has nonDeltaLobes, transmission, support, emissive, readsUv, plus albedo, derived and usesMicrofacet. The code comment says "Polarity flipped vs module-anatomy §2's deltaLobes sketch". The module-anatomy header says the file reorganization is DEFERRED, but impl-plan-descriptor-reorg.md is BUILT.
- why it matters: Both are in the CLAUDE.md authority table for adding an occupant, which is the main extension path. The real authority is now descriptors.ts and the family READMEs.
- suggestion (thought-through-not-checked): In the authority table and in each doc's header, say that descriptors.ts and src/components/<family>/README.md are the shapes of record. Update the fable-components tree or replace it with a pointer to `ls src/components`.
- pros/cons: Pros: one answer per fact (the code). Cons: the design rationale in these docs still has value and must not be lost when they are demoted to rationale.
- checker note: The fable-components.md §4 tree (lines 91-106) lists phase/ and film/ and flat files. Actual src/components has accumulator, aov, color, sensor, pixel, tonemap, volume_scattering, intersection, accel, data, and one folder per occupant. fable-components.md:14 describes the transport/pt/transport.ts move, which is now integrators/pt/pt.ts. fable-module-anatomy.md:35-44 has deltaLobes/transmission/emissive. descriptors.ts has nonDeltaLobes (:128, with the 'Polarity flipped' comment at :126), support (:142), readsUv (:149), usesMicrofacet (:116) and derived (:112). module-anatomy says the reorg is DEFERRED, but impl-plan-descriptor-reorg.md is BUILT.

### DOC-8 — Six plan headers say PLANNED, in progress or NOT BUILT for work that is built

- kind: doc-code-mismatch; reader confidence: checked; checker: **confirmed**
- evidence: impl-plan-display.md "Status: PLANNED (Jul 14 2026)": accumulator/ (average, oneshot, variance) and tonemap/ (7 occupants) exist. impl-plan-scattering.md "PLANNED": volume_scattering/{hg,rayleigh} exists. impl-plan-sensor.md "PLANNED": sensor/{ideal,cie1931} exists. impl-plan-audit-hardening.md "proposed — pending owner review": impl-plan-env-as-light.md:10 says "Prerequisite: impl-plan-audit-hardening.md (built)". impl-plan-2.10-contributions.md "in progress": FeatureContribution is used in pt.ts, pixel.ts and camera.ts. fable-epsilon-discipline.md "NOTHING HERE HAS BEEN BUILT": impl-plan-epsilon-discipline BUILT from it. claude-spectral-implementation-plan.md is still titled "draft for adversarial review" though its status says implemented.
- why it matters: A reader looking for unfinished work would be pointed at finished work. Plans that really are open look no different from stale ones.
- suggestion (checked): Correct the status line of each, one line per doc, citing the CHANGELOG entry or commit.
- pros/cons: Pros: trivial, and makes the status field trustworthy. Cons: impl-plan-2.10 and impl-plan-driven-lights need a closer check before relabeling (inferred, not proven).
- checker note: Status lines confirmed. display, scattering and sensor say PLANNED (Jul 14), but the accumulator/{average,oneshot,variance}, tonemap (7 occupants), volume_scattering/{hg,rayleigh} and sensor/{ideal,cie1931} folders exist. audit-hardening says 'proposed — pending owner review', but env-as-light:10 calls it built. 2.10-contributions says 'in progress', but FeatureContribution is used in 10 src files. Epsilon says 'NOTHING HERE HAS BEEN BUILT'. The spectral plan is still titled 'draft for adversarial review'. As the reader hedged, I did not prove that each Jul 14 plan was built as written (sensor/cie1931 came with the Sep spectral work), so each relabel should name what was actually built. CHANGELOG has no entries naming these plans.

### DOC-9 — Owner's App decisions 1–17 exist nowhere in the repo; the recovery copy is gone

- kind: other; reader confidence: checked; checker: **confirmed**
- evidence: docs/claude-app-decisions.md (untracked, so no git history) now holds only the 2026-10-04 withdrawal note and goals. CHANGELOG.md:22-23 says the full pre-rollback copy is at `/private/tmp/pathtracer-before-app-rollback-w081s938`, and `ls` reports No such file or directory. docs/claude-2026-11-review/decisions.md item 7: "The owner's App decisions 1–17 (docs/claude-app-decisions.md history, and the goals in its current text) remain the owner's decisions." The only surviving trace is the model memory file app-reorg-state.md, which summarizes decisions 1–17 in one paragraph.
- why it matters: The App redesign is priority (a) of this review. Its earlier owner decisions survive only as a model-written summary, so they cannot be cited exactly.
- suggestion (checked): Tell the owner. Ask whether they have the text elsewhere, or whether the memory summary should be confirmed with them and written into the review folder as owner-confirmed decisions.
- pros/cons: Pros: prevents later plans from citing decisions nobody can read. Cons: rebuilding them from a summary risks putting words in the owner's mouth, so the owner must confirm.
- checker note: /private/tmp/pathtracer-before-app-rollback-w081s938 does not exist (ls). claude-app-decisions.md (39 lines, untracked, no git history in any branch) holds the withdrawal note, the goals, a short 'Earlier discussions favored...' paragraph (three choices) and 'How to continue'. The 1–17 decisions are not there. claude-2026-11-review/decisions.md:31 still cites them. I searched ~/.claude and /private/tmp for any other copy: the only session transcript in the project dir is the current one. The memory app-reorg-state.md summarizes only decisions 1–11 in detail.

### DOC-10 — Open and in-progress designs are scattered among build records and must be kept

- kind: in-progress; reader confidence: checked; checker: **confirmed**
- evidence: Self-declared open or deferred: fable-subsurface.md (steps 1–3 built, step 4 unstarted; cited by 49 code comments); fable-imagery.md (P2 expression materials, P3 reconstruction filters, P5 showcases pending; only the box pixel filter exists in src/components/pixel); fable-expression-machinery.md + impl-plan-expression-machinery.md (DEFERRED; symbolic differentiation for varieties and curved space); fable-authoring-language.md (DRAFT); fable-emitter-profiles.md (future); claude-outputs-step7-plan.md (OIDN, proposed); claude-spectrum-fields.md step 5 (awaiting owner); impl-plan-driven-lights.md Stage B (driven light geometry, in CLAUDE.md Not built); impl-plan-realistic-camera.md (SHELVED, re-trigger: spectral, which has since landed); deferred-owen-sobol-sampler.md (reverted, kept for re-adoption); fable-accel-cwbvh.md (non-default occupant kept on purpose as a measured negative result); fable-reference-implementations.md §10 (H³ hyperboloid sketch); claude-improvements-2026-09.md Part 6 (curved-space first steps: an H³ furnace witness, SDF-only first scenes).
- why it matters: Under the unfinished-is-not-dead rule these are future-work anchors. Several serve the owner's stated goals: curved spaces, algebraic surfaces, and photorealism (textures, filters, subsurface).
- suggestion (thought-through-not-checked): List them in their own 'Open' table in the docs index, each with its trigger or next step, so they are visible and not mistaken for history.
- pros/cons: Pros: protects unfinished work from cleanup and gives the curved-space and photorealism planning a starting list. Cons: none significant.
- checker note: Status headers match. fable-subsurface: 50 citations in code (vs 49). imagery P1 built, the rest pending, pixel/ has only box. expression-machinery is HANDOFF / DEFERRED. authoring-language is DRAFT. emitter-profiles is FUTURE. realistic-camera is SHELVED with re-trigger 'the spectral axis landing'. owen-sobol was reverted. cwbvh was built, with a NO-GO verdict, and kept. improvements Part 6 (line 440) covers curved spaces and the hyperbolic furnace. These are correctly classed as in-progress, not dead.

### DOC-11 — No single curved-space design doc; the docs that touch it disagree on names and leave key questions open

- kind: euclidean-assumption; reader confidence: inferred; checker: **partly**
- evidence: Curved-space material is spread across fable-compiler-contracts §5 (ambient_transport, and "NEE ... analytically hopeless" in §5.3), trace-loop-contract.md (ambient_direction_to aims shadow rays; "length() is Euclidean; a geodesic ambient-distance helper is the curved-space follow-up"), fable-reference-implementations §10 (H³ sketch; open: "the ray's direction at a far hit ... needed for wo"), src/components/ambient/README.md (two places declared Euclidean-only: analytic medium bodies, equiangular), fable-transforms (placements are Euclidean similarities), and claude-improvements Part 6. AmbientSpaceDescription already has type 'euclidean' | 'hyperbolic' | 'spherical' (types.ts:43-46); there is no product (H²×R) type.
- why it matters: Curved space is the owner's first priority (b). The seam's signature returns a single direction (`ambient_direction_to(from,to)`). In S³ light reaches a point along more than one geodesic (the short and long great-circle arcs), so a one-direction two-point query may not express NEE there. This is a thought-through hypothesis, not checked against any design.
- suggestion (thought-through-not-checked): Before any code, write one curved-space design doc (in the review folder), with the owner, that collects the seam (geodesic, metric, two-point query, arrival direction, distance), lists every Euclidean-only site, and settles the S³ multiplicity and H²×R product questions.
- pros/cons: Pros: one answer per fact for the most important upcoming work. Cons: a new doc risks duplicating contracts §5; contracts §5 should then point to it.
- checker note: The core claim holds: no dedicated curved-space design doc exists (no file under docs/ matching curv/hyperb/geodes/ambient outside the archive), and AmbientSpaceDescription.type is only euclidean, hyperbolic or spherical, with no product type (types.ts:44). The evidence list is incomplete, though. It misses compiler-next-architecture.md:197-212, which lists open problems for swapping in hyperbolic/spherical: normal estimation by finite differences in curved space, and whether SDFs need modification. It also misses compiler-new-plan.md:91-96 and 323, fable-webgpu-handoff.md:309-319 and 443, and docs/archive/START/contracts/world/ambient_module.md, an older ambient contract whose problem analysis CLAUDE.md says can still be useful. The S³ multiple-geodesic point is still an unchecked hypothesis.

### DOC-12 — Doc volume is out of proportion to the code, especially spectral; component READMEs read as lab notebooks

- kind: complexity; reader confidence: checked; checker: **confirmed**
- evidence: About 38,000 lines in docs/. The spectral docs alone (claude-spectral-design 1472, claude-spectral-implementation-plan 1468, claude-spectrum-fields 1159, claude-spectrum-spec 418, claude-spectrum-bindings 181, claude-spectral-review 457, claude-spectral-authoring-survey 135) are about 5,300 lines. claude-design-review-2026-09-28.md Part 7.1–7.2 (checked there) puts the spectral docs at about 3,700 lines for about 550 lines of color-family code, and calls the spectral README a lab notebook. The outputs plan has 10 companion files (step 0–7 plans, discussion, revised, cleanup).
- why it matters: The owner wants a codebase one person can understand. The reading load is now dominated by process records, not by the design.
- suggestion (thought-through-not-checked): Don't delete anything. Mark the per-step plans and discussions as history in the index, and keep one present-tense contract per area (for spectral, the color READMEs; for pictures, claude-outputs-accumulation.md §1–§10).
- pros/cons: Pros: reading load drops without losing evidence. Cons: rewriting READMEs as contracts is real work and has to be reviewed against the code.
- checker note: docs/ (excluding archive) has 37,962 lines. One file name is wrong: claude-spectral-review.md does not exist; the file is claude-spectral-review-2026-09-28.md. All *spectr*.md files total 5,664 lines, and the seven named files come to about 5,300, so the figure holds. Design review 7.1 (line 475) gives ~3,700 lines vs ~550 lines of color code, and 7.2 (line 484) gives 'lab notebooks'. color/ has 1,038 non-test .ts/.glsl lines in total. The outputs plan has 11 companion files (step0–7, discussion, revised, review-cleanup), not 10.

### DOC-13 — Moving or renaming docs would break 306 code citations

- kind: extension-friction; reader confidence: checked; checker: **confirmed**
- evidence: `grep -rhoE "(fable|impl-plan|claude|...)-*.md"` over src, tests, tools, scripts and pages: 306 references in 74 files. Top cited: fable-subsurface 49, fable-volumetric-component 31, fable-heterogeneous-media 16, fable-variable-ior 9, fable-transforms 8. Many cite § numbers and omit the `docs/` prefix. None currently dangle (a loop over the unique names found every target).
- why it matters: Any docs cleanup that renames, moves or re-sections files creates dangling pointers in code comments, which CLAUDE.md treats as a defect.
- suggestion (checked): Prefer an index-and-status cleanup (keep paths). If folders are wanted, do it as a separate, mechanical, digest-neutral batch with a link checker.
- pros/cons: Option A (index only): no breakage, but stays flat. Option B (folders): status visible from the folder, but a large mechanical rewrite of comments and repeated moves as plans become records.
- checker note: My regex gave 307 references in 80 files, close to the reported 306 in 74 (the regexes differ slightly). I resolved every unique cited name under docs/ recursively, and none dangle.

### DOC-14 — Root README.md and CLAUDE.md have small stale facts

- kind: doc-code-mismatch; reader confidence: checked; checker: **confirmed**
- evidence: README.md: "Still Euclidean-only: heterogeneous media and curved spaces ... are the road ahead" (heterogeneous media are built). The Components box lists `phase` and `film` (now volume_scattering, accumulator, tonemap). The keys table lacks m, p, j, o and \ (src/app/extensions/AppShortcutsExtension.ts:83-153). CLAUDE.md's family list omits `aov` and `color` (both are directories in src/components). The status header says "September 2026" but includes Oct 1 AOVs. archive/README.md "What's current" names CURRENT-STATE.md, ARCHITECTURE.md, docs/COMPILER-ENGINE-ARCHITECTURE.md and docs/ARCHITECTURE-DECISIONS-SUMMARY.md, none of which exist under those names. deferred-owen-sobol-sampler.md cites `src/compiler/generate/glsl/rng.glsl`; the sampler is now src/components/sampler/pcg4d/pcg4d.glsl.
- why it matters: These are the first files anyone reads, so small errors there undermine trust in the rest.
- suggestion (checked): One small docs-only commit fixing these lines.
- pros/cons: Pros: cheap. Cons: none.
- checker note: Confirmed. README.md:9 says 'Still Euclidean-only: heterogeneous media...'. README.md:57-58 lists phase and film. The README key table (lines 92-99) lacks \, p, m, j and o, which AppShortcutsExtension.ts handles at lines 101-153. It also says '1/2/3' where line 23 says '1-9'. CLAUDE.md:78-80 omits aov and color. The CLAUDE.md:220 header says 'September 2026'. archive/README.md:18-21 names four files that do not exist. deferred-owen-sobol-sampler.md:4,71 cites src/compiler/generate/glsl/rng.glsl, which is gone; the sampler is in components/sampler/pcg4d/.

### DOC-15 — Stale handoffs and review trackers still read as active instructions

- kind: in-progress; reader confidence: checked; checker: **partly**
- evidence: claude-review-handoff.md: "Update it or delete it when the review is done"; batch 6 and its items "were not resumed". handoff-2026-07-16.md, handoff-2026-07-18-descriptor-compute.md, HANDOFF-2026-07-22-grin-session.md ("Do not touch anything until the owner picks": resolved, GRIN is built), and HANDOFF-2026-08-10-sdf-accel-session.md are all top-level with imperative instructions. claude-review-2026-09-25.md still holds open items (batch 5 item 5.5 paused, owner item 3 open) that CLAUDE.md cites as known defects.
- why it matters: A model reading these may follow old instructions, which is exactly what AGENTS.md warns against ("Do not resume a withdrawn implementation because a historical document calls it approved"). The open review items, though, are real in-progress work.
- suggestion (thought-through-not-checked): Put a one-line 'HISTORICAL: resolved, see CHANGELOG <date>' banner at the top of each handoff. Copy the still-open review items into the index's Open table.
- pros/cons: Pros: stops stale imperatives; open items stay visible. Cons: edits historical documents, though only a banner is added.
- checker note: The handoff imperatives are confirmed (claude-review-handoff.md:6-7, HANDOFF-07-22:6, the 07-16 and 08-10 headers). One attribution is off: the paused item 5.5 and the open owner item are recorded in claude-review-handoff.md:13,23, not in claude-review-2026-09-25.md, which has no '5.5'. The 09-25 review's Part 7 still lists undone batches 3, 4 and 6 and the GRIN note. One caution on the suggestion: handoff-2026-07-18-descriptor-compute.md says 'design, not yet built'. Material `derived` rows now exist (descriptors.ts:112), so it is probably resolved, but each banner should be checked one by one, not stamped 'resolved' as a blanket.

**Checker: missed by the reader**

- The reference-implementation drift goes beyond Lambert. The reference dielectric (fable-reference-implementations.md:40) also uses bare dot(), while dielectric.glsl:24 uses ambient_dot. Treat the whole normative doc as untrustworthy for the curved-space seam, not just §1.
- Earlier curved-space material not in DOC-11. compiler-next-architecture.md:197-212 lists curved-space open problems (normals by finite difference, SDFs not being Euclidean distances, the ambient functions as a swappable 'geometry backend'). compiler-new-plan.md:91 already sketched a 'sol' ambient type. fable-webgpu-handoff.md:309-319 and 443 restate the seam. docs/archive/START/contracts/world/ambient_module.md is an older ambient contract. All are inputs for the proposed curved-space design doc.
- fable-compiler-contracts.md contradicts itself, not just the code: the status line (3) and line 701 say 'item 9 remains', while line 714 says '§10.1 is COMPLETE'.
- In docs/README.md, the claude-outputs-accumulation row still says 'steps 0–5 built', and the claude-oidn-test-plan row says ON HOLD with no link to the newer claude-outputs-step7-plan.md (OIDN).

**Reader questions for the owner**

- Your App decisions 1–17 are no longer in the repo, and the /private/tmp recovery copy is gone. Do you have that text anywhere else? If not, would you like to confirm the memory summary so it can be written down as your decisions?
- For a docs cleanup, would you rather keep the flat folder and rewrite only the index and the stale status lines (no broken links from the 306 code citations), or move docs into design/plans/records folders (a bigger mechanical change)?
- Should architecture.md, compiler-system.md and architecture-decisions.md be marked superseded by CLAUDE.md's Architecture section, or do you still use architecture.md's App/Engine detail?
- compiler-engine-contract.md is marked LOCKED, but its §1 types and §7 Project API are out of date. May its text be corrected to match the code? That would be a documentation fix, not a contract change.
- Is there a curved-space design doc anywhere, for example in thurston-rebuild or the old PathTracer repo, that should be treated as the authority, or should one be written fresh in the review folder?


## thurston-port

thurston-rebuild (3-dimensional.space) ray-marches SDFs along exact geodesics in the eight Thurston geometries. It is built with three.js, JS and Mustache-templated GLSL. Each geometry is two GLSL files of about 250–330 lines (part1/part2) plus small imports (distance.glsl, direction.glsl, lightIntensity.glsl). They implement one contract, which core/geometry/shaders/model1.glsl.txt and model2.glsl.txt document as a template.

The contract:
- `Point { vec4 coords }`.
- `Vector { Point pos; vec4 dir }`: a tangent vector carries its base point.
- `Isometry { mat4 }`, plus a `float shift` for the R factor in H2xR and S2xR.
- `Position { Isometry boost; mat4 facing }`: an isometry composed with an orthonormal frame at the origin.
- `flow(Vector, t)`: returns the new point and the transported velocity.
- `geomDot`, `dist(p,q)`, `direction(p,q)` (the two-point geodesic), `orthoFrame(p)` (an orthonormal frame section), `makeTranslation(p)`, and `reduceError` (renormalizes onto the model).

Models and what is analytic:
- E3: homogeneous vec4.
- H3: hyperboloid in R^{3,1}.
- S3: the unit sphere in R4.
- H2xR and S2xR: xyz on the hyperboloid or sphere in R3, w is the height. Tangent coordinate e3 is vertical but is stored in .w.
- All of flow, dist, direction and frames are closed form in these five spaces. Nil, Sol and SL2 are not: Nil needs a numerical distance, Sol needs elliptic functions, SL2 uses 'fake' distance and direction. That is exactly the owner's exclusion line.

Shapes: SDF primitives are exact distance functions with analytic gradients:
- balls, half-spaces (asinh or asin of a Minkowski or Euclidean dot product);
- horoballs (log(-<p,c>));
- tubes about geodesics;
- the Clifford torus;
- product-space vertical and horizontal cylinders and slabs.

Lights:
- A light returns up to maxDirs geodesic directions. The S3 point light uses 2 (short and long arc). The S2xR light uses only 1, although light reaches a point along infinitely many geodesics there.
- Falloff is mostly non-physical (1/len). Only H3's trueLightIntensity (1/sinh^2) is correct.

Cameras map pixel directions through createVector(ORIGIN, dir) and applyPosition.

Quotient manifolds:
- The ray is a RelVector carrying a cellBoost group element.
- Half-space tests teleport it back into the fundamental domain, with analytic 'creep' to the wall (atanh of a dot-product ratio).
- Group elements of arithmetic lattices use exact Z[sqrt d] arithmetic (QuadRing).
- 'Local' shapes live in the quotient; 'global' shapes live in the universal cover.

The march re-flows from the seed every step (flow(v0, t)). That matches PathTracerGLSL's 'Ray = pure geodesic seed' contract.

The old path tracer is a toy and should not be ported:
- chance-based lobes, no NEE, no MIS, a 0.2 'hackCoeff';
- scattering that is overwritten on the next step;
- HalfFloat accumulation.

Engineering is also not to copy:
- per-geometry prototype monkey-patching of shared classes;
- JS objects passed as GLSL struct uniforms by property-name coincidence;
- hand-written JS twins of the GLSL teleport tests;
- duplicate Local and Global shape classes, three files per primitive per geometry;
- a separate Phong material and PT material on every solid.

Compared with PathTracerGLSL's ambient seam (ambient_geodesic → Point, ambient_dot, ambient_frame with cross, ambient_direction_to), the gaps for a port are:
- the arrival direction at a hit (pt.ts uses -ray.direction; the docs already list this as open);
- ambient_distance and the exp-map Jacobian for NEE falloff (sinh^2 or sin^2);
- several geodesics per light in S3 and S2xR;
- isometries in place of similarity placements;
- reduceError;
- a far clip: MAX_DIST=1000 overflows cosh in float32 above about 89; the H3 environment belongs at the ideal boundary;
- possibly quotient teleportation later.

A useful fact for meshes: in H3 and S3, geodesic triangles lie in linear hyperplanes of R4, so exact ray–triangle tests and a Klein or gnomonic-chart BVH look feasible. H2xR is harder.

### TP-1 — PathTracerGLSL ambient seam returns only a Point; the arrival direction at a hit is the origin direction

- kind: euclidean-assumption; reader confidence: checked; checker: **confirmed**
- evidence: PathTracerGLSL src/components/ambient/euclidean/euclidean.glsl:6 `Point ambient_geodesic(Point origin, Direction dir, float t)`; src/components/transport/integrators/pt/pt.ts:420 `'        Direction wo = -s.ray.direction;'`. thurston-rebuild src/geometries/hyp/geometry/shaders/part2.glsl:78-85 `Vector flow(Vector v, float t){ vec4 coords = cosh(t) * v.pos.coords + sinh(t) * v.dir; ... vec4 dir = sinh(t) * v.pos.coords + cosh(t) * v.dir;` returns point AND transported velocity. Already acknowledged open in docs/fable-reference-implementations.md §10: 'Open (§5.3): the ray's direction at a far hit ... needed for wo in curved space'.
- why it matters: In H3/S3/H2xR the tangent at the hit differs from the seed direction; every BSDF eval (wo), MIS and the spawn side test would use the wrong vector. This is the first seam change a curved occupant needs.
- suggestion (thought-through-not-checked): Make the seam flow a unit tangent vector: e.g. a function returning both point and direction at t (thurston's `flow`), used by intersection arms to fill the hit's arrival direction; Euclidean returns (o+td, d).
- pros/cons: Pro: one closed form per space, matches thurston's proven design and the doc's own open item; Euclidean output unchanged. Con: touches Hit (new field or wo computed in arms) and every intersection arm that fills hit.p; must be discussed with the owner as an interface change.
- checker note: Checked: euclidean.glsl:6 returns a Point only, and pt.ts:420 emits `Direction wo = -s.ray.direction;`. Thurston hyp flow (part2.glsl:78-85) returns both the point and the velocity. fable-reference-implementations.md:694 records this as open and names two fixes: a companion to ambient_geodesic, or an ambient_transport of the seed direction. The reader missed that the seam already declares `ambient_parallel_transport(v, from, to)` (euclidean.glsl:25), which is never called anywhere in src. That is in-progress scaffolding for the doc's second option, not dead code. A plan should weigh it against a flow-style function: two-point transport is ambiguous for antipodal points in S3, while flow is not.

### TP-2 — Delta-light falloff 1/d² is baked into LightSample; curved spaces need the exp-map Jacobian

- kind: euclidean-assumption; reader confidence: checked; checker: **confirmed**
- evidence: PathTracerGLSL src/glsl/core/structs.glsl LightSample: `Spectrum radiance;    // incident radiance, WITHOUT visibility (delta lights fold 1/d² in)`. thurston hyp/imports/trueLightIntensity.glsl:7-9 `float aux = sinh(len); return 1.  / (aux * aux);` while hyp/imports/lightIntensity.glsl:9 `return 1. / (len * len);` and euc/sph/h2e/s2e lightIntensity return `1./ len`.
- why it matters: Point/spot light NEE (and area-light pdf conversion area→solid angle) depends on the area density of the exponential map: sinh²d in H3, sin²d in S3, d²·sinh(a)/a in H2xR (a = H2 component length). thurston only gets H3 right in one variant, so its lights cannot be transcribed as-is.
- suggestion (thought-through-not-checked): Add the Jacobian (area density A(d, direction)) to the ambient contract next to distance, and have light samplers call it instead of d².
- pros/cons: Pro: one fact per space, closed form in all five target spaces. Con: the product-space formula is my derivation, not verified against a reference; needs a χ²/furnace-style witness per space.
- checker note: Checked the structs.glsl LightSample comment, thurston hyp trueLightIntensity (sinh²) and lightIntensity (len²), and euc/sph/h2e/s2e (1/len). trueLightIntensity is used only by hyp truePointLight and localTruePointLight. I re-derived the H2xR density: the exp-map Jacobian factors over the product as (sinh a/a)·1, so the area density at distance d is d²·sinh(a)/a with a = |H2 component|. The reader's formula is correct (derivation checked, not tested).

### TP-3 — Several geodesics join two points in S3 and S2xR; thurston's light API already models this (maxDirs), but S2xR uses only one

- kind: research-note; reader confidence: checked; checker: **partly**
- evidence: thurston src/core/lights/Light.js:51-55 doc: '`bool {{name}}_directions(RelVector v, int i, out RelVector dir, out float intensity)` ... The function returns true if the i-th direction exists'. sph/lights/pointLight/shaders/struct.glsl:29-43 `if (i>1){ return false; } ... if (i==1){ intensity = lightIntensity(2. * PI - pointLightComputations.dist); dir = negate(pointLightComputations.dir); }`. s2e/lights/pointLight/shaders/struct.glsl `if (i!=0){ return false; }`.
- why it matters: PathTracerGLSL's ambient_direction_to returns one direction. NEE/MIS in S3 and S2xR must treat each geodesic as a separate light image with its own pdf, or the estimator is biased relative to BSDF-sampled paths that do wrap around; S3 also focuses at the antipode (A(d)→0).
- suggestion (thought-through-not-checked): Decide in the curved-space plan whether NEE enumerates images (S3: 2 per winding; S2xR: a truncated family) or restricts NEE to the shortest geodesic and lets BSDF sampling + MIS cover the rest with consistent pdfs.
- pros/cons: Pro: enumerating images is exact for S3 (finite per winding). Con: S2xR has infinitely many images; truncation is a declared bias that would need a ledger entry; MIS weights per image add complexity.
- checker note: Evidence checked (Light.js:51-55, sph and s2e pointLight structs). Correction: S3 also has infinitely many geodesics between two points (each further winding adds two), so enumeration is exact only under a declared truncation (a far bound or a winding count), just like S2xR. The phrase 'exact for S3' overstates this. The reader also missed that thurston's sph second image drops the light's strength: `intensity = lightIntensity(2. * PI - pointLightComputations.dist);` has no `* light.intensity`, unlike the i==0 branch. Do not transcribe it as written.

### TP-4 — MAX_DIST = 1000 and 'environment found at MAX_DIST' cannot work in the hyperboloid model

- kind: euclidean-assumption; reader confidence: checked; checker: **confirmed**
- evidence: PathTracerGLSL src/glsl/core/math.glsl:11 `#define MAX_DIST 1000.0` and :8 'the environment is found there'. thurston core/cameras/camera/Camera.js:67 `this.maxDist = parameters.maxDist !== undefined ? parameters.maxDist : 50;` and hyp flow uses cosh(t)/sinh(t) (hyp part2.glsl:79).
- why it matters: cosh(t) exceeds float32 max near t≈89, and hyperboloid coordinates lose absolute precision as cosh(d) long before that. In H3 the environment lives at the ideal boundary (the endpoint p+d is light-like); in S3 rays never escape at all.
- suggestion (thought-through-not-checked): Make the far bound and the environment lookup ambient facts: H3 = ideal-boundary direction (null vector p+d) with a per-space far bound of a few tens of units; S3 = no environment (compact) or a declared truncation.
- pros/cons: Pro: removes an overflow trap before the first H3 scene. Con: environment maps in H3 need a chosen frame at infinity (an owner decision); S3 needs a policy for rays that never terminate.
- checker note: math.glsl:8-11 matches, Camera.js:67 has maxDist default 50, and hyp flow uses cosh/sinh. Arithmetic checked: cosh(89.4) ≈ 3.4e38, the float32 maximum. That S3 is compact (rays never escape) is correct.

### TP-5 — Placements are Euclidean similarities; curved spaces have isometries only, and thurston shows the frame form to use

- kind: euclidean-assumption; reader confidence: checked; checker: **confirmed**
- evidence: PathTracerGLSL src/glsl/core/placement.glsl:3-5 'q = the INVERSE rotation quaternion ... ts = (t_rigid.xyz, s) where ... s is the FORWARD scale' and :18-20 `vec3 placement_qrot(vec4 q, vec3 v)`. thurston core/geometry/shaders/commons2.glsl:51-54 `struct Position { Isometry boost; mat4 facing; };` and hyp/geometry/Isometry.js:69-102 makeTranslation via `I + sinh·M + (cosh-1)·M²`.
- why it matters: Uniform scale is not an isometry in H3/S3. PathTracerGLSL already moves the scale into primitive parameters (radius, half size), and that part ports. The rigid part must become a curved-space isometry (mat4 Lorentz/SO(4), or mat4+shift in product spaces), and the vec3 quaternion code is Euclidean only.
- suggestion (thought-through-not-checked): Treat the placement as an ambient fact: Euclidean keeps quaternion+translation; curved occupants supply an Isometry type with apply/inverse (thurston's structs), and scale stays on parameters exactly as today.
- pros/cons: Pro: reuses PathTracerGLSL's existing 'scale on parameters' rule; no new concept for Euclidean. Con: meshes can't be 'scaled' in H3/S3, and the placement generator code (vec3) needs a per-space branch.
- checker note: placement.glsl:3-20 matches (inverse quaternion, scale on parameters, vec3 qrot). Checked thurston commons2.glsl:51-54 `struct Position { Isometry boost; mat4 facing; }` and hyp Isometry.js makeTranslation, which builds I + sinh·M + (cosh−1)·M².

### TP-6 — Exact ray–triangle and BVH look feasible in H3/S3 through projective linearity; thurston already uses that linearity

- kind: research-note; reader confidence: inferred; checker: **confirmed**
- evidence: thurston src/geometries/hyp/groups/cube/set.js:19-33 GLSL test `return dot(p.coords, normal) > 0.;` and creep `float aux = - dot(local.pos.coords, normal) / dot(local.dir, normal); return atanh(aux) + offset;` — a linear hyperplane in R^4 and the exact geodesic hit time.
- why it matters: The owner flagged meshes in curved space as 'a bit more work'. In H3 (Klein model) and S3 (gnomonic chart / R^4), geodesics are straight lines, so geodesic triangles are flat. The hit time is atanh or atan of a dot-product ratio, and inside tests are 3 linear signs. A BVH over Klein coordinates stays valid. H2xR does not have this property: in (Klein_xy, z) coordinates its geodesics are curved.
- suggestion (thought-through-not-checked): Research item for the curved-space plan: mesh support in H3/S3 by intersecting in R^4 against the triangle's hyperplane through 0 plus a cone test, and BVH in the projective chart; record H2xR meshes as harder.
- pros/cons: Pro: exact and analytic, so mesh tracing keeps the same correctness bar as everything else. Con: S3 needs care with antipodal solutions (t and t+π) and the chart covers only a hemisphere. Untested, so it is a research note only, not a recommendation.
- checker note: Research note, correctly labeled inferred. Checked cube/set.js:19-33: linear hyperplane test plus `atanh(-<p,n>/<v,n>)`, which is the exact solution of cosh t·a + sinh t·b = 0. The H2xR claim is right: in (Klein, z) a geodesic is (tanh(λt)·u, μt), which is curved. By Beltrami, only constant-curvature spaces have a chart where geodesics are straight lines. Untested, so not a recommendation.

### TP-7 — PathTracerGLSL ambient family has one occupant; thurston supplies ready closed forms for four more

- kind: in-progress; reader confidence: checked; checker: **reclassify-in-progress**
- evidence: PathTracerGLSL src/components/ambient/index.ts:21-23 `export const AMBIENT_SPACES ... = { euclidean: { type: 'euclidean', glsl: euclideanGLSL } };`; README.md:24 'Sole occupant: euclidean/. H³ and Schwarzschild are the known next occupants'. thurston hyp part1.glsl 252 + part2 85, sph 186+73, h2e 279+76, s2e 199+71 lines with flow/dist/direction/orthoFrame all closed form.
- why it matters: The seam is deliberate scaffolding for curved spaces (CLAUDE.md 'Not built / deferred: curved spaces'), not dead code. The math is the part of thurston worth transcribing, after numerics are cleaned up (see TP-9, TP-10).
- suggestion (thought-through-not-checked): Use thurston's model1/model2 contract as the checklist when designing the curved occupants, transcribing only the closed forms (flow, dist, direction, orthoFrame, makeTranslation, reduceError) and the SDF primitives.
- pros/cons: Pro: the formulas have been in production use for years; each space is about 300 lines. Con: the code is written against Vector-with-base-point structs, so the transcription must be adapted to PathTracerGLSL's Point/Direction typedefs.
- checker note: The reader already classifies this correctly as in-progress, and this verdict agrees: the single-occupant ambient family is deliberate scaffolding (ambient/index.ts:21-23, README 'Sole occupant', CLAUDE.md 'Not built / deferred: curved spaces'). Line counts checked exactly: hyp 252+85, sph 186+73, h2e 279+76, s2e 199+71.

### TP-8 — Shading in a canonical orthonormal frame keeps BSDF code unchanged in curved spaces

- kind: research-note; reader confidence: inferred; checker: **confirmed**
- evidence: thurston hyp/geometry/shaders/part2.glsl:35-49 orthoFrame (verified orthonormal and tangent to 1e-15 by a numeric check in scratchpad/frames_check.mjs, for hyp, sph, h2e and s2e); core/renderers/shaders/pathTracer/random1.glsl:58-61 `Vector randomVector(Point p) { vec3 dir = randomUnitVec3(); return createVectorOrtho(p, dir); }`. PathTracerGLSL lambert.glsl:23 `s.wi = normalize(f.t * (sin_theta * cos(phi)) + f.b * (...) + n * cos_theta);`.
- why it matters: If Frame holds tangent vectors at p (vec4 in the curved models), BSDF code that combines frame vectors linearly is already frame-generic. The leaks are the world-space normalize/cross calls the Sep-28 review listed (§4.7).
- suggestion (thought-through-not-checked): Option for the plan: build ambient_frame from orthoFrame(p) (curved) and Gram–Schmidt against n, then express wi/wo in frame coordinates (vec3) so BSDFs never see vec4.
- pros/cons: Pro: material library untouched. Con: every BSDF must be audited for world-space normalize/cross (some already listed); there is a cost per hit to change coordinates.
- checker note: Checked random1.glsl:58-61 (createVectorOrtho) and lambert.glsl:23. Re-ran scratchpad/frames_check.mjs: the orthoFrame Gram error is up to about 1.4e-14 in hyp, not 1e-15 as stated; this is minor. The Sep-28 design review §4.7 exists (claude-design-review-2026-09-28.md:364). Note that lambert.glsl:23 itself wraps the frame combination in a Euclidean normalize(), so even Lambert is an example of the leak, not leak-free.

### TP-9 — Vertical rays produce a division by zero in H2xR and S2xR flow

- kind: defect; reader confidence: checked; checker: **confirmed**
- evidence: thurston h2e/geometry/shaders/part2.glsl:65-67 `vec3 u = v.dir.xyz; float lambda = hypLength(u); u = hypNormalize(u);` and s2e part2.glsl:60-62 `float lambda=length(u); u=normalize(u);`.
- why it matters: An exactly vertical direction (camera looking straight up, or a mirror reflection off a w-half-space whose normal is (0,0,0,±1)) gives 0/0, which becomes NaN on most GPUs. A port must branch on λ≈0 or use sinh(λt)/λ written in a numerically safe form.
- suggestion (thought-through-not-checked): Write the product flow as p' = cosh(λt)p + (sinh(λt)/λ)·u_raw with a series branch for small λ, never normalizing u.
- pros/cons: Pro: exact and branch-light. Con: one more series branch to test; the GPU NaN behavior was not observed (inferred from GLSL spec).
- checker note: h2e part2.glsl and s2e part2.glsl flow both compute lambda = length(u) and then normalize u without guarding u = 0. A purely vertical direction makes normalize(0) undefined in GLSL. That a NaN is actually observed on a GPU is inferred, not measured, as the reader says.

### TP-10 — Unclamped acos and 1/(1+w) singularities in S3 and S2xR

- kind: defect; reader confidence: checked; checker: **confirmed**
- evidence: thurston sph/imports/distance.glsl:5 `return abs(acos(dot(p1.coords, p2.coords)));`; sph part2.glsl:32 `float den = 1. + w;` in orthoFrame; s2e/shapes/wCylinder/shaders/struct.glsl comment 'for some strange reason, the SDF does not work properly, if we remove the absolute value below'.
- why it matters: Float drift makes |dot| slightly exceed 1, so acos returns NaN. orthoFrame is singular at the antipode of the origin, which a path in S3 can reach, and is badly conditioned near it. Transcribing these lines as written would bring the NaNs along.
- suggestion (thought-through-not-checked): Use atan2-based distance (atan(|q - <p,q>p|, <p,q>)) and a frame construction without the 1/(1+w) pole (e.g., recentre via makeInvTranslation or choose the chart by sign of w).
- pros/cons: Pro: the atan2 form is well conditioned everywhere. Con: slightly more arithmetic; needs a unit test per space.
- checker note: sph/imports/distance.glsl is `abs(acos(dot(...)))` with no clamp. In sph orthoFrame, `den = 1. + w` has a pole at w = −1, the antipode of the origin (0,0,0,1). The 'strange reason' comment appears in s2e wCylinder (line 17) and twice in wCappedCylinder. The atan2 distance form is correct.

### TP-11 — Old path tracer's volume scattering is overwritten on the next march step

- kind: defect; reader confidence: checked; checker: **confirmed**
- evidence: thurston core/renderers/shaders/pathTracer/raymarch.glsl:197-207 `marchingStep = marchingStep + creepingDist(localV, d, camera.threshold); localV = flow(localV0, marchingStep); ... if (doScatter){ scatterRay(localV); }` — the next iteration recomputes `localV = flow(localV0, marchingStep)` from the unscattered seed; same at :242-248.
- why it matters: It confirms that thurston's path tracer is not a reference for transport. Only the geometry layer should be ported. PathTracerGLSL's delta tracking and analytic media are far more correct.
- suggestion (checked): Do not port anything from core/renderers/shaders/pathTracer; port geometry only.
- pros/cons: Pro: avoids importing biased transport. Con: none.
- checker note: raymarch.glsl:197-207 and :242-248: scatterRay(localV) replaces localV.vector, but the next iteration runs `localV = flow(localV0, marchingStep)` from the unscattered seed, so the scatter is discarded (unless a teleport resets localV0). doesItScatter's 1−exp(−d/opticalDepth) with a uniform position in [0,d] is also not distance sampling. Agree: port no transport from thurston.

### TP-12 — Teleportation declares the inverse element's uniform under the element's name

- kind: defect; reader confidence: checked; checker: **confirmed**
- evidence: thurston src/core/teleportations/Teleportation.js:160-162 `shaderBuilder.addUniform(this.elt.name, 'GroupElement', this.elt); ... shaderBuilder.addUniform(this.elt.name, 'GroupElement', this.inv);` while teleport.glsl.mustache:12 uses `{{inv.name}}`.
- why it matters: ShaderBuilder dedupes by name, so the inverse is never declared. It works only because every set passes inv = another teleportation's elt or a neighbor entry (hyp/groups/cube/set.js:207-219). It is a latent trap if quotient support is ported by transcription.
- suggestion (thought-through-not-checked): If quotients are ported, derive inverses inside the group type rather than passing paired uniforms by naming convention.
- pros/cons: Pro: removes a naming coupling. Con: requires an inverse operation per group representation (cheap for Lorentz/orthogonal: JMᵀJ / Mᵀ).
- checker note: Teleportation.js:160-162 calls addUniform(this.elt.name, ..., this.inv), and ShaderBuilder.addUniform (utils/ShaderBuilder.js:130-136) skips any name already seen, so the inverse uniform is never declared under its own name. The mustache file uses {{inv.name}}, which resolves only because each inverse is another teleportation's elt (cube/set.js:207-219 add() pairs).

### TP-13 — Engineering patterns in thurston that should not be copied

- kind: complexity; reader confidence: checked; checker: **confirmed**
- evidence: Per-geometry prototype mutation: hyp/geometry/Isometry.js:13 `Isometry.prototype.build = function () {`, Utils.js:8 `Vector4.prototype.hypDot = ...`; bundle wiring src/3dsHyp.js `Renderer.prototype.constructor.shader1 = shader1;`. JS object as uniform: core/Generic.js shader() `shaderBuilder.addUniform(this.name, this.uniformType, this);`. JS/GLSL twin tests: hyp/groups/cube/set.js:14-23 `function testXp(p)` and `const glslTestXp`. Two material systems: core/solids/Solid.js `constructor(shape, material, ptMaterial = undefined)`. Shape boilerplate: hyp/shapes/ball/BallShape.js (101 lines) + struct.glsl + solids/Ball.js, duplicated as LocalBall.
- why it matters: The owner wants an extremely clean, readable codebase. These patterns cause global mutation, one geometry per bundle, coupling of names across languages, and roughly 3 files per primitive per geometry. PathTracerGLSL's descriptor and registry model (one folder per occupant) is already cleaner.
- suggestion (thought-through-not-checked): Transcribe math only; express curved primitives as ordinary PathTracerGLSL geometry occupants (one folder each) with a per-space SDF body, not as thurston-style class hierarchies.
- pros/cons: Pro: keeps one extension recipe for all spaces. Con: needs a decision on how a geometry occupant declares which ambient spaces it supports (a ball has a different SDF per space).
- checker note: All cited lines checked: Isometry.js:13, Utils.js:8 hypDot, 3dsHyp.js:10, Solid.js:24 (ptMaterial), Generic.js:134, BallShape.js at 101 lines, and ball/localBall duplicated in both shapes/ and solids/. Small correction: `Renderer.prototype.constructor.shader1 = ...` assigns a static property on the class (global mutation per bundle); it is not prototype mutation.

### TP-14 — Exact integer arithmetic for lattice group elements (QuadRing) and analytic creeping: building blocks for future quotient manifolds

- kind: research-note; reader confidence: checked; checker: **confirmed**
- evidence: thurston src/utils/quadRing/shader/quadRing.glsl `struct QuadRingMatrix { mat4 a; mat4 b; };` and `QuadRingMatrix reduce(QuadRingMatrix m){ m.a[0] = round(m.a[0]); ...`; core/teleportations/shaders/relative.glsl:195-202 `RelVector rewrite(RelVector v, GroupElement elt, GroupElement inv)`; core/renderers/shaders/pathTracer/raymarch.glsl:44-74 local loop with teleport + creepingDist.
- why it matters: The owner wants quotients eventually and 'to really take good care of light' (docs/claude-2026-11-review/decisions.md item 5). The relevant pieces are drift-free cell boosts, exact wall-crossing, and neighbor-cell SDF evaluation. Light in a quotient also means multiple light images (see TP-3).
- suggestion (none): Record as research input for a later quotient plan; do not design now.
- pros/cons: Pro: proven technique. Con: it touches the Ray (it must carry a cell element), NEE (images) and the BVH (fundamental domain), so it is a large structural feature.
- checker note: Path correction: the struct QuadRingMatrix and its reduce() are in utils/quadRing/shader/quadRingMatrix.glsl:9,16, not quadRing.glsl. relative.glsl rewrite() matches at lines 195-202, and decisions.md item 5 (line 24-26) quotes 'really take good care of light'. This is a research note, correctly not designed.

### TP-15 — Numerical-gradient frame is not orthonormal

- kind: defect; reader confidence: checked; checker: **confirmed**
- evidence: thurston core/shapes/shaders/numericalGradient.glsl.mustache:4-16 uses `smallShift` (built on `frame()`) then `createRelVector(v, vec3(vgx, vgy, vgz))`; hyp part2.glsl:15-25 `vec4 dir0 = vec4(w, 0, 0, x); ... f[0] = Vector(p, dir0 / l0);`. Numeric check (scratchpad/frames_check.mjs): frame() off-diagonal Gram entries 0.16–0.99 in hyp, sph, h2e and s2e.
- why it matters: Σ ∂f(f_i)·f_i is the gradient only in an orthonormal frame. In the five target spaces every basic shape overrides with an analytic gradient, so the error is dormant there; it is live for Nil/SL2 shapes and LookupShape. A port of marched SDF normals must use orthoFrame or apply the inverse metric.
- suggestion (thought-through-not-checked): Any curved-space finite-difference normal should use an orthonormal frame (orthoFrame) or recentre at the origin first.
- pros/cons: Pro: correct normals for user SDFs (defineSDF) in curved space. Con: orthoFrame has its own pole in S3 (TP-10).
- checker note: The mechanism is correct: numericalGradient.glsl.mustache sums the sdf differences against the non-orthonormal frame() through createRelVector→createVector(p, coords), which uses frame(), not orthoFrame. Correction to the numbers: re-running frames_check.mjs gives frame() off-diagonal maxima from 0.001 to 0.958 depending on the sampled point (zero at the origin), so '0.16–0.99' is sample-dependent. The 'dormant in the five spaces' claim is checked: every hyp/sph/h2e/s2e/euc *Shape.js overrides glslGradient (s2e wCylinder overrides it too, with the numerical import commented out). Shapes without an override are LookupShape and the nil and sl2 shapes. Whether frame() is non-orthonormal in Nil and SL2 was not checked.

### TP-16 — thurston extension tutorial says isGlobal defaults to true; the base class throws

- kind: doc-code-mismatch; reader confidence: checked; checker: **confirmed**
- evidence: thurston doc/tutorials/extending/shape.md: 'If the getter is not implemented, the class will inherit from the one of {@link Shape} which always return true.' vs src/core/shapes/Shape.js `get isGlobal() { throw new Error('Shape: this method should be implemented'); }`.
- why it matters: It is minor, and it is in the old repo. It matters only because the tutorials are a tempting reference for the port's extension design.
- suggestion (none): None in PathTracerGLSL; just do not rely on thurston docs over its code.
- pros/cons: n/a
- checker note: doc/tutorials/extending/shape.md:43-44 says Shape's isGlobal 'always return true', while Shape.js:138-139 throws. Minor, and confined to the old repo.

**Checker: missed by the reader**

- The seam already declares ambient_parallel_transport(v, from, to) (src/components/ambient/euclidean/euclidean.glsl:25), and nothing in src calls it. It is scaffolding for the 'ambient_transport of the seed direction' option in fable-reference-implementations.md:694 (TP-1). It must not be treated as dead code. A curved-space plan must choose between it and a flow-style companion to ambient_geodesic; two-point transport is ambiguous for antipodal points in S3.
- src/components/ambient/README.md:26-29 already marks two places as Euclidean-only beyond the seam: the analytic medium bodies and equiangular placement. Also, lambert.glsl:23 normalizes the frame combination in world space. Any curved-space plan inherits these alongside TP-1/2/4/5/8.
- thurston sph/lights/pointLight/shaders/struct.glsl, i==1 branch: `intensity = lightIntensity(2. * PI - pointLightComputations.dist);` leaves out `* light.intensity`, so the wrap-around image ignores the light's strength. It is a transcription trap for TP-3.
- thurston's sph/h2e/s2e/euc lightIntensity uses 1/len, which is not even Euclidean-correct for those spaces. Only hyp's TruePointLight variant uses the true density 1/sinh². None of thurston's falloff code should be transcribed; derive it from the exp-map Jacobian (TP-2).

**Reader questions for the owner**

- For H3, where should the environment live: at the ideal boundary (each ray's endpoint p+d), with an environment map attached to a chosen frame at infinity, or should H3 scenes have no environment light? MAX_DIST=1000 overflows cosh in float32.
- In S3 and S2xR a point light reaches a point along several geodesics. Should NEE enumerate those light images (exact for S3 per winding; S2xR would need a declared truncation), or sample only the shortest geodesic and leave the rest to BSDF sampling with consistent MIS pdfs?
- Do you want thurston's 'Position = isometry plus an orthonormal frame at the origin' as the placement and camera model in curved spaces? Scale would stay on primitive parameters, as PathTracerGLSL's placement.glsl already does.
- The H2xR and S2xR conventions put the vertical coordinate in .w but make it tangent axis e3 at the origin. Do you want to keep that layout, for compatibility with old scenes and formulas, or pick a fresh one?
- Is mesh support in curved spaces wanted first for H3/S3 only? There, geodesic triangles are flat in the Klein/gnomonic chart, so exact tests look feasible. In H2xR general triangles would need a root solve.
- Is the thurston 'local versus global' split (shapes in the quotient versus the universal cover) something you want to keep when quotients arrive, or would you rather have one kind of shape plus a per-scene choice of group?


## curved-literature

Only one source gets curved-space radiometry right: the owner's own paper (Coulon, Matsumoto, Segerman, Trettel, Exp. Math. 2022, arXiv 2010.15801). In its §5.7, a point light's intensity is I_light / A(r,u), where A is the area density of the exponential map, written with Jacobi fields as ||J_v ∧ J_w||. The values are A = r² in E³, sin² r in S³ and sinh² r in H³. In H²×R it is r·sinh(r sin β)/sin β, and in S²×R it is r·sin(r sin β)/sin β. Here β is the angle from vertical. I checked every formula except S²×R against a finite-difference Jacobian.

For unidirectional NEE/MIS, this means every place the repo writes r² must use A(r,u) instead. That covers point-light falloff and the area-to-solid-angle pdf conversion (point/quad/mesh lights). Radiance stays constant along geodesics in vacuum (Liouville/étendue), and A is symmetric in the spaces we target.

How many geodesics join two points:
- E³, H³ and H²×R: exactly one.
- S³: two (lengths θ and 2π−θ, with the same sin² falloff), and infinitely many at antipodes.
- S²×R: countably many.
- Quotients: one per group element.

The repo's ambient_direction_to returns a single direction.

Projective charts make geodesics straight lines: the Klein model for H³ and gnomonic (hemisphere) charts for S³. There, geodesic triangles are flat, so the Euclidean BVH slab test and triangle intersection carry over. Only the conversion from chart parameter to arc length changes: tanh t in H³, tan t in S³. This does not hold for H²×R in Klein×R, where geodesics are curved, so meshes there remain an open design question.

Three things I worked out myself (none came from a source):
- Equiangular medium sampling has exact closed forms in H³ and S³ (tan θ = tanh τ / sinh h, and tan τ / sin h). I checked these numerically.
- Euclidean solid-angle light samplers should work unchanged in the Klein or gnomonic chart centered at the shading point. This is reasoned, not checked.
- The H³ environment lookup is the ideal point (p+v).xyz/(p+v).w, which is already a unit vector. This is a derivation only.

Float32 precision (measured): Klein coordinates collapse at about hyperbolic distance 9. Hyperboloid coordinates resolve small separations only within about 5 units of the origin. acosh(−⟨p,q⟩) is unusable for small distances anywhere; the formula 2·asinh(√⟨p−q,p−q⟩ / 2) is the more accurate one.

Other sources:
- Kopczyński notes that H³ needs very many lights, so the light tree matters more there.
- Novello et al. only swap the dot product for the metric. They have no geometry term, so they are not a reference for radiometry.
- The GR renderers I found do pure BSDF-sampled Monte Carlo with no NEE.

The old thurston-rebuild repo has reusable exp/log/distance/isometry and quotient code. Its lighting, however, uses arbitrary falloffs (1/len, 1/len²), and its path tracer has no light sampling.

### CL-1 — No area-density (geometry-term) seam: r² is hard-coded in every NEE pdf and point-light falloff

- kind: euclidean-assumption; reader confidence: checked; checker: **unverified**
- evidence: src/components/lights/point/point.glsl:17 `ls.radiance = l.intensity / d2;` ; quad.glsl:30 and mesh.glsl:61 `ls.pdf = d2 / (l.area * cos_l);`. ambient/README.md lists only ambient_dot / ambient_geodesic / ambient_direction_to. Coulon et al. §5.7 eq 5.7: I = I_light / A(t,u), with A = sin² r (S³), sinh² r (H³), r·sinh(r sin β)/sin β (H²×R). Numeric Jacobian check (scratchpad/scripts/check.py) matches all of them to ~1e-11.
- why it matters: Any curved-space NEE or MIS is biased unless every r² becomes A(r,u). Today each sampler would have to be rewritten per space, even though the factor is the only metric-dependent piece in most of them.
- suggestion (thought-through-not-checked): Add a per-space area density, e.g. ambient_area_density(r, u) or a combined connection helper returning (direction at x, direction at y, distance r, A). The light samplers would multiply by it instead of computing d2.
- pros/cons: Pros: one fact per space; Euclidean output is unchanged (A = r²); the isotropic spaces reuse every sampler. Cons: one more seam function; it does not help anisotropic spaces whose samplers also need new direction sets; the samplers' METRIC EXEMPTION status has to be revisited.

### CL-2 — ambient_direction_to is single-valued, but S³, S²×R and quotients have several geodesics to a light

- kind: euclidean-assumption; reader confidence: checked; checker: **unverified**
- evidence: euclidean.glsl: `Direction ambient_direction_to(Point from, Point to) { return normalize(to - from); }`, used at transport/techniques/light/light.glsl:22 and shadow/media/media.glsl:59. Coulon §7.2: S³ lighting pairs have lengths θ and 2π−θ; §8: S²×E has countably many; quotients union over Γ. Kopczyński line 1441: in S²×R 'The light ray goes around the sphere k times'.
- why it matters: An unbiased NEE in S³ must sum both connections, which carry the same sin² falloff. Keeping only the shortest is a truncation that the bias ledger would have to declare (CLAUDE.md: 'Truncations are declared').
- suggestion (thought-through-not-checked): Decide per space whether NEE loops over k connections, or whether the shortest-only choice becomes a declared measurement truncation like maxBounces.
- pros/cons: Pros: keeps the estimator honest under the existing taxonomy. Cons: loop structure in the NEE technique; the count is unbounded for S²×R and quotients, so a truncation has to be declared there anyway.

### CL-3 — Ray velocity at a far hit is an acknowledged open item; the owner's old repo already solved it with flow returning (point, velocity)

- kind: in-progress; reader confidence: checked; checker: **unverified**
- evidence: docs/fable-reference-implementations.md §10: 'Open (§5.3): the ray's *direction at a far hit* … needed for `wo` in curved space'. thurston-rebuild hyp part1.glsl flow(): `coords = cosh(t)*pos + sinh(t)*dir; … dir = sinh(t)*pos + cosh(t)*dir;` returns a Vector.
- why it matters: wo, spot or beam emission profiles (the direction at the light) and MIS all need the velocity. In H³ the hit direction is not the seed direction.
- suggestion (checked): When the first curved occupant is built, give the seam a companion that returns the velocity at t, or have ambient_geodesic return both. Closed forms: H³ sinh t·p + cosh t·v; S³ −sin t·p + cos t·v.
- pros/cons: Pros: one closed form per isotropic space, already written in thurston-rebuild. Cons: if it stays a separate function, the hyperbolic functions are computed twice.

### CL-4 — MAX_DIST far clip and directional light assume a Euclidean 'infinity'

- kind: euclidean-assumption; reader confidence: checked; checker: **unverified**
- evidence: src/glsl/core/math.glsl:8-11: 'MAX_DIST — the far clip … the environment is found there', `#define MAX_DIST 1000.0`. CLAUDE.md: 'the environment and the directional light are found there'. S³ geodesics cos t p + sin t v are 2π-periodic. Kopczyński lines 2284-2285: 'we cannot assume that the light comes from a infinitely far away sun'.
- why it matters: In S³ a 1000-unit march repeats about 159 loops and there is no sky. In H³ the sky lives on the ideal boundary, and a large-t march loses float precision long before then.
- suggestion (thought-through-not-checked): Per-space far policy. S³: cut at 2π (opaque scenes) with no environment. H³: look up the env at the ideal point (p+v).xyz/(p+v).w, a unit 3-vector the existing direction-indexed env textures can use. The directional light becomes an ideal-point light in H³ and is absent in S³.
- pros/cons: Pros: an analytic, precision-free sky lookup in H³ that reuses the env components. Cons: env importance sampling and MIS compensation need the inverse map (ideal point → direction at x); a sky for H²×R needs its own parametrization.

### CL-5 — Klein (H³) and gnomonic (S³) charts make geodesic triangles flat, so the existing BVH and triangle code can run in chart coordinates

- kind: research-note; reader confidence: checked; checker: **unverified**
- evidence: Coulon §2.3.1/§4.1.2: geodesics are straight lines in the projective models of the isotropic geometries. pt.py: Klein images of three points on a hyperbolic geodesic are collinear (cross product 2.5e-17); the R⁴ plane hit tanh t = −⟨n,p⟩/⟨n,v⟩ has residual 1e-16.
- why it matters: Meshes in H³ and S³ do not need new intersection or BVH algorithms, only a chart and a parameter conversion. This is relevant to the 'BVH under non-straight geodesics' item deferred in trace-loop-contract.md.
- suggestion (thought-through-not-checked): Treat the chart as part of the curved occupant. Each instance's BLAS sits in a Klein or gnomonic chart centered on the instance, the TLAS placement becomes an SO(3,1) or SO(4) mat4, and the chart hit parameter maps to arc length via tanh or tan.
- pros/cons: Pros: maximal reuse of cwbvh/bvh code; instance-local charts sidestep Klein's float range. Cons: S³ rays cross hemisphere charts and have t+π hits; Klein float32 range ~d 8; does not extend to H²×R (CL-6).

### CL-6 — H²×R has no chart where geodesics are straight; general triangle meshes there are an open design question

- kind: research-note; reader confidence: inferred; checker: **unverified**
- evidence: Coulon §8: γ(t) = (γ_Y(|v_Y| t), w + t v_E). In Klein×R the horizontal coordinate moves like tanh(t sin β) along a segment while w is linear in t, so the curve is not straight (derivation). The totally geodesic surfaces of H²×R are only vertical planes and horizontal slices (from memory).
- why it matters: The owner's target list includes H²×R with meshes. A 'triangle' must first be defined there (a geodesic triangle is not a totally geodesic surface), and ray hits need a root find or restricted face types.
- suggestion (thought-through-not-checked): Raise this with the owner as a math decision before any design: what a mesh face means in H²×R.
- pros/cons: Pros: avoids building a mesh path that cannot be defined consistently. Cons: H²×R meshes stay unavailable until the definition is chosen.

### CL-7 — Equiangular medium sampling generalizes exactly to H³ and S³ (closed form)

- kind: research-note; reader confidence: checked; checker: **unverified**
- evidence: eq.py, numeric integration vs closed form: H³ ∫dτ/sinh²d = 2.3040768633223 vs (1/sinh h)[atan(tanh τ/sinh h)] = 2.3040768633225. The angle at the light equals atan(tanh τ/sinh h) exactly. S³: 3.99306488906 vs (1/sin h)[atan(tan τ/sin h)] = 3.99306488906. The ambient README says equiangular placement needs new bodies.
- why it matters: One of the two declared Euclidean-only holes in ambient/README.md has a two-line curved body: sample the angle at the light uniformly, as in Euclidean space.
- suggestion (checked): Record this in the ambient or equiangular math note as the H³/S³ body when curved work starts. S³ must split at |τ| = π/2.
- pros/cons: Pros: exact, cheap, same structure as the Euclidean form. Cons: S³ needs the τ range split and both geodesic branches; H²×R has no such closed form.

### CL-8 — float32 precision limits for H³: Klein collapses near d≈9; hyperboloid small-distance resolution degrades fast; acosh distance is unusable

- kind: research-note; reader confidence: checked; checker: **unverified**
- evidence: check.py (float32): 1−tanh(d) in float32 = 2.38e-7 at d=8, 5.96e-8 at d=9, 0 at d=10. A 1e-3 separation at distance D: 2·asinh(√⟨p−q,p−q⟩/2) gives 1.06e-3 (D=5), 0.147 (D=10), 0 (D=15); acosh(−⟨p,q⟩) gives 0 at D=5 and 9.77e-4 even at D=0. Celińska-Kopczyńska & Kopczyński ICCS 2024: Klein gap from 1 ~ e^{-2d}, 'Floating point numbers cannot express such a slight difference from 1'.
- why it matters: The repo's hit epsilons are ~1e-7 to 1e-6 (math.glsl:48 comment). In H³ these become meaningless a few units from the origin, so ray_spawn offsets and the march clearance need a space-aware scale.
- suggestion (thought-through-not-checked): Keep the camera at the chart origin and move the scene by isometries. Use the stable distance forms. Consider instance-local charts or quotients for large scenes.
- pros/cons: Pros: standard practice (HyperRogue, thurston-rebuild reduceError). Cons: moving the scene per camera move conflicts with the shared scene-data layout; it needs a uniform-level isometry rather than repacking.

### CL-9 — Solid-angle light samplers can be reused in a chart centered at the shading point (H³, S³)

- kind: research-note; reader confidence: inferred; checker: **unverified**
- evidence: At the chart center, log_o(q) normalized equals Klein q.xyz normalized (trivial from the hyperboloid formula), and geodesic polygons are flat in the chart (CL-5). Cone half-angle of a geodesic ball: sin α = sinh R/sinh d (from memory, hyperbolic right-triangle trig).
- why it matters: The sphere, quad, disk and mesh solid-angle samplers carry METRIC EXEMPTION notes saying curved spaces need new bodies. For isotropic spaces the new body could be 'apply the isometry to x, then run the Euclidean sampler in the chart'.
- suggestion (thought-through-not-checked): Verify with a χ² twin test before relying on it: sample in the chart, compare with brute-force hyperbolic solid angle.
- pros/cons: Pros: no new sampler math for H³ and S³. Cons: a per-sample isometry costs a mat4 multiply per light; it does not hold for H²×R or S²×R.

### CL-10 — The owner's thurston-rebuild has reusable geometry code but non-physical lighting and no light sampling

- kind: research-note; reader confidence: checked; checker: **unverified**
- evidence: thurston-rebuild/src/geometries/hyp/imports/lightIntensity.glsl returns `1. / (len * len)` with the sinh² line commented out; trueLightIntensity.glsl returns 1/sinh²; sph returns `1./(len)`; h2e returns `1./ len`. core/renderers/shaders/pathTracer/vectorDataUpdate.glsl.mustache:97 '// hack to make sure that lights are not too bright'. There is no light sampling in pathTracer/*.
- why it matters: A port should take exp/log/distance/isometry/frame/teleport and the solids library from thurston-rebuild, but not its light falloff.
- suggestion (checked): Port per-geometry primitives from geometries/{hyp,sph,h2e,s2e}/; derive lighting from A(r,u) instead.
- pros/cons: Pros: reuses tested formulas (direction.glsl and distance.glsl match Coulon §7-8). Cons: the old code uses the acosh distance form (precision, CL-8) and stores Isometry as an inverted mat4.

### CL-11 — Novello et al. and the GR Monte Carlo renderers are not radiometric references

- kind: research-note; reader confidence: checked; checker: **unverified**
- evidence: Novello et al. Eq. 2.4 replaces ⟨wi,N⟩ by g_p(wi,N); dω is never redefined; no Jacobian; point lights with binary shadows. Mandal–Ayush–Chaudhuri 2021: RK4 plus step halving, no NEE, 'very few ray samples make it through the wormhole back to the light'.
- why it matters: An AI or reader may cite these as 'the Riemannian rendering equation'. They omit the geometry term that unbiased NEE needs. Coulon §5.7 is the correct source.
- suggestion (checked): In the curved-space design doc, cite Coulon §5.7 for A(r,u) and use the Novello papers only for RTX and teleport architecture.
- pros/cons: Pros: avoids importing a biased estimator. Cons: none.

### CL-12 — Schwarzschild light paths may already be expressible through the GRIN walker (Fermat optical metric)

- kind: research-note; reader confidence: inferred; checker: **unverified**
- evidence: grin.md: 'follows a geodesic of the optical metric g = n²(x)·δ … the tracer's first curved-space walk'; the grin.glsl header mentions 'black hole's photon sphere'. From memory: Schwarzschild in isotropic coordinates is conformally flat in its spatial optical metric, n(r) = (1+M/2r)³/(1−M/2r).
- why it matters: It is a cheaper route to black-hole lensing than a new ambient occupant with RK4. It ignores redshift and time effects (a truncation that would need declaring).
- suggestion (thought-through-not-checked): Check the optical-metric index against a source before planning; keep it as an option beside the ambient-occupant route in docs/fable-reference-implementations §10.
- pros/cons: Pros: reuses symplectic Verlet, the L/n² invariant and roulette, which already exist and are tested. Cons: the index form is from memory, not a source; it is confined to a bounded region; the far field has no environment-at-infinity treatment.

**Reader questions for the owner**

- S³ NEE: should NEE sum both geodesics to a light (θ and 2π−θ), or keep only the shortest as a declared measurement truncation? The same question arises for quotients and S²×R, where the count is unbounded.
- H²×R meshes: what should a mesh face mean when geodesic triangles are not totally geodesic? Options are flat in Klein×R, a ruled surface, or only vertical and horizontal faces.
- Should the curved-space seam gain an area-density or geometry-term function (one per space), or should each light sampler get a per-space body as the METRIC EXEMPTION notes currently say?
- Far limit and sky: is 'no environment in S³, ideal-point environment in H³' the intended model? What replaces the directional light in H³: an ideal-point light, or nothing?
- Precision: for large H³ scenes, do you prefer camera-at-origin with the scene moved by isometries, instance-local charts, or quotient manifolds as the main tool?


## sota-architecture

I read the actual source of pbrt-v4 and Mitsuba 3 (downloaded today from GitHub master; copies kept in the scratchpad), plus parts of Cycles and Falcor and the OpenPBR v1.1.2 spec through a fetch summary. Points from papers are marked as remembered.

**Where the project already matches the references.** The core interfaces in both renderers are small, and this project already has nearly the same ones:
- Materials: flags, eval, sample, pdf.
- Lights: sample a direction toward the light, and the pdf of that direction.
- Light selection: pick a light, and the probability of having picked it.
- Media: coefficients at a point, plus an upper bound (majorant) along the ray.
- Camera generates rays; the pixel filter gives an offset and a weight; the film accumulates.

The project also follows pbrt in several specific choices: eval returns f without the cosine, sample weight is f·cos/pdf, the spectrum "role" decides how RGB becomes a spectrum (pbrt's SpectrumType), the hero wavelength is collapsed for dispersive IOR (pbrt TerminateSecondary), media attach to surfaces with no medium stack (pbrt MediumInterface; Cycles uses a stack), there is a light BVH, and emission is counted at the last allowed bounce but NEE is not. These are independent confirmations of the existing design.

**Where the references are simpler.**
1. **Delta or glossy is decided per hit.** pbrt has one conductor and one dielectric that switch to the delta form when alpha < 1e-3. The project has separate mirror/ggx and dielectric/rough_dielectric models, with the delta question fixed per model.
2. **One area light for all shapes.** The shape owns "sample me from point p" and its pdf; a light is just shape plus emission. The project gives each emitter shape its own light kind.
3. **One distance-sampling routine for all media.** A homogeneous medium is a single majorant segment. The project has separate analytic and delta-tracking occupants.
4. **MIS with delta tracking exists in about 60 lines** of pbrt (the r_u/r_l rescaled probabilities). The project lists this as not built.
5. **The path loop is handwritten in all three renderers.** Mitsuba folds scene-wide features to constants ("Null tests fold to literals"). The project generates the loop as GLSL text from TypeScript instead.
6. **Parameters are declared where they are read.** Unknown keys are caught by tracking which keys were read. Mitsuba builds its live-parameter list by walking the object graph (traverse), with one parameters_changed hook per object.

**Where curved space breaks the reference designs.**
- Materials written in a local frame need no change.
- Light sampling is where curvature enters: the 1/d² factor becomes a per-space Jacobian such as sinh²d in H³ or sin²d in S³, and in H²×R it depends on direction.
- In S³ and in quotient manifolds there is more than one geodesic between two points. `ambient_direction_to` returns one direction, so NEE needs a rule for the others.
- S³ has no "escaped ray", so the environment-at-MAX_DIST model does not apply there.
- Texture differentials and light-BVH bounds assume Euclidean space.

**Photorealism gaps against the references:**
- image textures (deliberately not built, V1-C4)
- normal and bump maps (Hit.frame has no parameterization tangent)
- complex-IOR or F82-tint conductors (Schlick only)
- GGX energy compensation
- layered materials (OpenPBR's albedo scaling is deterministic and fits a correctness-first tracer better than pbrt's stochastic LayeredBxDF)
- thin dielectric (a closed form, small)
- filters other than box (filter importance sampling needs no change to accumulation)
- a low-discrepancy sampler (one was tried and reverted)

Path guiding and wavefront need compute and scattered writes, which WebGL2 lacks; by the owner's decision 6 they are noted and skipped. ReSTIR reuses samples across pixels, so its images are correlated. That does not fit the project's independent progressive accumulation or its pinned estimator rules.

### sota-1 — The project's core interfaces already match pbrt-v4/Mitsuba/Falcor consensus

- kind: research-note; reader confidence: checked; checker: **unverified**
- evidence: pbrt base/bxdf.h:166-196 `f(wo, wi, mode)`, `Sample_f(wo, uc, u, ...)`, `PDF(...)`, `Flags()`; BSDFSample {f, wi, pdf, flags, eta, pdfIsProportional} (base/bxdf.h:121-152); Falcor IMaterialInstance.slang:46 `weight = f(wi, wo) * dot(wo, n) / pdf(wo)`. Project: src/components/materials/README.md:13-29 `<id>_eval/<id>_sample/<id>_pdf` with `(uc, u)`, 'eval returns bare f — NO cosine', 'sample.weight = f·|cosθᵢ|/pdf'. pbrt paramdict.h:70 `enum class SpectrumType { Illuminant, Albedo, Unbounded }` mirrors the project's spectrum roles; pbrt materials.h:186 `if (!eta.Is<ConstantSpectrum>()) lambda.TerminateSecondary();` mirrors the project's one-time hero collapse.
- why it matters: A simplification effort should leave these contracts alone. They are already the textbook factoring, and changing them would add risk with nothing gained.
- suggestion (checked): Treat the material/light/light-selector/medium/camera/filter interfaces as settled. Spend simplification effort on the plumbing around them.
- pros/cons: Pro: protects work that is already correct. Con: none found.

### sota-2 — Delta vs glossy is a static per-model capability; pbrt decides per hit, which roughness textures need

- kind: extension-friction; reader confidence: checked; checker: **unverified**
- evidence: pbrt util/scattering.h:137 `bool EffectivelySmooth() const { return std::max(alpha_x, alpha_y) < 1e-3f; }`; ConductorBxDF::Flags returns `mfDistrib.EffectivelySmooth() ? BxDFFlags::SpecularReflection : BxDFFlags::GlossyReflection` (bxdfs.h:289-293); DielectricBxDF likewise (bxdfs.h:176-180). Project: ggx.ts:21 `fn: (v) => Math.max(1e-3, roughness*roughness)` (host-derived), ggx.glsl:8-9 'author true mirrors as a delta model instead'; mirror.ts:17 / dielectric.ts:18 `nonDeltaLobes: false`; ggx.ts:26 / rough_dielectric.ts:30 `nonDeltaLobes: true`.
- why it matters: Photoreal assets use roughness maps that go to 0 in places, such as polished patches on a worn metal. With delta-ness fixed per model and alpha derived on the host, a spatially varying roughness cannot reach a true mirror, and the four occupants duplicate Fresnel and microfacet plumbing. I inferred that the host-derived alpha also blocks per-hit roughness expressions; I did not trace the expression path.
- suggestion (thought-through-not-checked): When textures arrive, consider pbrt's approach: one conductor and one dielectric model, each returning per-sample lobe flags, with the NEE skip based on the sampled flag rather than a model capability.
- pros/cons: Pro: two fewer occupants; roughness maps work down to 0; matches pbrt. Con: NEE gating moves from compile time to run time (a branch per hit); the capability tables and generated guards must change; witness values for mirror and dielectric must be re-derived through the unified model.

### sota-3 — Hit.frame has no parameterization tangent (dpdu), which normal maps and anisotropy need

- kind: extension-friction; reader confidence: checked; checker: **unverified**
- evidence: src/compiler/generate/features/intersection.ts:709 `hit.frame = ambient_frame(hit.p, ${o.nWorld});` (also :906, :1025); src/components/ambient/euclidean/euclidean.glsl:13-19 `Direction t = abs(nn.x) < 0.9 ? Direction(1.0, 0.0, 0.0) : Direction(0.0, 1.0, 0.0);`. pbrt bsdf.h `shadingFrame(Frame::FromXZ(Normalize(dpdus), Vector3f(ns)))`; pbrt NormalMap (materials.h:86-106) builds its frame from `ctx.shading.dpdu`; Mitsuba render/bsdf.h `NeedsTangents = Anisotropic | NormalMapped`.
- why it matters: Normal maps are on the owner's photorealism list (Hit.ng exists for them, structs.glsl:29-36). Tangent-space normal maps and anisotropic GGX are wrong with an arbitrary tangent. Every geometry backend (analytic, SDF, mesh, instances) has to supply dpdu, so this is a cross-cutting change to Hit.
- suggestion (thought-through-not-checked): Add the tangent at the same time as uv charts: each shape that declares a uv chart also supplies d p/du (meshes from vertex uvs; analytic shapes in closed form; SDFs from a declared chart or a triplanar convention). Keep the arbitrary tangent only for shapes without a chart.
- pros/cons: Pro: unblocks normal maps and anisotropy in one change and matches pbrt and Mitsuba. Con: touches every intersection backend; SDFs have no natural parameterization; in curved space the tangent must be metric-orthonormal (fits ambient_frame if it takes a tangent hint).

### sota-4 — Two-point geodesic assumed unique: ambient_direction_to returns one direction; wrong in S³ and quotient manifolds

- kind: euclidean-assumption; reader confidence: inferred; checker: **unverified**
- evidence: src/components/ambient/euclidean/euclidean.glsl: `Direction ambient_direction_to(Point from, Point to) { return normalize(to - from); }` and the comment 'Shadow rays are aimed with it at their light point.' src/components/ambient/README.md lists `Direction ambient_direction_to(Point from, Point to); // unit start direction of the geodesic from → to`. pbrt/Mitsuba NEE trace one shadow ray per light sample (pbrt cpu/integrators.cpp:797 `Unoccluded(intr, ls->pLight)`). Owner goals: S³ (docs/claude-2026-11-review/decisions.md item 3) and quotients 'really take good care of light' (item 5). I found no mention of non-unique geodesics in docs (grep for antipod/S³ hit only fable-compiler-contracts.md:30, :463 and unrelated GRIN notes).
- why it matters: In S³, light from a point reaches the shading point along the short arc and the long arc (and the antipodal point is a caustic). In a quotient it arrives along one geodesic per group element. NEE that follows only one geodesic misses light the BSDF-sampled path can find, so pt-nee and pt would converge to different images. That breaks the project's estimator-equality invariant.
- suggestion (thought-through-not-checked): Design the curved-space light-sampling seam to return a small list of geodesics (direction, length, Jacobian) or to sample one of them with a known probability. Make BSDF-hit MIS weights use the density of the geodesic actually traveled. Decide this before writing the first S³ occupant.
- pros/cons: Pro: unbiased NEE in S³ and quotients; makes the requirement explicit before code exists. Con: more state per shadow ray; a GLSL loop over geodesics; quotients need a bound on how many images contribute, which is a truncation that would have to be declared in the bias ledger.

### sota-5 — Area→solid-angle conversion and the 'environment at MAX_DIST' model are Euclidean; the ambient seam has no distance or Jacobian

- kind: euclidean-assumption; reader confidence: inferred; checker: **unverified**
- evidence: pbrt DiffuseAreaLight::SampleLi delegates to `shape.Sample(shapeCtx, u)` / `shape.PDF(shapeCtx, wi)` (lights.cpp:740-768), whose conversion uses cosθ/d². Project lights declare it: sphere.glsl header 'METRIC EXEMPTION (trace-loop contract): raw dot() ... light samplers are Euclidean closed forms; curved spaces get new bodies'; `grep -rn 'METRIC EXEMPTION' src` = 14 hits across 13 files (all light kinds, both env charts, math.glsl). The ambient seam (euclidean.glsl) has geodesic/frame/dot/parallel_transport/direction_to and no distance or Jacobian. docs/claude-design-review-2026-09-28.md:379 already proposed `ambient_distance`. CLAUDE.md: '`MAX_DIST` (1000) is an absolute far clip: the environment and the directional light are found there'.
- why it matters: Each light kind needs a separate body per space unless a generic fallback exists. In a space form the factor is cosθ_l/s(d)² with s = d, sinh d or sin d; in H²×R it depends on direction. S³ has no escaped rays (geodesics close after 2π), so the environment light and the far clip have no meaning there. In H³ the environment lives on the ideal boundary.
- suggestion (thought-through-not-checked): Give the ambient seam `ambient_distance` and an exp-map Jacobian (the area-to-solid-angle factor along a geodesic). Use generic 'sample the shape by area, convert with the space's Jacobian' as every shape's fallback light sampler, with closed-form cone samplers as per-space optimizations. Treat 'escape' as a per-space concept: an ideal-boundary environment in H³ and none in S³.
- pros/cons: Pro: one fallback covers every shape in every space, so light kinds × spaces does not grow as a product; follows pbrt's shape-owns-sampling split. Con: area sampling is noisier than cone sampling for small or distant spheres; the H²×R Jacobian must be derived; light BVH bounds also need per-space treatment.

### sota-6 — MIS with delta tracking (listed as not built) has a compact reference solution in pbrt-v4

- kind: research-note; reader confidence: checked; checker: **unverified**
- evidence: pbrt cpu/integrators.cpp:956 `SampledSpectrum L(0.f), beta(1.f), r_u(1.f), r_l(1.f);` null collision :1043-1050 `r_u *= T_maj * sigma_n / pdf; r_l *= T_maj * sigma_maj / pdf;` emission hit :1102-1110 `L += beta * Le / (r_u + r_l).Average();` NEE ratio tracking :1343-1374, final :1388-1392 `return beta * f_hat * T_ray * ls->L / (r_l + r_u).Average();`. One routine `SampleT_maj` (media.h:735-797) serves every medium, including homogeneous (media.h:250-255 returns one majorant segment with sigma_a+sigma_s). Project: CLAUDE.md 'Not built / deferred: ... MIS with delta tracking'; separate transport/volume/analytic and transport/volume/delta_tracking occupants.
- why it matters: This fills a declared gap with a transcribable reference, in line with the owner's 'read pbrt before designing' rule. It also shows that analytic homogeneous and tracked heterogeneous media can share one free-flight routine. The `.Average()` doubles as spectral MIS over the four wavelengths.
- suggestion (thought-through-not-checked): When MIS with delta tracking is planned, transcribe pbrt's rescaled-probability (r_u, r_l) form. Separately, evaluate whether the analytic arm can become 'one majorant segment' of the tracking routine.
- pros/cons: Pro: a known-correct reference about 60 lines long; may merge two occupants. Con: the project's per-channel MIS for homogeneous media and its interior roulette rule would need re-derivation in that formulation; GRIN is outside pbrt's model.

### sota-7 — References write the path loop by hand and fold scene features as constants; the project generates loop text

- kind: research-note; reader confidence: checked; checker: **unverified**
- evidence: pbrt PathIntegrator::Li is one handwritten function (cpu/integrators.cpp:628-762, about 135 lines); VolPath about 320 lines (:953-1271). Mitsuba integrators/path.cpp:122 '// Null tests fold to literals in scenes without null shapes' with `bool has_null = scene->has_null_shapes();`. Project: src/components/transport/integrators/pt/pt.ts (475 lines) emits the walk (`function walk`, :299) and a per-flag `PathState` (:147-176) from `Flags` (transport/flags.ts); CLAUDE.md 'Exact linkage. A generated function exists only if something calls it.'
- why it matters: The owner wants code that one person can read easily. A reader of the transport loop has to read TypeScript that emits GLSL. Mitsuba shows a simpler way to pay only for used features: plain constant booleans that the compiler folds. It conflicts with the owner's exact-linkage rule, so it is an owner decision, not a fix.
- suggestion (thought-through-not-checked): Raise with the owner as a question only: should the walk be one static GLSL file with `const bool HAS_MEDIA/HAS_NULLS/...` flags emitted by the compiler (Mitsuba pattern), with exact linkage relaxed for transport?
- pros/cons: Pro: the loop reads like pbrt; one file; the GLSL compiler removes dead branches. Con: violates exact linkage (callees must exist as stubs when unused); larger shader source to compile; generated budgets such as MAX_NULL_CROSSINGS stay as defines anyway; a large refactor of reviewed code, which the owner's rules say needs its own plan and review.

### sota-8 — Area lights: pbrt has one light type and puts sampling on the shape; the project has a light kind per emitter shape

- kind: research-note; reader confidence: checked; checker: **unverified**
- evidence: pbrt lights.cpp:745-746 `ShapeSampleContext shapeCtx(ctx.pi, ctx.n, ctx.ns, 0); pstd::optional<ShapeSample> ss = shape.Sample(shapeCtx, u);` and :767 `return shape.PDF(shapeCtx, wi);`; base/shape.h:57-64 Sample/PDF on Shape. Project src/components/lights/README.md: per-kind `<kind>_light_sample` / `<kind>_light_pdf`, plus `region` 'the backing emitter primitive for hittable kinds — one kind per primitive' and `valuesFromRegion` 'the sampleAsLight route's inverse'.
- why it matters: Two parallel registries (geometry primitives and area light kinds) are tied together by a lookup in each direction. pbrt's split has one place answering 'how do I sample this shape from p', which is also where curved-space Jacobians would go (sota-5).
- suggestion (thought-through-not-checked): Consider moving `sample_from(p)`/`pdf_from(p, wi)` onto geometry occupants, making 'area light = emissive object', with delta lights (point, spot, directional, beam) remaining light kinds.
- pros/cons: Pro: removes the region link and its inverse; one place for curved-space light sampling; any closed shape with an area sampler becomes a light for free. Con: geometry occupants grow a sampling duty; the one-sided quad/disk emitting-normal guarantee would move; light tree bounds and power must come from the shape; a large change across authoring, compiler and GLSL.

### sota-9 — Live parameters: Mitsuba derives them from the object graph with one update hook; the project authors sliders explicitly

- kind: research-note; reader confidence: checked; checker: **unverified**
- evidence: Mitsuba core/object.h:132 `virtual void traverse(TraversalCallback *cb);` :154 `virtual void parameters_changed(const std::vector<std::string> &keys = {});` :408-420 `ParamFlags { Differentiable, NonDifferentiable, Discontinuous, ReadOnly }`; bsdfs/roughconductor.cpp:246 `cb->put("alpha", m_alpha_u, ParamFlags::Differentiable | ParamFlags::Discontinuous);` and :214-224 recompute in parameters_changed. pbrt paramdict.h:46 `mutable bool lookedUp` and :170 `ReportUnused()`; Mitsuba core/properties.h:100-102 `was_queried`/`unqueried()`. Project src/components/param.ts `{ param, default, min?, max? }` with `valueParamProblems`; descriptors' `derived` rows (ggx.ts:19-22).
- why it matters: The owner listed the parameter system for possible simplification. The two references show the main designs: declaration in the reading code plus 'unread key' detection (both), and the live set derived from the scene graph plus one per-object recompute hook (Mitsuba).
- suggestion (thought-through-not-checked): Use these as reference points when the parameter-system plan is written. Mitsuba's parameters_changed is the same idea as the project's host-side `derived` closures. The real choice is opt-in sliders (project) versus everything exposed (Mitsuba).
- pros/cons: Pro: grounds the parameter redesign in two production systems. Con: exposing everything as live would make every value a uniform, costing constant folding the project relies on; Mitsuba can afford that because Dr.Jit re-traces kernels.

### sota-10 — Photorealism gaps vs references, ranked by fit for WebGL2 and correctness-first

- kind: research-note; reader confidence: checked; checker: **unverified**
- evidence: Not built per CLAUDE.md and folder listings: image textures ('V1-C4. No image textures in materials', docs/fable-compiler-contracts.md:54); normal/bump maps (structs.glsl:29-36 'later normal/bump maps'); conductors use Schlick f0 (ggx.ts:13) vs pbrt FrComplex (scattering.h:81-100) / OpenPBR F82-tint; no energy compensation (OpenPBR: 'implementations should add multiple-scattering compensation'); layered: pbrt LayeredBxDF approximate pdf `Lerp(0.9f, 1 / (4 * Pi), pdfSum / nSamples)` (bxdfs.h:882) vs OpenPBR albedo scaling `f_coat + (1 − E_coat)·f_sub`; thin dielectric closed form `R += Sqr(T) * R / (1 - Sqr(R))` (bxdfs.h:228); pixel filter box only (src/components/pixel/box) vs pbrt filter importance sampling (samplers.h:797-805 `FilterSample fs = filter.Sample(...)`, `cs.filterWeight = fs.weight`); sampler pcg4d only, Owen-Sobol 'built once and reverted' (sampler/README.md).
- why it matters: Owner priority (c) is photorealism. These are the standard pieces a production unidirectional tracer has. Several fit WebGL2 cheaply: thin dielectric, F82-tint, energy-compensation lookup textures, filter importance sampling. Albedo-scaled layering keeps exact pdfs, which suits the estimator-correctness rule better than pbrt's stochastic layered BSDF.
- suggestion (thought-through-not-checked): Order for planning (each needs its own plan): tangents + normal maps → image textures without prefiltering (bilinear plus pixel supersampling converges to the right image; mipmaps blur the converged image, pbrt interaction.cpp:43 can disable filtering) → F82-tint conductor → GGX energy compensation → albedo-scaled coat → thin dielectric → Gaussian/Mitchell filter via importance sampling.
- pros/cons: Pro: each step is small and has a pbrt/OpenPBR reference to transcribe. Con: image textures need a texture-array or atlas design within WebGL2's ~16 fragment texture units; energy compensation adds precomputed lookup-table assets; ordering is my judgment, not measured.

### sota-11 — Techniques that do not fit this repo: wavefront, path guiding, ReSTIR

- kind: research-note; reader confidence: inferred; checker: **unverified**
- evidence: pbrt wavefront/integrator.h:168-185 queues (rayQueues, mediumSampleQueue, shadowRayQueue, ...) need compute and global queues; Cycles guiding.h:135-140 `openpgl::cpp::SetPosition(state->guiding.path_segment, ...)` (Open PGL; CPU-only is remembered, not verified); Cycles megakernel.h:22-110 state-machine switch over kernels. Owner decision 6 (docs/claude-2026-11-review/decisions.md): 'This repo stays WebGL2 ... note and skip'. ReSTIR/GRIS from memory.
- why it matters: This saves a later reviewer from proposing them. Path guiding needs scattered training writes. ReSTIR's spatial and temporal reuse correlates pixels, and unbiased variants need shift-mapping Jacobians, which in curved space become geodesic Jacobi fields. Neither fits the project's progressive, independently sampled accumulation.
- suggestion (thought-through-not-checked): Record them in the curved-space and photorealism plans as 'WebGPU tracer' items, not here.
- pros/cons: Pro: keeps scope honest. Con: loses guiding's variance reduction on hard indirect light, which may matter for caustic-heavy curved-space scenes.

**Reader questions for the owner**

- S³ and quotient manifolds have several geodesics between two points. Should NEE add up the light along every geodesic, or pick one of them with a known probability? The answer shapes the curved-space light-sampling seam (ambient_direction_to currently returns one direction).
- When textures arrive, do you want pbrt's approach of one conductor and one dielectric that switch to the delta form per hit (alpha < 1e-3), replacing mirror/ggx and dielectric/rough_dielectric? Or keep separate delta models and clamp roughness?
- Would you consider moving 'sample this shape from a point' onto geometry occupants (pbrt's one-area-light design), or do you want light kinds kept separate from geometry?
- For the transport walk: is exact linkage (no unused generated functions) worth the cost of generating loop text from TypeScript? Mitsuba gets the same 'pay only for what the scene uses' with a handwritten loop and constant booleans the compiler folds.
- For image textures: should the converged image be the pixel integral of the unfiltered texture (no mipmaps; the correctness-first choice), with prefiltering treated as an optional measurement setting?

