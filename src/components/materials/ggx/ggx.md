# GGX rough conductor — the mathematics

*(Occupant math doc — facts about THIS model only. Transcribed source:
`fable-reference-implementations.md` §7, normative. Fields: `f0`, `roughness`.)*

## The model

Microfacet BRDF with GGX (Trowbridge–Reitz) normal distribution, separable Smith
masking-shadowing, Schlick Fresnel:

$$f(\omega_i, \omega_o) = \frac{F(\omega_o \cdot h)\, D(h)\, G_1(\omega_i) G_1(\omega_o)}{4\,|\cos\theta_i|\,|\cos\theta_o|}, \qquad h = \frac{\omega_i + \omega_o}{\|\omega_i + \omega_o\|}$$

with, in the local frame (n = +z), α = roughness² clamped ≥ 1e-3:

- $D(h) = \dfrac{\alpha^2}{\pi\,(h_z^2(\alpha^2 - 1) + 1)^2}$ — normalized so
  ∫ D(h)·h_z dh = 1 over the hemisphere.
- $G_1(v) = \dfrac{2|v_z|}{|v_z| + \sqrt{\alpha^2 + (1-\alpha^2)v_z^2}}$ — Smith,
  height-uncorrelated separable form.
- $F(c) = f_0 + (1 - f_0)(1 - |c|)^5$ — Schlick; `f0` IS the conductor's color
  (no separate albedo — declaring both would double-tint).

Reflection-only: `eval` returns zero when `wi`/`wo` straddle the surface. The alpha
clamp is a pinned convention: letting α→0 produces fireflies, not a mirror — true
mirrors are a delta model (§3.1).

## Sampling: visible-NDF (Heitz 2018)

Sample the *visible* microfacet distribution $D_{\omega_o}(h) \propto G_1(\omega_o)\,D(h)\,|\omega_o\cdot h| / |\cos\theta_o|$:
stretch the view by α, build an orthonormal basis around it, sample a projected disk
(with the hemispherical blend `s = (1+vh_z)/2`), unstretch. Reflect: $\omega_i = \mathrm{reflect}(-\omega_o, h)$.

- **pdf** (solid angle, through the half-vector Jacobian $1/(4|\omega_o\cdot h|)$):
  $p(\omega_i) = \dfrac{G_1(\omega_o)\, D(h)}{4\,|\cos\theta_o|}$.
  Side-symmetric by construction (G₁ uses |z|, D uses z²) — `ggx_pdf` needs no
  canonicalization and MUST equal `sample.pdf` (the §11.3 agreement).
- **The VNDF cancellation** — why `weight = F·G1(ωᵢ)` exactly:
  $$\frac{f\,|\cos\theta_i|}{p} = \frac{F D G_1(\omega_i) G_1(\omega_o)}{4|\cos\theta_i||\cos\theta_o|}\cdot|\cos\theta_i| \cdot \frac{4|\cos\theta_o|}{G_1(\omega_o) D} = F\,G_1(\omega_i).$$
  D, both cosines, and the Jacobian all cancel; the weight is bounded ≤ 1 — VNDF
  sampling cannot firefly from the D term.
- Samples reflected below the horizon (`wil.z ≤ 0`) are dead: weight 0, pdf 0.
- Side handling: canonicalize `wo` to the upper hemisphere with a `side` factor,
  undo it on the outgoing `wi` (avoids the `sign(0) = 0` hazard of the reference).

## Properties tests rely on

Reciprocity (f symmetric in ωᵢ↔ωₒ: h is shared, |ωₒ·h| = |ωᵢ·h| for reflection
pairs); the triple identity weight·pdf = eval·|cosθᵢ| (exact, float-noise only);
sample/query pdf agreement. All three + the χ² histogram over the spec grid live in
`ggx.test.ts` (the TS twin — line-for-line with `ggx.glsl`, change one change both).

## Witnesses

`veach-mis` (4 roughness × 3 light sizes; pt/pt-nee/pt-mis §11.2 equality; the power
heuristic's complementary failure regions are the visible signature). Known limits:
no multiple-scattering energy compensation (rough conductors darken slightly — the
classic single-scatter Smith loss; a future `E_ms` term is an occupant-local change).
