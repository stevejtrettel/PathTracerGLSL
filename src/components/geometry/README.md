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

**The marched-only shapes** (Aug 2026, once "an SDF is a shape with a slow intersect"
made a distance field an ordinary occupant): `torus/` (the first shape whose march bound
is a DIFFERENT primitive), `bottle/` (a CONSTRUCTION — two rounded cylinders,
smooth-unioned, onion-hollowed, chopped, punted), `menger/` and `apollonian/` (the two
fractals), `knob/` (a VENDORED model — see below). They declare
`provides: { sdf: true, analytic: false }` and are authored exactly like a sphere; only
which intersect line the generator emits differs.

**A field with EMPTY INTERIOR declares its thickness** (`apollonian/` is the standing
instance). An IFS limit set has measure zero: the estimate is ≥ 0 everywhere and reaches
0 only on the fractal, so a marcher renders it only because acceptance is
`d < march_epsilon(t)` — which makes the SHAPE a function of the marcher's TOLERANCE, and
of viewing distance, since that epsilon grows with t. Such an occupant takes a
`thickness` row and returns `estimate − thickness`: the object is then the declared
ε-neighbourhood, with a genuine interior (so containment, dielectrics and media work) and
a picture that no longer moves when a tolerance does. Subtracting a constant preserves
the never-overestimates clause. Same discipline as the majorant clamp in
`fable-heterogeneous-media` — the shape IS the clamped thing, and it says so.

**An occupant's GLSL is SELF-CONTAINED.** Helpers are the shape's own, prefixed and
file-private (bottle's smooth combinators, knob's vendored operators, menger's cell
box) — files are included wholesale, so a helper defined in two of them is a link
error. There is deliberately no shared vocabulary file: shared operators are the same
question as scene-level shape composition, and that is open (owner, Aug 10 2026 —
single shapes get settled first). A second consumer of some operator is the signal to
have that discussion, not to quietly add an include.

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

A MARCHED shape (fable-sdf-contract) authors its FIELD and declares facts — it never
hand-writes marching code:

4. The field is CANONICAL — origin-centred, standard orientation, NO center row
   (position/rotation/scale are placement's alone). `<type>_sdf_intersect` and
   `<type>_sdf_normal` (4-tap tetrahedral gradient) are GENERATED from the field per
   marched type (`emitSdfIntersect`/`emitSdfNormal` in `index.ts` carry the rules —
   interval-end dilation, the grazing stall-commit, the `abs()` interior discipline);
   the contract test fails an occupant that hand-writes either. Per-shape declared
   knobs: `stepBudget` (loop bound; default `MAX_MARCH_STEPS`) and `lipschitz`
   (step divisor for estimate-valued fields; default 1).
5. `marchBound` — `'self'`, `'unbounded'`, or a DIFFERENT primitive with its parameters
   derived from this shape's moduli. Never inferred: a marchable shape that declares
   nothing fails the contract test naming itself. A bound that is too loose only costs
   march steps; one that is too tight silently clips geometry, which is why
   `marchBound.test.ts` samples the field against the declared bound. A cross-type
   bound also SUPPLIES the AABB — `bounds()` is derived from it, never restated.
6. A TS field twin in `tests/components/fieldTwins.ts` — the CPU side of both gates
   (containment above, and the placement-fold contract, whose "surface points" for a
   field-defined shape are found by Newton-projecting onto its zero set).

**Vendoring a model** (`knob/` is the worked example): keep the licence block verbatim
at the head of the file, PREFIX every helper with the occupant name (the sdf-explorer
corpus was written to compile one model at a time and its helper names collide; here
every occupant lands in one program), leave the maths — including the model's own
smooth operators — untouched, and MEASURE the bound with the twin rather than guessing
it. Prefer permissively-licensed models: most of that corpus is CC BY-NC-SA 3.0, which
is a licensing decision about this repo before it is a technical one.

## Backend notes that matter downstream

- There is NO combined SDF scene (impl-plan-sdf-as-shape retired the global
  min-march): each marched object steps `|its own field|` inside its bound's ray
  interval — UNSIGNED, so a ray inside a shape marches to its exit — and nested
  surfaces are found because every object is visited, not because of a global
  minimum. The per-object `sdf_<id>` wrappers survive only as containment arms
  (`scene_region_at`).
- Quads are **zero-thickness** (`thin`): containment never claims a point, so they
  are one-sided under `region_to` emission and back-face hits probe the entering
  side (audit H2; the fog-panel witness guards it).
- Analytic objects still get signed-distance classification arms — containment is a
  point question, not an intersection question; non-thin analytic primitives derive
  it from their own `<type>_sdf` body.
- Cross-backend agreement is witness-gated (`analytic-minimal`, `analytic-glass`
  twins must converge to the SDF partners' images).
