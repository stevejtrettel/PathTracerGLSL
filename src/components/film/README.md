# film/ — accumulation and display

Two subfamilies with different taxonomy sections — kept together because both live at
the image plane:

| Subfamily | Taxonomy | Kind | Occupants |
|---|---|---|---|
| accumulation | **estimator** (the outer 1/N Σ of Monte Carlo) | pick-one | `accumulate_average/` (exponential, variance reserved) |
| tonemap | **view** (display only — applied to the converged linear HDR) | pick-one | `tonemap_reinhard/`, `tonemap_none/` |

`fullscreen.vert.glsl` (shared plumbing, family root): the `gl_VertexID` fullscreen
triangle every pass uses — no VAO.

## The sorting rule (where the accumulation zoo goes)

Does it change what the number converges to, how fast, or only how it's shown?
- Plain average — estimator, unbiased, converges. Today's occupant.
- Exponential moving average — estimator, unbiased but non-convergent (variance
  floor); the interactive-preview occupant, reserved.
- Variance/moment buffers — estimator instrumentation (extra outputs), reserved.
- Firefly clamping / median-of-means — BIASED: never hides here; a declared
  measurement truncation in the bias ledger, like `shadows: 'opaque-dielectrics'`.
- Denoising — view (a display filter); the HDR export stays the raw estimator output.

## What accumulation occupants uniquely own

The frame-spanning state: the accumulation ping-pong buffers
(`accumulation_current/_previous` — reserved suffixes) and therefore the *pipeline*
the compiler generates, not just shader text. NOTE the export semantics: **HDR export
reads `accumulation_previous`** (post-frame swap — see PipelineBuilder before
"correcting" it). Tonemap occupants are one function over the resolved buffer in the
display pass (`ShaderBuilder`).
