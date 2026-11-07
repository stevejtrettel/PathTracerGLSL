# Compiler Generate stage: map and findings

Read-only survey, 2026-11-06, branch `claudeapp`. Paths are relative to /Users/stevetrettel/Code/PathTracerGLSL.

## 1. What the stage does (2-minute version)

`generate(plan, scene, strategy, bag)` (src/compiler/generate/Generator.ts) turns ONE renderer's
`RenderPlan` into a `CompiledRenderer`: two GLSL programs (`<rendererId>-main`, `<rendererId>-display`),
the pass/framebuffer pipeline, uniform bindings (with CPU `compute` closures), UI parameter
metadata, export targets, the LDR recipe and block-level source maps.

The main fragment shader is built from **feature contributions**. Each feature is a function
`contributeX(plan) → FeatureContribution`:

```
FeatureContribution = { feature, blocks: ShaderBlock[], defines, uniforms, parameters,
                        textures, provides: ProvidedSeam[], requires: string[] }
ShaderBlock = { origin: 'components/…/x.glsl' | 'generated:…', source }
```

`collectFeatures` (features/index.ts) calls them in a fixed order:
core → [generated interface header] → intersection → materials → lighting → pixel → camera →
environment → aov → transport (components/transport/integrators/pt/pt.ts) → accumulation.
`mergeContributions` (features/merge.ts) concatenates blocks/defines/parameters, dedups uniforms
and textures by name (conflict = error), and runs the **link check**:
- `seam-conflict` (error): two features provide one seam;
- `seam-missing` (error): a `requires` name nobody provides;
- `seam-unused` (warning): a provided seam nobody requires, unless `componentScoped`.

`ShaderBuilder.buildShaders` puts a generated header (version, precision, `out` per picture,
`#define`s) and the uniform/sampler declarations in front of the merged blocks, and builds the
display shader separately (not a feature: tonemap occupant + generated main). `ShaderIR.assembleBlocks`
joins blocks and records a line-range → origin map, used both by `ShaderErrorMapper` (GPU
error line → origin block, consumed by app/RendererManager.ts:369) and `ShaderProvenance`
(inserts `// ╔══ BLOCK:` markers, consumed by scripts/dump-shaders.ts).

Generator.ts also enforces two WebGL2 floors on the assembled output: ≤ 4 pictures (draw
buffers) and ≤ 16 samplers (regex over the assembled fragment source).

### Exact linkage, in one paragraph
"A generated function exists only if something calls it." Hand-written component files
(`?raw` GLSL imported into descriptors) are included **whole** when their occupant is present;
generated functions are emitted only when a Planner decision says a caller exists
(`ProgramDescription.materials.surfaceEval = lighting !== null`, `surfacePdf = mis`,
`media.mediumEval`, `intersection.anyQuery`, `environmentPdf`, `emitters.lightingPdf`, …,
Planner.ts:600–700). Each feature then (a) gates the block on that field, (b) separately lists
the seam in `provides` under the same condition, and (c) consumers list it in `requires` under
their own conditions (transport derives these from `flags(program)`, components/transport/flags.ts).
The interface header (features/index.ts:53–71) forward-declares every provided seam, so
cross-feature definition order stops mattering for seams; seam-unused is supposed to catch
gates that drift.

### How hand-written GLSL gets in
Each registry descriptor carries its GLSL text (`import x from './x.glsl?raw'`). Features push
`{ origin: \`components/<family>/<type>/<type>.glsl\`, source: d.glsl }` for the occupants present
(materials: one per model present; lights: per kind present; geometry: per primitive type
present; camera/pixel/sampler/sensor/ambient/accumulator: the selected one). Fixed contract
files (`glsl/core/*.glsl`) are imported directly by core.ts/intersection.ts. Static files call
program-dependent things only through *generated* functions with pinned names (e.g.
`combiner_w_light`, `kernel_record`, `light_query_surface`, `medium_emission`), the "static-file
rule" (pt.ts:27–29).

### How the transport loop is generated (components/transport/integrators/pt/pt.ts, 475 lines)
`contributeTransport(program)` reads `flags(program)` (nee, mis, media, scattering, nulls,
deflecting, transmission, dispersion, rr, equiangular, …) and emits, in order:
1. `light_query_surface` / `light_query_medium` constructors (policy for the light-selection
   context) — **unconditionally** (pt.ts:47, 125–141, provides at 84–85).
2. `struct PathState` + `path_state_init` — the union of fields the included parts need
   (kernel record fields; current_medium, null_crossings, eta_scale, wavelengths_collapsed).
3. `math_mis.glsl` (if MIS), the combiner bodies (combiner.ts: pt / pt-nee / pt-mis are three
   sets of bodies for `combiner_w_emitter/_env/_light[_medium]`), `kernel_record`.
4. Optional: `collapse_wavelengths`, `roulette`, `roulette_interior`, `shadow_crossings_left`.
5. Technique static files: kernel.glsl (+ kernel_phase.glsl), light.glsl (+ light_medium.glsl),
   equiangular.glsl — each technique's .ts lists its blocks and requires.
6. The walk, `transport_trace(Ray ray[, out vec3 aov_<name>…])`: a `for bounce ≤ N` loop whose
   body is assembled from `lines.push` under the flags (media segment + GRIN handoff + medium
   event; null interfaces; AOV capture at bounce 0; emitter-hit scoring; budget break; dispersion
   collapse; NEE; continuation; medium tracking; η² bookkeeping; RR; spawn).
Defines: `MAX_NULL_CROSSINGS`, `RR_MAX_SURVIVAL`. Provides: `transport_trace` + the two
light-query constructors. Requires: walkRequires ∪ kernelRequires ∪ lightRequires ∪ equiangularRequires.

The `accumulation` feature writes `main()`: seed RNG, `pixel_sample`, `wavelengths_sample`,
`camera_generateRay`, `transport_trace`, `color_to_pixel`, then fold every planned picture with
its static update rule; it `requires` exactly those roots, so reachability starts there.

## 2. File map (line counts)

| File | Lines | Role |
|---|---|---|
| Generator.ts | 91 | entry: merge features, build shaders, floors check, pipeline, uniforms (+ display's u_resolution/u_picture bindings), exports, LDR recipe, source maps |
| PipelineBuilder.ts | 91 | plan.pipeline → engine RenderPipeline (role→shader id, extern textures joined to the pathtracer pass), uniform bindings (default compute = param lookup), export targets, LDR recipe |
| ShaderBuilder.ts | 232 | main fragment header/uniform decls + merged blocks; display shader (tonemap curve occupant, views, dither, picture choice by `u_picture`) |
| ShaderIR.ts | 87 | ShaderBlock, assembleBlocks (block line map), lookupLine |
| ShaderProvenance.ts | 32 | insert BLOCK markers for dumps |
| ShaderErrorMapper.ts | 116 | parse GPU info log, map lines to origin blocks → DiagnosticBag |
| color.ts | 59 | emitSpectrum / emitIndex: a spectrum value's GLSL via its *kind* (components/color/spectra), RGB programs show named kinds by RGB stand-in |
| values.ts | 201 | THE constant-vs-driven split: `emitValue` (literal / `u_` uniform / expression / per-instance attribute fetch), `mintValueUniform` (uniform + slider metadata; named kinds; RGB stand-in uniforms hashed by FNV-1a) |
| schema.ts | 83 | structs from descriptor rows; union of property fields across models present (`MaterialProperties`, `MediumProperties`) |
| records.ts | 114 | table-dispatch analytic/SDF record pack (App side) and GLSL reader `<type>_from_record` (shader side) |
| features/types.ts | 66 | FeatureContribution, ProvidedSeam, PlannedTexture |
| features/merge.ts | 129 | merge + link check |
| features/index.ts | 71 | feature order, interface header |
| features/core.ts | 132 | color model types, structs, generated property structs, interaction, sampler (pcg4d), spectrum, math, media math, color support, wavelength sampler, sensor, color model, ambient occupant, ray, spectrum-kind helpers, microfacet |
| features/intersection.ts | 1728 | primitives (closed-form & marched SDF arms), meshes (BLAS), instances (TLAS), table dispatch (scene TLAS with analytic/SDF records), placements, `scene_intersect[_any]`, `scene_region_at` (innermost-wins), `material_of`, `ior_of`, dispersion predicate |
| features/materials.ts | 954 | material lookup, model includes, surface interaction dispatch, guards (nondelta, two-sided, emissive), albedo dispatch; all medium codegen (tables, properties, ior_at, medium_sample/transmittance/survival/emission, phase dispatch) |
| features/lighting.ts | 940 | NEE: shadow query (opaque/media), light structs + per-kind files, accessors or light-tree loaders/walks, selection CDF (+ driven arrays), `lighting_sample`, `light_of`, `lighting_pdf`, equiangular delta query, env-selection probability |
| features/environment.ts | 252 | constant / image / procedural / none skies: radiance body, optional sampler and pdf, CDF textures |
| features/camera.ts | 161 | camera occupant + always-live pose/basis/fov/aspect uniforms (closures) |
| features/accumulation.ts | 90 | generated main(), previous-frame samplers, update-rule includes |
| features/pixel.ts / aov.ts | 21 / 21 | box footprint; AOV occupants |
| components/transport/integrators/pt/pt.ts | 475 | the generated walk (see above) |
| components/transport/{flags,combiner}.ts, techniques/*/ *.ts | 47 / 109 / ~130 | flags from the link map, MIS combiner bodies, technique block/requires lists |

Generated shader size (dumped sample, stale — see F14): ~2,350 GLSL lines / 64 blocks for a
pt-mis scene with spheres, a plane, quads, a mesh, instances, a light tree and an image sky.

## 3. Readability of the generated shaders

Sampled `generated-shaders/rgb-mis-emitB-main.frag.glsl` (dumped Sep 28; git-ignored, local).
- Good: the dump opens with a table of contents (the interface header); every block is tagged
  with its origin and line range; the walk for pt-mis is ~20 lines and reads like pbrt's
  integrator loop; material lookups are flat `if (id == k)` blocks with baked literals; the
  surface dispatch for a single-model scene collapses to direct calls.
- Noise: comment-heavy static files (history references, § numbers); some generated filler, e.g.
  `d = 1.0e20; if (d < 0.0 && d > best) {...}` for thin/unbounded regions in `scene_region_at`;
  `light_query_medium` present in media-free programs (F1).
- The *generator source* is harder to read than its output: GLSL is written as `lines.push('…')`
  strings interleaved with flag tests; comment density 25–30 % (intersection 471/1728,
  materials 251/954, lighting 226/940 comment lines) with ~100 batch tags (T4, R2, A1, D2, C5, E2…)
  across the stage.

## 4. The open defect: `light_query_medium` provided with nothing requiring it

Measured (vite-node script in this scratchpad, `seams.ts`, compiling every synchronous suite
scene with its declared strategies): **229 of 274** scenes warn; `light_query_medium` is the
**only** seam that triggers `seam-unused` anywhere in the suite. (CLAUDE.md's "221 of 265" is
the same defect on an older suite.)

Cause (checked by reading):
- pt.ts:47 always emits `lightQueryFns(f)`, which always defines both constructors (pt.ts:125–141),
  and pt.ts:84–85 always provides both.
- The only `requires` of `light_query_medium` are kernelRequires when `f.scattering`
  (kernel.ts:73) and lightRequires when `f.scattering && !f.equiangular` (light.ts:32–33).
- So every program without scattering media warns. The 45 scenes that don't warn are exactly
  the scattering-media scenes (fog, haze, slab-albedo, het-*, grin-scatter, emit-scatter, …).
- Second, hidden, half: the walk itself calls `light_query_medium(ms.exit_p)` in the GRIN
  handoff (pt.ts:358, emitted when `f.deflecting`), but `walkRequires` (pt.ts:98–112) does not
  list it. In 23 GRIN renderers without scattering (grin, grin-vacuum, maxwell, rough-grin,
  spectral-grin*, guides-grin-*) the function IS called, yet the warning fires — a false
  positive. A naive fix that gates the constructor on `f.scattering` alone would delete a
  function those 23 programs call (and glslang in the test suite would NOT catch it — see F3).
- History: the constructors and their unconditional provides came in commit d6f3f0b
  (2026-08-10, light BVH stages), after seam-unused existed (exact-linkage, July). The warning
  is not asserted by any test (no test file mentions `seam-unused`; only the diagnostics
  snapshot contains the message text), so it went unnoticed.

Likely fix (thought-through-not-checked): emit and provide `light_query_medium` iff
`f.scattering || f.deflecting`; add it to `walkRequires` under `f.deflecting`. Then decide
whether a test should assert zero `seam-unused` over the suite.

## 5. Findings index
See the structured result (F1–F15). Key themes:
- The provides/requires/Planner-decision bookkeeping is written by hand in three places per
  seam; F1 is one drift; F2/F4 propose deriving it.
- The static compile test can't see the drift the interface header can hide (F3).
- Some decisions are still made (and repeated) in the generator (F5, F6, F7).
- Euclidean assumptions live in seam signatures and generated intersection code (F9).

## 6. Neighbors
- Upstream: `RenderPlan` / `ProgramDescription` (compiler/plan/types.ts, Planner.ts) — every
  gate the generator reads. `dataTenants.ts`/`placeScene` give data-texture bases baked into
  generated readers.
- Components: descriptors and GLSL from every registry; transport's generator lives in
  components (pt.ts), imported directly by features/index.ts (INTEGRATORS registry unused, F8).
- Downstream: Engine executes CompiledRenderer blindly; App's RendererManager maps GPU errors
  through source maps; compiler/sceneData.ts uses records.ts packers.
