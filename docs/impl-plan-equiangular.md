# Equiangular medium NEE — the first new technique through the door

**Author:** Fable (July 2026) · **Status:** BUILT (July 13 2026, same session as the plan)
**Results:** the anatomy test PASSED — outside the new files (equiangular.{glsl,ts,test.ts}),
the diff is glue of a few lines each; no existing static .glsl changed. Twin harness: χ² green
across all six geometries (expected counts via the closed-form CDF — numeric integration
under-resolves the near-axis spike), pdf normalization exact, sample/query pdf agreement 1e-9.
GPU (headless, SwiftShader): vertex vs equiangular means 0.50% apart at ~20spp (the §11.2
equality); both ≥ pt by the delta-light term; lamp-halo CORE noise −19% display-space at
~4spp (mean |A−B| over independent runs, glow-centered disk). The win is real and localized
exactly where the theory says; it is tempered here by the scene (single-scatter albedo ≈ 0.95
→ multiple scattering dominates) and by tonemapped-display measurement — thin media and HDR
comparison show more. Converged equality = owner's standing check. Bring-up also fixed a
StatsPanel identity bug: the renderer label truncated to two dash-segments, displaying
'pt-nee-haze' and 'pt-nee-eq-haze' identically — full id now shown.
**Authority context:** `fable-components.md` §7 (technique anatomy), `fable-transport-glsl-target.md`
(static-file rules), `fable-strategy-taxonomy.md` (the new field's section), `fable-volumetric-component.md`
(the RTE partition this technique re-estimates).

## 1. The math (Kulla–Fajardo 2012)

The per-segment direct in-scatter term of the RTE is
∫₀^tmax T(0,t) · σ_s · phase(ω_L(t), −d) · L_direct(t) dt.

Today's estimator places the vertex by **transmittance** (the scatter vertex from
`medium_sample` does double duty: continuation AND the NEE site). Transmittance
sampling is blind to where the light is — for a small/point light the integrand is
peaked at the ray's closest approach by 1/d²(t), so noise near lights in fog is brutal.

**Equiangular sampling** places the direct-lighting vertex by the *angle subtended at
the light*: with D = L − o, t_c = ⟨D, d⟩ (closest approach), h² = |D|² − t_c²,

- θ(t) = atan2(t − t_c, h),  θ_a = θ(0),  θ_b = θ(t_max)
- draw θ = mix(θ_a, θ_b, u) →  **t = t_c + h·tan(θ)**
- **pdf(t) = h / ((θ_b − θ_a)(h² + (t − t_c)²))**  ∝ 1/d²(t) — cancels the peak exactly.

Contribution (delta light, §6.1 convention: intensity WITHOUT 1/d²):
`throughput · T(0,t) · σ_s · hg_eval(ω_L, −d) · (I/d²) · vis / (pdf_t · pdf_select)`.
T(0,t) = exp(−σ_t·t) analytically (homogeneous, per the volumeSampling='analytic' axis).

**Unbiasedness of the swap:** both placements estimate the SAME segment term; the
continuation path (transmittance-sampled scatter vertex, phase draw, carried record)
is untouched. This is a pure estimator-axis change — variance only.

## 2. The strategy axis (taxonomy: estimator, variance-only)

`estimator.mediumLightSampling?: 'vertex' | 'equiangular'` — default `'vertex'`
(today's behavior: NEE at the transmittance-sampled scatter vertex). `'equiangular'`
moves T2's medium estimate to a per-segment site with equiangular placement.
Meaningful only when `directLighting ≠ 'none'` ∧ scattering media exist (Validator
warns otherwise, the C5 silent-inert rule).

## 3. V1 scope pins (constraint-driven, each with its exit path)

1. **Delta lights only.** Equiangular needs the light's *position before choosing t*;
   our area-light samplers are solid-angle-from-p samplers (position-dependent).
   Scenes with samplable AREA lights or a samplable environment under 'equiangular'
   are Validator-REJECTED (reject-not-degrade). Exit: p-independent area arms on the
   light descriptors (uniform-area point + area pdf) — deferred table.
2. **nee only; `mis × equiangular` is reserved-rejected.** The emitter-hit power
   heuristic assumes T2 samples directions from the previous vertex; equiangular
   samples (t, light) — a different measure. Correct placement-MIS (and MIS between
   the two placements, the production pattern) is real math with its own batch.
   With v1's delta-only lights nothing is BSDF-hittable, so the binary NEE partition
   is exactly correct as-is — the combiner is untouched.
3. **Homogeneous media** (T(0,t) analytic) — matches the existing media axis; the
   heterogeneous form rides the majorant work whenever that lands.
4. **Euclidean math** (t_c, h are extrinsic distances) — declared in the file header,
   like the analytic medium bodies. Curved-space equiangular is a research item.

## 4. The anatomy test — what lands where

| Piece | File | Kind |
|---|---|---|
| the technique math | `components/transport/techniques/equiangular.glsl` | **NEW static file** |
| its glue (inclusion, requires) | `components/transport/techniques/equiangular.ts` | **NEW** |
| registry line | `techniques/index.ts` | 1 line |
| pdf twin harness | `techniques/equiangular.test.ts` | **NEW** (ggx.test.ts pattern: χ² of the t-sampler vs pdf) |
| light-position query `lighting_query_delta(uc, out pos, out intensity) → select_pdf` | generated by `lighting.ts` (it owns the CDF; positions are compile-time facts) | ~30 lines, emitted only under the knob |
| walk site: per-segment call replaces the at-event call | `integrators/pt.ts` (the roster in action) | ~6 lines |
| flags + program field + planner + strategy type | `flags.ts`, `plan/types.ts`, `Planner.ts`, `types.ts` | ~1 line each |
| Validator rules (mis-reject, non-delta-reject, inert-warn) | `Validator.ts` | ~15 lines |
| witness strategy + suite text | `mediaScenes.ts`, `scenes/index.ts` | small |

The measurement this batch exists to take: **everything outside the two new technique
files is glue of a few lines each.** If any existing static `.glsl` file needs an
edit, the seams are wrong (target-doc acceptance rule) — stop and fix the seam.

## 5. The walk-site semantics (the one structural decision)

The per-segment estimate runs **once per medium segment, before `medium_sample`,
using segment-start throughput** — it exists whether or not the transmittance sample
scatters (that independence is the technique's point). When 'equiangular' is on:
`light_medium.glsl` is NOT included, `combiner_w_light_medium` is NOT emitted, and the
walk emits `equiangular_sample_direct(s, med_mat, t_max)` at the segment site instead
of `light_sample_direct_medium(...)` at the event site. Absorbing-only media zero the
estimate through σ_s — no special case.

## 6. Witness (haze, the K-F textbook case)

`haze` gains a third strategy: keys 1 `pt-nee` (vertex), 2 `pt-nee-eq` (equiangular),
3 `pt`. Expected: **1 and 2 converge to the SAME image** (§11.2 — same integral, same
partition; divergence implicates the pdf algebra or the σ_s/T factors); **2 is
dramatically less noisy in the glow around the lamp** (the entire point); 3 differs by
exactly the delta-light term (unchanged from today's haze card). GPU checks: headless
mean agreement + noise ordering; converged equality is the owner's standing check.
The TS twin χ²-tests the t-sampler against its pdf across (t_c, h, t_max) configs,
including the near-axis clamp (h→0) and light-behind-segment (θ range signs).

## 7. Deferred (this batch's ledger)

- Area-light equiangular: p-independent area sampling arms on quad/sphere descriptors.
- Placement-MIS (equiangular × transmittance-vertex) and `mis × equiangular`.
- Heterogeneous T(0,t) via majorants; curved-space formulation.
- Identity-weight elision (inherited from the target-doc ledger, unrelated but adjacent).
