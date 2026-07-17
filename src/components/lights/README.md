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

Conventions (§6.1): **delta kinds** (point) fold 1/d² into `radiance`, set
`LIGHT_DELTA`, pdf 1 — never BSDF-hittable, MIS weight 1 (§6.4). **Area kinds**
(quad, sphere) do the area→solid-angle conversion inside the sampler. Quads are
**ONE-SIDED** (pinned deviation from the §6.2 two-sided aside): the derived `normal`
struct field is computed by geometry's `quadNormal` — hit side and sample side agree
bit-exactly by construction.

**Descriptor** (`<kind>.ts`): `kind`, `glsl`, `delta`, `params` (rows = generated
struct fields = ctor order; radiometric rows are `Spectrum`; geometric rows carry a
`kind` for the typedef + future Value<T> rules), `derivedFields` +
`derivedCtorFields` (declared/computed pair), `power(values)` (pbrt
PowerLightSampler, AREA-AWARE — pitfall 6), and the **desugar facts**: `toValues`
(authored light → registry values; radiometric products computed once),
`region` (the backing emitter primitive for hittable kinds), `valuesFromRegion`
(the sampleAsLight route's inverse — both authoring routes share ONE definition),
`validateAuthored` (degeneracy messages the Validator emits). **Registry line** in
`index.ts`. No Planner/Validator branches exist per kind. (Residue: a new kind's
authored-input interface still extends `LightDescription` — the scene-side union is
the authoring language's business.)

Authoring note (B2): lights author **`emission`** — Le for area kinds, radiant
intensity (W/sr) for delta — the same word materials use; scalar broadcasts.

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

## Invariants & witnesses

pt / pt-nee / pt-mis converge on cornell-area, X-GLASS, X-FOG (§11.2); shadow-ray
back-off is 2·EPSILON coupled to `ray_spawn`'s offset (the dark-tops bug — documented
at the call sites). Deferred: spherical-rectangle quads (Ureña), two-sided quads,
inside-sphere fallback, p-independent area arms (equiangular's area exit),
`Value<T>` light params (the generated struct + hoisted const are the ready ABI).
