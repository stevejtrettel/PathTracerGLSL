# CLAUDE.md

A WebGL2 **research path tracer**: TypeScript (strict) and GLSL 300 es, built with Vite, no
rendering frameworks. The owner is a mathematician. Long-term goals: volumetric media,
swappable material and transport models, complex multi-material objects, and non-Euclidean
spaces (H³, Nil, black-hole metrics). Correctness of the Monte Carlo estimators comes first.

This file is orientation and rules. History is in [CHANGELOG.md](CHANGELOG.md); design
rationale is in `docs/` (index: [docs/README.md](docs/README.md)).

## Commands

```bash
npm run dev            # dev server on :3000 — the scene gallery; a card opens lab.html?scene=<id>
npx vitest run         # all tests, once (`npm test` is watch mode)
npx tsc --noEmit       # typecheck
npm run witness        # GPU numeric tests (~45 min); `-- <scene…>` filters, `-- --list` lists
npm run dump:shaders   # generated shaders → generated-shaders/ (`-- --scene <module>` for one)
```

- The glslang static-compile tests (`tests/compiler/glsl-compile.test.ts` and a few others)
  use `glslang-validator-prebuilt-predownloaded`, whose macOS binary is x86-only. On Apple
  silicon without Rosetta ~350 tests fail with "glslangValidator could not be run"; that is
  the tool, not the code. Install Rosetta, or point `GLSLANG_VALIDATOR` at a native build
  (`brew install glslang`). CI (Linux) runs them.
- `npm run witness` needs Playwright's headless Chromium (`npx playwright install chromium`)
  and a free port 3000; never run two at once. Finished renders are cached in
  `.witness-cache/` (keyed on source contents), so an interrupted sweep resumes.

## Architecture

Dependency direction: **Authoring → App → Engine → Compiler → Components.** Nothing imports
upward.

- **Authoring** (`src/authoring/`) — conveniences that produce plain scene descriptions:
  group flattening (`flattenGroups`), OBJ and `.inst` loaders, instance clouds, the
  subsurface albedo inversion, camera poses.
- **App** (`src/app/`) — the facade and managers: renderer switching, the render loop,
  production renders, parameters, events, UI. It also packs scene data into textures
  (`App._uploadSceneGeometry`).
- **Engine** (`src/engine/`) — executes a `CompiledRenderer` blindly (programs,
  framebuffers, passes, uniforms, textures). It must not know about scenes, materials or
  algorithms. The compiler↔engine types are **locked** (docs/compiler-engine-contract.md).
- **Compiler** (`src/compiler/`) — `SceneDescription + RenderStrategy → CompiledRenderer`:
  Analyze (a small census) → Validate (diagnostics, never throws) → Plan (every decision,
  recorded in `ProgramDescription`) → Generate (feature generators emit GLSL from the plan
  alone). It contains no `.glsl` files.
- **Fixed GLSL** (`src/glsl/`) — `core/` is the contract every component is written against
  (structs, interaction, math, ray); `shared/` is compiler plumbing.
- **Components** (`src/components/`) — the swappable library. One folder per occupant
  (`name.glsl`, a `name.ts` descriptor, an optional `name.md` math note), grouped into
  families, each with a registry (`index.ts`) and a `README.md` contract: geometry,
  materials, lights, volume_scattering, transport, env, camera, pixel, sensor, sampler,
  accumulator, tonemap, ambient, intersection, accel, data. Components import only *types*
  from other layers (`tests/components/purity.test.ts`). Adding an occupant = one folder +
  one registry line.

How a program is assembled:

- **Descriptors declare facts about one model** (parameter rows, capabilities, how each
  parameter transforms under a similarity, bounds, pdf formulas); the compiler composes. A
  descriptor never refers to other components or to program structure.
- **Exact linkage.** A generated function exists only if something calls it. Features
  declare the seams they `provide` and `require`; merging reports missing, conflicting and
  unused seams. Hand-written component files are included whole.
- **The transport loop is generated** (`components/transport/integrators/pt/pt.ts`): a
  short generated walk calling static technique files; pt / pt-nee / pt-mis are combiner
  configurations. Math is static GLSL; policy and plumbing are generated.
- **Scene data** (meshes, BVHs, instance placements, the light tree, the object table)
  lives in six shared data textures. A scene's renderers are compiled together
  (`Compiler.compileScene`) and share one layout, which holds the optional structures
  (CWBVH, light tree, object table) only if some renderer reads them (`DataReads`).
  `planDataLayout` (components/data/ledger.ts) is the one layout; `dataTenantsOf`
  (compiler/plan/dataTenants.ts) feeds it. The compiler also returns a scene-data plan
  (`CompiledScene.sceneData`, compiler/sceneData.ts) saying what to pack where; the App
  executes it (app/sceneData.ts) and derives nothing from the scene itself. The App compiles
  before it packs.
- **Which scene objects are lights** has one answer: `samplableEmitterObjects` in
  dataTenants.ts (with the authored `lights` it forms `lightRosterOf`). Use it; don't
  re-derive it.

## Invariants

- **Measurement / estimator / view** (docs/fable-strategy-taxonomy.md, owner-pinned). The
  scene plus `measurement` define the integral; `estimator` says how it is sampled and must
  **never change the converged image**; `view` is display only. Every strategy field
  declares its section. Estimator equality is tested (pt, pt-nee and pt-mis must converge to
  the same image).
- **Truncations are declared.** Measurement fields that make the image differ from ground
  truth are the bias ledger: `maxBounces`, opaque shadow rays through dielectrics
  (`shadows: 'opaque-dielectrics'`), RGB color. `maxBounces: N` is Σ_{n≤N} TⁿE — at most N
  scattering events — under every estimator. `MAX_DIST` (1000, glsl/core/math.glsl) is an
  absolute far clip: the environment is found there by both BSDF rays and NEE.
- **The trace-loop contract** (docs/trace-loop-contract.md): `Ray` is a pure geodesic
  seed; `scene_intersect` fills a `Hit`; dot products go through `ambient_dot` (the
  curved-space seam).
- **`SceneDescription` is flat.** Groups and trees exist only in the authoring layer.
  Objects describe *shapes*, not backends: the compiler intersects analytically when the
  primitive supports it and marches the SDF otherwise (`backend:` pins exist for coverage).
- **Placements are Euclidean similarities** (TRS, positive uniform scale; no reflections,
  no non-uniform scale) — docs/fable-transforms.md.
- `docs/archive/` is a dead architecture (the pre-compiler module system). Its problem
  analyses are useful; never resurrect its designs (module descriptors, recipes,
  `SimpleCompiler`). `docs/architecture.md` predates the component and authoring layers;
  prefer this file.

## Conventions

- **GLSL naming:** occupant functions are `<occupant>_<op>` (`sphere_sdf`, `lambert_eval`;
  lights keep the `_light_` infix, `quad_light_sample`). Write against the typedefs `Point`,
  `Direction`, `Spectrum`, `Radiance` (vec3 today; `Point` may become vec4 for curved
  spaces).
- **Spectral discipline:** no raw `vec3(...)` literals for radiometric quantities in library
  GLSL; reduce spectra with `spectrum_*`; the generator formats radiometric constants.
- **One radiometric word, `emission`,** on lights and materials: radiance for area
  emitters, radiant intensity for point-like lights, irradiance for directional ones.
- **Ids follow insertion order** (materials, lights, regions); names are provenance only.
  Authored object names flow into emitted symbols (`sdf_<name>`).
- **Parameters:** `dotted.path` names in TS, derived `u_…` uniform names in GLSL
  (`paramToUniform`). Reserved: prefixes `engine.`, `env.`, `debug.`, `renderer.` and paths
  `camera.position`, `camera.target`, `camera.frame`. Engine builtins each frame:
  `engine.resolution`, `engine.sampleCount`, `engine.resetSalt`, `engine.time`,
  `engine.pixelOffset`, `engine.imageSize`.
- **Shader ids** are prefixed with the renderer id (`${rendererId}-main`, renderer id =
  `${strategy.id}-${scene.id}`): the engine's program map is flat and collisions silently
  overwrite.
- **HDR export reads `accumulation_previous`** (post-swap) — read the comment in
  PipelineBuilder.ts before "fixing" it.
- Fullscreen triangle via `gl_VertexID` (no VAO). Framebuffer suffixes `_current` /
  `_previous` are reserved.
- New design docs written by a model are prefixed `claude-…`. Existing `fable-…` docs keep
  their names.

## Writing code and comments here

- **Comments explain the present:** what the code computes and why — the math, units,
  conventions, invariants, non-obvious constraints. State a convention where it is used
  (e.g. η = n_i/n_t at every Fresnel call, not only in one file header).
- **No history in comments:** no batch codes (T3, C7, A5, …), dates, "owner-decided",
  "used to be", "fixed in …". History goes in commit messages and CHANGELOG.md. Many
  existing comments carry such tags; when you edit one, rewrite it to this standard rather
  than adding another tag.
- Cite a doc section only when a derivation is too long to include, and say what the
  reader will find there.
- **One answer per fact.** If two modules need the same decision, extract a function both
  call — don't mirror the logic and assert that the copies agree.
- **Discuss loop and interface structure with the owner before implementing.** Don't mix
  refactors with feature work.
- Don't describe deferred work as built. When a design doc is superseded, update or archive
  it rather than writing a new doc that amends it.
- After a batch of work, add a dated entry to CHANGELOG.md (not to this file).

## Verifying changes

- `npx vitest run` checks compiler structure and validation, TypeScript "twins" of the GLSL
  math (χ² histogram and pdf-consistency tests), and a glslang static compile of every
  registry scene. It never executes GLSL, and nothing checks a GLSL file against its twin.
- `npm run witness` is the numeric gate: it renders `tests/witnesses/` scenes on a software
  GPU and checks derived values (furnace 0.4, F-ETA 0.5540, slab transmittance, estimator
  equalities, noise). Run it after any change to sampling, lighting or transport GLSL.
  Adding a witness = one fixture in `tests/witnesses/scenes/` + one registry entry; gate
  policy and the standing failures are in tests/witnesses/README.md.
- CI (`.github/workflows/ci.yml`) runs typecheck + vitest (incl. glslang) on every push;
  the witness sweep is a manual job.
- The generated-GLSL snapshot diff is large and mostly source-map line numbers: review it
  by the kinds of lines that changed, not line by line.

## Status (September 2026)

**Built**
- Transport: path tracing with NEE and MIS (power heuristic); Russian roulette, including
  the per-collision interior rule in media; equiangular medium NEE (delta lights only).
- Geometry: sphere, plane, quad, disk, box, cylinder, torus, menger, apollonian, bottle,
  knob (closed form and/or marched SDF); scene-local SDFs (`defineSDF`); OBJ triangle meshes
  with BVHs (`closed: true` meshes have interiors); instancing with per-batch TLAS; `.inst`
  instance clouds (10⁵–10⁶ instances); table dispatch with boxed-SDF leaves for many objects.
- Placement: constant and `{param}`-driven similarities.
- Materials: lambert, ggx, mirror, dielectric, rough_dielectric, checker; GLSL-expression
  properties; per-instance attributes; blackbody emission.
- Lights: point, spot, directional, beam, softbeam, quad, sphere, disk, mesh; emissive
  objects sampled as lights; selection by power, uniform or a light tree (`bvh`); the
  environment as a light (constant, image, baked procedural; equirect or octahedral charts;
  MIS compensation).
- Media: homogeneous (closed form, per-channel MIS), heterogeneous (delta tracking;
  expression coefficients under a declared majorant), volume emission, HG and Rayleigh phase
  functions, null interfaces, variable-index (GRIN) media.
- Cameras: pinhole, thin lens, orthographic, equirect, fisheye, cylindrical. Box pixel
  filter; accumulators average / variance / oneshot; seven tonemaps.
- Output: exports carry reproducibility stamps; `app.renderTiled` renders any size in tiles
  and saves one stitched HDR/PNG (byte-identical to a one-piece render at the same salt).
- Tooling: the witness runner, shader dumps, CI.

**Not built / deferred:** curved spaces (the `ambient_*` seam exists; only Euclidean is
registered); spectral transport (`color: 'spectral'` is reserved); transparent shadow rays
through glass; MIS with delta tracking; equiangular sampling of area lights; spherical-
rectangle quad sampling; two-sided quad lights; driven light geometry; multi-material
meshes.

**Known open defects**: cube-cloud-ref does not finish under SwiftShader (tests/witnesses/
README.md). Correctness items found by the Sep 25 audit and deliberately left for a decision
(the mesh-light MIS normal on smooth meshes; three estimator-dependent budgets) are in
docs/claude-improvements-2026-09.md, Part 1. Fixed Sep 25: the GRIN furnaces (lenses rendered
black: a region/material id mix-up) and softbeam-wall (an under-sampled check). The Sep 25
sweep passed 180 of 181 exact checks (only cube-cloud).

## Design authority

Read the relevant document before designing in its area. Where the code and a document
disagree, the code is what runs — flag the disagreement.

| Document | Governs |
|---|---|
| docs/fable-strategy-taxonomy.md | the meaning of measurement / estimator / view (pinned) |
| docs/trace-loop-contract.md | the top-level loop and its types; overrides fable-compiler-contracts §5 and §6.3 |
| docs/fable-compiler-contracts.md | compiler work generally, where the trace-loop contract doesn't override it |
| docs/fable-components.md | the component library: families, the one-folder rule, the transport anatomy |
| docs/fable-module-anatomy.md | descriptor and property-schema shapes |
| docs/fable-reference-implementations.md | normative GLSL for the core models — transcribe, don't re-derive |
| docs/fable-validation-scenes.md | the validation scenes and their derived values |
| docs/fable-transport-verification.md | why innermost-wins, no medium stack, null interfaces — read before "fixing" them |
| docs/fable-volumetric-component.md | the media seams; overrides reference-implementations §5 on media |
| docs/fable-heterogeneous-media.md | heterogeneous media |
| docs/fable-transforms.md | placement |
| docs/fable-data-rail.md | the shared data textures |
| docs/fable-sdf-contract.md | how SDF objects work |
| docs/fable-light-bvh.md | the light tree |
| docs/compiler-engine-contract.md | the locked compiler↔engine types |
