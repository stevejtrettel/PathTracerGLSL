# Equirect chart — what it computes and why

The lat-long parametrization of direction space: `equirect_uv(dir)` (equirect_map.glsl)
maps a direction to `(φ/2π + ½, θ/π)` with θ = acos(y) (v = 0 at the +Y pole), and the
chart's `env_chart_uv` is that mapping; `env_chart_dir(uv)` (equirect.glsl) inverts it.
The mapping has its own file because the image environment's radiance lookup reads its
equirect map through it whichever chart the sampler uses; the chart registry's `needs`
includes it wherever the equirect chart is. The chart Jacobian is dΩ ∝ sinθ — polar
texels subtend less solid angle — so the CPU CDF builder weights rows by sinθ and the
sampler's pdf divides it back out. This folder owns ONLY the mapping and the chart;
radiance bodies, CDF plumbing, and the two-stage selection live in the compiler's
environment feature.

Two conventions that are load-bearing:

- **Rotation asymmetry**: `env_chart_uv` ADDS `u_envRotation`, `env_chart_dir`
  SUBTRACTS it — the pair must be exact inverses or sample↔pdf and sample↔radiance
  silently disagree whenever rotation ≠ 0 (an earlier reference implementation had
  them BOTH adding — env-plan pitfall 1; the asymmetry is the fix, don't "repair" it).
- **u is wrapped into [0, 1)** (`fract`). Radiance lookups would survive an unwrapped u
  (the map texture uses REPEAT), but `environment_pdf` turns u into a CDF column index.
  Before the wrap, a rotation shifted u outside [0, 1), the index was clamped to the edge
  column, and the MIS pdf was read from the wrong column across a band of longitudes as
  wide as the rotation — pt-mis was biased under any nonzero rotation (fixed Sep 2026).

METRIC EXEMPTION (§5.3): raw trig on world directions is deliberate — the environment
lives on direction-space S², not in scene space.

The chart axis (`estimator.envSampler.chart`) is estimator-side: charts change where
CDF resolution is spent (equirect over-resolves poles), never the answer — X-CHART's
4-digit agreement against octahedral is the witness.
