# geometry/ — intersection primitives + backends

**Taxonomy:** scene (defines the domain the integrand lives on). **Kind:** mix-many —
a scene may use the SDF backend (marching), the analytic backend (closed-form), or
both; the compiler generates `scene_intersect` / `scene_intersect_any` combining only
the backends present, plus the region tables (`material_of`, `ior_of`,
`scene_region_at`).

## Layout (impl-plan-geometry-descriptors, July 2026)

**One folder per primitive, both backends together**: `sphere/`, `plane/`, `box/`
(SDF-only), `cylinder/` (SDF-only, canonical Y-axis — orientation is placement),
`quad/` and `disk/` (analytic-only, zero-thickness — the two thin tenants; the disk's
unit `normal` is a real parameter because the analytic set must stay similarity-closed,
canonicalized through the descriptor `canonicalize` fact). Each folder holds ONE GLSL file
with all of that primitive's math — included wholesale when the primitive is present
(§2.12) — plus one descriptor (`<type>.ts`). This family owns the SHAPES only; the
engines that traverse them live in `components/intersection/` (the marcher — owner-
decided July 16: raymarching is an intersection METHOD, not geometry).
`similarity.ts` is the shared placement algebra (fable-transforms §2). The registry
lives in `index.ts` (`PRIMITIVES`).

## The occupant contract

A primitive supplies:

1. **GLSL — FUNCTIONS ONLY** (the `struct <Type>` is GENERATED from the descriptor
   rows, typedef-disciplined: point → `Point`, direction → `Direction`; declaring a
   struct in the occupant file is a contract-test FAILURE). Type-first symbols, the
   ONE convention across families (`lambert_eval`):
   - `float <type>_sdf(vec3 p, <Type>)` iff `provides.sdf` — the signed distance,
     ALSO the analytic backend's `scene_region_at` containment (one distance truth
     per primitive; the dichotomy: every primitive provides sdf XOR declares thin).
     Approximate SDFs are legal under the three clauses: correct sign everywhere,
     never overestimates world distance, ≈ true distance near the surface.
   - `bool <type>_intersect(Ray ray, <Type>, out float t)` and
     `vec3 <type>_normal(vec3 p, <Type>)` iff `provides.analytic`.
2. **A descriptor** (`PrimitiveDescriptor`, components/descriptors.ts): the schema
   row (`params` — ROW ORDER = GENERATED STRUCT FIELD ORDER = CTOR ORDER; each param
   declares `kind` (point | vector | direction | length — how it transforms under a
   similarity), `shape`, `required`, `default`, `constraint`), the declared surface
   (`provides.sdf` / `provides.analytic`), flat facts (`thin`, `samplableAsLight`),
   and — only when genuinely irregular — the `derivedFields`/`derivedCtorFields`
   pair (quad: the precompiled one-sided normal, a compile-time literal shared with
   the quad light's sampler so hit side and sample side agree bit-exactly) or a
   `fold` override (plane: the transformed offset couples translation with the
   rotated normal).
3. **One registry line** in `index.ts`. Nothing else — no type union (B1: object
   `type` is a string; the registry + Validator gatekeep), no demo entry for compile
   coverage (the kitchen-sink test synthesizes one from the registries).

The compiler resolves each object's BACKEND (B1 — shape, not backend): analytic if
`provides.analytic`, else sdf; a per-object `backend:` pin overrides for
research/coverage (Validator-rejected if unhonorable).

Everything mechanical is DERIVED from the row (`emitCtor`, `emitSdfCall`,
`emitAnalyticTest`, `emitSignedDistance` in `index.ts`): formatting by shape, the
similarity fold AND driven ×s scaling both derived from `kind` (everything scales
except directions; a coupled rule declares a `fold` override). The intersection
feature keeps all composition — dispatch loops, placement tiers, the §4.2 boundary
classification, region tables ("descriptors declare facts; generators decide").

## Adding a primitive (the recipe)

1. `geometry/<type>/<type>.glsl` — the math, per the symbol contract.
2. `geometry/<type>/<type>.ts` — the descriptor.
3. One line in `index.ts` (`PRIMITIVES`).

Placement (constant folds, wrapper tiers, driven uniforms), regions, and epsilons
come free — the wrapper machinery is placement-generic.

## Backend notes that matter downstream

- The generated `scene_march_bound` takes **min |sdf_i|** — UNSIGNED, arg-min — so
  marching works from interiors and stays bounded by nested inner surfaces;
  `scene_object_sdf` is the **per-owner** signed field for normals (the global
  signed min is hijacked by containers — R-SUBMERGED found it).
- Quads are **zero-thickness** (`thin`): containment never claims a point, so they
  are one-sided under `region_to` emission and back-face hits probe the entering
  side (audit H2; the fog-panel witness guards it).
- Analytic objects still get signed-distance classification arms — containment is a
  point question, not an intersection question; non-thin analytic primitives derive
  it from their own `<type>_sdf` body.
- Cross-backend agreement is witness-gated (`analytic-minimal`, `analytic-glass`
  twins must converge to the SDF partners' images).
