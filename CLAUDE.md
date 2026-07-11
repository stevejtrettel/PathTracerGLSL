# CLAUDE.md

WebGL2 **research path tracer** — no frameworks, pure WebGL2/GLSL 300 es, TypeScript strict, Vite. The owner is a mathematician; long-term goals include volumetric media, swappable material/transport models, complex multi-material objects, and eventually non-Euclidean spaces (H³, Nil, black-hole metrics). Read this file, then trust the `docs/fable-*.md` documents as design authority.

## Commands

```bash
npm run dev          # dev server on port 3000 (root = suite GALLERY; click a card → lab.html?scene=<id> renders it; suite registry in src/compiler/scenes/index.ts)
npx vitest run       # run tests ONCE (plain `npm run test` starts watch mode)
npx tsc --noEmit     # typecheck
```

## Architecture (three layers, dependency direction App → Engine → Compiler)

- **App** (`src/app/`) — facade + managers (RendererManager, RenderCoordinator, ProductionOrchestrator, ParameterStore, EventBus) + extensions + UI library.
- **Engine** (`src/engine/`) — executes `CompiledRenderer` objects **blindly**. It must never know about scenes, materials, or algorithms. Do not leak compiler/scene concepts into the engine — this boundary is load-bearing.
- **Compiler** (`src/compiler/`) — Analyze → Validate → Plan → Generate. Turns `SceneDescription + RenderStrategy` into `CompiledRenderer` (shaders + pipeline + uniform bindings). GLSL library lives in `src/compiler/generate/glsl/`, loaded via Vite `?raw` imports; assembly goes through `ShaderIR.ts` blocks so source maps track provenance.

## Design authority — read before designing anything

| Document | Role |
|---|---|
| `docs/trace-loop-contract.md` | **Authority for the top-level loop and its types** (owner-decided). `Ray`=pure geodesic seed, `scene_intersect`/`Hit`/interaction/`make_ray`, the `ambient_dot` metric rule. **Supersedes Fable §5 (`GeodesicState` stepper — deleted) and §6.3 (`shadow_transmittance` signature).** Read before touching the loop. |
| `docs/fable-compiler-contracts.md` | **Governs compiler work** *except where trace-loop-contract.md supersedes it.* GLSL contracts (interaction, Hit/regions/media, ~~geodesic stepper~~, lights, transport-as-generator), pinned conventions, v1 constraints (§1.1 — deferred, NOT excluded), migration roadmap (§10.1 — do items in order). |
| `docs/fable-reference-implementations.md` | **Normative GLSL — transcribe, don't re-derive** (Lambert, dielectric incl. the η² factor, GGX, HG, light samplers, the transport loop). Ends with a checklist mapping each reference → migration item → test. |
| `docs/fable-validation-scenes.md` | Concrete correctness tests with derived expected values (furnace = 0.4 exactly, etc.). Implement these as the harness. |
| `docs/fable-volumetric-component.md` | **Authority for the media build** (owner-decided) — the volumetric component seams (`medium_sample`/`medium_transmittance`/phase), interface-vs-segment separation, the RTE partition rule + radiance capability flag, chromatic sampling per pbrt-v3 (**supersedes reference-implementations §5's medium lines**), `volumeIntegrator` axis rename (v1 = `analytic`). |
| `docs/fable-transport-verification.md` | Why the non-obvious rules are what they are (innermost-wins, no medium stack, null interfaces). Check here before "fixing" something that looks odd. |
| `docs/fable-review.md` | Known bugs in all layers, ranked. Most are fixed across batches (headers note which); C4/C5/C7/C8 + camera-straight-down NaN remain open. |
| `docs/fable-module-anatomy.md` | Module anatomy & property machinery — descriptor/schema shapes for §3.3/§3.4, family taxonomy, deferred file layout, staging (dielectric landed on hand-written plumbing; schema reorg later). |
| `docs/compiler-engine-contract.md` | The **locked** compiler↔engine boundary (CompiledRenderer/RenderPipeline types). Do not change these types. |

`docs/archive/` is a **dead architecture** (pre-compiler module system). Its *problem analyses* are still valuable; its *designs* are superseded — never resurrect module descriptors, recipes, or `reference/SimpleCompiler.ts`.

## Current state

**Done** (see `docs/trace-loop-contract.md` + the impl-plan-*.md docs + memory): the top-level loop conforms to the trace-loop contract (`Ray` pure geodesic seed, generated `scene_intersect` dispatcher, `ambient_dot` metric discipline, no `GeodesicState`); §10.1 items 1–6 & 8; **two geometry backends** (SDF marching + closed-form analytic, combined by the dispatcher); **two-sided hits** (`Hit.region_owner`, generated `scene_region_at` innermost-wins, epsilon classification, owner-shades vs emission-on-`region_to`, `ray_spawn`, interior marching, per-owner normals); the **smooth dielectric** (η² factor, generated `ior_of`/NEE-guard tables, `etaScale` RR metric) with its witnesses (F-ETA 0.5540 GPU-verified, R-SUBMERGED, cornell/analytic-glass twins); RR post-weight per §7.2; **homogeneous media** behind the volumetric component (`docs/fable-volumetric-component.md`): null interfaces (`model: 'none'`), `current_medium` + §4.4 self-heal, `ambientMedium`/`material_of(-1)`, the generated `medium_sample`/`medium_transmittance` seams (absorbing arms deterministic; scattering arms = pbrt-v3 channel-MIS), HG phase (forward convention), spectral `shadow_media` segment walker, the emission gate (`material_is_emissive`) — **all four witnesses GPU-verified** (slab exact numbers, F-BOX-M 0.4/channel, haze g-flip, fogcube rim; F-ETA re-verified 0.554); the **suite gallery** at the dev-server root (`expected` pass criteria per scene).

**Still Euclidean + point lights + NEE** — no GGX, no area lights/MIS (glass shadows are dark by §6.3 policy — correct, no caustics possible yet; the haze pt/pt-nee equality pair waits on area lights), no heterogeneous media/majorants/equiangular NEE (deferred table in `impl-plan-media.md`), no curved spaces (the `ambient_*` seam is ready but H³/Schwarzschild are unbuilt), no transport-generator split (§10.1 item 9, still last), descriptor/schema reorg deferred (fable-module-anatomy §7). Don't describe those as built. **Discuss loop/interface structure before implementing** (owner preference); don't mix refactors with feature work.

## Critical conventions

- **Shader ID namespacing:** the Engine stores programs in a flat map — shader IDs MUST be prefixed with the renderer ID (`${rendererId}-main`), and renderer IDs are `${strategy.id}-${scene.id}`. Collisions silently clobber programs.
- **Uniforms:** `u_camelCase` in GLSL; `dotted.path` parameter names in TS. Engine builtins injected each frame: `engine.resolution`, `engine.sampleCount`, `engine.resetSalt`, `engine.time`, `engine.pixelOffset`, `engine.imageSize` (`engine.frameIndex` was DROPPED — §2.11).
- **Spectral discipline** (contracts §2.5): in library/template GLSL, never write raw `vec3(...)` literals for radiometric quantities; reductions via `spectrum_*` helpers; radiometric constants are emitted by the Generator's formatter.
- **GLSL types:** `Point`, `Direction`, `Spectrum`, `Radiance` are typedefs (currently `vec3`; `Point` may become `vec4` for curved spaces). Write against the typedefs.
- **HDR export reads `accumulation_previous`** — post-frame swap semantics; see the comment in `PipelineBuilder.ts` before "correcting" it.
- **Model-authored design docs** are prefixed by author (`fable-…`) so provenance is visible. Follow the pattern for substantial new design docs.
- Fullscreen triangle via `gl_VertexID` (no VAO). Buffer qualifiers `_current`/`_previous` are reserved suffixes on framebuffer IDs.

## Verifying changes

- `npx vitest run` covers compiler structure (shader assembly, source maps, validation). It does NOT compile GLSL — GPU errors only surface in the browser (ErrorOverlay maps them through source maps back to origin blocks).
- Rendering correctness = the scenes in `fable-validation-scenes.md` (furnace box, Beer–Lambert slab, η² witness, cross-strategy convergence). For any change to sampling/lighting/transport GLSL, run or reason through the relevant one.
- To see it render: `npm run dev`, open port 3000 — the suite gallery; click a scene card (each shows what it exercises + its expected value). In a scene: orbit controls, keys 1-9 switch renderers, `r` resets accumulation.
