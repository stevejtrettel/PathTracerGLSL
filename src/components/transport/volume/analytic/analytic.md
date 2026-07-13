# Analytic volume sampling — what it computes and why

The v1 `volumeSampling: 'analytic'` bodies: homogeneous media have closed-form
transmittance, so distance sampling and shadow attenuation need no marching.
Normative source: fable-volumetric-component §4 (supersedes reference-impl §5's
medium lines).

`medium_sample_analytic(m, t_max, xi)` — the per-segment decision "scatter at t, or
survive to the boundary":

- Distance drawn from ONE uniformly-selected channel's exponential
  (`t = −log(1−ξ)/σ_c`), then weighted by the **balance heuristic over all three
  per-channel pdfs** — pbrt-v3's chromatic scheme (owner decision: bounded weights,
  NOT the σ̄-ratio scheme). Scatter branch: `weight = σ_s·T(t)/pdf` with
  `pdf = ⅓Σ_c σ_c e^{−σ_c t}`; survive branch: `weight = T(t_max)/pdf` with
  `pdf = ⅓Σ_c e^{−σ_c t_max}`.
- Grayscale degeneracy: scatter weight → σ_s/σ_t (single-scatter albedo), survive
  weight → 1 — the §7.2 "no weight on survival" pin is the special case.
- `ms.radiance = SPECTRUM_ZERO` is mandatory (the §3 RTE partition rule: emission is
  a separate capability, not implicitly bundled into sampling).
- A zero channel gives t = ∞ → the survive branch handles it (the `max(σ_c, 1e-9)`).

`medium_transmittance_analytic(m, len)` — seam 2, the per-segment factor the shadow
walker multiplies: exact Beer–Lambert `exp(−σ_t·len)` over FULL extinction
(absorption + out-scatter — the standard shadow approximation). Residual ratio
tracking degenerates to exactly this for homogeneous media, so the heterogeneous
upgrade is a strict superset. Caller clamps `len` finite (inf × 0 = NaN, pbrt note).

Witnesses: slab (exact Beer–Lambert numbers per channel), F-BOX-M (0.4/channel —
catches the channel-MIS weights), fogcube (absorbing-only, no rim).
