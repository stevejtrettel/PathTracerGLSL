# intersection/ — the intersection-method axis

**Taxonomy:** the numerical engines by which rays find the scene's geometry — gated by
`ProgramDescription.intersection.backends` (`{ sdf, analytic, mesh }`; feature:
`compiler/generate/features/intersection.ts`, which combines exactly the arms present).
Distinct from `geometry/`, which owns the SHAPES (primitives, their math, the placement
algebra); this family owns the ENGINES that traverse them.

## Occupants

- (`raymarch/` was RETIRED at impl-plan-sdf-as-shape T3, Aug 10 2026.) Marching is no
  longer an engine that traverses the scene: **an SDF object is a shape whose intersect
  ITERATES**, so the march lives in each shape's own file beside its distance function
  (`<type>_sdf_intersect`, `<type>_sdf_normal`) and runs only inside that shape's
  DECLARED bound. The measurement that settled it is in `docs/impl-plan-sdf-as-shape.md`
  §0. Shared tolerances are `glsl/core/march.glsl`; the acceptance threshold is still
  COUPLED to `EPS_INTERFACE` classification — retune together or not at all.

Neither the analytic nor the marching method needs an engine file — both are generated
per-object dispatches over the primitives' own functions (`<type>_intersect` for the
closed forms, `<type>_sdf_intersect` inside a declared bound for the marched ones). The mesh backend (`mesh/` — impl-plan-meshes) is this family's second occupant:
a triangle engine over data-texture geometry, gated by `intersection.backends.mesh`.

The family REGISTRY (`index.ts` — held since founding, opened by the audit batch) holds
the genuine one-of-N axes: `MESH_TRAVERSALS` (`estimator.meshTraversal`: brute | bvh) and
`INSTANCE_ACCELS` (`estimator.instanceAccel`: linear | tlas). **A new traversal engine =
one descriptor + one registry line** (the Validator's membership check and the feature's
extern/define gating both read the registry). Geometry BACKENDS deliberately have NO
registry — they are scene-derived capabilities that compose (`intersection.backends`),
and a fourth geometry class is a design event, not an occupant drop.

`instancing/` (impl-plan-instancing + impl-plan-tlas) is the placement-list multiplier —
one prototype × N placements, accelerated by a per-batch TLAS — gated by
`intersection.backends.instanced`. Both engines stand on two SUBSTRATES outside this
family: the data rail (`components/data_textures.ts` + `glsl/core/data_texture.glsl` —
`DATA_TEX_WIDTH`, `data_texel1d`) and the BVH build core + ray-walk support
(`components/accel/bvh/` — `buildBVHNodes`, `bvh_aabb_hit`, `BVH_STACK_DEPTH`), so an
analytic-only instanced scene pulls those without the triangle leaf, and future clients
(light BVH, majorant grids) import the substrates without touching this family.

## Contract

The engine consumes the generated per-scene queries (`scene_march_bound`,
`scene_object_sdf`) and provides the backend walkers the generated
`scene_intersect` / `scene_intersect_any` dispatchers call. Region classification
(§4.2) is the dispatcher's job, not the engine's — the engine reports geometry +
owner only.
