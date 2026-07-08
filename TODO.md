# TODO — PathTracerGLSL

## Next Major Milestone: Build the Real Compiler (on the contracts)

A minimal vertical slice exists ("step zero" — Lambert/SDF/point-light only). The real compiler — volumes, swappable material and transport models, multi-region objects, the full design — is the work ahead. Path: migrate the slice to the pinned GLSL contracts, then grow features (dielectric, volumes, area lights, MIS) on top.

- Roadmap: [docs/fable-compiler-contracts.md](docs/fable-compiler-contracts.md) §10.1, in order — item 1 is reshaping `lambert.glsl` to the interaction contract
- Code to transcribe: [docs/fable-reference-implementations.md](docs/fable-reference-implementations.md)
- Correctness tests: [docs/fable-validation-scenes.md](docs/fable-validation-scenes.md)
- Known bugs: [docs/fable-review.md](docs/fable-review.md) (six fixed, rest open)

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
