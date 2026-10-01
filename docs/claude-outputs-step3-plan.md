# Step 3: the Planner builds the picture list (outputs and accumulation plan)

**Date:** 2026-09-30
**Status:** Built 2026-09-30. Every prediction held; the results are in the CHANGELOG.
Part of `claude-outputs-accumulation.md` §1–§3 and §9. Baselines at commit `40b74d1`:
`.digest/step2-commit-frames`, and `.digest/step2c.json` with `.digest/step2c-keep`.

## Why

Today the fact "this program has a second output" is re-derived from the variance flag in
four places, and its names are separate literals in different files:
- the Planner's layout, inputs and outputs (`Planner.ts:695-728`);
- the Generator's boolean (`Generator.ts:22`);
- the ShaderBuilder's `fragMoment` declaration (`ShaderBuilder.ts:131-141`);
- the PipelineBuilder's `variance` export (`PipelineBuilder.ts:74-86`).

The accumulation feature declares the samplers from a fifth fact
(`features/accumulation.ts`). "Where is the newest value" is also written three times: in
the display input, the exports and the PNG recipe.

This step replaces all of that with **one planned list** and **one function**. It adds no
new pictures; that comes in step 6.

## The change

**1. Where each picture's facts come from.** These are declared as data, using today's
literal names so the generated text stays the same.
- **The main picture,** keyed by `measurement.response`, in a one-row table:
  `radiance → { name: 'radiance', output: 'fragColor', previous: 'u_previous' }`. The
  table lives in a new `src/compiler/plan/pictures.ts`, which also holds the list builder
  and the newest-value function.
- **A statistic:** its `AccumulatorStatistic` entry gains `picture: { name: 'variance',
  output: 'fragMoment', previous: 'u_previousMoment' }`. That replaces `readsMoment`: every
  picture reads its previous value exactly when the mode reads history
  (`readsPrevious`), which is one rule instead of two flags.

**2. The list.** `planPipeline` builds `PlannedPipeline.pictures`, in order: the main
picture, then the requested statistic. Each entry gets its attachment index. The list
lives in the planned pipeline, not in the `ProgramDescription`, because it is derived
from decisions already recorded there.

**3. Everything generated from the list:**

| Generated | From the list |
|---|---|
| The accumulation buffer's format | `'rgba32f'` for one picture (today's scalar form), an array for more |
| The path-tracer pass outputs | `accumulation_current` for one picture; `accumulation_current:i` in list order for more |
| The path-tracer pass inputs | one `previous` sampler per picture, **only when the mode reads history**. This removes the `u_previous` input the Planner hands `oneshot`, which it never declares (`Planner.ts:711-713`) |
| The previous-sampler declarations (accumulation feature) | the same entries, so the sampler declarations and the pass inputs come from one list |
| The fragment outputs (ShaderBuilder header) | `out vec4 fragColor;` for one picture (today's form); `layout(location = i) out vec4 <output>;` for more |
| The export targets | one per picture, named by the picture, read after the frame, with `attachment` omitted when 0; then `ldr` |
| The display input and the PNG recipe | the main picture's newest value: during the frame for the display, after the swap for the recipe |

**4. One newest-value function,** `pictureBuffer(picture, 'current' | 'previous')`. It
returns `accumulation_current` or `accumulation_previous`, plus `:i` when the attachment is
not 0. Every reference above calls it. The PipelineBuilder comment explaining why exports
read `_previous` moves onto this function.

**5. Removed:** the `variance` booleans in `Generator.ts`, `ShaderBuilder.buildShaders`,
`ShaderBuilder.buildHeader` and `PipelineBuilder.buildExportTargets`. Also the
hard-coded `'display-pass'` in `buildLdrRecipe`, which becomes the same role → id function
`buildPipeline` uses.

**6. New checks:**
- **The Generator rejects more than 4 pictures,** next to the sampler budget. WebGL2
  guarantees 4 draw buffers (expected, from the spec); today this is only caught at load
  time (`ResourceManager.ts:358-365`).
- **`validateCompiledRenderer` gains:**
  - pass outputs, pass inputs and export targets must use attachment indices within their
    buffer's formats (this replaces today's 0–7 warning);
  - `_current` and `_previous` only on a `double_buffer`;
  - the PNG recipe's pass and its output buffer must exist.

## Verification, with the prediction written first

**Prediction.**
- **Shaders:** text identical for every suite scene.
- **Renderer structure:** changes in exactly two places.
  - (a) Every `oneshot` renderer loses its path-tracer `u_previous` input (`cornell-oneshot`
    is the only suite scene with one).
  - (b) Every renderer with variance lists its exports as `radiance`, `variance`, `ldr`
    instead of `radiance`, `ldr`, `variance`. Only the key order changes.
- **Pictures:** every picture bit-identical.
- **Snapshots:**
  - `generated-glsl.snapshot` is unchanged. Its keys are sorted, and it has no oneshot
    case.
  - `program-description.snapshot` is unchanged, because the list lives in the planned
    pipeline.

1. `npx tsc --noEmit` clean; `npx vitest run` passes, with the new tests below.
2. **The digest** against step 2's commit. Only `rest` parts differ. A structural script
   (like step 1's) confirms that every differing part is equal to the old one once (a) and
   (b) are applied, and that nothing else differs.
3. **The frames:** 18 of 18 bit-identical, including the `oneshot` case, which is the
   runtime check for (a).
4. **A new table test of the planned pipeline,** over `average`, `average + variance` and
   `oneshot`. It checks:
   - the formats against the list;
   - the outputs in list order;
   - each previous sampler bound to `accumulation_previous[:i]`, present exactly when the
     mode reads history;
   - each export's buffer and attachment;
   - the display input during the frame, and the recipe input after the swap;
   - the `layout(location)` lines matching the outputs;
   - every pass input appearing as a sampler in that pass's shader.
5. **New validator cases:** an attachment beyond the buffer's formats; `_previous` on a
   `texture` buffer; a recipe naming a missing pass; more than 4 pictures (built by hand,
   since no strategy can request 5 yet).
6. **A minimal witness:** `npm run witness -- furnace` (about 10 seconds), for the
   variance renderer's exports at runtime.
7. **The literal search:** `git grep -n "fragMoment\|u_previousMoment\|=== 'variance'"`
   finds only the declared picture data and the variance GLSL.

## Not in this step

- The generated `main()` (step 4).
- AOVs (step 6).
- The display switch and saving (step 5).
- Moving `variance/variance.glsl`.
