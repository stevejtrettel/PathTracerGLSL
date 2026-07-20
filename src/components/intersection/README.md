# intersection/ — the intersection-method axis

**Taxonomy:** the numerical engines by which rays find the scene's geometry — gated by
`ProgramDescription.intersection.backends` (`{ sdf, analytic, mesh }`; feature:
`compiler/generate/features/intersection.ts`, which combines exactly the arms present).
Distinct from `geometry/`, which owns the SHAPES (primitives, their math, the placement
algebra); this family owns the ENGINES that traverse them.

## Occupants

- `raymarch/` — the SDF backend's engine: sphere-tracing over the generated unsigned
  nearest-surface bound (`sdf_intersect`, stall-aware exhaustion in both directions,
  adaptive `march_epsilon`), the occlusion walker (`sdf_intersect_any`), and
  gradient normals over the per-owner signed field (`scene_normal`). See
  `raymarch/raymarch.md`; the acceptance threshold is COUPLED to `EPS_INTERFACE`
  classification — retune together or not at all.

The analytic backend needs no engine file — its "method" is the generated
closed-form dispatch (`generateAnalyticDispatch`) over the primitives' `<type>_intersect`
functions. The mesh backend (`mesh/` — impl-plan-meshes) is this family's second occupant:
a triangle engine over data-texture geometry, gated by `intersection.backends.mesh`.

`instancing/` (impl-plan-instancing + impl-plan-tlas) is the placement-list multiplier —
one prototype × N placements, accelerated by a per-batch TLAS — gated by
`intersection.backends.instanced`. `bvh_common.glsl` is the shared root file: the generic
BVH-traversal helpers (`bvh_texel1d`, `bvh_aabb_hit`, `BVH_STACK_DEPTH`) used by both the mesh
BLAS walk and the instance TLAS walk, so an analytic-only instanced scene pulls them without the
triangle leaf.

## Contract

The engine consumes the generated per-scene queries (`scene_march_bound`,
`scene_object_sdf`) and provides the backend walkers the generated
`scene_intersect` / `scene_intersect_any` dispatchers call. Region classification
(§4.2) is the dispatcher's job, not the engine's — the engine reports geometry +
owner only.
