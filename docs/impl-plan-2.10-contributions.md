# Implementation Plan — §2.10 Resource Contributions (step i)

**Author:** Opus (implementing Fable's pinned design, contracts §2.10)
**Status:** in progress (July 2026)

This is the build plan for the **pure `FeatureContribution` refactor** — step (i) of the
§2.10 block. It reorganizes the compiler so each feature owns everything it contributes
(shader code, defines, uniforms, parameters, textures) in one place, **with zero behavior
change**, proven by a byte-identical snapshot of the generated GLSL. Proving cases
(a) fov→uniform, (b) `MaterialProperty {param}`, (c) environment/`extern:` come *after*.

## Why (short version)
Today the knowledge of "what a feature needs" is scattered across four monoliths —
`Planner.planUniforms`, `ShaderBuilder.buildHeader`, `PipelineBuilder.buildParameters`,
`ShaderBuilder.buildPathtracerBlocks`. Adding a feature means editing all four, and
forgetting one silently drops the feature (review C5). This makes each feature
self-contained and makes declared-vs-wired validation structural. It's also the input
shape the transport-generator split (§10.1 item 9) consumes, so it must land first.

## Load-bearing invariant
The generated fragment-shader section order (GLSL requires declare-before-use):
```
header → uniform-decls → structs → rng → math → euclidean → sdf_primitives →
sdf-dispatch → raymarch → material-lookup → lambert → light-sampling →
camera_pinhole → path_trace → main_accumulate
```
The contribution collection order `[core, intersection, materials, lighting, camera,
transport, accumulation]` must reproduce this exactly. This is the ONE thing that must
match; the snapshot test guards it.

## Phases

### Phase 0 — Safety net first
Add `src/compiler/__tests__/generated-glsl.snapshot.test.ts`: compile
`cornellBox+cornellStrategy`, `minimalScene+minimalStrategy`, `minimalScene+directOnlyStrategy`;
snapshot via `toMatchSnapshot()`:
- both fragment shaders (`-main`, `-display`) as full strings,
- the flat `CompiledRenderer` surface: `uniforms` (order matters), `parameters`, `pipeline`, `exportTargets`,
- `sourceMaps` (block `origin` + line ranges — error-mapping is live and depends on provenance).

Run → records baseline, commit. This is the proof.

### Phase 1 — Type + merge
`src/compiler/generate/features/types.ts`:
```ts
interface FeatureContribution {
  blocks: ShaderBlock[];
  defines: Record<string, string>;
  uniforms: PlannedUniform[];
  parameters: Record<string, ParameterMetadata>;
  textures: PlannedTexture[];   // { name, source } — unused until proving case (c)
}
```
`mergeContributions(contribs, bag)`: concat blocks in order; `Object.assign` defines;
dedupe uniforms by name (identical→merge, conflict→`bag.error`); merge parameters by path.

### Phase 2 — One file per feature (verbatim code-motion)
`src/compiler/generate/features/{core,intersection,materials,lighting,camera,transport,accumulation,display}.ts`,
each exporting `contribute<X>(plan, bag): FeatureContribution`. Existing generators
(`generateSDFDispatch`, `generateMaterialLookup`, `generateLightSampling`, `buildCamera`,
`buildAccumulation`) move into their feature file.

| Feature | blocks | defines | uniforms | parameters |
|---|---|---|---|---|
| core | structs, rng, math, euclidean | — | u_resolution, u_time, u_resetSalt | — |
| intersection | sdf_primitives, *sdf-dispatch*, raymarch | — | — | — |
| materials | *material-lookup*, lambert(per model) | — | — | — |
| lighting | *light-sampling* (if NEE) | — | — | — |
| camera | camera_pinhole | TAN_FOV | u_cameraPosition, u_cameraTarget, u_imageSize | camera.position, camera.target |
| transport | path_trace | MAX_BOUNCES, ENABLE_NEE?, RR?+RR_START_DEPTH? | — | — |
| accumulation | main_accumulate | — | u_sampleCount, u_pixelOffset | — |
| display | tonemap_reinhard | — | *(unchanged in i-a — Phase 5)* | — |

(*italics* = generated-per-scene; roman = fixed `.glsl` file.)

### Phase 3 — Rewire orchestration
- `generate()` gains `const merged = mergeContributions(collectFeatures(plan, bag), bag)` up front
  (`collectFeatures` returns contributions in the load-bearing order above).
- `ShaderBuilder`: `buildPathtracerBlocks` → `[ buildHeader(program), uniformDecls(merged.uniforms + u_previous), ...merged.blocks ]`; `buildUniformDeclarations` iterates the merged uniforms (no per-feature `if`s).
- `PipelineBuilder`: `buildUniforms(merged.uniforms)`; delete `buildParameters` (use `merged.parameters`).
- `Planner`: delete `planUniforms`; drop `RenderPlan.uniforms`. Rest of plan unchanged.

**Refinement — defines stay in `buildHeader` for i-a (keeps it byte-identical).** The current
header emits defines transport-first (`MAX_BOUNCES … TAN_FOV`) while blocks are camera-before-transport;
no single contribution order reproduces both, so moving defines into contributions *now* would reorder
the header's `#define` lines (behavior-neutral but not byte-identical). So i-a moves only
**blocks + uniforms + parameters** and leaves `buildHeader(program)` intact. The `FeatureContribution.defines`
field exists but stays empty for now. The conflict **self-resolves**: once fov becomes a uniform
(proving case a), transport is the only feature emitting defines, so consolidating them then is
byte-identical with no ordering conflict.

### Phase 4 — Prove it
Snapshot test must pass **byte-identical**. Fix contribution order/formatting until it does.
Typecheck + full suite green. No GPU needed — identical GLSL ⇒ identical behavior.

### Phase 5 — (i-b) close the display-uniform hole
Route the display shader's `u_radiance`/`u_resolution` through `contributeDisplay` + the merged
uniform-declaration path instead of the tonemap template declaring them. Updates the snapshot by
exactly those display lines — review, confirm it's only moved declarations, accept. One live run
to confirm display still renders (this step *does* change output).

## Micro-decisions (settled)
1. `contributeCore` bundles structs/rng/math/euclidean + engine builtins — not split (they're not a swappable feature). Reversible.
2. Uniform `compute` field (`tan(fov/2)`) is NOT in step (i) — added in proving case (a) when fov goes live. Step (i) leaves fov baked as `TAN_FOV`.

## Scope guard
Step (i) = zero behavior change. No fov uniform, no `{param}` materials, no `extern:` textures,
no environment. Those are proving cases after this lands.
