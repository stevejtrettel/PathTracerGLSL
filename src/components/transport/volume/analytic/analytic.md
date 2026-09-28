# Analytic volume sampling — what it computes and why

The v1 `volumeSampling: 'analytic'` bodies: homogeneous media have closed-form
transmittance, so distance sampling and shadow attenuation need no marching.
Normative source: fable-volumetric-component §4 (supersedes reference-impl §5's
medium lines).

`medium_sample_analytic(m, t_max, xi)` — the per-segment decision "scatter at t, or
survive to the boundary":

- Distance drawn from ONE uniformly-selected channel's exponential
  (`t = −log(1−ξ)/σ_c`), then weighted by the **balance heuristic over all N
  per-channel pdfs** — pbrt-v3's chromatic scheme (owner decision: bounded weights,
  NOT the σ̄-ratio scheme). Scatter branch: `weight = σ_s·T(t)/pdf` with
  `pdf = (1/N)Σ_c σ_c e^{−σ_c t}`; survive branch: `weight = T(t_max)/pdf` with
  `pdf = (1/N)Σ_c e^{−σ_c t_max}`.
- Grayscale degeneracy: scatter weight → σ_s/σ_t (single-scatter albedo), survive
  weight → 1 — the §7.2 "no weight on survival" pin is the special case.
- `ms.radiance = SPECTRUM_ZERO` is mandatory (the §3 RTE partition rule: emission is
  a separate capability, not implicitly bundled into sampling).
- A zero selected channel survives to the boundary, including an exact zero random draw.
  It has no finite exponential event; the sampler assigns `t_max` directly.

`medium_transmittance_analytic(m, len)` — seam 2, the per-segment factor the shadow
walker multiplies: exact Beer–Lambert `exp(−σ_t·len)` over FULL extinction
(absorption + out-scatter — the standard shadow approximation). Residual ratio
tracking degenerates to exactly this for homogeneous media, so the heterogeneous
upgrade is a strict superset. Caller clamps `len` finite (inf × 0 = NaN, pbrt note).

`emission.glsl` supplies `medium_absorption_integral(sigma, len)` for the generated
homogeneous absorbing-emission arm. Per lane it returns
`integral_0^len exp(-sigma*s) ds`; the dispatcher multiplies by the resolved volume
emission coefficient. At zero extinction the result is exactly `len`, while path
attenuation remains exactly one. For optical depth `tau < 0.1`, a fourth-degree
Taylor polynomial evaluates `(1-exp(-tau))/tau` without cancellation; its omitted
term is at most `tau^5/720`. Larger depths use `(1-exp(-tau))/sigma` directly.
The helper is included for analytic emitting arms and the GRIN walker, which calls it
for per-step and boundary source collection. Emissive
scattering media use the tracking bodies, whose per-collision source collection
already fits the same `MediumSample.radiance` contract.

Witnesses: slab (exact Beer–Lambert numbers per channel), F-BOX-M (0.4/channel —
catches the channel-MIS weights), fogcube (absorbing-only, no rim), emit and
spectral-emit (source integrals), spectral-emit-vacuum (zero-extinction limit).
