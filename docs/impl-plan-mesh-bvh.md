# impl-plan-mesh-bvh.md — the mesh BVH (v1 accelerator)

**STATUS: BUILT — GPU-render-verified; numeric witness sweep owner-gated.** Owner-approved forks:
swappable axis (A), 2-texel float encoding, default LEAF_SIZE=2/K=12, one BVH per mesh. tsc +
vitest 1100 green (incl. the builder cross-check + both engines through glslang). GPU verify: the
`models` scene (teapot+cactus, ~7.5k tris) renders correctly under the BVH at **16 fps / 61 ms
on SwiftShader — where brute force could not produce a first frame** on the same emulated GPU.
Build record §10. The pre-build plan follows for the record.

**Goal:** replace the brute-force per-ray triangle scan with a BVH-accelerated traversal, so
the `models` scene (teapot + cactus, ~7.5k tris — **0.7 fps brute force**) renders the *same
image* at interactive rates. Correctness is already proven; this batch is purely about cost.

---

## 1. What v0 left ready (the drop-in was designed)

- **The shared triangle leaf.** `mesh.glsl`'s Möller–Trumbore test + attribute fetch + normal/uv
  interpolation is the exact code a BVH leaf runs — v0's brute-force loop is just that leaf over
  `[0, triCount)`. The BVH changes *which ranges* call it, nothing inside.
- **The data-texture rail.** `extern:` chain, `registerDataTexture`, `createRGBA32F`, `packMesh`,
  `App._uploadMeshes`, `meshExternNames`/`MESH_TEX_WIDTH` — a BVH node texture is one more extern
  on rails that exist.
- **Ray-into-local.** The per-mesh wrapper already conjugates the world ray into the mesh's local
  frame; the BVH is built and traversed in that same local frame (no per-ray transform of nodes).
- **Witnesses.** `mesh-furnace` (0.4) and `mesh-quad-twin ⇄ mesh-quad-ref` become the regression:
  the BVH must reproduce them bit-for-bit-equivalent (it changes cost, not the integrand).

---

## 2. The builder (CPU/TS — binned SAH)

Lives in `components/intersection/mesh/bvh.ts` (pure TS, imported by the app packer). Input: the
mesh's LOCAL positions + indices. Output: a flattened node array + a **reordered triangle index**
(so leaf triangle ranges are contiguous — three-mesh-bvh's scheme).

1. Per triangle: centroid + AABB.
2. Recursively split a node's triangle set:
   - **Binned SAH:** for each axis, bin centroids into K bins (K≈12); accumulate per-bin AABB +
     count; sweep to evaluate `cost(split) = SA(L)·N(L) + SA(R)·N(R)` (÷ parent SA + a traversal
     constant). Take the best axis+plane across all three axes.
   - **Leaf** when `N ≤ LEAF_SIZE` (≈2–4) or the best split doesn't beat the leaf cost `N`.
3. **Flatten DFS:** left child is emitted immediately after the parent (implicit `node+1`); the
   right child's index is stored. Leaves store `(offset, count)` into the reordered index.

Deterministic (no RNG). Recursion is fine for v1; switch to an explicit work-stack only if a
pathological mesh blows the JS stack (noted, not pre-built).

## 3. Node texture layout (RGBA32F, 2 texels/node — no usampler2D)

Following v0's "index as exact float, no bit-packing" choice, a node is **2 RGBA32F texels**:

```
texel 2i   = (min.x, min.y, min.z, A)
texel 2i+1 = (max.x, max.y, max.z, B)

A >= 0  → LEAF:     count = A,  offset = B           (triangle range in the reordered index)
A <  0  → INTERNAL: splitAxis = -A - 1 (∈ 0,1,2),  rightChild = B,  leftChild = i + 1
```

No third texel, no bit-fields, no `usampler2D` (so no ShaderBuilder change). One new extern per
mesh: `mesh_N_bvh`. The index texture is re-emitted in BVH-leaf order (positions/normals/uv
unchanged — leaves reference triangles, which reference vertices).

## 4. Traversal GLSL (the walk around the shared leaf)

`mesh_nearest_bvh` / `mesh_any_bvh` in `mesh.glsl` — a fixed-stack DFS:

```glsl
int stack[BVH_STACK_DEPTH]; int ptr = 0; stack[0] = 0;   // root
while (ptr >= 0) {
    int ni = stack[ptr--];
    vec4 t0 = fetch(bvh, ni*2), t1 = fetch(bvh, ni*2 + 1);
    float tenter;
    if (!aabb_hit(t0.xyz, t1.xyz, ro, rd, tmax, tenter)) continue;   // slab test, prune by tmax
    if (t0.w >= 0.0) {                       // LEAF → the SAME triangle test as v0, over [off, off+cnt)
        <the v0 mesh_test_range inner loop, updating tmax / nLocal / uv / found>
    } else {                                 // INTERNAL → push children, NEAR child last (popped first)
        int axis = int(-t0.w - 1.0), L = ni + 1, R = int(t1.w);
        bool nearFirst = rd[axis] >= 0.0;
        stack[++ptr] = nearFirst ? R : L;
        stack[++ptr] = nearFirst ? L : R;
    }
}
```

- `aabb_hit` = the tavianator slab test (transcribed), returning the entry distance for the
  `tenter > tmax` prune (skip boxes farther than the current nearest).
- `BVH_STACK_DEPTH` = a numeric `#define` (a knob, not a structural gate) — sized to the max tree
  depth (≈2·log₂(triCount)+slack; 32–64 is ample).
- The leaf body is refactored out of v0's `mesh_nearest_local` into a shared `mesh_test_range(...)`
  so brute-force and BVH call ONE triangle test — no drift.

## 5. THE fork: swappable traversal, or BVH-only?

The intersection family was explicitly "held for the BVH/mesh backend" and the house style is
"build the swappable axis." Two options:

- **(A) Swappable `meshTraversal: 'brute' | 'bvh'` axis (recommended).** Both are occupants of the
  mesh engine; the feature emits one wrapper or the other; the app builds+uploads the BVH texture
  only in `bvh` mode. **Gives a LIVE A/B toggle** (key-switch brute vs bvh on the `models` scene —
  the comparison you asked for, on one scene, same image) and honors the modular principle. Cost is
  low: brute = the shared leaf over the full range (already written); bvh = the walk around it. The
  decision is bias-free (same converged image), so it rides `estimator` per the taxonomy
  (`estimator.meshTraversal`, default `'bvh'`) → `ProgramDescription.intersection`.
- **(B) BVH-only.** Delete brute force; compare via git/the remembered 0.7 fps. Less code, no live
  toggle.

*My position: (A)* — the live toggle is the cleanest way to get the before/after you want, it's
the idiomatic fit for the intersection registry, and it's nearly free given the shared leaf.

## 6. Wiring

- `packMesh` (or a new `packMeshBVH`) also builds the BVH and emits the node texture + reordered
  index; `App._uploadMeshes` registers `mesh_N_bvh` alongside the existing four.
- `PlannedMesh` gains nothing structural for BVH (the walk is self-terminating); `triCount` stays
  only for the brute path. `ProgramDescription.intersection` carries the `meshTraversal` decision
  (if fork A).
- `features/intersection.ts`: the per-mesh wrapper calls `mesh_nearest_bvh` (+ the bvh extern) or
  `mesh_nearest_local` per the decision. Dispatcher/thin-set/region tables unchanged.

## 7. Verification

- **Builder unit test (TS):** every triangle in exactly one leaf; leaf ranges partition
  `[0, triCount)`; each node's bounds contain its triangles' AABBs; child indices in range; a
  brute-force-vs-BVH ray-hit cross-check on a random mesh (same nearest hit for N random rays).
- **Witnesses reproduce:** `mesh-furnace` (0.4) and `mesh-quad-twin` unchanged — the BVH is a
  cost-only change. glslang static-compiles the new traversal (auto, via the suite).
- **Perf (the point, not a gate):** the `models` scene — record `pathtracer` ms/frame brute (0.7
  fps baseline) vs bvh. Expect a large multiple (thousands of triangles → log-depth traversal).
- tsc + vitest between iterations; GPU witness sweep owner-gated.

## 8. Build order (STOP points)

1. **Interface + fork decision** (this doc, §3–§5). — **STOP: owner review.**
2. `bvh.ts` builder + unit test (pure TS — provable before any GLSL).
3. Refactor v0's leaf into `mesh_test_range`; add `aabb_hit` + `mesh_nearest_bvh`/`mesh_any_bvh`.
4. Packer emits node texture + reordered index; `App` uploads `mesh_N_bvh`.
5. Feature: emit the bvh wrapper + extern; `meshTraversal` decision (fork A).
6. Witnesses reproduce; tsc + vitest green; render `models` both ways, record the numbers.
   — **STOP: owner calls the GPU witness sweep + eyeballs the perf win.**

## 9. Open decisions

1. **§5 fork** — swappable `meshTraversal` axis (my pick) vs BVH-only.
2. **Node encoding** — 2-texel float-packed (my pick, §3) vs 3-texel (clearer, +50% node memory)
   vs a real `usampler2D` bit-packed record (matches three-mesh-bvh exactly, needs a ShaderBuilder
   sampler-type change). *My pick: 2-texel float — no new machinery, plenty of headroom.*
3. **LEAF_SIZE / bin count** — start `LEAF_SIZE=2`, `K=12` bins (standard); tune against `models`.
4. **One BVH per mesh now; instancing/TLAS later** — v1 is one BLAS per mesh, traversed in local
   space (no shared-BLAS instancing yet — that's the contract's `instances?` capability, deferred).

---

## 10. Build record (BUILT — GPU-render-verified)

Built in the §8 order; tsc clean, vitest 1100 green.

- **Builder** — `components/intersection/mesh/bvh.ts` (`buildBVH`): binned SAH (K=12, LEAF_SIZE=2),
  best-of-3-axes, flattened DFS (implicit left child), reordered triangle index. Unit-tested
  (`tests/components/bvh.test.ts`): leaf ranges partition [0,T), node bounds contain triangles,
  valid child links, and a **brute-vs-BVH nearest-hit cross-check over 500 random rays**.
- **Node texture** — 2 RGBA32F texels/node (`min.xyz + A`, `max.xyz + B`; `A≥0` leaf, `A<0`
  internal), packed by `packMesh` (`packNodes`) into the `mesh_N_bvh` extern. Index texture is
  re-emitted in BVH-leaf order (both engines read it; brute is order-independent).
- **Traversal** — `mesh.glsl`: the v0 leaf refactored into the shared `mesh_test_range` /
  `mesh_any_range`; `mesh_aabb_hit` (slab); `mesh_nearest_bvh` / `mesh_any_bvh` (fixed
  `BVH_STACK_DEPTH=64` DFS, near-child-first, `tenter > tmax` prune). Brute (`mesh_nearest_local`)
  and BVH call the SAME leaf — no drift.
- **Swappable axis** — `estimator.meshTraversal: 'brute' | 'bvh'` (default `bvh`) →
  `ProgramDescription.intersection.meshTraversal`; the intersection feature emits the matching
  wrapper and declares `mesh_N_bvh` only for bvh (exact linkage). App always builds+uploads the BVH
  (scene-static; a brute program just never binds it).
- **A/B demo** — `models`: key 1 = bvh, key 2 = brute (pixel-identical), key 3 = pt. glslang checks
  both engines × flat/smooth/driven.

**GPU verify:** `models` under bvh renders the teapot+cactus correctly (smooth normals, shadows,
no artifacts) at 16 fps / 61 ms on SwiftShader; brute force stalled before the first frame there.

**Next (owner):** `npm run witness` (mesh-furnace + mesh-quad-twin now run under bvh — must still
hit 0.4 and the twin) — the owner-gated numeric gate. Then: SAH refinements, a second BVH occupant,
multi-material meshes, or instancing/TLAS as priorities dictate.
