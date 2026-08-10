# impl-plan-sdf-accel.md — boxed-SDF leaves (Stage C): the build

**STATUS: owner-approved plan (Aug 10 2026) — the staged build of `docs/fable-sdf-accel.md`
(the design authority; read it first — every decision cited here is pinned there).
The owner declared the trigger and ordered the build in the same session that pinned
the design. Steps land green independently; cheap gates (tsc + targeted vitest)
between steps, snapshots re-goldened with audited classes, the witness sweep
owner-gated at the end.**

## T1 — substrate: the range slab test + the leaf-1 scene TLAS

- `bvh_aabb_hit_range(bmin, bmax, ro, inv, tmax, out t0, out t1)` beside the bool
  form in `accel/bvh/bvh.glsl` (the out-param its own comment reserves; the bool
  form and every existing caller byte-untouched).
- The scene TLAS builds at **leaf size 1** (design §2.1): one argument at the App's
  `buildBVHNodes` call. "Node box = object box" becomes an invariant.
- Gate: ZERO snapshot churn (the tree is data); vitest; bazaar re-gates at the sweep.

## T2 — plan side: eligibility, `LEAF_SDF`, records

- `dataTenantsOf`: SDF-backend objects that are constant ∧ `bounds()` ∧
  ¬`keepsLocalFrame` become `LEAF_SDF` table leaves. ROTATED ones are eligible
  (unlike the analytic arm — the SDF record carries the quat);
  driven/unbounded/frame-retained stay residual (the analytic rule verbatim).
- Records ride the existing 5-texel analytic stride: header (kindCode, regionId) +
  folded params + a quat texel for non-closed shapes (box = exactly 5 texels).
  Kind codes mint per **(type, arm)** — a box may appear as an analytic record AND
  an SDF record in one scene.
- App packs via `classifyPlacement` (folded params + residual quat) — the ONE fold
  truth, third consumer.
- Gate: ledger/adapter vitest (region sizes, solids-first ordering incl. SDF solids,
  determinism) before any GLSL exists.

## T3 — generate side: the leaf marchers + the walk arm

- One generated `march_leaf_<type>(Ray, float t0, float t1, <records args>, inout Hit)`
  per present tabled SDF type: conjugate by the record quat, march `|<type>_sdf|`
  clamped to the interval, gradient normal from the SAME conjugated field.
- **The named epsilon rule (design §3)**: interval dilated by `march_epsilon(t_exit)`
  (+ the slab pad); stall-commit only STRICTLY inside; per-leaf exhaustion = miss,
  traversal resumes.
- `scene_table_leaf`/`_leaf_any` gain the `LEAF_SDF` arm; the interval comes from
  `bvh_aabb_hit_range` on the node texels already in scope at `bvhWalkLines`' leaf
  position (leaf-1 ⇒ node box IS the object box) — no walk-skeleton change.
- Under table mode `generateSDFDispatch` shrinks to the RESIDUAL subset
  (mirroring `residualAnalytic`); an all-tabled scene carries NO global marcher.
- Gate: glslang every pair; snapshot audit = the new-arm class only.

## T4 — record-form per-owner queries for tabled SDF objects

Tabled params leave the baked `sdf_<name>` symbols, so the owner-keyed queries need
record-reading forms: `scene_region_at`'s SDF containment arm (now with the
**point-in-box early-out** — the Aug 10 review's ledger item closes),
`scene_object_sdf` (gradient normals + interior marching), `scene_object_uv`.
Gate: vitest + glslang; dielectric/nesting witnesses re-gate at the sweep (a tabled
glass box exercises exactly this).

## T5 — witnesses + the measurement referee

- **sdf-table-twin**: ~30 rotated mixed `backend:'sdf'`-pinned objects, table ≡
  unrolled IDENTICAL-STREAM equality (the bazaar gate — THE correctness proof) + a
  grazing-silhouette stress arm gating the §3 epsilon rule specifically.
- **perf-sdf** (`--perf`, report-only referee): procedural N ∈ {8, 32, 128},
  unrolled vs table arms → crossover N + slope. No default-policy change this batch
  (design §2.3); the crossover number reopens that question.
- Leaf-size 1-vs-2 confirmation on the same fixture.
- Existing marcher scenes (minimal, submerged, mist, cylinders) stay
  untouched-green — they are the unrolled regime.
- Then the owner's sweep.

## Out of scope (the follow-up doors)

SDF instancing (the frame-tier wrapper + `march_leaf_<type>` as the leaf body — its
own small batch once this lands), custom/expression fields (need declared bounds —
design §2.4), baked skip oracles, relaxation knobs.


## THE FAILURE AND THE FIX (Aug 10 2026 — the post-build incident record)

The first build FAILED at load past ~50 objects: pages never finished compiling
(SwiftShader AND Metal — backend-agnostic; on the owner's machine MTLCompilerService
pinned the system, then the WebGL context died to black). Headless localization
(cornell ✓ 3.2s / grand-bazaar ✓ 6.7s / sdf-table-twin@30 ✓ 4.4s / sdf-field@150
NEVER LOADS) proved the failure scaled with N with the march leaves present.

**The mechanism**: `march_leaf_<type>` committed through `raymarch_commit` — reusing
"the ONE hit body" — which calls `scene_normal` = six taps of `scene_object_sdf`, an
**N-arm dispatch**. GLSL compilers inline everything: ~6·N ops × 2 commit sites × 3
type marchers × nearest+any, nested inside the traversal walk. At N=30 ≈ 10⁴ inlined
ops (seconds); at N=150 the superlinear compile never returns. ONE line of misdesign:
an O(N)-body call inside a per-leaf inner loop.

**The fix (one shot, owner-authorized)**: the self-contained per-type commit
`march_commit_<type>` — normal = six taps of the leaf's OWN field (O(1)), rotated
once by the record's quat (`placement_normal`); uv from the type's own chart / the
planar placeholder; called at both acceptance sites (the two-paths-one-body
discipline, kept LOCALLY). Measured: sdf-field went from never-loads to
**ready 2.9s (SwiftShader) / 0.74s (Metal)**, rendering the same image as the twin
arms (mean-lum agreement across backends and arms). vitest 1759 + glslang green.

**The lesson, generalized**: in generated GLSL, never call an O(N)-dispatch from
inside a per-item inner loop — inlining multiplies it by every enclosing site. The
region-keyed O(N) dispatches (`scene_object_sdf`/`scene_object_uv`/`scene_normal`)
are safe ONLY at top-level call sites (the global marcher's 2 commit sites), never
inside leaves. Owner's GPU verdict on the fixed build: PENDING (their run + sweep +
the perf-sdf crossover).
