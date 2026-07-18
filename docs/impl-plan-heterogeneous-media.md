# Heterogeneous media — implementation plan (V0 → V2)

**Author:** Fable (July 17 2026) · **Status:** PLAN — implementation starting this session.
**Authority:** `fable-heterogeneous-media.md` **as amended Jul 17** (kickoff decisions:
clamp-in-the-lookup, the absorbing-only arm, transcribe-with-lottery). Seams:
`fable-volumetric-component.md`. Strategy sections: `fable-strategy-taxonomy.md`.
The trace-loop contract and the walk/PathState/combiner are UNTOUCHED (the mis/tally
batch is separate, owner-ordered).

The shape of the batch: two generated one-liners become four dispatch arms; everything
else is plumbing for one new input-language mechanism (`GlslExpression.params`) and one
new medium field (`majorant`). Existing scenes must compile **byte-identical** —
constant media never reroute.

## The 2×2 dispatch (amended D2)

| | constant / `{param}` coefficients | expression coefficients |
|---|---|---|
| **scattering** (σ_s may be nonzero) | `medium_sample_analytic` (unchanged) | **delta tracking** (transcribed lottery form) |
| **absorbing-only** (σ_s ≡ 0, authored constant) | deterministic Beer–Lambert (unchanged) | **ratio-tracked pass-through** (`{scattered:false, weight:T}` over σ_a) |

`medium_transmittance` likewise: constant → closed form (unchanged); expression →
ratio tracking. Classification is by *authored type* (an expression σ_s — even one
that evaluates to 0 — classifies as scattering; the existing `isScattering` in
`generate/features/materials.ts` already implements exactly this rule).

---

## V0 — plumbing (gate: tsc + full vitest, incl. the kitchen-sink extension)

1. **`GlslExpression.params`** (`compiler/types.ts:183`): optional
   `{ param: string; default: number; min?: number; max?: number }[]` (v1: float only).
   General to every expression property, not media-specific.
2. **`MediumDescription.majorant?: number`** (`compiler/types.ts:218`) +
   `PlannedMedium.majorant` (`plan/types.ts`), carried by `resolveMedium`
   (`Planner.ts:576`).
3. **Uniform minting**: each declared param rides the existing ValueParam path — the
   collect helper in `generate/features/materials.ts` (~L219) gains an
   expression-params walk: `paramToUniform(path)` uniform + `ParameterMetadata`
   (`type:'float'`, `triggersReset:true`, range from min/max, group from the material
   name). Dedup across shared paths as ValueParams already do.
4. **Validator** (design doc §2, all seven rules; sites `Validator.ts:297` media block,
   `:390` volumeSampling block, `:180` param-collision machinery):
   - expression coefficient without `majorant` → error (V1-C1 message updated);
   - `majorant` must be finite > 0; warn when all coefficients are constant (inert, C5);
   - `delta-tracking` × `directLighting:'mis'` → error (unknowable pdf — tally batch);
   - `delta-tracking` with no heterogeneous medium → warn; `analytic` WITH one → error
     (reject-not-degrade);
   - params: reserved prefixes + `paramToUniform` collisions + finite defaults + warn
     when a declared param's uniform never appears in the source (C5);
   - `raymarch`/`ratio-tracking` stay reserved-rejected; expressions on phase params
     stay rejected.
   - **Rule 8 (from the design-doc deferred ledger, enforced now):**
     `mediumLightSampling:'equiangular'` + heterogeneous medium present → error (its
     T(0,t) is the analytic closed form; the interplay is a deferred item).
5. **Analyzer**: `media.hasHeterogeneousMedia` fact next to the existing census
   (`Analyzer.ts:47–56`).
6. **Planner / link map**: `estimator.volumeSampling` accepts `'delta-tracking'`
   (strategy type at `compiler/types.ts:408` already reserves the word);
   `MediaDesc` (`plan/types.ts:82`) records the decision + a per-medium arm map
   (`heterogeneous: boolean` per planned medium is sufficient — the 2×2 column).
7. **Kitchen-sink**: the synthesized registry scene gains one heterogeneous medium
   (expression σ_s with a declared param + majorant) so glslang covers the new arms
   forever.

## V1 — loops (gate: glslang + snapshots; existing scenes BYTE-IDENTICAL)

1. **Transcription first**: fill §"Transcription & deviations" below — papers on the
   left (Kutz et al. 2017 / STAR §6.5.2 spectral tracking; pbrt-v4 VolPath collision
   handling; Novák et al. 2014 ratio tracking), our GLSL on the right. The deviations
   table may contain only declared-and-inert facts (emission branch empty; bound exact
   by D1; clamp upstream in the lookup) — **never modified formulas**. The same table
   is commented at the loop.
2. **The clamp in the lookup** (amended D1): `mediumPropertyExpr`'s throw-branch
   (`generate/features/materials.ts:391`) becomes a splice; expression-media branches
   of `scene_medium_properties` emit the D1 scale after assigning σ_a/σ_s:
   `u = max channel of (σ_a + σ_s); scale = (u > σ̄) ? σ̄/u : 1.0` (u = 0 → scale 1,
   no division guard needed with the ternary on floats — verify ANGLE-safe, scalars
   only, no struct ternary). Constant branches: zero emitted change.
3. **Occupant folder** `components/transport/volume/delta_tracking/`:
   `delta_tracking.glsl` (static math — the two loops as functions taking
   `(int med, float majorant, Ray ray, float len/t_max, vec2 xi)`, calling the
   generated `scene_medium_properties`; Euclidean `p(t) = origin + t·dir` declared in
   the header like the analytic bodies) + `delta_tracking.md` (the transcription
   record). Loops draw `random()` internally past the leading `xi` draws — the
   equiangular precedent; add the one contract line to
   `fable-volumetric-component.md` §2.
4. **Generated dispatch**: `generateMediumSample` / `generateMediumTransmittance`
   route per the 2×2 (majorant spliced as a `formatFloat` literal per arm).
   `MAX_NULL_COLLISIONS` numeric define, pin **64** (expected null collisions per
   segment ≈ σ̄·t_max — generous for tight majorants; exhaustion = conservative
   pass-through with accumulated weights, documented as a truncation beside
   `MAX_SHADOW_SEGMENTS`).
5. Include the occupant wholesale (contracts §2.12) gated on the link-map decision;
   provides/requires per the interface-header discipline.

## V2 — witnesses (owner runs the sweep)

Fixtures in `tests/witnesses/scenes/`, checks in `witnesses/index.ts` (gate policy per
its README). All four from design-doc §5:

| Witness | What it proves | Check kind |
|---|---|---|
| **F-HET-CONST** | `glsl('0.5')` + majorant (delta arm) ≡ authored `0.5` (analytic arm) — same integrand, different estimators. The sharpest gate of the build. | twin equality (Δ-mean + χ²) |
| **F-HET-SLAB** | linear σ(z) slab; optical depth closed-form → exact per-channel numbers derived in the fixture comment | mean |
| **F-CLAMP** | `glsl('2.0')` with `majorant: 1.0` ≡ authored `1.0` — the clamp IS the definition, proven for every consumer (clamp lives in the lookup) | twin equality |
| **HET-DRIVEN** | a declared slider in the formula at two parameter points ≡ baked twins (the `driven`/`driven-theta2` pattern) — the params machinery end to end | twin equality ×2 |

pt vs pt-nee convergence rides the same fixtures. An absorbing-only heterogeneous
check rides F-HET-SLAB (author it absorbing) so the ratio pass-through arm is gated
too. Haze-style demo card → `demos/` (churnable), after the sweep.

Then STOP. The mis/tally batch (pbrt-v4 r_u/r_l rescaled probabilities through
PathState + combiner) is the first follow-up, planned separately.

## Transcription & deviations (V1 step 1 — sources fetched and read July 17 2026)

Sources: **Kutz, Habel, Li, Novák 2017** ("Spectral and Decomposition Tracking for
Rendering Heterogeneous Volumes", TOG 36(4) §3.3–3.4/§5, Algorithms 1 & 4, Eq. 10,
15–16, 26–33) — the normative algorithm; **pbrt-v4** (`SampleT_maj` in ch. 14 + the
`VolPathIntegrator` collision branches and `SampleLd` ratio-tracking loop, fetched from
pbr-book.org and the pbrt-v4 repo) — the working cross-check; **Novák et al. 2018 STAR**
§6.5.2 Eq. 63 (which reprints Kutz's probability scheme). Verbatim fragments below.

### The published algorithm (Kutz Alg. 4, "spectral tracking"; ⊙ = per-channel)

```
ŵ ← (1,…,1)
loop:
  t ← −ln(1−ζ)/μ̄ ;  x ← x + t·ω
  if ξ < P_a(x):        return ŵ ⊙ μ̂_a(x)/(μ̄ P_a(x)) ⊙ L̂_e(x,ω)     — absorption/emission, path ends
  else if ξ < 1−P_n(x): ŵ ← ŵ ⊙ μ̂_s(x)/(μ̄ P_s(x)) ; real scatter (phase sample)
  else:                 ŵ ← ŵ ⊙ μ̂_n(x)/(μ̄ P_n(x)) ; null collision, continue
```

with the local-weight identity (Eq. 15–16): w_⋆(x_j) = μ_⋆(x_j)/(μ̄(x_j)·P_⋆(x_j)),
⋆ ∈ {a, s, n}, μ_n = μ̄ − μ_t. Collision probabilities: we use the paper's
**history-aware average-based** scheme (Eq. 30–33, their recommended variant — Fig. 10b
shows it bounds path throughput and is firefly-immune):

```
P_⋆ = avg_λ(|μ_⋆(x) ⊙ w(X_{j−1})|) · c⁻¹ ,   c = Σ_⋆ avg_λ(|μ_⋆ ⊙ w|)
```

where w(X_{j−1}) is the tracker's own accumulated weight (Alg. 4's ŵ — the product of
collision weights since THIS tracker invocation, per the paper's definition of the
already-built subpath). Segment boundary (our seam has t_max; pbrt's `SampleT_maj`):
sampled t past the end ⇒ transmitted; with a SCALAR majorant the residual majorant
transmittance is achromatic and pbrt's `T_maj/T_maj[0]` normalizations collapse to 1,
so the transmitted weight is exactly the accumulated ŵ.

**Transmittance (seam 2): ratio tracking** (Novák et al. 2014; pbrt-v4 `SampleLd`
verbatim: `T_ray *= T_maj * sigma_n / pdf` with `pdf = T_maj[0] * sigma_maj[0]` —
scalar-majorant collapse gives `T ⊙= σ_n/σ̄ = (σ̄ − σ_t)/σ̄`), with pbrt's
Russian-roulette termination transcribed: when max-channel T < 0.05, kill with
q = 0.75 else divide by 1−q (unbiased — the trigger is a heuristic, the compensation
is exact).

### Deviations table (declared-and-inert facts ONLY — no modified formulas)

| # | Deviation | Status |
|---|---|---|
| 1 | The absorption branch collects no emission (v1 media don't emit): its return is ŵ ⊙ σ_a·L_e/(σ̄·P_a) with L_e ≡ 0, expressed through the seam as `{scattered:false, t:t_max, weight:0, radiance:0}` — the walk carries a dead path to the boundary (RR reaps it). The branch, its probability, and its weight algebra are all present; fire later sets `radiance` (the seam's field exists for exactly this — §3 partition rule). | inert-by-value |
| 2 | The papers' \|·\| absolute values (Eq. 26–33) guard negative μ_n under non-bounding μ̄; by D1 the bound is exact (σ_t ≤ σ̄ by definition), so μ_n ≥ 0 and the \|·\| are identities. A `max(…, 0)` stays in GLSL for floating point. | unreachable-by-D1 |
| 3 | The D1 clamp itself is applied upstream in `scene_medium_properties` — the tracker runs the papers' algorithm on the clamped field, which is *the* medium (D1 definitional). | definitional |
| 4 | Scalar σ̄ (v1): pbrt's per-channel `T_maj` normalizations collapse (noted above) — an algebraic simplification that is exact, not an approximation. | exact-collapse |
| 5 | Kutz §5.1.3 (set P_a = 0, renormalize over {s,n}) is the paper's OWN variance option for non-emissive media — one line inside this same structure. Not enabled in v1 (owner: keep the full lottery as built); recorded here as the published escape hatch if absorption-termination noise ever warrants it. | noted-not-enabled |

The same table is commented at the loop in `delta_tracking.glsl`.

## What this batch must NOT do (design doc §4)

No structural defines; no walk/PathState/combiner edits; constant media never
reroute; witness envs/media are load-bearing (no blanket edits); glslang ≠ ANGLE
(struct ternaries, reserved `__`) — GPU witnesses own runtime truth; the sweep is
owner-run.
