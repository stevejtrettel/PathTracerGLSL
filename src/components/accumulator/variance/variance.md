# Progressive mean + variance — what it computes and why

The `average` occupant plus estimator instrumentation: alongside the running mean
(attachment 0, byte-identical update — the mean is NOT touched by instrumentation,
which is this occupant's witness), a second render target accumulates the per-channel
**population variance of the path samples**, v_n = M₂/n, via Welford's algorithm.

## The update

With n = samples already accumulated (u_sampleCount) and x the new sample:

- mean′ = mean + (x − mean)/(n+1)                    — same as `average`
- v′    = v + ((x − mean)·(x − mean′) − v)/(n+1)     — Welford, normalized by count

Both are the `mix(prev, new, 1/(n+1))` running-average shape. Storing v = M₂/n
instead of the raw M₂ keeps the stored magnitude bounded (M₂ grows linearly with n,
which erodes fp32 precision at high sample counts); the recurrence follows from
M₂′ = M₂ + δ·δ′ by dividing through by n+1.

**Why Welford and not E[x²] − mean²:** the naive second-moment form cancels
catastrophically in fp32 precisely where variance instrumentation matters most —
nearly-converged pixels, where E[x²] and mean² agree to more digits than the
mantissa holds. The δ·δ′ cross product never subtracts two large near-equal numbers.

## What readers get

- v = attachment 1 (`readBuffer('accumulation_previous', 'float', 1)` post-swap, or
  the `variance` export target) — population variance of the SAMPLE stream.
- Unbiased sample variance = v·n/(n−1).
- **Variance of the accumulated mean** (the pixel's remaining error): ≈ v/n.
  Readers divide — they know n (`engine.sampleCount`). Per-pixel σ of the image
  is sqrt(v/n): this is the number estimator-comparison figures quote at equal spp.

## Contract position

Estimator section, like all accumulation occupants: it changes HOW the integral is
computed (adds instrumentation), never WHAT converges — the mean must equal
`average`'s mean exactly (same RNG stream, same update). Anything biased (clamping)
is NOT an accumulation variant but a declared measurement truncation (family README).

The moment buffer is the second attachment of the SAME `accumulation` double_buffer
(MRT), so one swap flips mean and moment together — they cannot desynchronize. The
pipeline branch lives in `Planner.planPipeline`; the dual `layout(location=…)` outs
are emitted by the ShaderBuilder header when this occupant is selected.
