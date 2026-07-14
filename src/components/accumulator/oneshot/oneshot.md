# Oneshot (non-accumulating) — what it computes and why

The estimator's outer average, turned off: instead of `mix(previous, color, 1/(n+1))`, each
frame writes the current sample directly (`fragColor = color`). So the image does NOT
converge — it live-updates as a noisy preview, one frame = one (or a few) samples. Useful
for real-time interaction, animation, and debugging where you want the *current* frame, not
a running mean.

It reuses the standard accumulation pipeline unchanged (the ping-pong `accumulation_*`
buffers; display reads the swapped buffer) — it just never reads `u_previous`. `u_sampleCount`
still increments each frame, so the RNG stream advances and the grain animates rather than
freezing. The seed contract (`rng_init(pixel, sampleCount, resetSalt)`) is identical to the
accumulating occupants; only the write differs.

Taxonomy: estimator, like the other accumulation occupants — but note it is *non-convergent*
by construction (it reports the current sample, not the limit). Distinct from the reserved
`exponential` occupant, which blends past frames with a decay `alpha` (a variance-floored
moving average); `oneshot` keeps no history at all.
