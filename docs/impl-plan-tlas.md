# impl-plan-tlas.md — the top-level acceleration structure (TLAS)

**STATUS: STAGE A BUILT — GPU-render-verified; numeric sweep owner-gated.** The per-batch instance
TLAS is done: `spheres` (500 instances) went **~7× faster (825 → 114 ms/frame on SwiftShader), same
image**, and `instance-twin` still matches its reference under the tree. tsc + vitest 1116 green
(incl. both instance backends through glslang). Stage B (data-driven distinct objects) and Stage C
(boxed SDF leaves) remain LATER. Build record §9. The plan follows for the record.

**Goal:** make instance count (and eventually object count) a *sub-linear* frame-rate cost. Today
every ray iterates all instances/objects linearly (`spheres`: 500 sphere tests/ray → 8.7 fps); a
TLAS walks a tree over their boxes instead.

---

## 1. The pivotal realization (why this splits in two)

A BVH indexes its leaves by a **runtime reference** — at a leaf, the shader must intersect "leaf
#k" by looking k up. That is only cheap if the geometry is **data-driven** (params/vertices in
textures, addressed by k). It clashes with "unroll into GLSL":

- **Instances are ALREADY data-driven** — placements live in a texture, the prototype's geometry in
  textures. A TLAS over instances is a clean drop-in: a BVH over placement boxes, leaves = placement
  ranges, reusing `buildBVH` + the BLAS traversal pattern. **No architectural shift.**
- **Distinct analytic/mesh objects are UNROLLED** — each object's params are baked into its own GLSL
  block. To index them by a runtime leaf ref you must either (a) a giant `switch(objIndex)` — keeps
  the huge shader, fixes only frame time, not load; or (b) move object params into a **data
  texture** — a real shift from unroll-by-default. And your measurement said the distinct-object
  pain is **load time (shader size)**, which only (b) fixes. So distinct-object acceleration = the
  data-driving shift, a bigger batch.

**Reconciled with "unroll by default; hundreds+ → batch":** these are two regimes. Small scenes stay
unrolled (fast, tiny shader, no TLAS). Scale comes from **instancing** (already data-driven) — and
the instance TLAS makes *that* path sub-linear. Distinct-object scale (many UNIQUE objects) is the
separate data-driving regime (Stage B), only worth it if you actually author many unique objects
rather than instancing.

So this plan is **Stage A now (instance TLAS — the clean, high-value scale win), Stage B later
(data-driven distinct objects), Stage C later (SDF leaves).**

## 2. The two-level model (the target shape)

- **BLAS (built):** a BVH over one mesh's *triangles*. Per unique geometry.
- **TLAS:** a BVH over *placed leaves*, each = a box + a way to intersect it. At a leaf the ray
  transforms into the leaf's space and runs its intersect (a BLAS walk, or an analytic closed form).
- In the fully general form every placed thing is a TLAS leaf and "distinct vs instanced" dissolves
  (Stage B). SDF objects join once boxed (Stage C). Stage A populates the TLAS with **instances**.

---

## 3. STAGE A — the per-batch instance TLAS (this batch)

Each instance batch (one prototype × N placements) gets a BVH over its **placement boxes**. The
`spheres`/`forest` demos are one batch → this directly makes them sub-linear.

### 3.1 Build (CPU/TS)
- **Prototype local AABB:** mesh prototype → the BLAS root node's bounds (already computed by
  `buildBVH`); analytic prototype → a per-primitive `bounds(params)` (sphere ±r, etc. — a small
  descriptor addition, derivable for built-ins).
- **Per-instance world AABB:** transform the prototype local AABB by each placement (8 corners →
  world AABB). Feed these N boxes to a **generalized `buildBVH`** (refactor its SAH core to take an
  AABB list; the triangle version becomes "compute tri-AABBs, then the same core"). Output: a node
  array + the placement order re-emitted so leaves are contiguous ranges.
- Node texture: the SAME 2-texel format as the BLAS (`min.xyz+A`, `max.xyz+B`); leaves store a
  placement-range `(offset,count)` into the reordered placement texture.

### 3.2 Traversal (GLSL)
Replace the instance batch's linear `for i in 0..INSTANCE_COUNT` with a stack DFS over the batch's
TLAS nodes (reusing `mesh_aabb_hit` + the stack pattern). At a leaf, loop the placement range and run
the **existing instance intersect body** (read placement → conjugate → prototype intersect → record).
So the leaf action is unchanged; only *which placements* it visits changes. `instance_batch_any_k`
gets the same walk.

### 3.3 Wiring
- `packPlacements` also builds the batch TLAS (reordered placements + node texture); App uploads a
  `instance_k_tlas` node texture alongside the placement texture.
- `PlannedInstanceBatch` gains nothing structural (the walk is self-terminating); the feature emits
  the TLAS walk instead of the linear loop. A tiny-N batch can stay linear (threshold knob).

### 3.4 Reuse
`buildBVH` (generalized to AABB input), the 2-texel node format, `mesh_aabb_hit`, the stack-DFS
skeleton, the whole existing instance intersect body. Genuinely small.

---

## 4. STAGE B — data-driven distinct objects + scene TLAS (LATER, the shift)

Sketch only. To accelerate many UNIQUE analytic/mesh objects (and fix their *load* time):
- Move analytic object params from baked GLSL into a **params texture**; one `analytic_leaf(kind,
  ref)` reads params by ref (kills the 500-unrolled-block shader → small + fast to load).
- Unify mesh BLAS data into shared textures with per-mesh base offsets (leaf ref → offsets).
- One **scene TLAS** over all object boxes; leaves dispatch by kind (analytic / mesh / instance-batch).
- This is the "real GPU renderer" data-driven design — it retires the unrolled dispatch for large
  scenes while keeping it for small ones (the two regimes, §1). Only worth it if distinct-object
  scale is a real need vs instancing.

## 5. STAGE C — boxed SDF leaves (LATER, with the SDF work)
Per the SDF discussion: give each SDF object an analytic AABB, march its field only inside the box
interval, and it becomes a TLAS leaf like the rest (disjoint SDF objects; overlapping SDF objects
keep the union-field fallback). Retires the separate SDF-march arm for disjoint SDFs.

---

## 6. Verification (Stage A)
- **Twin:** a TLAS'd batch ≡ the same batch linear → identical image (the instance-twin already
  compares instanced ≡ individual; add a large-N variant, or assert the TLAS render matches the
  linear render). The TLAS changes cost, not the image.
- **Builder test:** generalized `buildBVH` over AABBs — leaf ranges partition, boxes contain their
  instances, brute-vs-TLAS nearest agreement (extend the existing bvh.test cross-check to AABB leaves).
- **Perf (the point):** `spheres` + `forest` fps before/after (expect a large jump — 500 → ~log 500).
- tsc + vitest + glslang between iterations; GPU witness sweep owner-gated.

## 7. Build order (STOP points)
1. **Interface + the §1 split decision** (this doc). — **STOP: owner review.**
2. Generalize `buildBVH` to an AABB-list core (triangle path feeds it); unit-test.
3. Per-primitive `bounds(params)` for analytic prototypes; prototype-local AABB (mesh = BLAS root).
4. `packPlacements` builds the batch TLAS (reordered placements + node texture); App uploads it.
5. Feature: emit the TLAS walk in `instance_batch_k`/`_any_k` (replace the linear loop; tiny-N knob).
6. Witness + perf; tsc/vitest/glslang green; GPU render the forest/spheres before-after.
   — **STOP: owner GPU sweep + perf read.**

## 8. Decisions (my picks — correct me)
1. **Scope now = Stage A (instance TLAS).** It's the scale path (your "scale = instancing"
   philosophy), reuses everything, and directly speeds the `spheres`/`forest` demos. Distinct-object
   acceleration (Stage B) is the data-driving shift — defer unless unique-object scale is a real need.
2. **Per-batch TLAS** (one BVH per instance batch) vs one cross-batch TLAS. *Pick: per-batch* — one
   prototype per tree (clean leaves); few batches → linear over batches is fine.
3. **Tiny-N stays linear** (a threshold, e.g. < 8 instances skip the TLAS) — the BVH overhead isn't
   worth it for a handful. *Pick: yes, a small threshold.*
4. **Generalize `buildBVH`** to an AABB-list core, shared by BLAS (triangles) and TLAS (leaves).
   *Pick: yes — one builder, two feeders.*

---

## 9. Build record (Stage A — BUILT, GPU-render-verified)

Built in the §7 order; tsc clean, vitest 1116 green.

- **Shared SAH core:** `buildBVHNodes(AABB[])` extracted from `buildBVH` (BLAS byte-identical, bvh.test
  green). `buildBVH` = triangle-box feeder; TLAS = instance-box feeder. Added `transformAABB` (8-corner)
  + `rootBoxOf` + `BVHResult.rootBox`.
- **Prototype boxes:** `bounds(values)` on sphere/quad/disk descriptors (+ `primitiveBounds` helper);
  mesh prototype box = the BLAS root (`packMesh` now returns `rootBox`).
- **Per-batch TLAS:** `packInstanceBatch(localBox, placements)` — transform the box by each placement →
  `buildBVHNodes` → reorder the placement texture into leaf order + pack the node texture (shared
  `packNodes`). New extern `instance_k_tlas`.
- **App:** `_uploadInstances` computes the prototype box, builds the batch TLAS, uploads placement +
  tlas textures.
- **Feature:** `generateInstanceDispatch` emits a stack-DFS TLAS walk (`instanceTlasWalk`) whose leaf
  loops the placement range and runs the existing per-placement conjugate+intersect body
  (`instanceLeafItem`) — mesh (÷s, unscaled BLAS) and analytic (rigid, s-scaled) both. `_any_` mirrors it.
- Always-TLAS (no tiny-N threshold in v1 — one code path; a 3-instance tree is cheap and the
  instance-twin exercises it).

**GPU verify:** `spheres` (500) 825 → 114 ms/frame (~7×), same cloud; `instance-twin` ≡
`instance-twin-ref` under the tree; `forest` renders. SwiftShader numbers — the owner's GPU will be
faster still.

**Next:** owner `npm run witness` (instance-twin + regressions). Stage B (data-driven distinct
objects) and Stage C (boxed SDF leaves) when their scale/need arrives.
