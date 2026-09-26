# Heterogeneous Media — Design Authority

**Status: owner-approved design (July 17 2026); BUILT the same day (V0→V2, build
record: `impl-plan-heterogeneous-media.md`); its witnesses pass in the full sweeps.
Medium emission (`impl-plan-medium-emission.md`) landed the same evening, filling this
build's reserved slots.**
**Amended July 17 2026 (implementation kickoff, owner-decided):** (a) the D1 clamp is
emitted inside the generated `scene_medium_properties` itself — every consumer sees only
the effective field; (b) absorbing-only heterogeneous media get a ratio-tracked
pass-through arm of `medium_sample` (the fourth dispatch quadrant); (c) §3 policy
revised: **transcribe the published spectral tracker with its absorption lottery**
(Kutz et al. 2017 / STAR §6.5.2, cross-checked against pbrt-v4) — the absorption branch
is a pure terminator (emission, when it arrived, collects per tentative collision — NOT
in the branch) and the bound assumption holds exactly by D1; the doc's original
no-lottery scatter-with-albedo loop moves to the deferred ledger as a no-emission-only
variance optimization. Implementation plan: `impl-plan-heterogeneous-media.md`.
This document is the design authority for the heterogeneous-media build. It extends
`fable-volumetric-component.md` (the seams it fills were cut there) and opens the door
that contracts §1.1 / V1-C1 deliberately left closed ("procedural media not yet
supported — declare a majorant when they are"). Nothing here supersedes the
volumetric component contract; the trace-loop contract is untouched.

Sources behind the design: pbrt-v4 (Media / Equation of Transfer / Volume Scattering
Integrators), Novák–Georgiev–Hanika–Jarosz 2018 STAR (read in full), Kettunen et al.
2021, Kutz et al. 2017. Section 3's chromatic algebra is fable-derived from those and
marked **verify-in-impl** — the witnesses in §5 are its acceptance gates.

---

## 0. The picture in plain language (read this first)

A heterogeneous medium is the **same authored medium block** we have today, except
the coefficients may be **formulas of position**, plus **one declared ceiling
number**:

```ts
smoke: {
  model: 'none',
  medium: {
    sigma_s: glsl('u_fog_gain * exp(-3.0 * p.y)', { params: [{ param: 'fog.gain', default: 2.0, min: 0, max: 6 }] }),
    sigma_a: [0.05, 0.05, 0.05],
    majorant: 6.2,                 // "my total density never exceeds this"
    phase_g: 0.4,
  },
}
```

Only two places in the whole tracer ever think about fog:

1. **"Did anything happen along this stretch of ray, and where?"** — `medium_sample`.
2. **"How much light survives this shadow ray?"** — `medium_transmittance`.

Today each is a closed-form one-liner (constant σ). Heterogeneous media replace each
one-liner with a short loop — and change **nothing else**. The walk, regions,
nesting, phase functions, lights, cameras: untouched.

The loop is the **phantom-fog game** (null-collision / delta tracking, Woodcock
1965 → Galtier 2013 → Miller et al. 2019; pbrt-v4's foundation): pretend the fog is
everywhere at its maximum density σ̄ — that uniform fog you CAN sample in closed
form. Jump forward an exponential step as if in max-density fog; where you land,
peek at the real density; flip a coin weighted real/max. Heads: a real event
(scatter — handled from there exactly like today's homogeneous scatter). Tails: you
hit *phantom fog* — nothing there, keep flying, jump again. This is **not an
approximation**: the odds cancel exactly, for any ceiling. The ceiling is a
**pacing knob** (tight = few wasted peeks), not a correctness knob.

Shadow rays play the sibling game: same jump-and-peek line, but instead of coin
flips, multiply a running per-channel score `(1 − σ/σ̄)` at each peek — the score
converges to the true transmittance (ratio tracking, Novák et al. 2014; pbrt-v4's
`SampleLd` does exactly this).

---

## 1. Pinned decisions (owner, July 17 2026)

### D1 — The ceiling is part of the medium's definition

The rendered medium **is** the clamped field. Precisely: with authored coefficient
fields σ_a(x), σ_s(x) and ceiling σ̄, let

```
u(x)      = max over RGB channels of (σ_a(x) + σ_s(x))     — the authored total density
scale(x)  = min(1, σ̄ / u(x))
σ_a_eff   = scale(x) · σ_a(x),   σ_s_eff = scale(x) · σ_s(x)
```

The proportional scale **preserves the single-scattering albedo field** — only
extinction saturates. Where the formula pokes above the ceiling, density flattens:
deterministic, smooth, and every estimator (delta tracking now, decomposition
tracking later, the analytic arm on constant media) agrees on the same integrand, so
the §11.2 estimator-swap discipline stays exact.

Why this and not the "exact-anyway" weighted mode (negative-weight null collisions,
STAR Eq. 31–33): (a) for **singular fields** — accretion-disk r⁻ⁿ profiles,
exponentials of diverging potentials, the owner's core imagery program — no finite
ceiling exists and weighted tracking has unbounded weights; clamping is the *only*
coherent semantics, and making it the definition turns σ̄ into an explicit
mathematical regularization parameter. (b) Under **live sliders** (D4) a clamp
degrades gracefully (peaks flatten) where weighted tracking sprays fireflies.
(c) The ceiling doubles as an honest **performance dial** with a deterministic
currency. The weighted mode remains valuable for percentile-majorant strategies on
heavy-tailed noise — it is a **measurement-level** declared mode (it renders the
*unclamped* field, a different integral) and lives on the deferred ledger, never as
silent v1 behavior.

Implementation corollary: the coin probability `u_eff/σ̄` never exceeds 1 — the
"accidentally clamped probability" bug class of naive delta trackers becomes
*defined behavior* here. Comment this at the loop.

**Placement (owner, Jul 17 kickoff): the scale is emitted inside the generated
`scene_medium_properties` itself**, in the expression-media branches only. The loops
are not the sole readers of a medium's properties — the medium light-sampling sites
(`light_medium`, equiangular) fetch at event points, and future occupants
(decomposition tracking, grid media) will fetch too. With the clamp in the lookup, no
caller can ever observe the unclamped formula: the clamped field stops being a rule
readers follow and becomes the only field that exists — D1 made structural. Constant
media pay nothing (no scale lines are emitted in their branches), and F-CLAMP then
verifies the definition for every consumer at once.

### D2 — Transport shape: two new arms, the walk untouched

- `medium_sample` gains a **delta-tracking arm** (the jump/peek/flip loop). It
  returns exactly what the seam returns today — scattered-at-t or made-it-through,
  with per-channel weight — so the generated walk cannot tell the arms apart.
- `medium_transmittance` gains a **ratio-tracking arm** (jump/peek/multiply). The
  spectral shadow-segment walker composing it is untouched.
- **Per-medium dispatch**: media with constant/`{param}` coefficients STAY on the
  `analytic` arms (exact, zero regression — every existing witness's integrand and
  estimator are bit-identical). Only expression-coefficient media route to the new
  arms. A scene may mix both kinds.
- **Absorbing-only heterogeneous media (owner, Jul 17 kickoff)**: the delta-tracking
  arm exists to *find a scatter event* — in a medium with σ_s ≡ 0 every real event it
  finds carries zero weight (wrong tool). Absorbing-only expression media route to a
  **ratio-tracked pass-through arm** of `medium_sample` (`{scattered: false, weight: T}`
  with T estimated by the seam-2 loop over σ_a) — the heterogeneous analog of today's
  deterministic Beer–Lambert arm. The dispatch is thus a 2×2 mirroring the existing
  scattering/absorbing split: constant×{scattering, absorbing} → today's arms
  (unchanged); expression×scattering → delta tracking; expression×absorbing → ratio
  tracking.
- **Step budget**: each loop derives its own bound from the segment it walks,
  `tracking_cap(σ̄·t) = ⌈λ + 6.5√λ + 12⌉` with λ = σ̄·t the mean number of tentative
  collisions. A walk runs out with probability below 1e-10 for every λ, so the bound never
  decides the picture (taxonomy §4.1); a walk that did run out would drop the rest of its
  segment. There is no fixed number and no warning. The cost is the walk's own: a long
  segment at a high majorant takes about λ steps, thin field or not — a fog open to the far
  clip pays σ̄ × 1000 per escaping ray. Cheaper walks through thin regions need tighter
  local majorants, not a smaller bound.
- **RNG**: the loops draw internally from the stream (`random()`, as the equiangular
  technique already does). The seam's `vec2 xi` stays for the leading stratified
  draws; the contract note in `fable-volumetric-component.md` §2 should gain one
  line recording that arms may consume additional stream draws.

### D3 — v1 estimator arms: plain + nee; mis is a planned follow-up

`estimator.volumeSampling: 'delta-tracking'` (the already-reserved word) goes live
**under `directLighting: 'none' | 'nee'` only**. The `mis` combination is
Validator-rejected with a real message.

Reason (structural, not incidental): MIS weights need the probability of the sampled
scatter distance, and delta tracking's distance pdf is **unknowable** (it
marginalizes over infinite phantom-collision chains — STAR §4.2.1/§7.1). The
standard resolution (pbrt-v4) is to carry **rescaled probability tallies** (r_u,
r_l) along the path, updated at every tentative collision, consumed by the MIS
weights at scoring sites. For us that means generated `PathState` fields + combiner
weight extensions — machinery we have (PathState is generated per-program for
exactly this kind of growth), but it reaches beyond the two seams into transport.
**Owner decision: do the simple cases now; plan the tally restructure carefully as
its own batch.** The deferred ledger (§6) carries the design sketch.

This is the third instance of the house maturation pattern (homogeneous media
M1→M2, equiangular nee-only → placement-MIS deferred).

### D4 — Input language: position + declared sliders; ceiling required with formulas

- `sigma_a` / `sigma_s` may be `GlslExpression` **iff** the medium declares
  `majorant` (a positive finite constant number in v1).
- Expressions may reference the position `p` and **declared parameters**:
  `GlslExpression` gains an optional `params` list of `{ param, default, min?, max? }`
  records (v1: float params only). Each becomes a live uniform + slider through the
  existing `{param}` machinery (reserved-prefix rules, `paramToUniform` collision
  checks, `triggersReset` — dragging resets accumulation, zero recompiles). The
  expression source references the derived uniform name (`fog.gain` → `u_fog_gain`);
  the Validator warns when a declared param's uniform never appears in the source
  (the C5 inert-knob class). This extension is **general** (any expression property
  may declare params — procedural albedo benefits too), not media-specific.
- Sliders + D1 compose safely **by construction**: no slider position can violate
  the ceiling contract — the field saturates. This is the payoff of D1.
- `phase_g` etc. stay as they are (constants/`{param}` — spatially-varying phase
  parameters are NOT in v1; Validator continues to reject expressions there).
- The ambient medium may be heterogeneous (expressions evaluate anywhere); note the
  shadow-walker cost in the doc for authors, nothing structural.

---

## 2. Validator rules (complete list for the implementing session)

1. Expression on `sigma_a`/`sigma_s` **without** `majorant` → error (the V1-C1
   message updates to say what is now possible).
2. `majorant` present: must be a finite number > 0. Warn if the medium's
   coefficients are all constant/`{param}` (derivable bound — inert declaration,
   C5 class).
3. `volumeSampling: 'delta-tracking'` + `directLighting: 'mis'` → error (reserved:
   the tally batch; message explains the unknowable-pdf reason briefly).
4. `volumeSampling: 'delta-tracking'` with no heterogeneous medium in the scene →
   warn (inert knob, C5). Conversely `'analytic'` with a heterogeneous medium
   present → error (the analytic arm cannot evaluate σ(x); reject-not-degrade).
5. Expression `params` entries: paths run through the existing reserved-prefix +
   `paramToUniform`-collision machinery; defaults must be finite; warn on a declared
   param whose uniform name does not appear in the expression source.
6. `'raymarch'` / `'ratio-tracking'` as `volumeSampling` values stay
   reserved-rejected (ray marching is biased — if ever added it is a *declared
   measurement truncation*, not an estimator; 'ratio-tracking' names a distance-
   sampling variant we are not building).
7. Spatially-varying phase params (expression on `phase_g` etc.) → still rejected.

Analyzer: one new scene fact, `media.hasHeterogeneousMedia` (any medium with an
expression coefficient). ProgramDescription: the per-medium arm selection is a
Planner decision recorded in the link map (which media route to which arm), plus the
`volumeSampling` value itself.

---

## 3. The loops (implementation contracts; REVISED Jul 17 kickoff — transcribe, don't adapt)

Both loops live in a new occupant folder mirroring the analytic one:
`components/transport/volume/delta_tracking/` (static math file + descriptor), with
the per-medium dispatch and σ̄/expression splicing generated — **math static,
policy/plumbing generated**, per the house rule. `scene_medium_properties(med, p)`
finally uses its `p` (the argument was future-proofed for this); the generator's
`mediumPropertyExpr` throw-branch for expressions becomes a splice. Per the amended
D1, the lookup already returns the **effective** (clamped) field — the loops consume
it directly and need σ̄ only for pacing the jumps.

**Policy (owner, Jul 17 kickoff):** the distance-sampling loop is a **verbatim
transcription of published spectral tracking** — Kutz et al. 2017 / STAR §6.5.2,
cross-checked against pbrt-v4's VolPath collision handling — **including the
absorption lottery**. Reasons: (a) medium emission (fire) is planned — the
absorption branch is where Le goes, so building the lottery now means emission later
is filling an existing branch, not a restructure; (b) the published weight machinery
is shaped for densities that exceed the bound, which the deferred weighted
(unclamped) mode will need; (c) the house rule — transcribe from a source whose
assumptions match, or derive the difference — is satisfied by pure transcription,
and by D1 the papers' bound assumption (σ_t ≤ σ̄) holds *exactly*, so no adaptation
is required at all.

Structural shape (the concrete probabilities and per-channel history weights are
TRANSCRIBED in the impl plan directly from the sources — this sketch is structure
only, deliberately not normative algebra):

```
t = 0
loop (≤ tracking_cap(σ̄·t_max)):
    t += -ln(1 - random()) / σ̄
    if t ≥ t_max: return transmitted (weight as accumulated)
    fetch EFFECTIVE props at p(t)                    // clamp already applied in the lookup
    lottery over {absorb, scatter, null} with the papers' probabilities:
        absorb  → path ends (a pure terminator — emission, as built, collects per
                  tentative collision instead, impl-plan-medium-emission P3)
        scatter → return scattered at t (weight per the papers' history weights)
        null    → phantom fog; update weight per the papers; continue
```

The impl plan carries a **deviations table** next to the transcription; its only
entries are declared-and-inert facts, never modified formulas: (1) emission branch
empty in v1; (2) bound exact by D1 (the papers' defensive handling of σ_t > σ̄ is
unreachable); (3) the clamp itself is definitional (D1), applied upstream in the
lookup. The same table is commented at the loop. The original no-lottery
scatter-with-albedo variant (this section's pre-amendment sketch) is a
no-emission-only variance optimization — deferred ledger, re-derive before enabling.

**Transmittance (ratio-tracking arm of `medium_transmittance`), RGB — verbatim
published (Novák et al. 2014; pbrt-v4 `SampleLd`):**

```
T_c = 1;  t = 0
loop (≤ tracking_cap(σ̄·len)):
    t += -ln(1 - random()) / σ̄
    if t ≥ len: return T
    fetch EFFECTIVE props at p(t)                    // clamp already applied in the lookup
    T_c *= (σ̄ − σ_t_eff,c) / σ̄
    (optional early-out when max channel of T < ε)
return T   // cap reached (probability < 1e-10 per segment): the rest of the segment is dropped
```

Notes: exact per channel with one shared collision stream. On constant-σ media this
estimator is *noisy* where the closed form is exact — which is why D2 keeps constant
media on the analytic arms. The same loop (over σ_a) is the body of D2's
absorbing-only pass-through arm of `medium_sample`. (Kettunen et al. 2021 is the
known superior occupant for this same seam — deferred.)

---

## 4. What implementation must NOT do

- No structural `#define`s (conditionally-included blocks; only numeric knobs are
  defines). No walk/PathState/combiner changes in v1 (that is the tally batch).
- Constant/`{param}` media never route to the new arms.
- glslang cannot catch ANGLE dialect quirks (no struct ternaries; the reserved-`__`
  scan exists in `tests/helpers/glslangCheck.ts`) — GPU witnesses own runtime truth.
- The witness sweep is owner-run; cheap gates (tsc + targeted vitest + glslang)
  between iterations.
- Don't blanket-edit existing witness scenes (their envs/media are load-bearing).

---

## 5. Witnesses (the correctness harness; add to `tests/witnesses/`)

1. **F-HET-CONST** — the integrand-held-fixed equality: a medium whose coefficient
   is the *constant expression* `glsl('0.5')` (+ majorant) renders on the delta arm;
   its twin authors the same constant as a plain number (analytic arm). Same
   integrand, different estimators → twin equality gate. This is the single
   sharpest correctness check of the whole build.
2. **F-HET-SLAB** — a slab with linear σ(z): optical depth integrates in closed
   form → exact per-channel center-pixel numbers, F-SLAB's sibling. Derive the
   numbers in the fixture comment.
3. **F-CLAMP** — D1 verified by twin: a formula deliberately exceeding the ceiling
   everywhere (e.g. `glsl('2.0')` with `majorant: 1.0`) must render identically to
   the authored-constant-1.0 twin. The clamp *is* the definition — proven as an
   equality, not an assertion.
4. **HET-DRIVEN** — a slider in the formula at two parameter points ≡ baked twins
   (the `driven`/`driven-theta2` pattern), covering the expression-params machinery
   end to end.
5. A haze-style visual demo card belongs in `demos/` (churnable), not here.

pt vs pt-nee convergence on a heterogeneous scene rides the same fixtures (both
arms are live in v1).

---

## 6. Deferred ledger

| Item | Note |
|---|---|
| **The mis/tally batch** | pbrt-v4 rescaled probabilities: generated `PathState` fields `r_u`/`r_l`, updated per tentative collision, consumed by combiner weights at every scoring site; spectral MIS shape included. **DEFERRED (owner, Jul 17 2026 evening, after a planning read)** — it is a whole-program switch (balance heuristic via tallies, tally-returning shadow walker, RR metric /avg(r_u)) with near-zero win for current scenes; re-trigger: the first nee-only firefly scene (bright emitters IN fog, g→0.85+, sun-through-atmosphere) or the spectral axis scheduling. |
| Weighted (non-bounding) mode | Renders the *unclamped* field — a measurement-level declared mode (different integrand), negative-weight machinery; for percentile-majorant strategies on heavy-tailed noise. |
| Exceedance debug view | False-color `max(0, u(x) − σ̄)` — the §11.4-family diagnostic for checking a declared bound while dragging sliders. |
| Grid media (3D textures) | Density grids via the `extern:` texture chain (as env images); majorant derived at load (max), later per-segment via a coarse majorant grid + DDA (pbrt's 64–256³ sweet spot). A second medium *kind*, same seams. |
| Decomposition tracking | Analytic control (our existing sampler!) + delta-tracked residual — third occupant of the `medium_sample` seam; production standard. |
| Kettunen 2021 transmittance | Superior occupant for the `medium_transmittance` seam; zero variance on constant extinction. |
| Driven majorant | The ceiling on a slider (live regularization exploration). Mechanically trivial (uniform pacing); do after v1 settles. |
| Medium emission (fire) | **BUILT Jul 17 2026 evening (`impl-plan-medium-emission.md`).** `emission` = ε, the volume emission coefficient (W·sr⁻¹·m⁻³, B2's dimensional ladder), collected per-tentative-collision (pbrt's shape — NOT the lottery branch, which stays a pure terminator); the D1 scale applies to ε (source-function preservation). Volume light sampling (NEE toward glow) is that plan's deferred ledger. |
| No-lottery collapsed tracker | The pre-amendment §3 sketch (always-scatter, absorption rides the weight): a variance optimization. NOTE (post-emission): with per-collision ε collection the absorption branch is no longer emission's site, so the old "non-emissive only" caveat needs re-examination if this is ever picked up — re-derive regardless; twin-gate against the transcribed lottery form. |
| Equiangular × heterogeneous | Equiangular currently pairs with delta lights + nee; its estimate would need ratio-tracked transmittance along the sampled segment — check the interplay before enabling the combination. |
| Brace-sugar for param refs | `{fog.gain}` substitution in expression source — authoring-layer nicety; v1 writes the derived uniform name. |

---

## 7. Suggested build order (the implementing session cuts the real plan)

1. **V0 plumbing**: `GlslExpression.params` + uniform minting + Validator rules
   (§2) + `majorant` in `MediumDescription` + Analyzer fact + link-map decisions.
   Gate: vitest + kitchen-sink extension (a heterogeneous medium joins the
   synthesized scene).
2. **V1 loops**: the occupant folder + generated dispatch arms (2×2 per amended D2)
   + the D1 scale in the lookup + step budgets. First step: the side-by-side
   transcription (papers → GLSL) with the deviations table, in the impl plan. Gate:
   glslang + snapshots (additive for new fixtures; existing scenes byte-identical —
   constant media never reroute).
3. **V2 witnesses**: §5's four fixtures + registry entries; owner runs the sweep.
4. Then stop. The tally batch is a separate, carefully-planned restructure.
