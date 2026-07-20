# instancing — the placement-list multiplier (impl-plan-instancing + impl-plan-tlas)

Not an engine of its own: an instanced batch is **one prototype placed at N transforms**, realized
as the driven ray-into-local wrapper looped over a placement texture, against a shared prototype
(a mesh BLAS or an analytic closed form). Accelerated by a **per-batch TLAS** (a BVH over the
instance world boxes).

## TS surface (`instancing.ts`)
- `instanceExternNames(ordinal)` — extern texture names: `placements`, `tlas`, and the prototype's
  mesh BLAS textures (mesh prototypes only).
- `packPlacements(similarities)` — the per-instance rigid-frame pairs (`q_inv`, `(t_rigid, s)`),
  2 RGBA32F texels/instance, on the shared data rail (`DATA_TEX_WIDTH` + `data_texel1d`).
- `packInstanceBatch(localBox, placements)` — builds the batch TLAS: transforms the prototype box by
  each placement → `buildBVHNodes` → reorders the placements into leaf order + packs the node texture.

## GLSL (generated in `features/intersection.ts`)
`instance_batch_k` / `_any_k` — a stack-DFS over `u_inst_k_tlas` (world ray, pruned by hit.t/maxDist,
using `bvh_aabb_hit`/`BVH_STACK_DEPTH` from `accel/bvh/bvh.glsl`); at a leaf, loops the placement range
and runs the per-placement conjugate + prototype intersect. Two conventions (see the code): **mesh**
= ÷s ray (Möller–Trumbore is non-unit-safe) + unscaled BLAS; **analytic** = rigid ray (unit) +
s-scaled shape params. `estimator.instanceAccel: 'linear' | 'tlas'` swaps the walk for a plain loop
(the A/B baseline). One region/material per batch (v1, thin-like/opaque).

## v1 scope / deferred
v1: mesh + analytic prototypes, constant placements, one material per batch. Deferred: per-instance
materials, driven placements, SDF prototypes (the domain-repetition generalization), cross-batch
TLAS. See `docs/impl-plan-instancing.md` + `docs/impl-plan-tlas.md`.
