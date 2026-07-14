# Progressive average — what it computes and why

The outer sum of Monte Carlo: the converged pixel is E[sample], and this occupant
maintains the running mean incrementally — `main()` draws ONE new path estimate per
frame and folds it in as `mix(previous, color, 1/(n+1))`, the numerically stable
running-average update (algebraically identical to (n·prev + new)/(n+1)).

What the code pins:

- `rng_init(uvec2(pixel), sampleCount, resetSalt)` — the seed uses the GLOBAL pixel
  (`gl_FragCoord + u_pixelOffset`), so tiled production renders don't replay the same
  stream per tile; `sampleCount` advances the stream within a render; `resetSalt`
  decorrelates across resets (§2.11).
- `u_sampleCount == 0` writes the sample directly (no stale `previous` read on a
  fresh accumulation).
- The ping-pong: reads `u_previous` = `accumulation_previous`, writes
  `accumulation_current`; the engine swaps after the frame. **HDR export therefore
  reads `accumulation_previous`** — post-swap it holds the newest resolved mean (see
  PipelineBuilder before "correcting" it).

Estimator section: unbiased and convergent (variance ∝ 1/n). The reserved siblings
sort by the same rule — exponential average (unbiased, non-convergent: the
interactive-preview trade), variance/moment buffers (instrumentation); anything
biased (clamping) is NOT an accumulation variant but a declared measurement
truncation.
