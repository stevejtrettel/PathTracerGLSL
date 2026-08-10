# fable-sdf-accel-starter.md — boxed-SDF leaves (Stage C): the session starter

**STATUS: starter brief (Aug 9 2026) — NOT a design. Read this at the top of the
design session; the session's owner-approved design supersedes it. Written while the
accel research batch's audit is fresh (fable-accel-cwbvh.md has the measurement
context; the CWBVH no-go does NOT touch this — this is about indexing OBJECTS, not
node formats).**

## The problem, precisely

SDF objects are the ONLY geometry class with no spatial index. The marcher's bound is
a min over EVERY SDF object at EVERY step:

- `scene_march_bound(p, out region)` — generated at
  `src/compiler/generate/features/intersection.ts` (`generateSDFDispatch`): a linear
  chain of `d_obj = abs(sdf_<id>(p)); if (d_obj < d) …` over all planned SDF objects.
  Cost per RAY = N_sdf × steps (steps up to 512 with the grazing-stall discipline).
- The same linear shape appears in `scene_object_sdf` (per-owner gradient/normals),
  `scene_object_uv`, interior marching, and `scene_region_at`'s SDF containment arm.

Today this doesn't bite: most primitives resolve analytic (shape-not-backend), and
SDFs are the research shapes (GRIN spheres, marcher-pinned coverage scenes, future
custom distance fields). **Trigger: any scene composing more than a handful of SDF
objects** — the GRIN/embedded-geometry direction is the likely igniter.

## What already exists to build on (verified in the Aug 9 audit)

- **The scene TLAS** (Stage B, `objectDispatch: 'table'`): typed leaf records +
  `LEAF_ANALYTIC/LEAF_MESH/LEAF_BATCH` kinds, a residual unrolled arm for
  driven/unbounded objects. SDF objects are currently EXCLUDED by
  `dataTenantsOf` ("SDF objects stay in the marcher arm"). The natural shape of this
  batch is a **fourth leaf kind (`LEAF_SDF`)**, not a new tree.
- **`bounds()`** is an existing per-primitive descriptor fact (sphere/quad/disk
  declare it — instancing prototypes require it). Box/cylinder do NOT declare it yet;
  their bounds are trivially rows-derived (center ± halfSize; center ± (r, h, r)).
  A registered SDF shape without `bounds()` stays residual (the plane precedent).
- **Placement-fold (Aug 9)**: closed constant SDF shapes now carry FOLDED params (no
  wrapper); non-closed keep a pure-rotation rigid residual. Boxes for the TLAS come
  from `bounds(foldedParams)` transformed by the residual rotation (the 8-corner
  transform, `transformAABB` in accel/bvh/bvh.ts).
- The binary TLAS walk is the measured platform optimum (fable-accel-cwbvh verdict);
  no node-format questions here.

## The mathematical core the session must pin (this is the interesting part)

Sphere tracing against a SUBSET of objects is only valid where the subset's fields
bound the distance to EVERY surface the ray could hit. The standard resolution is
**interval-restricted marching**: walk the scene TLAS front-to-back; each SDF leaf
contributes a ray interval [t_enter, t_exit] of its (conservative) box; march WITHIN
an interval using only that leaf's SDF(s), clamping steps to the interval's end.

Correctness argument to write down properly in the session:
1. Inside interval I of leaf L, surfaces of objects ∉ L lie outside L's box... FALSE
   in general — boxes overlap. The correct statement: process intervals in t order,
   maintain global tmax; a hit found in interval I at t_hit only COMMITS once every
   interval starting before t_hit has been processed (or prune: intervals with
   t_enter > running t_hit are skipped — the standard nearest-hit walk shape).
   Overlapping SDF boxes → a leaf's march may need the OTHER leaf's field for the
   bound? NO — marching only needs a lower bound on distance to L's OWN surfaces to
   find L's nearest hit in I; other objects' hits come from their own intervals.
   Within-interval march of only-L is exactly the per-object closed-form pattern the
   analytic arm uses; the min-over-all-objects global march is NOT required for
   correctness, only for the historical single-arm structure. This reframing (march
   per leaf, not per scene) is the heart of the batch — check it against
   trace-loop-contract + the §2.3/§2.7 region rules before building.
2. Containment (`scene_region_at`, innermost-wins) still needs candidate solids at a
   POINT — a point-in-box TLAS query (the mesh containment root-box early-out
   precedent), or keep the linear loop for solids (small counts) — session decision.
3. Interior marching (dielectric/GRIN regions): the walk inside region R can restrict
   to R's box — the owner's field is the only one marched there already
   (`scene_object_sdf`), so this may be nearly free.
4. The march-epsilon discipline (`march_epsilon(t)`, EPS_INTERFACE, stall-commit) is
   world-space and per-t — unaffected by leaf restriction, but the interval END needs
   the same care as surface proximity (don't commit a stall at a box boundary).
5. GRIN walker (variable-IOR regions): steps its own ODE with per-step sdf probes —
   audit `grin.glsl`'s probe sites before assuming this batch touches them.

## Sketch of the seams (verify before trusting)

- `dataTenantsOf`: SDF objects with `bounds()` ∧ constant placement → table-eligible;
  driven/unbounded stay residual (exactly the analytic rule).
- Records: an SDF leaf record = the folded params (the analytic record pattern —
  `<type>_from_record` readers exist) + the rigid-residual rotation when non-closed
  (a records-side quat — new record layout question for the session).
- The walk: `scene_table_intersect` gains an `LEAF_SDF` arm that runs the
  interval march (`march_leaf(...)` — a new marcher entry point taking an interval +
  ONE object's params instead of the global bound).
- Estimator surface: no new axis — this rides `objectDispatch: 'table'` (the
  march-restructure is an estimator-internal change, bias-free by contract, equality
  witnesses the gate).

## Proof regime sketch

- Twin: a many-SDF scene (e.g. 30 SDF spheres/boxes/cylinders under rotations)
  table ≡ unrolled-marcher, identical-stream gates (the bazaar pattern).
- The existing marcher-pinned scenes (minimal, submerged) stay untouched/green.
- Perf: a `perf-sdf` fixture (procedural N-SDF scene, N ~ 50–200) with table vs
  unrolled arms — the win should scale with N; report the crossover.
- Region/containment witnesses: regions-transformed + submerged re-gated.

## Open questions for the owner in the session

1. Leaf granularity: one SDF object per leaf vs letting SAH group nearby SDFs into
   one leaf whose march takes the min over 2–3 fields (leaf-size question, measured).
2. Whether containment joins the TLAS now or stays linear (count-driven).
3. Custom/user SDF expressions (future): they'd need DECLARED bounds — ties into the
   deferred expression-machinery interval-arithmetic capability (cap D in that plan).
