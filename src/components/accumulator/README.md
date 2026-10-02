# accumulator/ — Monte-Carlo sample accumulation

**Taxonomy:** **estimator** — the outer `(1/N) Σ` of Monte Carlo (+ its instrumentation).
**Kind:** pick-one. `estimator.accumulation.type` selects the occupant.

Occupants: `average/` (plain unbiased mean — today's default) and `oneshot/`
(non-accumulating live preview — writes `fragColor = color` each frame, never reads
history). Exponential moving average is reserved.

**Statistics** are recorded alongside a mode's pictures and never change them. Each mode's
descriptor lists the ones it supports; the strategy switches one on by its name, e.g.
`accumulation: { type: 'average', variance: true }`. `average` supports `variance`
(Welford; the mean byte-identical to plain `average`, a second MRT attachment holding the
per-channel sample variance, exported as `variance`), whose GLSL is in `variance/`.
`oneshot` supports none.

## The sorting rule (where the accumulation zoo goes)

Does it change what the number converges to, how fast, or only how it's shown?
- Plain average — estimator, unbiased, converges. `average/`.
- Exponential moving average — estimator, unbiased but non-convergent (variance floor);
  the interactive-preview occupant, reserved.
- Variance/moment buffers — estimator instrumentation (extra outputs): the `variance`
  statistic of `average` (Welford; mean byte-identical to `average`, second MRT attachment
  = per-channel sample variance, `variance` export target).
- Firefly clamping / median-of-means — BIASED: never hides here; a declared measurement
  truncation in the bias ledger, like `shadows: 'opaque-dielectrics'`.
- Denoising — view (a display filter); the HDR export stays the raw estimator output.

## What accumulation occupants uniquely own

The frame-spanning state: the accumulation ping-pong buffers
(`accumulation_current/_previous` — reserved suffixes) and therefore the *pipeline* the
compiler generates, not just shader text. NOTE the export semantics: **HDR export reads
`accumulation_previous`** (post-frame swap — see `pictureBuffer` in
`compiler/plan/pictures.ts` before "correcting" it).

## How the compiler consumes it

An occupant's `<id>.glsl` is a static **update rule** — the arithmetic that folds one sample
into one picture — and its descriptor names it (`update`). The accumulation `main()` is
generated (`features/accumulation.ts`) from the planned picture list: it traces one camera
sample, fetches each picture's previous value when the mode reads history, calls each
picture's rule in list order (the main picture first, so a statistic can read its new value),
and writes every picture to its output. The rules' signatures:

- a mode that reads history: `vec3 <mode>_update(vec3 previous, vec3 x, int n)`;
- a mode that does not: `vec3 <mode>_update(vec3 x)`;
- a statistic: `vec3 <stat>_update(vec3 previous, vec3 mainPrevious, vec3 mainNew, vec3 x, int n)`.

An AOV picture (`components/aov/`, listed in `measurement.aovs`) is updated by the mode's own
rule, with the AOV's sample in place of the traced color.

`n` is the number of samples already folded in (`u_sampleCount`); every rule must handle
`n = 0`, when the previous values are the just-cleared buffer. The type is validated in BOTH
`Validator.ts` AND the feature's backstop — keep both registry-gated when adding an occupant.

The downstream display transfer (tonemap curve → screen/PNG) is a SEPARATE family,
`tonemap/` (view). The shared `gl_VertexID` fullscreen-triangle vertex shader is
fixed plumbing at `src/glsl/shared/fullscreen.vert.glsl` (every pass
uses it — main/display/bake), no longer a family-root file here.
