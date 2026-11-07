# Engine survey (src/engine/ + docs/compiler-engine-contract.md)

Read-only survey, 2026-11-06, branch claudeapp at 8a101b6 (+ uncommitted docs).

## 1. What the Engine is, in two minutes

The Engine runs a `CompiledRenderer` (types in src/compiler/types.ts:766-1150) with no
knowledge of what the shaders compute. A CompiledRenderer is:

- `shaders: Map<shaderId, {vertex, fragment}>` (GLSL strings),
- `pipeline: { framebuffers[], passes[], postFrame.swaps[] }`,
- `uniforms: UniformBinding[]`, each `{ uniform, parameters: string[], type, compute(params) }`
  (compute is a JS closure),
- optional `sourceMaps`, `parameters` (UI metadata), `exportTargets`, `ldrRecipe`.

Each frame (`Engine.renderFrame`, Engine.ts:190):
1. build the parameter record = engine builtins (`engine.resolution`, `engine.imageSize`,
   `engine.time`, `engine.sampleCount`, `engine.resetSalt`, `engine.pixelOffset`) + every
   value the App pushed with `setParameter` (Engine.ts:231-254);
2. `RenderExecutor.executePipeline`: for each pass, bind output FBO, set the viewport to
   the output's size, `useProgram`, let ParameterManager upload uniforms (closure memo +
   upload-skip cache), bind input textures to units 0..k in declaration order (framebuffer
   refs via ResourceManager, `extern:<name>` refs via TextureRegistry), draw one
   fullscreen triangle (RenderExecutor.ts:159-211);
3. run postFrame swaps (flip ping-pong index) (RenderExecutor.ts:253-257);
4. sampleCount++.

Buffer references are a small string language parsed in the engine:
`<base>[_current|_previous][:N]` (ResourceManager.ts:648-669).

In practice the compiler emits exactly one shape (Planner.ts:699-743): a double-buffered
`accumulation` framebuffer (1 rgba32f attachment per picture, MRT when >1), `screen`, an
rgba8 `ldr` scratch target; pass 1 = path tracer (reads `accumulation_previous[:N]`,
writes `accumulation_current[:N]`, plus `extern:` data textures); pass 2 = display
(reads `_current`, optional `extern:blue_noise`, writes screen); one swap. The env bake
(compiler/EnvironmentBake.ts) is the other producer: one fixed-size `texture` buffer, one
pass, no swap, export `table`.

## 2. Files (line counts; 2887 total incl. a 16.7 KB base64 blob)

| File | Lines | Role |
|---|---|---|
| Engine.ts | 535 | Facade. Holds renderer map, active id, per-renderer sampleCounts, reset salt (+pinning), custom parameter map, pixelOffset/imageSize for tiles; load/unload/validate/select; renderFrame; renderView (ldrRecipe re-run); readExport/readBuffer; registerDataTexture(U32); env loading pass-throughs; context loss/restore. |
| RenderExecutor.ts | 456 | Compiles/links programs (flat `shaderId → program` map), executes passes/pipeline, binds textures (sole texture-unit authority), MRT drawBuffers cache, sampler location cache. Exports pure `computeDrawBuffers`. |
| ResourceManager.ts | 678 | Per-renderer framebuffer sets: screen / texture / double_buffer, MRT attachments, fixed `size` exemption from resize, swap, clear, resize, resolve `_current/_previous/:N`. Exports pure `parseResourceId`, `resolveBufferIndex`. Enables EXT_color_buffer_float. |
| ParameterManager.ts | 281 | For the active renderer: caches uniform locations per (uniform, shader); per frame/pass runs each binding's closure only if its input params changed (E7 memo), skips upload when value equals last upload per shader. Debug-only reverse map and stats. |
| utils/shader-uniform-utils.ts | 167 | `setUniformValue` (typed switch; untyped inference fallback), exact `uniformValuesEqual`. |
| TextureRegistry.ts | 61 | Dumb `name → WebGLTexture` store; replace deletes old texture. |
| utils/TextureFactory.ts | 152 | createR32F (CDF, NEAREST/CLAMP), createRGB32F (HDR map, LINEAR-if-extension else NEAREST, REPEAT/CLAMP), createRGBA32F (data, NEAREST/CLAMP), createRGBA32UI. |
| HDREnvironmentLoader.ts | 161 | fetch + validate + parse .hdr, upload RGB32F map, call buildEnvironmentSampler for the default (equirect, uncompensated) CDFs, return data for App variant builds. |
| loaders/hdr-loader.ts | 185 | Radiance RGBE parser (RLE). Pure CPU. |
| loaders/build-environment-sampler.ts | 43 | Calls `components/env/importance.ts` buildEnvImportanceTable(chart, compensation, blur) and uploads cond/marg CDFs as R32F under caller names. |
| loaders/blueNoise.ts + resources/blueNoise.ts | 29 + 7 | Decode baked 64x64 RGB8 tile, register as `blue_noise` (NEAREST/REPEAT) at construction and after context restore. |
| GPUProfiler.ts | 104 | Wall-clock per-pass timing forced by 1x1 readPixels; `update()` is a no-op kept for "API compat". |
| types.ts / index.ts | 14 / 14 | Re-exports of contract types; EngineState union. |

Outside src/engine but part of the seam:
- src/errors/compiler/validation.ts (347) — `validateCompiledRenderer`, run by Engine.loadRenderer before any GPU change; has its own buffer-ref parser `parseBufferRef` (l.320).
- src/compiler/generate/PipelineBuilder.ts (91) and compiler/plan/pictures.ts (52) mint the buffer-ref strings, export targets and ldrRecipe.
- src/app/{App,RendererManager,RenderCoordinator,BuiltinAssets}.ts are the only callers.

Tests: tests/engine/*.ts (431 lines): pure helpers (ids, drawBuffers, uniform equality), extern binding order with a recording GL stub, HDR parse, env sampler CDF round-trip. Nothing exercises the executor on a real GL context except the witness sweep / lab pages.

## 3. Engine API actually used by the App (grep of `engine.X(` in src/app, tests)

setParameter(6) getSampleCount(5) selectRenderer(4) clearAccumulation(4) unloadRenderer(3)
renderFrame(3) renderView(2) registerEnvironmentTable(2) registerDataTexture(2) readExport(2)
loadRenderers(2) isProfilingEnabled(2) getResetSalt(2) validateRenderers loadRenderer
loadEnvironmentHDR registerDataTextureU32 setPixelOffset setImageSize clearPixelOffset
clearImageSize resize pinResetSalt getPinnedResetSalt getExportNames getCanvasSize
getAvailableRendererIds getAllPassTimings getActiveRendererId getActiveRenderer
enableProfiling disableProfiling dispose isRunning onContextRestored.

Not called outside the engine (debug/convenience; not to be deleted — small, harmless):
getTextureRegistry, getAllParameters (engine's), getParameter, getAvailableBuffers,
getPassTiming, isReady, isError, getState, time; ParameterManager.getCacheStats /
getParameterBindings; GPUProfiler.getRawPassTiming; ResourceManager.clearBuffer.

## 4. Is the engine blind?

Mostly yes. Engine/RenderExecutor/ResourceManager/ParameterManager contain no scene,
material, light or geometry vocabulary; buffer, pass, uniform and export names all come
from the compiled data (ldrRecipe removed the last memorized names). It is also
geometry-blind: nothing in it assumes Euclidean space — curved spaces are entirely a
compiler/GLSL matter.

Leaks (details in findings):
1. Environment: Engine.registerEnvironmentTable / HDREnvironmentLoader call the estimator's
   importance-table builder (components/env/importance.ts) with `chart`/`compensation`, and
   the loader decides the "default" table variant (equirect, uncompensated) that App's
   `envVariantSuffix(...) === ''` also encodes. E6 moved the math's source file but the
   engine still orchestrates it.
2. Sampler state is decided by the engine/App per texture (LINEAR+REPEAT for the env map,
   NEAREST+REPEAT for blue noise, NEAREST+CLAMP for data) while component GLSL relies on it
   (equirect_map.glsl comment "the map texture repeats horizontally"); the contract's
   `extern:` ref carries no sampler/format facts.
3. The global texture name `blue_noise` is hardcoded in the engine (loaders/blueNoise.ts:28)
   and in the Planner (Planner.ts:737); size 64 is repeated in glsl/shared/noise.glsl:9.

## 5. Complexity / duplication observations

- Buffer-ref string grammar parsed in 3-4 places: ResourceManager.parseResourceId,
  errors/compiler/validation.parseBufferRef, RenderExecutor.computeDrawBuffers, and a regex at
  validation.ts:139. The compiler builds structured `{bufferId, attachment}` (pictures.ts:45)
  and serializes it to a string that the engine parses back.
- Three "active renderer" pointers: Engine.activeRendererId, ResourceManager.activeRenderer,
  RendererManager.activeRendererId; two renderer maps (Engine, RendererManager).
- Per-renderer framebuffers + sampleCounts are kept so that "switching is instant and each
  renderer keeps its accumulation" (contract §6), but RendererManager.selectRenderer and
  recompile always clearAccumulation after switching (RendererManager.ts:245-248, 270-278),
  so retained accumulation is never used; memory scales with renderer count.
- Program map is flat across renderers (RenderExecutor.ts:34), which forces the CLAUDE.md
  convention "shader ids are prefixed with the renderer id"; ResourceManager is already
  namespaced per renderer.
- Two uniform-location caches (RenderExecutor WeakMap for samplers, ParameterManager map for
  bindings); useProgram issued twice per pass (RenderExecutor.ts:197, ParameterManager.ts:92).
- MRT drawBuffers set at FBO creation (ResourceManager.ts:517-520; per-FBO state) and again
  per pass from a cache with a fallback (RenderExecutor.ts:181-189).
- ParameterManager.clearCache on every accumulation reset (Engine.ts:308) throws away the E7
  memo, so every interactive change re-runs every closure.
- Parameter values live in App's ParameterStore and in Engine.customParameters (plus env.*
  values pushed straight to the engine, App.ts:213-217 explains why).
- TextureFactory: four near-identical create functions; constructor checks
  EXT_color_buffer_float, which data textures do not need.
- History tags (E6, E7, E11, T1, T4, §2.10/§2.11, "fable-review Engine #4", "audit F1/F10")
  appear in most engine files.

## 6. Contract doc vs code (docs/compiler-engine-contract.md, "LOCKED", Jan 2025)

Doc says / code does:
- §1 `sourceMap: SourceMap` / code `sourceMaps?: Map<string, SourceMap>`; code adds
  `parameters`, `exportTargets` (ExportTarget type not described except the `picture` extension).
- §2 FramebufferConfig `format` includes `'depth'`, `multisampled?` / code has neither; code has
  `size?` (T4 extension, recorded only in a code comment) and MRT arrays.
- §2 RenderPass `inputs.uniforms?`, `output: string` / code: no `uniforms`, `output: string | string[]`, `extern:` refs (documented in fable-compiler-contracts §2.10, not here).
- §4 example `type: 'accumulation'` is not a valid FramebufferConfig type.
- §6 sketch APIs (`setupFramebuffers`, `prepareFrame`, `finalizeFrame`) do not exist.
- §8 "the Compiler does NOT extract or forward [UI] metadata" / it does (`CompiledRenderer.parameters`).
- §8 "Renderer-specific parameters are scoped to renderer ID" / Engine.customParameters is one global map.
- §9 "Exactly one screen framebuffer" / validator allows zero when no pass targets screen (bake).
- §11 Production mode `JSON.stringify(compiled)` / impossible: `uniforms[].compute` are closures and `shaders` is a Map.
- §12/§13 "Next steps: FlexibleResourceManager…" — historical.
- Not mentioned anywhere in the doc: engine builtin parameter names, `float[]` uniform type, ldr scratch, ExportTarget format.

## 7. In-progress scaffolding (keep)

- `execution.type: 'loop'` + `iterations`, `clearBeforeRender`: never emitted (PipelineBuilder.ts:39 always 'once'). Note: as executed (RenderExecutor.ts:239-243) a loop re-runs the pass with identical parameters, no swap, no sampleCount bump — it cannot by itself give "multiple samples per frame" for an accumulating pass.
- `SwapInstruction 'rotate'`: throws in ResourceManager.ts:190-193; rejected at load by validation.ts:218. Temporal history queues.
- Formats `rgba16f`, `r32f`; uniform types `mat3`, `mat4`, `bool`, `sampler2D`, `samplerCube` (executor always binds TEXTURE_2D, so samplerCube would need executor work).
- `engine.time` builtin: zero consumers, reserved for motion blur (comment Engine.ts:241-243). It is wall-clock time, which is not reproducible under a pinned salt.
- GPUProfiler `update()` no-op, `getRawPassTiming`.

## 8. WebGL2 limits relevant to future work

- No compute, no storage buffers, no scatter: data rides 2D float textures (6 RGBA32F + 1 RGBA32UI); light tracing / BDPT / photon / ReSTIR are declared non-goals "reserved for a future WebGPU tracer" (fable-compiler-contracts.md:33, impl-plan-interaction-reshape.md:85).
- DATA_TEX_WIDTH = 4096 (components/data/pack.ts:12) exceeds the WebGL2 MAX_TEXTURE_SIZE floor (2048); the engine uploads without checking the limit or gl.getError (only the HDR path checks, errors/resources/validation.ts:175-188).
- 16 fragment texture units floor: checked by the compiler (Generator.ts:41-47).
- Sampler precision: GLSL ES 3.00 default for sampler2D in fragment shaders is lowp; the compiler emits highp only for usampler2D or when a texture asks (ShaderBuilder.ts:224). The contract cannot tell the engine or validator what format an extern holds. Already a known open item in CLAUDE.md.
- Uniform arrays (`float[]` light CDFs, lighting.ts:169-183) consume uniform vectors; no budget check against MAX_FRAGMENT_UNIFORM_VECTORS (floor 224) was found (search for UNIFORM_VECTORS empty). Inferred risk only.
- Per-draw watchdog: one fullscreen draw per frame; App-level TiledRenderer (resizes the canvas per tile) is the existing answer. Heavier curved-space marching will make this more pressing; the engine has no per-pass scissor tiling.
- WebGPU: no port is planned. fable-webgpu-handoff.md is a project description (July 2026; its §10 "Data tables are baked into GLSL… no runtime-sized scene data" is out of date since the data rail). WebGPU appears only (a) as a separate "future WebGPU tracer" for non-goals and (b) in the OIDN step-7 plan (docs/claude-outputs-step7-plan.md), which adds a separate WebGPU device for denoising next to the WebGL2 engine. The engine's small surface (~35 methods used) and data-only pipeline would make a sibling backend feasible, but shaders are GLSL strings and uniforms are per-name closures, so a WebGPU backend would need WGSL (or a GLSL→WGSL path) and uniform-buffer packing.
