# fable-sdf-accel.md — boxed-SDF leaves (Stage C): the design

**STATUS: owner-approved DESIGN (Aug 10 2026) — supersedes `fable-sdf-accel-starter.md`
(the session brief) as authority; `fable-sdf-accel-research.md` remains the research
record behind it. BUILT the same day (the owner declared the trigger and ordered the
build; record `docs/impl-plan-sdf-accel.md` T1–T5, vitest 1755 + glslang green) — the
witness sweep (sdf-table-twin) and the perf-sdf crossover measurement are OWNER-GATED.
Placement-fold stage 4 (box/cylinder analytic occupants) landed FIRST as ordered, so
the tabled-SDF population today is the `backend:'sdf'` pins + future custom fields.
Build deviation from §2.2, declared: the containment record loop shipped WITHOUT the
point-in-box early-out — for PRIMITIVE fields the signed-distance eval costs about a
box test, so the early-out only pays when expression fields arrive (noted in the
generated code).**

## 1. The shape of the batch (decided)

Interval-restricted per-leaf marching as a **fourth scene-TLAS leaf kind (`LEAF_SDF`)**
— not a new tree, not a restructure of the global marcher (research §5, adopted).
Bespoke marchers emit **per TYPE, not per object**: one generated
`march_leaf_<type>(Ray, float t_enter, float t_exit, record, inout Hit)` per SDF
primitive type present, `<type>_sdf` inlined, the record's quat applied outside the
distance call. Object identity is data. Two regimes, mirroring Stage B exactly:
`objectDispatch: 'unrolled'` keeps today's global min-march byte-untouched (the
reference twin, and genuinely the right regime below ~10 objects);
`objectDispatch: 'table'` moves constant ∧ `bounds()` ∧ ¬`keepsLocalFrame` SDF objects
into TLAS leaves, with driven/unbounded/frame-retained in the residual global marcher
(the analytic rule verbatim). No new estimator axis; bias-free by contract; equality
witnesses are the gate.

## 2. Pinned decisions (the session's answers to the open questions)

1. **Scene-TLAS leaf size goes to 1, unconditionally** (not only when SDF leaves
   exist). This resolves record layout and leaf granularity as ONE decision: an SDF
   object alone in its leaf gets its march interval `[t_enter, t_exit]` from the TLAS
   node box the walk has already fetched — zero extra record texels. The record is
   exactly the folded params + the rigid-residual quat (box 10 floats, cylinder 9,
   pinned sphere 4 — inside the existing 5-texel analytic stride; NO stride change).
   "Node box = object box" becomes an invariant, not a special case. Scene tables are
   tens of objects — the extra nodes are noise; the TLAS leaf sweep already refuted
   big leaves for mere sphere tests, and a march is far more expensive than a node
   step. `bvh_aabb_hit` grows the anticipated entry/exit-distance out-param form
   (its own comment reserves this); the bool form stays for every other caller.
   The bazaar identical-stream gate is unaffected (traversal order touches neither
   the RNG stream nor nearest-hit results).
2. **Containment ships in-batch.** A tabled SDF object's params leave the baked
   `sdf_<name>` symbols, so `scene_region_at`, per-owner normals (`scene_object_sdf`),
   uv, and interior marching need record-reading forms regardless — the batch touches
   that loop anyway. Tabled SDF solids join the containment record loop behind a
   **point-in-box early-out** (the mesh root-box precedent) — this also retires the
   Aug 10 review's "containment is linear even under table" ledger item.
3. **No default-policy change.** `'table'` stays authored per-strategy until
   `perf-sdf` reports the crossover N (experiment ladder §5). Revisit the default
   with numbers only.
4. **The custom-field contract, declared now:** a distance field is table-eligible
   only with DECLARED bounds (no bounds → residual — the plane precedent); any future
   `smin` blend must share ONE leaf with its blend partners, box dilated by the blend
   radius (interval restriction distributes over hard `min` only — research §3 pin 1).
   Ties to expression-machinery cap D (interval bounds) when custom fields arrive.

## 3. The interval-end epsilon rule (elevated from research prose to a NAMED pin)

Each leaf interval is dilated by `march_epsilon(t_exit)` plus the Ize slab pad
(`BVH_TFAR_PAD`, already single-sourced), and **a stall NEVER commits at a box
boundary** — stall-commit applies per leaf and only strictly inside the dilated
interval; per-leaf exhaustion is a miss that resumes traversal. This is the one
artifact class the design can newly introduce (clipped silhouettes / dotted cut lines
at box faces), so it is a named rule with its own witness: the grazing-silhouette
stress arm (§5.3). Interior rays are the unsigned-|sdf| semantics per leaf
(`t_enter = 0` inside your own leaf), which is cleaner than the global entanglement —
research §3 pin 3.

## 4. Seams (all existing; verified in the Aug 9 audit + the Aug 10 consolidation)

- Eligibility opens at `dataTenantsOf`'s one backend line; the analytic-eligibility
  predicate generalizes (constant ∧ bounds ∧ ¬keepsLocalFrame).
- Records ride the 5-texel analytic stride with a kind-code header; readers are the
  generated `<type>_from_record` pattern plus a quat texel for non-closed shapes.
- `scene_table_leaf` gains the `LEAF_SDF` arm calling `march_leaf_<type>`; the `_any`
  twin gets the unordered first-hit arm with intervals clamped to `[0, t_light]`
  per leaf (the maxDist lesson, generalized).
- The walk emitter is `bvhWalkLines` (Aug 10 — ONE skeleton); the entry-distance
  variant extends it, not a new copy.
- Shadow rays: restriction drops commit ordering — any leaf order, terminate on first
  accepted hit.
- GRIN is untouched (research §2: the walker's only geometry query is membership via
  `scene_region_at` + `ior_at`; interior per-owner marching already restricts to one
  field).

## 5. Proof regime (the CWBVH discipline: measure before committing the default)

1. **perf-sdf** (report-only referee): procedural mixed scene of `backend:'sdf'`-pinned
   shapes, N ∈ {8, 32, 128}, arms unrolled vs table → the crossover N + scaling slope.
   (Pins are required post-stage-4: box/cylinder resolve analytic by default.)
2. **Leaf-granularity confirmation** on the same fixture (expectation: 1 wins; if 2+
   ever wins, records grow per-object boxes — the decision in §2.1 is revisited with
   numbers, not silently).
3. **Twin gates**: ~30-object rotated mixed-SDF scene, table ≡ unrolled
   identical-stream (bazaar pattern); a grazing-silhouette stress arm for §3;
   re-gate regions-transformed / submerged / cylinders / mist.

## 6. Explicitly out of scope

SDF instancing (domain repetition — its own deferred batch; `LEAF_SDF` covers N
DISTINCT objects), baked/sampled fields (bias-safe only as conservative skip oracles —
research §4, far future), segment tracing / relaxation (vacuous on exact λ=1 primitive
fields; a later knob for custom fields, never a dependency).
