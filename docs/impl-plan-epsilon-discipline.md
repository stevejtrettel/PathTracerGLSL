# Impl plan: provenance-based surface-proximity epsilons

**STATUS: BUILT (Aug 12 2026, owner-approved same day; the plan was REWRITTEN after a six-agent
adversarial audit of the full blast radius before the owner's go). vitest 2355 + glslang all 329
pairs green; snapshots re-goldened, churn audited to the named classes; the GRIN-floored
`spawn_eps_analytic` variant verified in the grin-furnace dumps; the neg-seg-len rider (decision
4) SHIPPED. GPU witness sweep OWNER-GATED — slab-albedo ×4 must go green at the exact values;
the shadow sentinels (cornell-area, cornell-disk, shadow-medium, emit-scatter, mesh-light-twin,
orb, instance-lights, driven-emission-equals-baked, haze) re-gate; pt tripwires recalibrate.**

Design antecedent: `docs/fable-epsilon-discipline.md` (the investigation). Since it was written,
the diagnosis was settled by measurement (CPU renderer-twin reproducing all nine dense
`slab-albedo` numbers to ~1σ; the GPU falsifier sweep confirming tenfold density scaling), and a
first draft of this plan was then audited against the source by six independent read-only sweeps
(Hit construction census; every intersect caller; the marched pipeline; the GRIN walker + medium
events; scene coordinate scales; the shadow/light machinery). **The audit found the first draft
wrong in four places.** This version is the reconciliation; every scoping decision below cites
what forced it.

## The rule, as amended by the audit

> Every self-intersection guard derives from the positional uncertainty of the hit it protects — a
> provenance fact. **Only the analytic tier actually shrinks**, because only there is the hit both
> fp-accurate AND offset along a trustworthy normal. Every other tier keeps today's magnitude and
> gets it from a named, derived source instead of the inherited `EPSILON`.

The measured bias (slab-albedo, −2.7/−1.9/−1.1%) lives entirely in the analytic tier — the slab is
a box, the offending constants are the `ray_spawn` offset (J1) and the analytic `t > EPSILON`
floors (J2), measured at roughly half each and interacting (J1 masks J2 ⇒ one batch, never split).

### The tier table (the heart of the batch)

| hit provenance | spawn offset (`Hit.eps`) | intersect floor | why (audit evidence) |
|---|---|---|---|
| analytic root (6 primitives) | `fp_uncertainty(p)` ≈ 3e-5·max\|p_i\| | **`t > 0`** | proven floor-independent by algebra: spawned origins give *strictly negative* re-roots for plane/quad/disk; sphere/box/cylinder select by the inside test with ~500× margin at this offset scale (pinned, see T2) |
| triangle test (mesh) | **unchanged 1e-3** (named) | **unchanged** (`t >` same named constant) | `ray_spawn` offsets along the SHADING normal (meshes interpolate; `Hit` carries no geometric normal); the floor is what rejects same-triangle re-hits when wi dips below the geometric horizon. Dropping either → acne + black NEE speckle at silhouettes. The proper fix (spawn along ĝ) is a bigger contract change with no measured need. |
| march, unrefined AND refined | **unchanged `2·MARCH_EPSILON_MAX` = 1e-3** (derived) | n/a (marcher owns acceptance) | a `2·march_epsilon` offset sits at a ZERO-margin knife edge against the marcher's first acceptance test (today's constant gives 5×), and grazing escapes feed the 16× stall-commit. Refined shapes stay in this tier: the stall path discards the refine result, so their worst commit is still 16·march_epsilon. |

`fp_uncertainty(Point p)` in `core/math.glsl`: `max(FP_ABS_FLOOR, FP_REL·max(|p.x|,|p.y|,|p.z|))`,
constants transcribed from Wächter & Binder (*Ray Tracing Gems* ch. 6) at build, derivation
pinned in the comment. Scalar-along-normal rather than their per-component integer form: the
escape is spelled through `ambient_geodesic` (the metric seam is load-bearing), and the legal
window is ≥2 orders wide on both sides. Named escalation: if a grazing witness ever catches the
scalar form, the full integer transcription slots behind the same helper.

Scale audit verdict (favorable): crossover where relative eps exceeds 1e-3 is \|p\| ≈ 33; the only
media past it are the `mist` null-interface fog (optically invisible boundary by design) and the
sparse slab's leak walls (not the measured face). All measurement-grade witnesses live at
\|p\| < 10 where the new offset is 3–11× smaller. Grazing hits on distant infinite planes get
larger offsets — correctly, fp error there genuinely exceeds 1e-3.

## T1 — `Hit.eps` + `fp_uncertainty` (plumbing; no behaviour change)

- `Hit.eps` added to `core/structs.glsl` (trace-loop-contract amendment; rider text ships with the
  batch). Audit: **zero positional `Hit(...)` constructors exist anywhere**, so the field is
  add-safe; fills are `primitiveHitFill` (intersection.ts — all seven primitive arms, marched
  included) + the TWO hand-written mesh fills (intersection.ts:866, :980 — near-duplicates;
  consolidate while there) + nothing else.
- Per-arm eps expression at the fill sites per the tier table. `scene_intersect` takes an
  **uninitialized `out Hit`** — a structure test must assert every emitted arm writes `eps`
  (garbage otherwise reaches `ray_spawn` silently).
- **GRIN floor policy**: in programs with deflecting media, the generated fills floor eps at
  `GRIN_GRAD_EPS` (1e-3) — the walker's ∇n stencil reaches 1e-3 from the entry point and only
  stays inside the region because today's offset matches it; authored ior formulas need not be
  total outside. Policy lives in the generated fill (core `ray.glsl` stays fixed).
- Byte gate: nothing reads the field yet — churn = struct line + fill lines exactly.

## T2 — the paired flip (analytic tier only; never ship half)

- `ray_spawn` (`core/ray.glsl:18`): `EPSILON` → `hit.eps`.
- The SIX analytic floors → `t > 0.0`: sphere:26, box:28, plane:16, quad:13, disk:14, cylinder:47.
  Root-SELECTION discipline untouched (inside-test); comments reworded to name the new owner.
  **Pin the selection margin**: the inside test (`c < 0` / `tn < 0`) needs offset ≫ ulp-noise of
  the discriminant — at 256-ulp offsets the margin is ~500×; derive it in the code comment and
  assert the constants in the coupling test.
- **NOT touched** (audit counterexamples): `mesh.glsl:85,107` floors (shading-normal compromise —
  keep, rename); the `*_interval` clips sphere:48/box:51/cylinder:87 (they guard the emitted
  marcher's UNGUARDED first acceptance test — a sub-epsilon bound sliver could otherwise commit a
  hit outside its own interval; keep at the marched constant, or add the missing `t <= t_stop`
  guard to the first acceptance and revisit).
- Expected sweep effect: slab-albedo ×4 → green at the exact values; a hairline light leak at
  exactly-antiparallel shadow spawns (found by the audit) also closes.

## T3 — the keyed constants + the deletion

Every surviving `EPSILON` reader gets a named, derived source; then the symbol is deleted.

- **J3 shadow back-off** (`shadow/opaque.glsl:14`, `shadow/media.glsl:30`): **value kept** at
  2e-3, renamed `SHADOW_BACKOFF` with the real derivation: the requirement is ANGLE-AMPLIFIED
  (`ε_abs/cos θ_l` for planar emitters — the flush-panel fixtures sit at cos θ ≈ 0.01, where an
  fp-relative back-off would resurrect the dark-tops bug), and it must exceed the origin's spawn
  offset (the light point is computed from the un-offset hit). Both demands are met by today's
  value; only its provenance changes. Inert for delta/env kinds (1e20 sentinel absorbs it).
- **J4 GRIN pull-back** (`grin.glsl:180,323`): **value kept** at 2e-3, derived from the walker's
  own residual — the crossing comes from `GRIN_BISECT_ITERS = 8` bisections of a `GRIN_DS_MAX`
  step (residual ≈ 2e-4, scene-scale, NOT fp) and must also clear a marched wall's acceptance
  band (5e-4). The handoff point must land strictly inside the region: the walk deliberately
  neither flips `current_medium` nor re-spawns there, so nothing rescues an outside landing.
- **J5 march restart** (`geometry/index.ts:288`): value kept, spelled `2·MARCH_EPSILON_MAX` — it
  is the other half of the marched self-intersection clearance (same knob as the marched spawn
  tier, never independent).
- Mesh floors + interval clips: renamed to their tier constants (values unchanged, T2 note).
- Delete `EPSILON` from `core/math.glsl`; fix the stale `pinhole.glsl` tmin comment.
- **`tests/components/epsilonCoupling.test.ts`** (note: components/, not compiler/ — two docs cite
  the wrong path) extended: no bare `EPSILON` token in any .glsl or emitter output; FP constants
  match the transcribed values; marched/mesh tier constants equal their derivations; the existing
  EPS_INTERFACE couplings unchanged. Today it never reads `EPSILON` at all — the coupling it
  advertises does not cover the spawn offset; after this batch it genuinely will.

## Untouched, deliberately

- **`EPS_INTERFACE`** (two-sided classification bound, costs no energy) and **`NORMAL_EPSILON`**.
- **Marched medium boundaries** (porcelain): the deferred second batch (refine-on-medium +
  distance-invariance witness). slab-albedo is all-analytic.
- **Pre-existing holes the audit found — documented here, fixed elsewhere or later**:
  - the marcher's stall-commit residual (16·march_epsilon, up to 8e-3) is cleared by neither the
    spawn offset nor EPS_INTERFACE today — pre-existing, unchanged by this batch;
  - the media shadow walker can pass a NEGATIVE segment length into `medium_transmittance`
    (unclamped exp → energy amplification) when an unfloored medium-event origin lands within the
    back-off of the light — pre-existing one-line rider, owner's call whether it rides;
  - `fable-instance-clouds.md`'s radius floor ("0.01 = 10× the GLSL EPSILON spawn offset") and the
    Validator scale-warning text name the old constant — wording updates on owner word;
  - mesh proper-fix trigger: multi-material meshes bounding media ⇒ geometric normal in `Hit`.

## Gates

1. vitest + glslang; snapshots re-goldened, churn audited to the named classes; the extended
   coupling test; a structure test that every emitted arm writes `eps`.
2. Owner witness sweep, full suite. Primary gates named by the audit: **slab-albedo ×4 green at
   the exact values** (the headline); sparse stays green; energy gates hold exactly (furnace 0.4,
   F-ETA 0.5540, slab triple, F-BOX-M, sss-furnace); the shadow gates **cornell-area, cornell-disk,
   shadow-medium, emit-scatter, mesh-light-twin, orb, instance-lights, driven-emission-equals-baked,
   haze** (flush-panel and silhouette geometry — the dark-tops sentinels); marched/GRIN/mesh scenes
   value-stable by construction (their constants keep today's magnitudes); chance-hit pt tripwires
   re-roll — recalibrate per the README; the four grin furnaces stay red (unrelated, do not read
   movement there as signal).
3. `--perf` spot check (a few ALU per spawn — expected wash).

## Post-build cleanup addendum (same day, owner-approved)

Three compromises the build carried were cleaned up hours later:

1. **The dispatcher's conservative `Hit.eps` seed is now provably dead code**: the glslang gate
   asserts, for every registry pair + the sinks, `hit.eps` fills = `hit.p` fills + the seed —
   a missing fill fails CI instead of silently degrading to legacy behavior (the
   roulette-clamp lesson applied preemptively). The seed stays as out-param hygiene only.
2. **`GRIN_GRAD_EPS` has ONE owner**: the TS const in intersection.ts, emitted as a program-header
   define that grin.glsl's `#ifndef` default yields to (the numeric-knob override seam);
   `spawn_eps_analytic`'s floor references the macro, not a baked literal. The `.glsl` value is a
   standalone-reading fallback, drift-pinned by the coupling test.
3. **The `*_interval` sliver clips reverted to the pure geometric statement** (`tf ≤ 0`, "behind
   the ray") and the emitted march loop gained the missing FIRST-acceptance `t_stop` guard —
   the bound now lives where the math says it should, and the hairline class where a shape whose
   interval exit fell within the clearance became invisible is gone (marched scenes re-gate in
   the next sweep; behavior identical outside that hairline class).

## Owner decisions required before build

1. **`Hit.eps`** — the trace-loop-contract amendment. Audit-confirmed: no positional constructors
   anywhere; fills consolidated; `ray_spawn` cannot otherwise learn provenance (a generated
   region-keyed table breaks under table dispatch with mixed backends).
2. **`EPSILON` deleted**, every reader enumerated by the audit and given a named derived source
   (`fp_uncertainty`, the marched clearance, `SHADOW_BACKOFF`, the GRIN pull-back, mesh tier).
3. **Scalar `fp_uncertainty`** (metric seam preserved; window ≥2 orders both sides; root-selection
   margin pinned) with full integer-space Wächter–Binder as the named escalation.
4. **The negative-seg-len transmittance clamp rider** — one line, pre-existing bug, fix now or file.
