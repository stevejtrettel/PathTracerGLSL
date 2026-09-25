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

**Descriptor** (`<kind>.ts`): `kind`, `glsl`, `delta`, `authoredParams` (the kind's
AUTHORED input schema — fields besides `kind`/`emission`; the Validator's generic
loop derives unknown-key/required/shape checks from it and runs `validateAuthored`
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
id; identity lives on REGIONS), `lighting_pdf` (mis only — arms are one-line
compositions `select × <kind>_light_pdf(light_i, …)`), and `lighting_query_delta`.
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

## Invariants & witnesses

pt / pt-nee / pt-mis converge on cornell-area, X-GLASS, X-FOG (§11.2); the shadow-ray
back-off is `SHADOW_BACKOFF` (math.glsl), which must exceed `ray_spawn`'s offset (the
dark-tops bug — documented at the call sites). Deferred: spherical-rectangle quads (Ureña), two-sided quads,
inside-sphere fallback, p-independent area arms (equiangular's area exit),
`Value<T>` light params (the generated struct + hoisted const are the ready ABI).
