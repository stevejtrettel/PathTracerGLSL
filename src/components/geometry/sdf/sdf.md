# SDF backend — what it computes and why

Geometry as signed distance: each primitive is a function `sdf_*(p) → float` whose
sign says inside/outside and whose magnitude bounds the distance to the surface.
Intersection is sphere-tracing: step by the scene's unsigned nearest-surface bound
until it collapses.

The pieces and why they are shaped this way:

- `sdf_primitives.glsl` — the closed-form distance functions (`sdf_sphere`,
  `sdf_plane`, `sdf_box`); the compiler wraps them into per-object `sdf_object_<i>`
  functions with baked parameters and translations.
- The generated `scene_march_bound(p, out region)` takes **min |sdf_i|** —
  UNSIGNED, arg-min over objects. Unsigned so marching works from object interiors
  (dielectrics, media) and stays bounded by nested inner surfaces; the signed min
  would overshoot them.
- The generated `scene_object_sdf(p, region)` — the **per-owner** signed field, used
  for normals: the gradient of the HIT object's own SDF. The global signed min is
  hijacked by containers (inside a water pool, the pool's deeply negative value wins
  everywhere, and its gradient points at the nearest POOL face — cube-quantized
  normals on a submerged sphere; R-SUBMERGED found it).
- `raymarch.glsl` — the marcher: stall-aware exhaustion in both directions plus an
  adaptive `march_epsilon`, the fix for grazing-angle black edges. The acceptance
  threshold is COUPLED to `EPS_INTERFACE` classification (see the glancing-angle
  memory) — retune together or not at all.

Parameter schemas live in `../index.ts` (`PRIMITIVE_PARAMS`): required parameters
error when missing — `{ r: 2 }` silently rendering a unit sphere is the bug class
this table exists for (review C7).
