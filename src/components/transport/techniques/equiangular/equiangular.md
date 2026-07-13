# Equiangular medium NEE — the mathematics

*(Occupant math doc — facts about THIS technique only. Source: Kulla & Fajardo,
"Importance Sampling Techniques for Path Tracing in Participating Media", EGSR 2012;
plan: `docs/impl-plan-equiangular.md`.)*

## The term being estimated

The per-segment direct in-scatter integral of the RTE, for a segment (o, d, t_max)
through a scattering medium:

$$\int_0^{t_{max}} T(0,t)\; \sigma_s\; \rho(\omega_L(t), -d)\; L_{direct}(t)\; dt$$

For a delta light of intensity I at position L, $L_{direct}(t) = V(t)\, I / d^2(t)$
with $d(t) = \|L - (o + t d)\|$ — the integrand is peaked at the ray's closest
approach by $1/d^2$, and **transmittance-based placement is blind to that peak**:
sampling t ∝ T(0,t) puts vertices where the fog is, not where the light is. That
mismatch is the classic spike noise near lights in fog.

## The placement

Parametrize by the angle subtended at the light. With $D = L - o$,
$t_c = \langle D, d\rangle$ (closest approach), $h^2 = \|D\|^2 - t_c^2$:

$$\theta(t) = \operatorname{atan2}(t - t_c,\, h), \quad \theta_a = \theta(0),\ \theta_b = \theta(t_{max})$$

Draw θ uniformly in [θ_a, θ_b]:

$$t = t_c + h \tan\theta, \qquad p(t) = \frac{h}{(\theta_b - \theta_a)\,\big(h^2 + (t - t_c)^2\big)}$$

Since $d^2(t) = h^2 + (t - t_c)^2$ **exactly**, the estimate becomes

$$\frac{T(0,t)\,\sigma_s\,\rho\; I/d^2\; V}{p(t)} = T(0,t)\,\sigma_s\,\rho\, I\, V\;\frac{\theta_b - \theta_a}{h}$$

— the $1/d^2$ is cancelled identically; the remaining factors are bounded (T ≤ 1,
ρ bounded, V ≤ 1). The closed-form CDF $(\theta(t)-\theta_a)/(\theta_b-\theta_a)$
is what the twin test uses for exact expected counts (`equiangular.test.ts` — numeric
integration under-resolves the near-axis spike and fails spuriously).

Edge cases the atan2 form handles: light behind the segment start (θ_a > 0... both
angles negative-side), light past the end, unbounded t_max (θ_b → π/2). Light on the
ray line: h² clamped ≥ 1e-8.

## Estimator bookkeeping (why the swap is unbiased)

The per-segment estimate REPLACES the at-vertex NEE estimate — both are unbiased
estimators of the same segment term, run once per segment in expectation (the vertex
placement scores at the transmittance-sampled scatter vertex; that vertex exists with
the segment's scatter probability, and its estimator carries the matching weights).
The continuation path (transmittance sampling, phase draw, carried record) is
untouched: this is a pure T2 placement change, `estimator` section, variance-only —
the haze pt-nee / pt-nee-eq §11.2 equality is the witness.

Runs with **segment-start throughput, before `medium_sample`**, independent of whether
the transmittance sample scatters — that independence is the technique's point (a
segment that passes through un-scattered still contributes its direct in-scatter).
σ_s appears explicitly (this estimate rides no `medium_sample` weight); T(0,t) is the
analytic homogeneous form, matching the `volumeSampling: 'analytic'` axis.

## V1 pins and their exits (Validator-enforced)

- **Delta lights only** — equiangular needs the light position BEFORE choosing t; the
  area samplers are solid-angle-from-p. Exit: p-independent area arms on the light
  descriptors.
- **nee only** — the emitter-hit power heuristic assumes T2 samples directions from
  the previous vertex; equiangular samples (t, light) in a different measure.
  Placement-MIS (and MIS against transmittance placement, the production pattern for
  thick media where T(0,t) matters more than 1/d²) is a designed-later batch.
- **Euclidean** — t_c and h are extrinsic distances (like the analytic medium bodies).

## Measured behavior (haze witness, July 2026)

Equality: vertex vs equiangular means 0.50% apart at ~20spp. Halo-core noise −19%
(display-space, ~4spp). The win is localized to rays passing near the light and grows
as single scattering dominates — haze is albedo-≈0.95 multiple-scatter-heavy, which
placement cannot help; thin media with small bright lights show much more.
