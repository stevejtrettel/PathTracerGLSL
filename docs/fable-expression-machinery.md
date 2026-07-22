# fable-expression-machinery.md — compiler expression parsing / differentiation / manipulation

**STATUS: HANDOFF — research + plan kickoff, NOT approved, NOT built (Jul 21 2026).** Written to
pass off to a fresh research+plan session. It captures the vision, a grounded survey of the
current `GlslExpression` state (file:line anchors), the proposed layered architecture, the two
open forks (with leans + reasoning), a recommended build order, and the open research questions.
The fresh session refines this into the plan-of-record (co-author with `fable-compiler-contracts`,
since it adds a real `src/compiler/expr/` module) once the forks are settled with the owner.

## 0. The vision

Give the compiler the ability to **understand** authored expressions, not just pass their source
strings through: parse a `GlslExpression` into an AST, analyze it (free variables), transform it
(differentiate, simplify, substitute), and emit derived GLSL — most headline-worthily, **exact
analytic derivatives** into the compiled shader. This is deeply aligned with what the tracer is:
a mathematician's instrument where the compiler manipulates the math.

**Use cases (general, not GRIN-specific):**
- **GRIN `∇n`** (the immediate driver) — replace the 6-point finite-difference gradient in
  `grin.glsl` with one exact evaluation (6→1 evals AND removes the `ε` error).
- **Analytic SDF normals** — `scene_normal` is the same finite-diff pattern; exact `∇f`.
- **Approximate-SDF normalization** (owner's example) — an authored field `f` that isn't a true
  distance (`|∇f| ≠ 1`) can be marched safely as `f/|∇f|` (the Lipschitz correction) once `∇f` is
  available: author any field, the compiler makes it a safe distance bound.
- **Chart / importance Jacobians** — the env/octahedral Jacobians are hand-analytic today; a
  later unify-opportunity.
- **Free-variable analysis (no calculus)** — parsing alone retires the coarse P2 `materialReadsUv`
  gate (exact "does this formula read `uv`?") and the lone substring lint, and enables
  compile-time "undeclared slider / typo'd `uv`" errors.

## 1. Grounded current state (survey Jul 21 2026)

**The compiler is pure-TS, zero runtime deps** (confirmed) — a parser module has no dependency
concerns. Expressions are **100% opaque today except ONE trivial `String.includes`** (Validator.ts:1228,
the inert-declared-param lint — the one hacky source-peek a real parser subsumes).

- **Type**: `GlslExpression = { kind:'glsl'; source:string; params?: GlslExpressionParam[] }`
  (`types.ts:251-256`); `GlslExpressionParam = {param,default,min?,max?}` (`:243-249`);
  `isGlslExpression` (`:292-294`). Aliases `ScalarProperty`/`SpectrumProperty` (`:260,:264`).
- **Producers + their SCOPE (the free vars each may reference):**
  | Domain | Emit site | Scope |
  |---|---|---|
  | Media σ_a/σ_s/ε | `scene_medium_properties(int mat, vec3 p)` (materials.ts:500) | `p`, `u_<param>` |
  | Material rows (P2) | `scene_material_properties(id,p,uv,element)` fill (materials.ts:355-375) | `uv`, `p`, `u_<param>` |
  | Procedural env | `env_chart_dir`→radiance (environment.ts:213; EnvironmentBake.ts:66) | `dir` ONLY (pinned param-free) |
  | GRIN `ior` (new) | `ior_at(int med, vec3 p)` (materials.ts:600-603) | `p`, `u_<param>` |
- **Emit path**: `emitValue(v, format, exprFormat=(e)=>e.source)` (`values.ts:47-68`) — default
  emits `e.source` verbatim; `mintValueUniform` (`values.ts:97-124`) mints one float uniform per
  declared param (`paramToUniform`, e.g. `fog.gain`→`u_fog_gain`) + slider metadata. Overrides:
  `mediumPropertyExpr` wraps `max(Spectrum(src),0.0)` (materials.ts:479-491); `ior_at`/material
  rows/env emit raw source.
- **Derivative consumers (finite-diff today)**: `grin_grad_n` (grin.glsl:37-44, 6-pt central of
  `ior_at`, feeds `n·∇n`); `scene_normal` (raymarch.glsl:22-29, 6-pt central of `scene_object_sdf`).
  Env/chart Jacobians already analytic (importance.ts:110; octahedral.glsl:8,20).
- **The uv-gate to replace**: `materialReadsUv` (dataTenants.ts:27-32 — `Object.values(mat).some(isGlslExpression)`,
  COARSE) + `materialsReadUv` program flag (Planner.ts:512). Consumed at intersection.ts:128,973 +
  `keepsLocalFrame`.
- **Module home**: `src/compiler/expr/` as a peer of `analyze/`/`plan/`/`generate/`. Consumed by
  `analyze/Validator.ts` (free-var validation + the uv-gate) and `generate/values.ts` exprFormat +
  `generate/features/materials.ts` (analytic-gradient emit).

## 2. Proposed architecture — a LAYERED subsystem

```
GLSL-expr string ──parse──▶ AST ──▶ [free-var] ──▶ [differentiate] ──▶ [simplify] ──emit──▶ GLSL
```

- **Layer 0 — parser + AST.** The one hard prerequisite: an operator-precedence expression
  grammar (NOT full GLSL — no statements/control flow) over a **defined supported subset**.
- **Layer 1 — free-variable analysis** (no calculus). "Which of scope's vars + `u_<param>` does
  this reference?" Retires the substring lint + the coarse uv-gate; enables identifier-validation
  errors. **Pays for itself before any derivative** → build first, de-risks the parser on
  low-stakes targets.
- **Layer 2 — differentiation.** AST → derivative AST wrt the scope's spatial var. GRIN `∇n`, SDF
  normals, approx-SDF `f/|∇f|`, Jacobians. Exact (no `ε`).
- **Layer 3 — simplification.** Constant-fold + algebraic identities → tight emitted GLSL, dead-
  term elimination (folds `identity·x → x`, matching exact-linkage discipline). Likely REQUIRED to
  tame symbolic-diff blowup.
- **Layer 4 — emit.** AST → GLSL string (subsumes today's raw-source passthrough).

**Organizing concept: an expression = source + SCOPE** (the free vars it may reference). Free-var
analysis validates references against the scope; differentiation differentiates wrt the scope's
spatial variable (`p` for GRIN/SDF). Each producer domain declares its scope (see §1 table).

## 3. The two forks (leans + reasoning — for the owner to settle)

1. **Parse the authored GLSL strings** (keep "write `sqrt(2−dot(p,p))`") with a defined subset +
   graceful fallback — **LEAN**. Alternative: author expressions as a structured builder/AST
   (dodges the parser, changes the paint-with-a-formula idiom + touches every producer). All four
   domains author raw strings today, so parsing preserves everything.
2. **Symbolic differentiation + a simplification pass** (a manipulable closed-form derivative —
   the general "expression machinery") — **LEAN** — with **dual-numbers** (forward-mode) as the
   fallback emit when something simplifies poorly. Both ride the same AST, so it's a per-use emit
   choice, not a foundation fork. Symbolic risk = chain-rule blowup ⇒ simplification is its
   required companion; dual-number is a smaller build but point-evaluated (not manipulable).

## 4. Scope discipline

NOT a computer-algebra system. A **defined expression subset** — the ops that appear in authored
formulas (`+ − * /`, `dot`, `length`, `sqrt`, `sin/cos/exp/pow`, `vec2/3/4` constructors, swizzles,
`u_` uniforms, `p`/`uv`/`dir`) — with **complete** differentiation rules for exactly that set, and
an honest "can't differentiate / outside subset → fall back to today's opaque passthrough (or
diagnose)" boundary. Grows one function-rule at a time, like the rest of the codebase.

## 5. Recommended build order

1. **Parser + AST + free-var analysis** — ship the exact P2 uv-gate, the identifier-validation
   errors, retire the substring lint. (De-risks the parser; immediate value; no calculus.)
2. **Differentiation** — GRIN `∇n` (swap `grin_grad_n`), then SDF normals, then approx-SDF `f/|∇f|`.
3. **Simplification** — as needed to keep emitted derivatives tight.

Each layer stands alone and lands value independently.

## 6. Open research questions (for the fresh session)

- **The parser subset boundary** — exact grammar + supported functions; how strict, and the
  fallback/diagnostic when an expression is outside it (esp. when a derivative is *needed* there).
- **Symbolic vs dual-number**, in detail — the blowup/simplification cost of symbolic vs the
  smaller-but-point-evaluated dual approach; whether to build both (symbolic default, dual
  fallback) or one.
- **Vector calculus shape** — differentiating vec3-valued expressions wrt vec3 `p` (the gradient
  of a scalar `n` is a vec3; Jacobians of vec quantities are matrices). Scope the v1 to scalar-
  field gradients (GRIN/SDF) and defer full Jacobians?
- **How derivatives thread into the emit path** — a new `exprFormat`-style hook that emits both the
  value AND its gradient? A dedicated `grad_<field>` emitter (materials.ts `ior_at` sibling)? How
  the driven `u_<param>` uniforms interact (a derivative wrt `p` treats them as constants).
- **Simplification strategy** — how far (constant fold + a small identity set vs a real
  normalizer); the correctness bar (must not change the emitted numeric result beyond fp).
- **Interaction with the spectral axis** — a future `λ` in scope (dispersion `n(λ)`) and whether
  differentiation ever wants `∂/∂λ`.
- **Testing** — the TS-twin pattern (like `grin.test.ts`): differentiate a known formula, check
  against the hand-derivative; a fuzz-check (analytic ∇ vs finite-diff ∇ agree within tolerance).

## 7. Pointers

Survey anchors in §1. Immediate consumer to prove it end-to-end: `grin_grad_n`
(`src/components/transport/volume/grin/grin.glsl`) — `ior_at` is the exact expression whose
derivative is wanted; the `grin.test.ts` Bouguer/straight-line twin is the correctness harness the
analytic gradient must keep green. Related: `fable-variable-ior.md` (the GRIN feature),
`fable-imagery.md` P2 (the coarse uv-gate this sharpens), `fable-compiler-contracts.md`.
