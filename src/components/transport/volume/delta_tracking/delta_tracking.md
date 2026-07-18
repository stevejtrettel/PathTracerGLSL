# delta_tracking — the heterogeneous-media null-collision occupant

**Seams:** the delta-tracking arm of `medium_sample` (scattering media), the
ratio-tracked pass-through arm of `medium_sample` (absorbing-only media), and the
ratio-tracking arm of `medium_transmittance`. Constant/`{param}` media never route
here — they stay on the exact analytic bodies (`../analytic/`).

**Design authority:** `docs/fable-heterogeneous-media.md` (as amended Jul 17 2026).
**Build record + transcription table:** `docs/impl-plan-heterogeneous-media.md`.

## The idea (phantom fog)

Pretend the fog is everywhere at its ceiling density σ̄ — uniform fog you can sample
in closed form. Jump an exponential step in that fog; peek at the real (effective,
D1-clamped) density where you land; hold the paper's three-way lottery
(absorb / scatter / phantom). The odds cancel exactly for any ceiling — σ̄ is a pacing
knob, not a correctness knob. Shadow rays play the sibling game: same jumps, no
lottery, multiply the per-channel survival score (σ̄ − σ_t)/σ̄.

## The algebra is transcribed, not derived

Kutz et al. 2017, Algorithm 4 (spectral tracking) with the history-aware
average-based probabilities (Eq. 30–33) and the weight identity
w_⋆ = μ_⋆/(σ̄·P_⋆) (Eq. 15–16); ratio tracking per Novák et al. 2014 / pbrt-v4
`SampleLd`. Deviations are declared-and-inert only (no modified formulas) — the
table lives in the impl plan and in the `.glsl` header.

## Correctness gates

`F-HET-CONST` (constant-expression twin vs the analytic arm — same integrand, two
estimators), `F-HET-SLAB` (linear σ(z), closed-form numbers), `F-CLAMP` (the D1
definition as a twin equality), `HET-DRIVEN` (expression params at two points vs
baked twins).
