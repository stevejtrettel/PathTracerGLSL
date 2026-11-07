# lights/ — samplable emitter kinds

**Taxonomy:** scene (defines the source term Le). **Kind:** mix-many — kinds coexist;
the compiler generates the light structs, the hoisted consts, the selection CDF, and
the `lighting_sample` dispatcher.

## What an occupant supplies (struct-alignment + door batches, July 17 2026)

**GLSL** (`<kind>.glsl`) — FUNCTIONS ONLY (the `<Kind>Light` struct is GENERATED from
the descriptor rows). Type-first symbols; the `_light_` infix is deliberate:

- `LightSample <kind>_light_sample(<Kind>Light l, Point p, vec2 xi)` — `wi` (unit,
  toward the light), `distance`, `radiance` (incident, WITHOUT visibility), `pdf` in
  **solid-angle measure from the shading point** (per-light only — selection
  multiplies in at the dispatcher), `flags`.
- Hittable (non-delta) kinds ALSO define
  `float <kind>_light_pdf(<Kind>Light l, Point p, Point light_p, Direction wi)` —
  the MIS density, which MUST mirror the sampler (§6.1). The mirror is now two
  ADJACENT functions over one struct in one file — never TS strings.

**Curved bodies** (`<kind>_<space>.glsl`) take the query and, for the pdf, the transport's
`wo` at the emitter hit (the arrival direction reversed):
`<kind>_light_sample(<Kind>Light l, LightQuery q, vec2 xi)` and
`<kind>_light_pdf(<Kind>Light l, LightQuery q, Point light_p, Direction wo)`. In S³ two
geodesics join the shading point to a light point, the short arc (length d) and the long arc
(length 2π − d), leaving and arriving in opposite directions with the same area density sin² d;
the body chooses the arc before the emitter's back-face test (`spherical_light_arc`, the S³
occupant): a one-sided surface receiver (`!q.two_sided`, `q.n ≠ 0`; `q.n` is `hit.frame.n`, which
`scene_intersect` has already turned toward the side the ray arrived from) takes the arc leaving
into its upper hemisphere with probability 1, anything else (a two-sided receiver, a medium event)
each arc with probability ½, drawing one `random()`. The pdf
carries that probability; the emitter cosine is taken against the arrival direction of the arc
the ray travelled, which `wo` gives at a hit. The generated arms pass `q.p` and `-wo` (= the
departure direction in E³) to Euclidean bodies, `q` and `wo` to curved ones.

Conventions (§6.1): **delta-position kinds** (point, spot) fold 1/d² — and any
angular falloff — into `radiance`, set `LIGHT_DELTA`, pdf 1 — never BSDF-hittable,
MIS weight 1 (§6.4). **Delta-direction kinds** (directional, beam —
impl-plan-directional-beam) are the same delta contract with NOTHING folded:
collimation has no 1/d², so `radiance` is the authored irradiance E verbatim and
transmittance is the shadow walker's job (directional's `distance` is `MAX_DIST`, the far
clip, like the environment's; beam's is the axial distance to its aperture plane, and outside the
beam's forward cylinder the sampler returns pdf 0 — the techniques' invalid-sample
guard). ISOTROPIC delta kinds declare the `deltaQuery` fact (which rows are
position/intensity — the equiangular placement query composes from it); anisotropic
ones (spot, directional, beam) deliberately don't, and the Validator rejects them
under 'equiangular' (the queried intensity feeds the estimate directly — an on-axis
value would bias it). **Area kinds**
(quad, sphere, disk) do the area→solid-angle conversion inside the sampler. Quads
and disks are **ONE-SIDED** (pinned deviation from the §6.2 two-sided aside): the
emitting-side normal is ONE compile-time formula shared with the backing geometry
(quad: `quadNormal`; disk: `unitVec3` through the primitive's `canonicalize`) — hit
side and sample side agree bit-exactly by construction.

**Descriptor** (`<kind>.ts`): `kind`, `glsl` (the file per ambient space it is implemented
in; ambient/README.md — a hittable kind is gated together with the primitive and the
material model backing it, `LIGHT_BACKING_MODEL` in compiler/plan/dataTenants.ts; in a curved
space the point row is the backing region's isometry applied to o (the region's anchor: the quad
light's `corner` row holds the quad's center) and the direction and vector rows the same isometry
applied to them at o, 4-vectors in `PlannedLight.world` (`values` keeps the authored rows, which the
selection power reads; a curved struct has no derived fields) — compiler/plan/curved.ts; the H³ bodies,
`<kind>_hyperbolic.glsl`, use the area density sinh² r in place of r², the S³ bodies,
`<kind>_spherical.glsl`, sin² r and the arc rule above, the H²×R bodies, `<kind>_h2xr.glsl`, the
direction-dependent d²·sinh(D_H)/D_H, `h2xr_area_density`, D_H the H² distance), `delta`, `authoredParams` (the kind's
AUTHORED input schema — fields besides `kind`/`emission`; the Validator's generic
loop derives unknown-key/required/shape/constraint checks from it, including a row's
`constraintIn` (the further domain a space's body requires: the S³ disk light's radius lies
in (0, π), `SPHERICAL_RADIUS`; the H²×R disk light's normal is vertical, `H2XR_VERTICAL`), and runs
`validateAuthored` and `validateAuthoredIn` (the coupled rules a space's body adds: the curved quad
light's orthogonal edges and bounded rectangle)
only on well-shaped input; the desugar-totality contract test keeps it honest
against the desugar functions in both drift directions), `params` (rows = generated
struct fields = ctor order; radiometric rows are `Spectrum`; geometric rows carry a
`kind` for the typedef + future Value<T> rules), `derivedFields` +
`derivedCtorFields` (declared/computed pair), `power(values)` (pbrt
PowerLightSampler, AREA-AWARE — pitfall 6), and the **desugar facts**: `toValues`
(authored light → registry values; radiometric products computed once),
`region` (the backing emitter primitive for hittable kinds — one kind per primitive,
registry-test-enforced: the sampleAsLight inverse is a first-wins lookup),
`valuesFromRegion` (the sampleAsLight route's inverse — both authoring routes share
ONE definition), `validateAuthored` (degeneracy messages the Validator emits).
**Registry line** in `index.ts`. No Planner/Validator/Analyzer branches exist per
kind — census classifies by the `delta` fact, the backing model flows from the
desugared materials into `program.materials.models`, and the DOOR TEST
(`tests/compiler/lightsDoor.test.ts`) proves a registry-only kind addition compiles
end to end. (Residue: a new kind's authored-input interface still extends
`LightDescription` — the scene-side union is the authoring language's business.)

Authoring note (B2): lights author **`emission`** — Le for area kinds, radiant
intensity (W/sr) for delta-position kinds, irradiance (W/m², ⊥ to the propagation
direction) for delta-direction kinds — the same word materials use; scalar
broadcasts. `power(values, ctx?)` may read the Planner-stamped `ctx.worldRadius`
(directional's pbrt Φ = E·π·R² — variance-only, stamped on every light, no kind
branch anywhere).

## How the compiler consumes it

`lighting.ts` owns everything cross-kind: the generated structs + one hoisted
`const <Kind>Light light_<id>` per light (a single construction site read by the
sampler dispatcher, the MIS pdf query, and the equiangular delta query), the
compile-time power/uniform selection CDF (+ `cdf_rescale` — never reuse the
selection random, pitfall 4), the two-stage env wrapper, `light_of` (region → light
id; identity lives on REGIONS), `lighting_pdf(q, wo, light_id, light_hit)` (mis only —
arms are one-line compositions `select × <kind>_light_pdf(light_i, …)`; `wo` is the
arrival direction reversed at the emitter hit), and `lighting_query_delta`.
Explicit area lights DESUGAR in the Planner through the descriptor's `region` fact
to synthesized emissive regions (`__light_n`), so every hittable light is real
geometry.

**Selection is a carved axis** (`LIGHT_SELECTIONS` in index.ts — fable-light-bvh):
`power`/`uniform` are the baked-CDF regime above; `bvh` makes every light
TABLE-resident (`table.ts` is the row-layout truth; rows + bit trails ride the
records channel, the tree rides nodes — `accel/light_tree` builds) and replaces the
CDF with the generated pick/trail-pmf walk pair. Kinds opt into the tree via the
`treeBounds` descriptor fact (mesh lights use its `'data'` form: the App supplies the box
from the BLAS root); kinds without it (directional, beam) are Validator-rejected under 'bvh'.
Each selection occupant lists the ambient `spaces` it is implemented in (ambient/README.md).

## Invariants & witnesses

pt / pt-nee / pt-mis converge on cornell-area, X-GLASS, X-FOG (§11.2), and in curved spaces on the
h3-* and s3-* witnesses (h3-quad-light, s3-quad-light: the curved quad light, sampled uniformly in
the plane's Klein / gnomonic chart with the exact area density 1/(4·T(a)·T(b)·w³);
s3-long-arc: a light reached only through the long arc; s3-medium: the ½
rule at medium events; s3-long-arc-blocker: an occluder on the far part of a long arc); a shadow ray is aimed
at the sampled light point (`ambient_aim`) and stops `SHADOW_BACKOFF` (math.glsl) short of it, so a light's own
surface does not block it (shadow-aim-march, shadow-aim-far). Deferred: spherical-rectangle quads (Ureña), two-sided quads,
inside-sphere fallback, p-independent area arms (equiangular's area exit),
`Value<T>` light params (the generated struct + hoisted const are the ready ABI).
