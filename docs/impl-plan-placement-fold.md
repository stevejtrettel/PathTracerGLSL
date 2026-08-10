# impl-plan-placement-fold.md — closure as a declared fact; maximal folds; the instance params tier

**Status: stages 1–3 BUILT Aug 9 2026 (vitest 1397 + glslang green; snapshot diffs =
exactly the predicted class — wrapper lines → ctor literals, `s·d` prefixes deleted,
rigid-only residual matrices). GPU witness sweep OWNER-GATED: instance-params-twin ≡
instance-params-frame + the existing transform/instance twins. Stage 4 deferred — own
batch, trigger = cube clouds wanted.**
Design session record: this plan. Authorities amended: `fable-transforms.md` §5.2/§6.1.
Related: `fable-instance-clouds.md` §8 (the cube deferral — stage 4 resolves it).

## The decomposition (owner-decided, Aug 9 2026)

Three facts were riding one flag; they are independent and each gates a different consumer:

- **A — `provides.analytic`**: a closed-form intersection exists. Pure intersection
  method. (Cylinder/box have the math; they were kept out only because the analytic
  path assumed total folding — the storage question contaminated the method question.)
- **B — `similarityClosed`**: a full similarity folds into the param rows. Genuine
  per-shape symmetry — NOT derivable from kind rows (sphere and cylinder have identical
  kinds; isotropy is the difference). Declared on the descriptor, verified both
  directions by an equivariance contract test.
- **C — `bounds()`**: instanceable at all (already separate).

Sub-fact of B, derivable: translation and scale fold for EVERY current shape (the point
row absorbs T, length/area rows absorb s) — the only thing that can fail to fold is R.
So the maximal-fold principle: **every constant placement folds maximally on every
backend; the wrapper serves only the residual, and the residual is identity or a pure
rotation.**

## Stage 1 — the closure fact (byte-identical)

- `similarityClosed: boolean` on `PrimitiveDescriptor` (required — every descriptor
  declares it): sphere/plane/quad/disk `true`; box/cylinder `false`.
- Contract test (both drift directions, the desugar-totality pattern): declared-true
  shapes satisfy point-mapping equivariance under random similarities (surface points of
  `g·Shape(params)` satisfy `Shape(fold(params, g))`); declared-false shapes must
  VIOLATE it for some rotation (a shape declared open that is actually closed, or vice
  versa, fails the suite).
- `foldAnalyticParameters` → `foldPlacementIntoParameters` (backend-neutral — the old
  name embodied the conflation). Call sites: Planner, App record packing,
  `authoring/instance.ts` sizeScale fold, tests. Throws on a non-closed type — the
  guard that makes `derivedFold`'s silent rotation-drop structurally unreachable
  (today it is only incidentally unreachable).

Gate: `npx tsc --noEmit`, vitest, snapshots byte-identical.

## Stage 2 — maximal fold on constant placements, both backends

- `classifyPlacement(type, values, g) → { parameters, residual: Similarity }` in
  `components/geometry/index.ts` beside `derivedFold` (one truth for Planner + App):
  - closed → `parameters = fold(values, g)`, residual identity;
  - non-closed with one point row → `parameters = derivedFold(values, g)` (center
    takes the full `g·center`; lengths ×s), residual = rotation about the folded
    center: `(1, R, (I − R)·c′)`. Derivation: `g·Shape(c, ℓ) = {g(c) + sR·u} =
    {c′ + R·v : v ∈ Shape₀(s·ℓ)}` — exactly the world→local query the EXISTING rigid
    tier emits (`p = Rᵀ(p − t_res)`), no new GLSL forms;
  - non-closed without exactly one point row (no current shape) → residual = g,
    parameters untouched (today's behavior, safe fallback).
- `resolveSDFPlacement` constant branch: route through `classifyPlacement` UNLESS the
  object `keepsLocalFrame` (uv-charted + uv-reading material + rotated — the oriented
  SDF chart inherits the wrapper's rotation, `intersection.ts` P1b coupling; the
  predicate gains its third reader). Retained objects keep today's exact emission.
  The old point-pre-fold (center → placement) is subsumed: the fold now goes the other
  direction (placement → center), same composed geometry, twin-gated.
- Consequences: closed constant SDF objects emit NO wrapper (bare `<type>_sdf` with
  folded ctor); non-closed constants demote to at-worst the rigid tier — the `s·d`
  similarity tier remains reachable ONLY via keepsLocalFrame retention (not dead).
- Emitted-code churn is the feature: every centered SDF object loses its historical
  `p = p - center` line (center rides the ctor literal, matching the analytic path).
  Snapshots re-goldened; diff must be exactly wrapper lines → ctor literals.

Gate: classifyPlacement vitest (residual-reconstruction property per shape), snapshot
re-golden with reviewed diffs, glslang, existing witnesses (transform-bake,
cross-backend, conjugation, regions-transformed, driven≡baked) on the owner's sweep.

## Stage 3 — the instancing params tier (fable-transforms §6.1 ABI amendment)

Per-batch record layout, decided at PLAN time from shape facts, never from data:

- predicate (in `dataTenantsOf`, beside keepsLocalFrame — Planner and App both read
  it): prototype backend analytic ∧ `similarityClosed` ∧ folded row width ≤ 4 floats
  ∧ ¬`materialReadsUv`(prototype material). Selects exactly sphere today (disk = 7
  floats — the 2-texel arm is deferred with a named trigger below).
- record = the folded canonical parameters, 1 texel, rows in schema order
  (`center.xyz, radius` = `rec.xyz, rec.w`). Pack folds per instance FLAT (no
  per-instance allocation — the Aug 8 discipline), reference-twin-gated against
  `foldPlacementIntoParameters` on a sample.
- ledger: per-batch record stride (frame 2 / params 1) replaces the hardcoded
  `2 × instanceCount`.
- leaf body (`instanceLeafItem` params arm): ONE fetch → ctor from texel components →
  `<type>_intersect` with the WORLD ray — no conjugation, no `placement_dir`, no
  `placement_normal`; normal from `<type>_normal` directly.
- TLAS boxes: the existing corner-transform loop is UNCHANGED (correct for both tiers;
  exact center±r tightening for rotated sphere placements is a deferred nicety).
- `.inst` format: ZERO changes. Orientation data on a params-tier batch is absorbed
  exactly by the fold (R fixes the canonical center) — accepted silently, per the
  format doc's "pointless for spheres".
- authoring pin `placementRecord: 'frame'` on `InstancedObject` (the `backend:`-pin
  pattern) — forces the frame arm for coverage; the params≡frame witness twin rides it.

Gate: ledger/pack vitest, snapshot re-golden (instancing scenes), glslang, witnesses
(params≡frame twin + existing instance twins + cloud regression) on the owner's sweep.

## Stage 4 — non-closed analytic occupants (DEFERRED; feature work, own batch)

Box slab test + cylinder quadratic as `_intersect`/`_normal` occupants
(`provides.analytic` → true); constant-rotated non-closed analytic route through the
EXISTING retained-frame constant arm (the P1b "movable shape with constant placement"
emission) with stage 2's folded T,s; instancing `'cube'`/`'cylinder'` shapes ride the
frame tier unchanged — **this closes the fable-instance-clouds §8 cube deferral** (its
blocker was exactly the A/B conflation). Witnesses: SDF-vs-analytic cross-backend
twins under rotation; a cube-cloud scene. Trigger: cube clouds wanted.

## Deferred ledger

- disk params-tier arm (2 texels — bandwidth tie, ALU win). Trigger: perf witness
  shows placement-fetch bound, or disk clouds wanted.
- CPU-side folding of DRIVEN placements on closed shapes through the values rail
  (folded params as derived uniforms — zero placement GLSL even when animated). The
  §6.1 rigid-frame contract serves driven until then.
- exact TLAS leaf boxes for params-tier batches (center±r under rotation).
- a perf-timing witness arm (ms/frame at fixed scene+spp) — recommended alongside any
  future traversal work (wide/compressed BVH nodes gate on it).
