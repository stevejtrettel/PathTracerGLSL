# TODO — PathTracerGLSL

## ▶ START HERE (next session) — §10.1 item 1: reshape the surface interaction to the §3.2 contract

**Context:** the §2.10 contribution refactor + all three proving cases (fov / material `{param}` / analytic environment) are done and committed (see Completed). The compiler now assembles from per-feature contributions in `src/compiler/generate/features/`. Next is the first *real GLSL-contract* migration.

**The task:** reshape the surface material interaction from the slice's ad-hoc shape to the pinned §3.2 shape.
- **Current** (`src/compiler/generate/glsl/lambert.glsl`): `interaction_surface_shade(wi,wo,hit,props)→f·cos`, `interaction_surface_scatter(wo,hit,props,out pdf)→wi` (draws `random2()` *internally*), `interaction_surface_pdf(...)`, `interaction_surface_emit(props)`.
- **Target** (§3.2): **sample-returns-weight** (the sampler returns a `sample` struct carrying `weight = f·cos/pdf`, not a bare direction+pdf), **bare-f eval** (separate `f` without the cosine), **explicit `xi`** argument (§2.9 — don't call `random2()` inside), and **flags** (e.g. delta). For Lambert it's mechanical: `sample.weight = albedo`.

**Read first (normative — transcribe, don't re-derive):**
- `docs/fable-compiler-contracts.md` §3 / §3.1 (the sample struct) / §3.2 (the interaction interface).
- `docs/fable-reference-implementations.md` — the normative Lambert to transcribe (and the annotated transport loop it plugs into).
- `docs/fable-transport-verification.md` — the bounce/RR accounting pins the loop must honor.

**Files that change together:** `glsl/lambert.glsl` (the interface) **and** `glsl/path_trace.glsl` (the call sites — lines ~19/32/49/52 combine `shade`+`scatter`+`pdf` by hand; the new sample-returns-weight shape simplifies these). `features/materials.ts` just includes lambert (unchanged). *(This couples material + transport because the loop consumes the interaction interface — that's expected. The transport-generator **split**, §10.1 item 9, is still separate and later.)*

**Test discipline:** this is a *real* GLSL change, so the golden snapshot (`generated-glsl.snapshot.test.ts`) **will** differ — review the diff, confirm it's exactly the interaction reshape, then `npx vitest run … -u`. Then **verify live** (the established pattern): `npm run dev`, render cornell, confirm it still converges correctly (energy-conserving — this is where a sample/eval/pdf inconsistency would visibly bias the image; §11.1 furnace is the eventual automated form). Playwright harness recipe is in prior sessions' scratchpad pattern (install `playwright`, drive `channel:'chrome'`, read `app.readExport('hdr')` / screenshots, clean up after).

**Then:** items 2 (Hit→`region_from/to` + `material_of()`), 3 (LightSample→CDF), etc., per §10.1. Deferred alternative if you'd rather: tabulated environments (`docs/impl-plan-tabulated-env.md`, T1 clears engine #2/#8 + display-hole i-b).

---

## Next Major Milestone: Build the Real Compiler (on the contracts)

A minimal vertical slice exists ("step zero" — Lambert/SDF/point-light only). The real compiler — volumes, swappable material and transport models, multi-region objects, the full design — is the work ahead. Path: migrate the slice to the pinned GLSL contracts, then grow features (dielectric, volumes, area lights, MIS) on top.

- Roadmap: [docs/fable-compiler-contracts.md](docs/fable-compiler-contracts.md) §10.1, refined by the §2.10 ordering. **First implementation block is the resource-contributions refactor (§2.10)**, not §10.1 item 1: (i) feature planners return `FeatureContribution`s as a pure TS restructure with snapshot-identical generated GLSL asserted before/after; (ii) proving cases — fov `#define`→uniform, `MaterialProperty` `{param}`, environment-as-scene-data (retires the hardcoded sky / C3); then the §10.1 interaction/Hit/LightSample items, with the transport-generator split last (it consumes `FeatureContribution` as its input shape).
- Code to transcribe: [docs/fable-reference-implementations.md](docs/fable-reference-implementations.md)
- Correctness tests: [docs/fable-validation-scenes.md](docs/fable-validation-scenes.md)
- Known bugs: [docs/fable-review.md](docs/fable-review.md) (all reachable non-compiler items fixed; compiler C-series open — absorbed into the build)

(The former open design questions — scene format, codegen approach, multi-material compilation, source maps — are all answered in the contracts doc or already built.)

### Cleanup
- Remove or replace legacy `STRATEGY_PRESETS` in `src/app/types.ts` — SimpleCompiler-era strategies cast `as any`; they don't validate against the real compiler's `RenderStrategy`
- Design discussion queued: scene authoring language (builder API / DSL above `SceneDescription`) — see contracts §10.2

---

## Low Priority

### Layout-Aware Extension Base Class
3 extensions (ParameterPanel, ProductionPanel, StatsPanel) share identical layout detection boilerplate. Could extract a `LayoutAwareExtension` base class. Premature until more extensions are added.

### WidgetFactory Type Expansion
Currently supports: `float`, `int`, `bool`, `color`, `vec2`, `vec3`, `vec4`. Could add `string`, `file`, `enum` when needed.

---

## Completed

- [x] §2.10 proving case (c), analytic half — environment as scene data (July 2026): added `EnvironmentDescription` (`none`/`constant`/`procedural`/`image`; only the analytic pair implemented) + optional `scene.environment`. New `contributeEnvironment` feature fills one function `environment_radiance(vec3 dir)` — `none`→black, `constant`→live `u_environment_color * u_environment_intensity` (+ Sky color/intensity params). `path_trace.glsl`'s hardcoded blue-gradient sky replaced with `environment_radiance(...)` — **retires review C3** (environment is now scene data, not baked-in; also stops the closed-box sky contamination). Ordering: `environment` before `transport` in the contribution list. Snapshot diff reviewed = exactly the sky→function swap + the environment block. Typecheck + 47 tests; verified live — minimal scene renders a blue sky that also lights the scene, and changing `environment.color` re-tints it warm live (sky-temperature) with no recompile. **Design pinned for the tabulated half** (procedural + image): both are "tabulated environments" (equirect table + CDF), sharing all machinery; procedural is a recipe for the table (live uniforms while editing, freezes to an image for a fixed render). Deferred as one shared chunk — see below.

- [x] §2.10 proving case (b) — live `MaterialProperty {param}` (July 2026): `MaterialProperty` gained the `{param}` variant; the Planner preserves it (doesn't bake), and `contributeMaterials` scans every material's albedo/emission/roughness for `{param}` refs → a uniform named from the path (`clay.albedo` → `u_clay_albedo`, deduped so materials can share one) + `generateMaterialLookup` emits `props.albedo = u_clay_albedo` instead of a baked literal, plus a color/float parameter. Demoed by giving the cornell sphere a `clay` material with `albedo: {param:'clay.albedo', default:[0.8,0.4,0.2]}`. Snapshot diff reviewed = exactly the clay material + uniform + param + deterministic material-ID renumber. Typecheck + 47 tests; verified live — setting `clay.albedo` recolored only the sphere (orange→blue) with no recompile. Scene-side scalar payoff, mirroring proving case (a).

- [x] §2.10 proving case (a) — fov as a live uniform (July 2026): added `Value<T>` (§2.8) to types; `camera.fov` is now `Value<number>` — a constant bakes to `#define TAN_FOV <literal>`, a `{param}` (e.g. cornell's `{param:'camera.fov', default:0.8, min:0.3, max:1.5}`) emits the `u_tanFov` uniform (value = `tan(fov/2)` via new `PlannedUniform.compute`) + a FOV slider, aliased `#define TAN_FOV u_tanFov` so `camera_pinhole.glsl` is untouched. This also **consolidated all `#define`s into contributions** (camera + transport) — `buildHeader` now emits `merged.defines` and no longer reads `program` (the i-a defines deferral is resolved). Snapshot diff reviewed = exactly the fov migration + a behavior-neutral `TAN_FOV` reorder. Typecheck + 47 tests; verified live on GPU — the FOV slider changes the view (visibly wider at 1.4) with no recompile. First real payoff of the contribution model: a feature went live via a one-file change to `contributeCamera`.

- [x] §2.10 resource-contributions refactor, step i-a (July 2026): each feature (core, intersection, materials, lighting, camera, transport, accumulation) now returns a `FeatureContribution { blocks, defines, uniforms, parameters, textures }` from its own file in `src/compiler/generate/features/`, and the Generator merges them (concat + dedupe) into the single source of truth for shaders/uniforms/parameters — replacing the scattered `planUniforms`/`buildParameters` monoliths + the inline block list. `ShaderBuilder` 406→~150 lines. **Proven byte-identical** via a golden snapshot test (`generated-glsl.snapshot.test.ts`) over cornell + minimal×2 — the generated GLSL, uniform bindings, parameters, pipeline, and source maps are all unchanged. Typecheck + 47 tests. Defines stayed in `buildHeader` for i-a (order conflict self-resolves after fov→uniform); display-uniform hole (i-b) and proving cases (fov, `MaterialProperty {param}`, environment/`extern:`) still ahead. Plan: docs/impl-plan-2.10-contributions.md.

- [x] Sample stream / RNG (contracts §2.11, July 2026): rewrote `rng.glsl` to a counter-based, dimension-indexed `pcg4d` hash (Jarzynski–Olano) — closes review C9's shifted-copy weakness and keeps the §2.9 QMC door a drop-in (stateful PCG would not). **Dropped `engine.frameIndex`** (was `==sampleCount`): the seed now varies on `sampleCount` (within-render + accumulation weight) and a new monotonic `engine.resetSalt` (bumped in `Engine.clearAccumulation`), which kills RNG replay-after-reset and frozen-motion noise. `Planner` swaps `u_frameIndex`→`u_resetSalt`; `main_accumulate.glsl` seeds `rng_init(pixel, u_sampleCount, u_resetSalt)`. Dimension layout + fixed-seed reproducibility deferred (§2.11). Typecheck + 44 tests; verified live on GPU — Cornell box converges correctly (unbiased) and frame-0 noise decorrelates across resets (meanAbsDiff ~1.5, was 0 before).

- [x] WebGL context-loss restore (July 2026): `Engine` now handles `webglcontextlost`/`webglcontextrestored`. On loss it invalidates dead GPU handles (`RenderExecutor.invalidate`, `ResourceManager.handleContextLoss`, `TextureRegistry.handleContextLoss`, `ParameterManager.reset`) but keeps the `CompiledRenderer` data, and `renderFrame` no-ops (state `'context-lost'`) so a running loop survives instead of throwing. On restore it rebuilds every renderer from the retained data, re-enables `EXT_color_buffer_float` (extension state resets on loss — otherwise float FBOs return INCOMPLETE_ATTACHMENT), re-selects the previously-active renderer, and resumes. Env textures aren't restored (source not retained) — reload via `loadEnvironmentHDR()`. Typecheck + 44 tests; verified live via `WEBGL_lose_context` (loss→restore→resume, image intact, 0 errors). Closes the last item of fable-review engine #7. (Held: engine #9 perf caching — premature without a measured bottleneck; this tracer is shader-bound, not uniform-plumbing-bound.)

- [x] UI widget-library cluster (batch UI, July 2026): Modal `body.overflow` leak (dispose override); NumberInput clamps emitted values to min/max; Slider auto-precision capped via `-log10(step)` (no more 18-digit explosion); Window z-index re-tiered into a bounded stack below modals/overlay; Window drag → pointer-capture + viewport clamp (no stuck dragging); WidgetFactory honors `meta.options` (labeled dropdown for discrete ints); ColorPicker preserves alpha. Typecheck + 44 tests pass; NumberInput clamp + Slider precision verified live. (`Window` is a library component not yet instantiated — fixed for final-state correctness, not runtime-reachable today.)

- [x] Production/interactive lifecycle cluster (batch A, July 2026): made the production lifecycle explicit — `ProductionOrchestrator` now owns `begin/settle/exitProduction` (idle→active→settled state machine) instead of inferring transitions from `RENDER_STARTED`/`STOPPED` events; render events are UI-only now. Fixes app #2 (paused production no longer leaves params locked — `startInteractive`/`startProduction` settle the pending promise), #3 (layout/resolution restore driven explicitly by `App.start()`/`stop()`→`exitProduction`, completed 4K view preserved until you leave), #4 (lazy `accumulationDirty` flag in `RenderCoordinator` — camera/param change while stopped/complete defers reset to the next start, no ghost, frozen buffer survives for export), #7a (reentrancy guard via `phase`), #7b (forced final progress so the production panel reaches its complete UI), #7c (`ParameterPanelExtension.repopulate` on `RENDERER_SWITCHED`). Typecheck + 44 tests pass; all 6 reachable behaviors verified live on GPU. **Deferred:** everything tiled (#6, tiled error state, `SessionData.tileJob` resume) — `TiledRenderer` is a dormant subsystem (never instantiated), to be wired as a coherent feature later.

- [x] Removed two compiler conventions leaked into the locked App layer (batch 2d, July 2026): reset-on-parameter-change now reads the compiler's `triggersReset` metadata (`App._triggersReset`), falling back to path-prefix heuristic only for params without metadata; `RendererManager` owns a `strategyToRenderer` map (from compiled renderer ids) so `selectRendererByStrategy` no longer re-derives `${strategyId}-${sceneId}`. Typecheck + 44 tests pass.

- [x] Fixed the reachable engine leaks/crashers (batch 2c, July 2026): engine #6 (ParameterManager cached uniform values by reference — array snapshots into the cache now); engine #7 partial — `TextureRegistry.register` unit leak on re-registration (reuse existing unit), `createR32F` LINEAR-without-extension (NEAREST for CDF/PDF tables), `HDRLoader.decompressRLE` infinite-loop on corrupt/truncated files (bounds + zero-length-run guards). Still open in #7: context-loss restore path. Typecheck + 44 tests pass.

- [x] Atomic recompile / "keep the last-good renderer" (batch 2 follow-up, July 2026): `RendererManager.recompile()` now compiles all strategies, then GPU-validates every new shader via `Engine.validateRenderers` → `RenderExecutor.validateShaders` (throwaway programs, no framebuffers — peak GPU memory stays 1×), and only then does the destructive swap. A bad-GLSL recompile throws during validation before anything is unloaded, so the previously-working renderers keep rendering. Also reordered `Engine.loadRenderer` to run structural validation before the unload. Typecheck + 44 tests pass.

- [x] Fixed four more bugs from docs/fable-review.md (batch 2, July 2026): app #5 (tiled grid math — edge tiles overran the image; now fixed-stride tiles with edge clamping via `TiledRenderer.tileRect`); engine #3 (reload/unload path — `loadRenderer` replaces instead of skipping, `unloadRenderer` added on Engine/RenderExecutor/ResourceManager, `loadShaders` deletes-before-overwrite, plus `RendererManager.recompile()`/`App.recompile()` dev-loop entry points); app #8-partial (ErrorOverlay reachable outside `initialize` — factored `App._showErrorOverlay` + `RendererManager.attachShaderDiagnostics`); engine #4 (resize resets all renderers' sample counts). Typecheck + 44 tests pass.

- [x] Fixed six output-corrupting bugs from docs/fable-review.md (July 2026): RNG values ≥ 1.0 NaN-poisoning pixels (rng.glsl, also fixes multi-light selection fallthrough); tiled-render RNG seeding with local instead of global pixel (main_accumulate.glsl); HDR export reading one frame stale post-swap (PipelineBuilder.ts); Rec.601→Rec.709 luminance (math.glsl); ResourceManager.cleanup() throwing on the 2D texture array (dispose was broken); EventBus.emit skipping listeners when once() unsubscribes mid-dispatch. Tests + typecheck pass.

- [x] Move keyboard controls from App to AppShortcutsExtension
- [x] Add 'error' state to Engine
- [x] Cache draw buffer setup in RenderExecutor
- [x] Rename Flexible* files (FlexibleApp → App, etc.)
- [x] Design and implement DiagnosticBag error system
- [x] Migrate HDR validation to use DiagnosticBag
- [x] Remove legacy error files (~1700 lines deleted)
- [x] Rename formatters/ to reporters/
- [x] Fix all 29 TypeScript errors
- [x] Add GLSL module type declarations (src/glsl.d.ts)
- [x] Add uniform location warnings
- [x] CompiledRenderer validation (structure, references, duplicates)
- [x] ResourceManager format normalization
- [x] Sort documentation — archive old module/recipe docs, write CURRENT-STATE.md
- [x] Update README.md to reflect actual current state
- [x] ParameterManager cleanup — accepts `UniformBinding[]` directly, removed `ModuleDescriptor`/`ModuleKind`/`MODULE_ORDER` from engine/types.ts
- [x] Archive old module code — extracted GLSL algorithms to `reference/`, deleted dead `src/optics/` and `src/world/` TypeScript wrappers
- [x] Unified SessionData — single definition in SessionManager.ts with production goal and tile job support
- [x] Documentation sync — fixed strategy count, gl_FragData references, ParameterManager description, SessionData interface, source file map
