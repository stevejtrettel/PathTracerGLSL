# Equirect chart — what it computes and why

The lat-long parametrization of direction space: `env_chart_uv(dir)` maps a direction
to `(φ/2π + ½, θ/π)` with θ = acos(y) (v = 0 at the +Y pole); `env_chart_dir(uv)`
inverts it. The chart Jacobian is dΩ ∝ sinθ — polar texels subtend less solid angle —
so the CPU CDF builder weights rows by sinθ and the sampler's pdf divides it back out.
This file owns ONLY the mapping; radiance bodies, CDF plumbing, and the two-stage
selection live in the compiler's environment feature.

Two conventions that are load-bearing:

- **Rotation asymmetry**: `env_chart_uv` ADDS `u_envRotation`, `env_chart_dir`
  SUBTRACTS it — the pair must be exact inverses or sample↔pdf and sample↔radiance
  silently disagree whenever rotation ≠ 0 (the reference hdri-importance.glsl had
  them BOTH adding — env-plan pitfall 1; the asymmetry is the fix, don't "repair" it).
- The φ seam at ±π wraps via the texture's REPEAT mode — no seam handling in code.

METRIC EXEMPTION (§5.3): raw trig on world directions is deliberate — the environment
lives on direction-space S², not in scene space.

The chart axis (`estimator.envSampler.chart`) is estimator-side: charts change where
CDF resolution is spent (equirect over-resolves poles), never the answer — X-CHART's
4-digit agreement against octahedral is the witness.
