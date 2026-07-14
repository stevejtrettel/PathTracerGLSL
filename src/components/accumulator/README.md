# accumulator/ — Monte-Carlo sample accumulation

**Taxonomy:** **estimator** — the outer `(1/N) Σ` of Monte Carlo (+ its instrumentation).
**Kind:** pick-one. `estimator.accumulation.type` selects the occupant.

Occupants: `average/` (plain unbiased mean — today's default), `variance/` (Welford;
mean byte-identical to `average`, a second MRT attachment = per-channel sample variance,
`variance` export target), `oneshot/` (non-accumulating live preview — writes
`fragColor = color` each frame, never reads history). Exponential moving average is
reserved.

## The sorting rule (where the accumulation zoo goes)

Does it change what the number converges to, how fast, or only how it's shown?
- Plain average — estimator, unbiased, converges. `average/`.
- Exponential moving average — estimator, unbiased but non-convergent (variance floor);
  the interactive-preview occupant, reserved.
- Variance/moment buffers — estimator instrumentation (extra outputs): `variance/`
  (Welford; mean byte-identical to `average`, second MRT attachment = per-channel sample
  variance, `variance` export target).
- Firefly clamping / median-of-means — BIASED: never hides here; a declared measurement
  truncation in the bias ledger, like `shadows: 'opaque-dielectrics'`.
- Denoising — view (a display filter); the HDR export stays the raw estimator output.

## What accumulation occupants uniquely own

The frame-spanning state: the accumulation ping-pong buffers
(`accumulation_current/_previous` — reserved suffixes) and therefore the *pipeline* the
compiler generates, not just shader text. NOTE the export semantics: **HDR export reads
`accumulation_previous`** (post-frame swap — see `PipelineBuilder` before "correcting"
it).

## How the compiler consumes it

An occupant's `<id>.glsl` is the accumulation `main()` (the fragment that blends the new
sample with history). The Generator's `features/accumulation.ts` selects it by
`estimator.accumulation.type` and declares `u_sampleCount` / `u_pixelOffset`.
`accumulation` is validated in BOTH `Validator.ts` AND the feature — the glsl-compile
test caught a missed second gate once; keep both in sync when adding an occupant.

The downstream display transfer (tonemap curve → screen/PNG) is a SEPARATE family,
`tonemap/` (view). The shared `gl_VertexID` fullscreen-triangle vertex shader is
compiler-owned plumbing at `src/compiler/generate/glsl/fullscreen.vert.glsl` (every pass
uses it — main/display/bake), no longer a family-root file here.
