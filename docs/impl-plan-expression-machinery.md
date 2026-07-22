# impl-plan-expression-machinery.md — a symbolic-algebra layer in the compiler

**STATUS: DEFERRED (owner, Jul 21 2026).** Plan-of-record kept intact below for when a real
customer re-triggers it. Design authority is `docs/fable-expression-machinery.md` (the handoff/vision).

**Why deferred — the "what NEEDS this vs where finite-diff is OK" audit (Jul 21):** running the use
cases under that lens collapsed the worth to a narrow true-need. **Finite-diff is numerically
correct for anything that IS a derivative of a smooth field** — normals, GRIN's connection (shipped),
metric Christoffels (finite-diff the tensor, like GRIN), texture footprints (central-difference in
uv), CSG blend normals. Differentiation (capability B) — the thing this was originally pitched on
("generate the analytic gradient") — is almost never a NEED; it's a perf/cleanliness upgrade over
central differences that already work. **Symbolic is genuinely required only where the thing you
need is NOT a derivative:** (1) **root isolation** of the ray-polynomial (capability C — algebra),
and (2) **conservative interval bounds** for a BVH (capability D). And even those are needs only in
the HARD regimes: root-finding beats safe-marching (`f/|∇f|`, itself finite-diff'able) only for
**singular / high-degree** surfaces; interval bounds matter only at **many-object scale**. Smooth
low-degree surfaces, few objects, a handful of famous metrics → numerics all the way down.

**Re-trigger condition:** open this plan when **singular, high-degree algebraic varieties (enough of
them to want a BVH)** become a feature you actually want to render — that is the ONE place where
"finite-diff is already OK" is false. Also fine to cherry-pick **Stage 0 (parser + free-var)**
independently if the procedural-material validation DX (exact uv-gate, typo errors) becomes worth it
on its own — it needs no calculus and no customer. Everything else stays finite-diff until a singular
variety or a many-metric authoring workflow is on the desk.

---

Below: the plan-of-record as written (scope decision, staged build keyed to first-customers, grounded
integration points verified against current code, the research that settles the varieties stage, test
gates). Co-authored against `docs/fable-compiler-contracts.md` because it stands up a new
`src/compiler/expr/` module as a peer of `analyze/`/`plan/`/`generate/`.

---

## 0. The scope decision (why this exists, and its limit)

A symbolic layer is **overengineering if every use case has a cheaper substitute** — and most do.
Finite differences already ship GRIN's ∇n ([grin.glsl:37-44](../src/components/transport/volume/grin/grin.glsl#L37-L44),
GPU-verified) and SDF normals; hand-authored ∇f, hand-declared majorants, and supersampled
procedurals all work. Case by case, symbolic is an **upgrade, not an enabler**.

It flips on one fact: **two things have no non-symbolic path, and both are stated north stars.**

1. **Algebraic varieties / isosurfaces** — robust ray/surface intersection reduces the ray to a
   univariate polynomial and finds its roots. You cannot finite-diff your way to "robust roots of
   the ray-polynomial." This is *capability C* (polynomial algebra: substitute + collect + change
   basis), **not** differentiation.
2. **Curved space (H³, Nil, Schwarzschild)** — geodesic integration needs the Christoffel symbols,
   which are **derivatives of an authored metric `g_ij(x)`**, plus the inverse metric. GRIN's
   `n·∇n` is already this for the conformally-flat metric `n²·δ`; the general case is "author `g`,
   compiler derives the stepper." Hand-deriving connections per space is the exact friction the
   instrument should remove.

**Therefore the worth is inherited, not intrinsic.** Build the symbolic engine when varieties or
curved-space is the *next* feature you actually render. The **one** piece worth doing on spec is the
parser + free-variable layer (Stage 0), because it earns its keep on **validation alone** — no
calculus, retires the substring lint, ships the exact uv-gate. Everything symbolic beyond Stage 0
waits for its first real customer. Do **not** build the differentiation/reduction engine because it
is elegant.

This staging is the plan's spine: each stage stands alone, lands value independently, and is pulled
into existence by a named customer.

---

## 1. Grounded current state (verified Jul 21 2026)

The compiler is **pure-TS, zero runtime deps** — a parser module has no dependency concern.
Expressions are **100% opaque today except ONE `String.includes`** ([Validator.ts:1228](../src/compiler/analyze/Validator.ts#L1228),
the inert-declared-param lint — the one source-peek a real parser subsumes).

- **Type**: `GlslExpression = { kind:'glsl'; source:string; params?: GlslExpressionParam[] }`
  ([types.ts:251-256](../src/compiler/types.ts#L251-L256)); `GlslExpressionParam = {param,default,min?,max?}`
  ([:243-249](../src/compiler/types.ts#L243-L249)); `isGlslExpression` ([:292-294](../src/compiler/types.ts#L292)).
  Aliases `ScalarProperty` ([:260](../src/compiler/types.ts#L260)) / `SpectrumProperty` ([:264](../src/compiler/types.ts#L264)).
- **Producers + SCOPE (the free vars each may reference):**

  | Domain | Emit site | Scope |
  |---|---|---|
  | Media σ_a/σ_s/ε | `scene_medium_properties(int mat, vec3 p)` (materials.ts) | `p`, `u_<param>` |
  | Material rows (P2) | `scene_material_properties(id,p,uv,element)` fill (materials.ts) | `uv`, `p`, `u_<param>` |
  | Procedural env | `env_chart_dir`→radiance (environment.ts / EnvironmentBake.ts) | `dir` ONLY (param-free pin) |
  | GRIN `ior` | `ior_at(int med, vec3 p)` (materials.ts) | `p`, `u_<param>` |

- **Emit path**: `emitValue(v, format, exprFormat=(e)=>e.source)` ([values.ts:47-66](../src/compiler/generate/values.ts#L47-L66))
  — default emits `e.source` verbatim; `mintValueUniform` ([values.ts:97+](../src/compiler/generate/values.ts#L97))
  mints one float uniform per declared param (`paramToUniform`, e.g. `fog.gain`→`u_fog_gain`) + slider metadata.
- **Derivative consumers (finite-diff today)**: `grin_grad_n` (grin.glsl:37-44, 6-pt central of `ior_at`);
  `scene_normal` (raymarch.glsl, 6-pt central of `scene_object_sdf`). Env/chart Jacobians already analytic.
- **The uv-gate to sharpen**: `materialReadsUv` ([dataTenants.ts:27-32](../src/compiler/plan/dataTenants.ts#L27-L32)
  — `Object.values(mat).some(isGlslExpression)`, **COARSE by choice**) + the `materialsReadUv` /
  `keepsLocalFrame` program flags. The doc-comment there already names "precise per-formula
  uv-detection" as the follow-up Stage 0 delivers.
- **Module home**: `src/compiler/expr/`, consumed by `analyze/Validator.ts` (free-var validation +
  the uv-gate) and `generate/values.ts` (`exprFormat`) + `generate/features/{materials,intersection}.ts`.

---

## 2. The capabilities (what sizes the system)

The layer is a set of AST capabilities; each use case is a combination. This is the sizing lever.

| Cap | What | Difficulty | First customer |
|---|---|---|---|
| **A. Free-var / scope analysis** | "which of scope's vars + `u_<param>` does this read" | trivial, no calculus | validation (Stage 0) |
| **B. Differentiation** | ∇ / Jacobian / Hessian on the subset | easy — *total & mechanical* on the subset | varieties normals, GRIN, curved-space |
| **C. Polynomial algebra** | compose (ray→univariate), collect, **→ Bernstein basis**, gcd/squarefree | moderate, mechanical, degree-bounded | varieties (Stage 1) |
| **D. Interval / reduced-affine extension** | evaluate the AST in an inclusion algebra | moderate — a second "number type" interpreter | degree-independent robustness, media majorants |
| **E. Symbolic integration** | ∫ along a ray, CDF inversion | **hard, partial** — never foundational | opportunistic only |
| **F. Symbolic linear algebra** | det / inverse of a symbolic matrix (3×3/4×4 closed form) | moderate | curved-space metric inverse |

A–D are the safe core (complete on their subset). **E is opportunistic — no stage may depend on it
being general.** F is small and self-contained, added when curved space comes due.

**Organizing concept: an expression = source + SCOPE** (the free vars it may reference). Free-var
analysis validates references against the scope; differentiation differentiates wrt the scope's
spatial var (`p`). Each producer declares its scope (§1 table).

---

## 3. Architecture

```
GLSL-expr string ─parse─▶ AST ─▶ [A free-var] ─▶ [B differentiate] ─▶ [C reduce/poly] ─▶ [D interval] ─emit─▶ GLSL
```

- **Layer 0 — parser + AST.** Operator-precedence expression grammar (NOT full GLSL — no statements
  / control flow) over a **defined supported subset** (§5). The one hard prerequisite; shared by
  every capability. Graceful fallback: an expression outside the subset stays opaque passthrough
  (today's behavior) unless a capability *needs* it, in which case a diagnostic (§5).
- **Layer 1 — free-var analysis (A).** No calculus. Retires the substring lint, makes the uv-gate
  exact, enables identifier-validation errors. **Pays for itself before any calculus.**
- **Layer 2 — capabilities (B/C/D/F).** Each is an AST→AST or AST→inclusion transform, added per
  customer. Differentiation, ray-reduction-to-Bernstein, interval extension, metric algebra.
- **Layer 3 — emit.** AST → GLSL string; subsumes today's raw-source passthrough. Constant-fold +
  a small identity set (matches exact-linkage discipline; must not change the numeric result beyond
  fp). Bernstein-coefficient emit is a Horner/de-Casteljau formatter.

**Positions taken (no menus):**
- **Parse the authored GLSL strings** (keep "write `sqrt(2-dot(p,p))`"), not a structured builder.
  All four producers author raw strings today; parsing preserves the paint-with-a-formula idiom.
- **Symbolic** transforms (manipulable closed form), with **dual-numbers / finite-diff as the
  per-use fallback emit** when something is outside the subset. Both ride the same AST → it's an
  emit choice, not a foundation fork.
- **Bernstein basis is the numerical substrate for C** (see §4) — non-negotiable, not an option.

---

## 4. The varieties stage — grounded in the literature (Stage 1)

Research (Jul 21, primary-source verified) settles the method choices so Stage 1 is a transcription,
not a re-derivation:

- **The reduction is the shared, symbolic move.** Loop & Blinn 2006, the Bézier-subdivision line
  (Reimers/Seland/SINTEF 2007), and the polynomial interval methods all reduce the ray to a
  univariate polynomial. That reduction (substitute `o+t·d`, collect by power of `t`, convert to
  Bernstein) **is capability C** and has no finite-diff substitute.
- **Bernstein basis is the confirmed precision answer.** Provably *optimally stable* on [0,1]
  (Farouki — minimal non-negative basis); Wilkinson deg-20 root conditioning ~10⁵ (Bernstein) vs
  ~10⁸ (power). Loop & Blinn compute coefficients in Bernstein form explicitly "to maximize the
  stability of root finding." **But** conditioning still blows up near multiple roots → a real
  degree ceiling remains; basis choice helps, it does not rescue arbitrarily high degree.
- **Root-isolation occupants (a swappable axis — the modular fit):**

  | Occupant | Reach | Cost | Role |
  |---|---|---|---|
  | **Analytic ≤ deg 4** | quadric/cubic/quartic exact | cheapest | fast path (spheres, tori, Kummer) |
  | **Bernstein subdivision** | deg 5+ singular zoo interactively (Dervish quintic, 31 double pts); **register-bound, not precision-bound** | moderate | the workhorse |
  | **Interval / reduced-affine** | **degree-*independent*** robustness; non-polynomial implicits too | higher/step; GPU-float caveat: regression AA ops (sqrt/transcendental/÷) unreliable → fall back to interval | high-degree / arbitrary implicits |

- **The singular wall is inherent, not a method defect** (set expectations, do not advertise as
  solved): at a singular point all directional derivatives vanish → the **normal/shading breaks
  down and the feature goes invisible**, regardless of root method. Naive Newton polish triples fps
  but corrupts topology. Multiplicity-aware isolation (non-squarefree via `gcd(g,g′)`; the VAS
  continued-fraction isolator computes multiplicities) is the **deferred** specialist for grazing
  rays; most exact isolators (Sturm-adjacent, DSC2) require a squarefree input.

**C and B are independently shippable.** Stage 1 needs *no* differentiation engine: the surface
**normal is finite-diff'd once at the hit point** (one gradient eval per hit, NOT in the march loop),
so the reduction engine ships without B. Analytic ∇f normals become a later swap (Stage 3).

**A varieties geometry backend** slots into the existing `backend`-resolution seam
(shape-not-backend; the compiler resolves analytic-if-provided-else-sdf today — add
"algebraic-if-`f`-provided"). Root isolation is a registry family (`components/accel/` or a new
`components/geometry/algebraic/` — decide at kickoff), occupants = analytic / bernstein-subdiv /
interval, exactly the swappable-axis philosophy.

---

## 5. Scope discipline (the subset + fallback)

NOT a computer-algebra system. A **defined subset** — the ops in authored formulas: `+ − * /`,
`dot`, `length`, `sqrt`, `sin/cos/exp/pow`, `vec2/3/4` constructors, swizzles, `u_` uniforms,
`p`/`uv`/`dir` — with **complete** rules for exactly that set, grown one function-rule at a time.

**The fallback boundary is explicit:** an expression outside the subset stays **opaque passthrough**
(today's behavior) for value-emit. When a capability *needs* a derived quantity there (a derivative,
a reduction) and cannot produce it, the compiler emits an **itemized diagnostic** — never a silent
wrong answer, never a hidden finite-diff that masks an unsupported form. The subset boundary is the
one open design question flagged for kickoff (§8).

---

## 6. Integration & emit

- **Free-var (A)** → `analyze/Validator.ts`: replace the `String.includes` lint ([:1228](../src/compiler/analyze/Validator.ts#L1228))
  with a real reference-set check; add undeclared-slider / typo / out-of-scope-var errors. Feed the
  exact result into `materialReadsUv` ([dataTenants.ts:27-32](../src/compiler/plan/dataTenants.ts#L27-L32)),
  retiring the COARSE `Object.values(mat).some(isGlslExpression)`.
- **Derived emit (B/C)** rides the existing `exprFormat` hook ([values.ts:50](../src/compiler/generate/values.ts#L50)):
  a value site can request the value AND a derived sibling (`grad_<field>` next to `ior_at`; a
  `poly_coeffs(o,d)` emitter for a variety's `f`). Driven `u_<param>` uniforms are **constants wrt
  ∂/∂p** — the derivative treats them as leaves.
- **Interval (D)** is a distinct AST interpreter emitting inclusion-arithmetic GLSL (or evaluated at
  compile time for majorant bounds — see §7).

---

## 7. Quiet wins (fold in as their producers are touched, not as a stage)

- **Rigorous media majorants (D, compile-time).** Interval-evaluate the authored density formula
  over the region bounds → a **guaranteed conservative majorant**, upgrading the current
  hand-declared / heuristic `MediumDescription.majorant` from "declared truncation" to
  "compiler-proven bound." Ties directly into the heterogeneous-media build.
- **Analytic procedural-texture band-limiting (B).** `∂(pattern)/∂(uv)` antialiases expr materials
  without supersampling — high value for still imagery. Bump-height→normal is the same ∇.
- **Exact uv-gate (A).** Already covered by Stage 0; listed here as the concrete first payoff.

---

## 8. Open questions for kickoff (settle before writing code)

- **The parser subset boundary** — exact grammar + supported functions; strictness; the
  fallback/diagnostic when a derivative is *needed* outside it.
- **Bernstein-emit shape** — de Casteljau vs Horner in-shader; blossoming for the trivariate→
  univariate reduction (per the subdivision line) vs direct coefficient formulas.
- **Where the algebraic geometry backend + root-isolation registry live** (`geometry/algebraic/`
  vs `accel/`), and the `backend` resolution extension.
- **Vector-calculus shape** — scalar-field gradients (varieties normals, GRIN) for v1; full
  Jacobians / the metric→Christoffel machinery (F) deferred to the curved-space customer.

---

## 9. Test strategy

- **TS-twins** (the `grin.test.ts` pattern): differentiate/reduce a known formula, check against the
  hand-derivative / hand-expanded polynomial. **`grin.test.ts` (Bouguer/straight-line) must stay
  green** when `grin_grad_n` swaps to analytic ∇n.
- **Fuzz**: analytic ∇ vs finite-diff ∇ agree within tolerance over random points; reduced
  univariate `g(t)` vs direct `f(o+t·d)` evaluation agree.
- **glslang** static-compiles every emitted derivative/reduction (existing gate).
- **Witnesses** (owner-gated sweep): a first variety render (Clebsch/Kummer) with a derived-value
  numeric check; media-majorant equality (interval-derived ≡ hand-declared) as a twin.
- **Snapshots** re-goldened; the exact uv-gate change is provenance/flag churn, verified diff.

---

## 10. Build order (each stage stands alone; gated by a real customer)

0. **Parser + AST + free-var (A).** Ship the exact uv-gate + validation errors, retire the substring
   lint. *No customer required — validation justifies it.* ← the only speculative bite.
1. **Ray→Bernstein reduction (C) + algebraic geometry backend + analytic/bernstein-subdiv
   occupants.** *Pulled by: the first variety you want to render.* Finite-diff normals at the hit.
2. **Interval / reduced-affine occupant (D).** *Pulled by: a high-degree / non-polynomial surface
   that outruns subdivision registers.* Also lights up compile-time media majorants (§7).
3. **Differentiation (B).** *Pulled by: exact variety normals, the GRIN ∇n swap, approx-SDF `f/|∇f|`.*
4. **Symbolic linear algebra (F) + metric→Christoffel.** *Pulled by: the first curved space.*

**Deferred (no stage depends on them):** multiplicity-aware isolation + the singular-shading fix;
symbolic integration (E); full Jacobians.

---

## 11. Pointers

Design authority: `docs/fable-expression-machinery.md`. Immediate correctness harness:
`grin.test.ts`. Related: `docs/fable-variable-ior.md` (GRIN — the built conformal special case of
Stage 4), `docs/fable-imagery.md` §P2 (the coarse uv-gate Stage 0 sharpens),
`docs/fable-compiler-contracts.md` (the module this co-authors with). Research provenance: Loop &
Blinn 2006; Reimers/Seland (Bézier subdivision) 2007; Knoll et al. (interval/reduced-affine) 2009;
Farouki (Bernstein conditioning); Aberth/CGF 2025 (Lipschitz fields).
