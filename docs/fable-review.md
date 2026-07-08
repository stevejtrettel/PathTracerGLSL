# Fable's Review — PathTracerGLSL

**Reviewer:** Claude Fable 5 (Claude Code)
**Date:** July 7, 2026
**Status update (same session):** six bugs fixed — compiler C1 (RNG ≥ 1.0), C2 (export off-by-one), C6 (tile RNG seed), the Rec.601 luminance note, engine #1 (`ResourceManager.cleanup()` 2D-array crash), and app #1 (EventBus mid-dispatch skip). See TODO.md. All other findings remain open.
**Scope:** Active docs (`docs/*.md`, archive excluded) and all of `src/` — compiler reviewed in depth directly; engine, app, and UI layers reviewed via parallel deep-dive passes with findings verified against source.

---

## Overall Assessment

This is a genuinely well-architected codebase. The three-layer split is real (not just aspirational), the compiler's Analyze → Validate → Plan → Generate pipeline is cleanly separated, the ShaderIR block/source-map design is elegant for its ~90 lines, and the docs are unusually honest about what exists vs. what's planned. The tests assert the right things (source-map gap-freeness, shader namespacing, multi-error validation).

That said, there are real bugs at every layer — including two that will visibly corrupt production renders (RNG NaN poisoning, tiled-render grid math), one that makes `Engine.dispose()` throw every time, and a cluster of lifecycle gaps that will block the compiler dev-loop that comes next (no renderer reload/unload path anywhere in the stack).

---

## Compiler Layer

### Correctness bugs

**C1 — `random()` can return values > 1.0, producing NaN that permanently poisons pixels.**
`src/compiler/generate/glsl/rng.glsl:27` computes `float(rng_u32()) / 4294967295.0`. `float(u32)` rounds to the nearest representable float, and every u32 above ~2³²−128 rounds *up* to 4294967296.0, so `random()` slightly exceeds 1.0 (and many values hit exactly 1.0). Consequences: in `lambert.glsl:16`, `sqrt(1.0 - xi.y)` with `xi.y > 1` is `sqrt(negative)` → NaN direction → NaN radiance. The accumulation `mix()` keeps NaN forever, and `safe_color` in the display pass maps it to black — so long renders accumulate permanently-black pixel dust (roughly thousands of events over a 10k-sample 1MP render). The same root cause makes the multi-light selection chain in `ShaderBuilder.ts:363-368` fall through all branches (`light_choice == N`), returning an uninitialized `LightSample`.

*Fix:* `return float(rng_u32() >> 8) * (1.0 / 16777216.0);` — guaranteed [0, 1).

**C2 — HDR export reads one frame stale.**
`PipelineBuilder.ts:80` points the `hdr` export at `accumulation_current`, but exports run after `renderFrame()`, and the post-frame swap has already flipped `currentIndex` (`ResourceManager.ts:620` resolves at read time). After the swap, `accumulation_current` is the buffer holding frame N−1. A 1000-sample production render exports the 999-sample image — and after a fresh reset, the first export reads stale garbage.

*Fix:* export target should be `accumulation_previous` (which post-swap holds the freshly written frame), ideally with a comment, or add a `latest` qualifier concept.

**C3 — Hardcoded sky is an invisible, unsampled environment light.**
`path_trace.glsl:13-15` bakes a blue gradient sky into the transport template. It's not in the `SceneDescription`, it's not NEE-sampled, and for the closed Cornell box it also disguises ray-march failures (grazing-angle marches that exhaust `MAX_MARCH_STEPS` return "miss" → blue speckle GI contamination on the walls). The environment belongs in the scene description (`environment: none | constant | gradient | hdri`) with analyzer/planner support — the reference GLSL for this already exists in `reference/world/environment/`.

**C4 — A scene with only `emissive`-model materials generates a broken shader.**
The Validator rejects `disney`/`dielectric` but not `emissive` (`Validator.ts:46-51`). The Planner then includes `'emissive'` in `brdfModels`, but `ShaderBuilder.ts:88-90` only emits code for `lambert` — so a lambert-free scene produces GLSL with no `interaction_surface_*` functions and fails at the GPU with a confusing undeclared-identifier error instead of a compile-time diagnostic.

**C5 — Silently ignored strategy/material fields.**
Three cases where valid input does nothing, with no warning:
- `display.exposure` — carried through `TonemapDesc`, but `tonemap_reinhard.glsl` has no exposure uniform or define.
- `transport.samplesPerFrame` — accepted, never used (one sample per frame always).
- `metallic` / `ior` material properties — accepted by the type, dropped by the Planner.

The Validator should warn on each.

**C6 — Tiled rendering seeds the RNG with the local pixel, not the global one.**
`main_accumulate.glsl:6` calls `hash_init(uvec2(gl_FragCoord.xy), …)` while line 5 already computes the offset-corrected `pixel`. Every tile at the same frame index replays the identical RNG stream — the noise pattern repeats across tiles of a stitched image. Should be `hash_init(uvec2(pixel), …)`.

**C7 — SDF parameter typos are silently defaulted.**
`generateSDFCall` (`ShaderBuilder.ts:253-274`) uses `?? fallback` for every parameter — a sphere with `{ r: 2 }` instead of `{ radius: 2 }` silently renders a unit sphere. The Validator never checks parameter names/shapes against a per-primitive schema. Also `torus`/`capsule` are in the `StandardSDF` type but unimplemented; hitting them throws a raw `Error` mid-generation instead of going through the DiagnosticBag.

**C8 — The Planner can't emit diagnostics.**
`plan()` has no `DiagnosticBag` parameter (`Compiler.ts:22`), so its known silent behaviors — Vec3-to-scalar truncation in `resolveScalarProperty` (`Planner.ts:234`, the comment admits it), dropped material properties — have no channel to warn through. Pass the bag to all four phases.

**C9 — RNG quality: counter-add sequences are shifted copies.**
`rng_u32()` = `mix32(rng_seed + rng_counter)` (`rng.glsl:21-24`) means two pixels whose seeds differ by *d* generate identical values offset by *d* counter steps. With hashed seeds collisions are rare, but the construction is weaker than it needs to be. Standard fix: advance state instead of hashing seed+counter (e.g. PCG: `state = state * 747796405u + 2891336453u` then output-hash).

**Minor:**
- `luminance()` uses Rec.601 coefficients on linear-light RGB (should be 0.2126/0.7152/0.0722 — affects RR survival slightly).
- Camera basis NaNs when looking straight up/down (`camera_pinhole.glsl:11`, `cross` with world-up degenerates).
- Vertex-shader errors map through the *fragment* block map in `mapEngineShaderError`.
- `maxBounces ≤ 0` produces a silent black image with no validation.

### Compiler design observations

**Camera pose has no home.** `camera.position` defaults to `[0,0,8]` — defined *twice* (`Planner.ts:142` and `PipelineBuilder.ts:60`) — and for the Cornell box that default is *inside the solid front wall* (plane at z=5): forget `initialParameters` and you get an undiagnosable black screen. The initial camera pose is scene-dependent data and belongs in the scene or strategy, not hardcoded in the compiler.

**FOV is a `#define` but position/target are uniforms.** Changing fov requires a full recompile while orbiting is live. Users will expect an fov slider. `TAN_FOV` should become a uniform bound to `camera.fov` — also the first natural test case for feature-local uniforms.

**Light and material constants are fully baked.** Fine as a compiler philosophy ("no runtime dispatch over compile-time knowledge"), but it means the `parameters` panel for a compiled renderer contains only camera position/target. The contract doc's own example (§8: `roughness: { param: 'glass.roughness', … }`) points the way: let `MaterialProperty` gain a `{ kind: 'param', path, default, min?, max? }` variant. The Planner then resolves it to a planned uniform + parameter metadata instead of a literal. That single addition gives live material/light editing without recompiles and exercises the whole uniform pipeline.

---

## Engine Layer

Ranked; the top four matter before the compiler grows.

1. **`ResourceManager.cleanup()` is broken** — `resource.textures` is `WebGLTexture[][]` but cleanup iterates it one level deep and passes an *array* to `deleteTexture` (`ResourceManager.ts:238-240`). `Engine.dispose()` throws mid-cleanup every time; all textures leak. One-line nested-loop fix (the correct pattern exists at line 534).

2. **Texture-unit collision between per-pass binding and the env-map registry.** `RenderExecutor._bindTextures` assigns pass inputs to units 0,1,2… every pass; `TextureRegistry` binds env textures to units 1-3 *once at load* and never rebinds. Texture units are global GL state — the first pass with ≥2 texture inputs clobbers unit 1 and every env lookup thereafter samples the accumulation buffer. Latent today; fires as soon as the compiler emits a two-input pass plus an env map.

3. **No reload/unload path** — `Engine.loadRenderer` silently *skips* an id that's already loaded (`Engine.ts:65-68`); there's no `unloadRenderer`. Recompiling a scene mid-session (the entire point of the compiler dev loop) silently keeps rendering the stale renderer. Plus `RenderExecutor.loadShaders` overwrites programs without `deleteProgram` (GPU leak on collision).

4. **`Engine.resize` corrupts accumulation for non-active renderers** — ResourceManager reallocates (zeroes) every renderer's textures, but only the active renderer's `sampleCount` is reset. Resize, then switch renderers → the average pass blends new samples against a zeroed buffer at high N → dark image slowly brightening.

5. **MRT drawBuffers construction is wrong for non-contiguous attachments** (must be location-indexed with `NONE` holes, not a sorted compact list), and a single-output pass targeting attachment ≠ 0 is impossible. Matters for G-buffer/AOV pipelines.

6. **ParameterManager caches computed values by reference** — a `compute` returning a parameter array by identity plus in-place mutation (standard camera-controller pattern) means the uniform never re-uploads. Clone arrays into the cache.

7. **Lifecycle/robustness cluster:** context loss has no restore path (subsystem maps left inconsistent; `loadRenderer` then early-returns and `selectRenderer` throws); `TextureRegistry.register` leaks a unit per re-registration (repeated HDR loads exhaust 32 units); `createR32F` sets LINEAR filtering without checking `OES_texture_float_linear` (CDF textures sample as zero on some devices — and NEAREST is correct for CDF lookup anyway); `HDRLoader.decompressRLE` infinite-loops on a corrupt file (a zero count byte never advances the pointer).

8. **Design: the env-map path is the one genuine violation of the blind-executor contract** — the engine hardcodes `u_envMap`/`u_envCDF*` names and a unit-0 reservation. The clean shape is a generic "external texture" concept referenced through `pass.inputs.textures` (e.g. `'u_envMap': 'extern:env_map'`) with scalars flowing through normal `UniformBinding`s. That deletes the special-case code and fixes #2 and the load-order issue as side effects — and it's really the same question as the feature-local-uniforms discussion.

9. **Performance:** `getUniformLocation` is called per texture per pass per frame (cache it — the machinery already exists in `ParameterManager`); `binding.compute()` and a fresh params object run for every binding every frame even when nothing changed (a dirty-set keyed by the existing `parameterToBindings` map skips both).

Also noted: `engine.frameIndex` and `engine.sampleCount` are the same number — if `frameIndex` is ever meant to be a non-resetting global counter (useful so a cleared accumulation doesn't replay the identical RNG sequence), it needs its own counter; decide before generated GLSL depends on the accidental equality.

---

## App Layer

1. **EventBus `emit` skips listeners when a handler unsubscribes mid-dispatch** (`EventBus.ts:61-72`) — `once()` splices the live array during iteration; the next listener silently never fires. Iterate a copy.

2. **A paused production render can be silently abandoned with parameters locked forever** — `startInteractive`/`startProduction` guards check `isRunning()`, which is false while paused; the pending production promise never settles, so `ProductionOrchestrator`'s `finally` (unlock, layout restore) never runs.

3. **Layout/resolution restore only happens on `RENDER_STOPPED`** — completing a production render then pressing Space, or finishing a tiled job, never emits it: interactive rendering resumes at 4K in the production layout with stale restore state.

4. **Camera moves while stopped/complete never dirty the accumulation** — orbit the frozen result, then Space or "Extend Render": new-viewpoint samples average into the old image (ghosted or silently corrupted production output).

5. **Tiled grid math is wrong** — `ceil(W/tilesX)` doesn't divide W; e.g. W=1030, tileSize=512 → 3×344=1032: edge tiles render past the image and the stitched result is the wrong size. Clamp the last tile.

6. **`RENDER_COMPLETE` fires per tile** — an N-tile job pops N "Render Complete" modals, and clicking one mid-job calls `app.stop()`.

7. **Medium:** production panel never reaches its 'complete' UI state (final progress emit is throttled away); no reentrancy guard on `renderProduction` (a failed second call unlocks the first's parameters); tiled-job error handling leaves `state:'running'` forever; `SessionData.tileJob` is documented but never written, so tiled-job resume is actually impossible; the ParameterPanel is a one-shot snapshot that never repopulates on renderer switch (masked today only because both strategies share parameters).

8. **Compiler-readiness gaps:** the ErrorOverlay/ShaderErrorMapper wiring exists *only* in the `App.initialize` path — a shader error during a later recompile or switch has no route to the overlay, and a failed initialize leaves zero renderers with no "keep the previous working renderer" recovery. Accumulation-reset semantics are hardcoded prefixes in `events.ts:52-83` instead of the compiler's per-parameter `triggersReset` metadata (which the compiler already emits). `selectRendererByStrategy` re-derives the compiler's `${strategyId}-${sceneId}` convention by hand. All three are compiler concerns leaked into the "locked" layer.

---

## UI Layer

**Top items:**
- **Modal leaks `body.overflow: hidden`** if disposed without `close()` (no `dispose()` override).
- **Z-index tiers are inverted** — Windows start at z=10000 and float above Modal (1050) and the compile-error overlay (1100), so a tool window can hide fatal compile errors.
- **NumberInput never clamps typed values** to min/max (typing 999 into a max-100 field emits 999).
- **Slider auto-precision explodes** on float-imprecise steps (`(0.7-0)/100` → displays `0.350000000000000000`).

**Medium:** window drag has no viewport clamping or pointer capture (release outside the browser leaves it stuck dragging); `WidgetFactory` ignores `meta.options` so discrete int parameters show raw numbers; ColorPicker silently drops alpha.

**Doc drift** is minimal — mainly the ui-components doc presenting NumberInput min/max as enforced, and the docs tree omitting ErrorOverlay.

---

## On the Three Open Design Questions

(Feature-local uniforms, pipeline flexibility, richer error analysis — and underneath them, whether a renderer is *composable modules* or a *recipe*.)

The answer is: **it's both, at two different altitudes, and the current `ProgramDescription`/`PlannedPipeline` split already has the right seam — it's just not load-bearing yet.**

- **Shader content is compositional.** Each planned feature (camera, accumulation, transport, materials, lighting, environment) naturally owns a *contribution*: `{ blocks, uniforms, defines, parameters }`. Today those are scattered — `planUniforms` centrally knows that pinhole needs `u_imageSize` and average-accumulation needs `u_pixelOffset` (`Planner.ts:127-157`), while the display shader's uniforms live in the GLSL template outside the system entirely. Restructure so each feature planner returns its contribution and the Planner concatenates; the ShaderBuilder stops knowing feature-specific facts. The `PlannedResource` sketch in compiler-next-architecture.md §3 is exactly right — add `provides:`/`requires:` headers on GLSL blocks (parsed from the comment headers already written) so assembly can validate the dependency chain instead of relying on ordering discipline.

- **Pipeline topology is a recipe, and that's fine.** Pass count and buffer structure are determined by the accumulation/display/transport *combination*, not contributed independently — the contract doc's five examples all show this. Don't force topology into the module system: let the accumulation feature own a small set of *pipeline archetypes* (progressive ping-pong, one-shot, temporal queue, variance-MRT), and let other features attach passes to slots in the chosen archetype. Modules contribute code and resources; the recipe owns structure. This resolves the tension without picking a side.

- **Error analysis** falls out of the same move: once features declare their contributions, validation becomes structural (every declared uniform has a source, every texture wiring has a declaration, every block's `requires` is satisfied) rather than a growing list of hand-written checks. Near-term concrete wins regardless: per-primitive SDF parameter schemas (C7), warnings for ignored fields (C5), bag access in the Planner (C8), and a `maxBounces ≥ 1` check.

**Testing suggestion:** the biggest untested surface is "does the generated GLSL actually compile." A small vitest step that runs generated fragments through a GLSL validator (`glslangValidator` binary, or a WASM build) would catch an entire class of codegen regressions (like C4) without a browser.

---

## Suggested Order of Attack

1. **Fixes that corrupt output now:** RNG (C1), tiled grid math (App #5), tile RNG seeding (C6), export off-by-one (C2).
2. **Unblock the compiler dev loop:** `unloadRenderer`/replace semantics in Engine + RendererManager, error-overlay wiring beyond initialize, `ResourceManager.cleanup()` fix.
3. **The contribution-model refactor** (uniforms/resources feature-local, pipeline archetypes) — do this before adding thin-lens/ACES/emissive, since each becomes a one-file contribution afterward instead of edits in four places.
4. **First new features to prove the axes:** fov-as-uniform, exposure support, `{ kind: 'param' }` material properties, environment-in-scene (C3) — each small, each exercising a different part of the new structure.
