# intersection/ — the intersection-method axis

**Taxonomy:** the numerical method by which rays find the scene's geometry — the
occupant of `ProgramDescription.intersection.method` (feature:
`compiler/generate/features/intersection.ts`). Distinct from `geometry/`, which owns
the SHAPES (primitives, their math, the placement algebra); this family owns the
ENGINES that traverse them.

## Occupants

- `raymarch/` — the SDF backend's engine: sphere-tracing over the generated unsigned
  nearest-surface bound (`sdf_intersect`, stall-aware exhaustion in both directions,
  adaptive `march_epsilon`), the occlusion walker (`sdf_intersect_any`), and
  gradient normals over the per-owner signed field (`scene_normal`). See
  `raymarch/raymarch.md`; the acceptance threshold is COUPLED to `EPS_INTERFACE`
  classification — retune together or not at all.

The analytic backend needs no engine file — its "method" is the generated
closed-form dispatch (`generateAnalyticDispatch`) over the primitives' `<type>_intersect`
functions. The future mesh backend's BVH traversal is this family's next occupant
(`intersection.method` grows a value when it lands).

## Contract

The engine consumes the generated per-scene queries (`scene_march_bound`,
`scene_object_sdf`) and provides the backend walkers the generated
`scene_intersect` / `scene_intersect_any` dispatchers call. Region classification
(§4.2) is the dispatcher's job, not the engine's — the engine reports geometry +
owner only.
