# CLAUDE.md

WebGL2 **research path tracer** — no frameworks, pure WebGL2/GLSL 300 es, TypeScript strict, Vite. The owner is a mathematician; long-term goals include volumetric media, swappable material/transport models, complex multi-material objects, and eventually non-Euclidean spaces (H³, Nil, black-hole metrics). Read this file, then trust the `docs/fable-*.md` documents as design authority.

## Commands

```bash
npm run dev          # dev server on port 3000 (index.html → examples/scene-lab.ts; root = cornell, ?scene=<id> switches the suite in src/compiler/scenes/index.ts)
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
| `docs/fable-compiler-contracts.md` | **Governs all compiler work.** GLSL contracts (interaction, Hit/regions/media, geodesic stepper, lights, transport-as-generator), pinned conventions, v1 constraints (§1.1 — deferred, NOT excluded), migration roadmap (§10.1 — do items in order). |
| `docs/fable-reference-implementations.md` | **Normative GLSL — transcribe, don't re-derive** (Lambert, dielectric incl. the η² factor, GGX, HG, light samplers, the transport loop). Ends with a checklist mapping each reference → migration item → test. |
| `docs/fable-validation-scenes.md` | Concrete correctness tests with derived expected values (furnace = 0.4 exactly, etc.). Implement these as the harness. |
| `docs/fable-transport-verification.md` | Why the non-obvious rules are what they are (innermost-wins, no medium stack, null interfaces). Check here before "fixing" something that looks odd. |
| `docs/fable-review.md` | Known bugs in all layers, ranked. Six are fixed (header notes which); the rest are open. |
| `docs/compiler-engine-contract.md` | The **locked** compiler↔engine boundary (CompiledRenderer/RenderPipeline types). Do not change these types. |

`docs/archive/` is a **dead architecture** (pre-compiler module system). Its *problem analyses* are still valuable; its *designs* are superseded — never resurrect module descriptors, recipes, or `reference/SimpleCompiler.ts`.

## Current state

Only a **minimal vertical slice** of the compiler exists ("step zero": Euclidean, SDF sphere/plane/box, Lambert, point light + NEE, pinhole, average accumulation, Reinhard). **The real compiler — the system the contracts describe — has not been built**; do not describe it as built. The slice also deliberately does not yet conform to the contracts. Build path: `fable-compiler-contracts.md` §10.1, in order — item 1 (reshape `lambert.glsl` to the interaction contract) is the starting point. Don't mix migration steps with feature work.

## Critical conventions

- **Shader ID namespacing:** the Engine stores programs in a flat map — shader IDs MUST be prefixed with the renderer ID (`${rendererId}-main`), and renderer IDs are `${strategy.id}-${scene.id}`. Collisions silently clobber programs.
- **Uniforms:** `u_camelCase` in GLSL; `dotted.path` parameter names in TS. Engine builtins injected each frame: `engine.resolution`, `engine.frameIndex`, `engine.sampleCount`, `engine.time`, `engine.pixelOffset`, `engine.imageSize`.
- **Spectral discipline** (contracts §2.5): in library/template GLSL, never write raw `vec3(...)` literals for radiometric quantities; reductions via `spectrum_*` helpers; radiometric constants are emitted by the Generator's formatter.
- **GLSL types:** `Point`, `Direction`, `Spectrum`, `Radiance` are typedefs (currently `vec3`; `Point` may become `vec4` for curved spaces). Write against the typedefs.
- **HDR export reads `accumulation_previous`** — post-frame swap semantics; see the comment in `PipelineBuilder.ts` before "correcting" it.
- **Model-authored design docs** are prefixed by author (`fable-…`) so provenance is visible. Follow the pattern for substantial new design docs.
- Fullscreen triangle via `gl_VertexID` (no VAO). Buffer qualifiers `_current`/`_previous` are reserved suffixes on framebuffer IDs.

## Verifying changes

- `npx vitest run` covers compiler structure (shader assembly, source maps, validation). It does NOT compile GLSL — GPU errors only surface in the browser (ErrorOverlay maps them through source maps back to origin blocks).
- Rendering correctness = the scenes in `fable-validation-scenes.md` (furnace box, Beer–Lambert slab, η² witness, cross-strategy convergence). For any change to sampling/lighting/transport GLSL, run or reason through the relevant one.
- To see it render: `npm run dev`, open port 3000 — Cornell box with orbit controls; keys 1-9 switch renderers, `r` resets accumulation.
