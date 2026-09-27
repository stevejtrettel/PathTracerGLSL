# Equirect chart — what it computes and why

The lat-long parametrization of direction space: `equirect_uv(dir)` (equirect_map.glsl)
maps a direction to `(φ/2π + ½, θ/π)` with θ = acos(y) (v = 0 at the +Y pole), and the
chart's `env_chart_uv` is that mapping; `env_chart_dir(uv)` (equirect.glsl) inverts it.
The radiance lookup uses this mapping regardless of the sampling chart. The sampler
selects a CDF cell, then `env_chart_sample` chooses azimuth uniformly and cos(theta)
uniformly between its row edges. The exact cell area is
`(2π/W) * 2 sin(π(j+1/2)/H) sin(π/(2H))`, a stable form of the cosine difference.
The density is the stored CDF cell mass divided by this area. The CPU's midpoint
sine weights are only an importance heuristic; they do not define the directional PDF.

Within-cell sampling uses squared half-angle coordinates to retain the transverse
direction near a pole. The inverse uses `atan(length(n.xz), n.y)`, preserving small
polar angles even when the axial component rounds to ±1.

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
