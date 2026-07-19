# impl-plan-env-power-selection — the env joins the power partition + the DERIVED majorant

Owner-authorized Jul 19 2026 ("set up the environment like any other light" / "lets build
the correct system"), out of the Jul 18 audit (docs/fable-audit-2026-07-18.md, generate-front
F1/F2 + plan-front H3). Two contained batches sharing one idea: **a selection/bounding
quantity that is a pure function of live values is DERIVED (category 5) — CPU compute
closure, bake ≡ ship — never an authored magic number and never stale.**

## Batch 1 — env selection probability derived from the power partition

**The claim.** Every finite light's NEE selection probability is derived from the
area-aware power CDF; the environment was the ONE emitter whose selection probability was
authored (`selectWeight`, default 0.5). The fix makes the env selection-commensurable: the
two-stage draw stays (it is the exact factorization of an (N+1)-entry power CDF — env mass
p vs finite mass 1−p, then the finite CDF within; the emitted structure, combiner weights,
and every pdf-symmetry invariant are UNCHANGED), but `u_envSelectProb`'s value becomes

    p_env = Φ_env / (Φ_env + Σ Φ_light)          (selection 'power')
    p_env = 1 / (N + 1)                          (selection 'uniform')

clamped to [0.01, 0.99] (fp guard; a black env or black light set degenerates gracefully).

**Φ_env** (pbrt's infinite-light convention): `Φ = 4π² r² L̄ × intensity`, with
- `L̄` constant env: `spectrum_average(color)` (driven color resolved live);
- `L̄` image/procedural env: from the loaded table's `env.totalWeight` (the CDF builder's
  luminance total, constants dropped) converted per chart:
  equirect `L̄ = total·π/(2WH)`, octahedral `L̄ = total/(WH)` — with `L̄ = 1` before the
  table loads (declared pre-load default). For MIS-compensated tables `totalWeight` is the
  COMPENSATED mass — deliberate: selection tracks what the env technique will actually
  sample.
- `r` = a plan-time scene-radius estimate from descriptor KINDS (the kinds payoff): over
  analytic + SDF objects and lights, max of |point rows| + Σ length-row extents, floored
  at 1. A declared heuristic — p_env is variance-only by construction (pdf bookkeeping
  matches selection on every side), so a crude r shifts noise, never the mean.

**Mechanism.** `u_envSelectProb` becomes a DERIVED uniform: default = plan-time bake with
authored values; compute closure over `env.intensity`, `env.totalWeight`, the chart's size
param, and every driven-emission path — the light-CDF closure's sibling (one power truth:
`lightPower`). The env's selection follows the intensity slider and driven lamp emissions
live, exactly like the finite CDF already does.

**`selectWeight` migrates:** removed from `EnvironmentDescription` (scene = the integral;
selection probability is computation) → optional `estimator.envSelectWeight` OVERRIDE
(variance-only; declared estimator-section per the taxonomy). When authored: Validator
requires 0 < w < 1 finite (closes audit H3 — silent invalid probability), warns when inert
(no samplable env / no finite lights); the override mints the constant uniform + the
`env.selectProb` slider exactly as before. In derived mode NO slider is minted (a manual
slider would fight the closure). No scene ever authored `selectWeight` (grepped) — the
type-level removal breaks nothing; audit F1 (procedural drop) dies with the field.

**Gate:** sky-lamp (the two-stage witness) — selection changes are variance-only, so its
convergence equalities are the correctness gate; its "sweeping env.selectProb changes NOISE
ONLY" probe becomes "the derived p"). vitest: snapshot churn = u_envSelectProb
default/binding only.

## Batch 2 — the DERIVED majorant (audit F2: the D1 hole for driven-σ tracking media)

**The claim.** For a `{param}`-driven CONSTANT-σ medium routed to the tracking arms
(emissive scattering, P5), the exact majorant IS the live value: σ̄ = max-channel(σ_a+σ_s)
of the current parameters. The pre-batch state (authored fixed majorant required, no clamp
emitted) let a slider exceed the ceiling → negative null coefficients.

**Mechanism.** `σ̄` for NON-expression tracking media is always DERIVED:
- all-constant: the plan-time literal (existing P5 auto-derivation — byte-identical);
- any `{param}` coefficient: a `u_majorant_<matId>` uniform, default = resolved-defaults
  max-channel σ_t, compute closure over the σ params (broadcast scalars, §2.5), floored at
  1e-6 (sliding to vacuum ⇒ one giant jump ⇒ transmitted — the right physics, no ÷0).
Authored majorants are honored ONLY for expression media (D1 unchanged: clamp in the
lookup against the authored ceiling); on non-expression media the declaration is inert
(existing Validator warning, wording updated). The Validator's "{param} emissive-scattering
needs an authored majorant" ERROR is deleted — the requirement it enforced is now met
structurally. Tracking arms receive σ̄ as an argument, so delta/ratio bodies and the ε/σ̄
emission collapse are untouched.

**Witness (AWAITING owner sweep): `emit-driven`** — a driven-σ constant emissive scattering
medium at a parameter point ABOVE its authored default (the exact pre-batch failure mode:
stale σ̄ < σ_t) twinned against the same values BAKED (auto-derived σ̄, the emit-scatter
route). Equality of means at the driven point is the gate.

## Explicitly out of scope (ledgered in fable-audit-2026-07-18.md)
Resolving the whole EnvironmentDescription into ProgramDescription (M7, compiler pass);
the octahedral bake bug (compiler pass, pulled forward); the env chart registry (M3).
