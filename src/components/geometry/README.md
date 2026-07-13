# geometry/ — intersection backends

**Taxonomy:** scene (defines the domain the integrand lives on). **Kind:** mix-many —
a scene may use the SDF backend, the analytic backend, or both; the compiler generates
`scene_intersect` / `scene_intersect_any` combining only the backends present, plus
the region tables (`material_of`, `ior_of`, `scene_region_at`).

## Occupants

- `sdf/` — signed-distance primitives + the marcher (stall-aware exhaustion, adaptive
  `march_epsilon` — see the glancing-angle record). Per-owner signed SDF for normals
  (the global signed min is hijacked by containers — R-SUBMERGED found it).
- `analytic/` — closed-form primitives (sphere, plane, quad). Quads are zero-thickness
  regions: their containment never claims a point, and the dispatcher's owner-covers-
  own-side shortcut is invalid for them (audit H2).

A new backend (mesh/BVH someday) = primitive GLSL + dispatch arms in `intersection.ts`
+ parameter schemas here.

## What an occupant supplies

Primitive GLSL (`ray_*` / `sdf_*` functions), a dispatch arm in the compiler's
intersection feature, and **parameter schemas** in `index.ts` (`PRIMITIVE_PARAMS` —
the Validator checks authored parameters against them: unknown keys warn, missing
required error; a sphere without a radius is a typo, not a unit sphere — review C7).
`index.ts` also hosts `quadNormal` (the one-sided pin requires hit side and sample
side to agree — one formula, two readers: the analytic arms and the quad light).

## Contract context

Regions are globally unique across backends (§2.3); `Hit` carries
`region_from/region_to/region_owner` (§4.1-4.3, innermost-wins classification);
epsilon coupling between the marcher's acceptance and `EPS_INTERFACE` is documented
in the glancing-angle memory — retune together or not at all.

## Invariants & witnesses

Every suite scene exercises intersection; the two-backend twins (cornell-glass vs
analytic-glass) must converge to the same image; fog-panel guards back-face
`region_from` on thin quads.
