# lights/ — samplable emitter kinds

**Taxonomy:** scene (defines the source term Le). **Kind:** mix-many — kinds coexist;
the compiler generates the selection CDF and the `lighting_sample` dispatcher.

## What an occupant supplies

**GLSL** (`<kind>.glsl`): the kind's sampler, returning a `LightSample` — `wi` (unit,
toward the light), `distance`, `radiance` (incident, WITHOUT visibility), `pdf` in
**solid-angle measure from the shading point** (per-light only — selection multiplies
in at the dispatcher), `flags`. Conventions (§6.1):
- **Delta kinds** (point, directional): fold 1/d² into `radiance`, set `LIGHT_DELTA`,
  pdf 1 — they are never BSDF-hittable and take MIS weight 1 (§6.4).
- **Area kinds** (quad, sphere): area→solid-angle conversion inside the sampler; the
  `emitPdfArm` MUST be the same formula as the sampler's pdf (byte-match invariant —
  MIS breaks silently otherwise). Quads are **ONE-SIDED** (pinned deviation from the
  §6.2 two-sided aside: hit side and sample side must agree).

**Descriptor** (`<kind>.ts`): `kind`, `glsl`, `delta`, `power(l)` (the pbrt
PowerLightSampler formula — AREA-AWARE, pitfall 6), `emitSampleCall(l, xi)` (the
dispatcher arm), and for hittable kinds `emitPdfArm(l, selectExpr)` (the
`lighting_pdf` arm). **Registry line** in `index.ts`.

## How the compiler consumes it

`lighting.ts` owns everything cross-kind: the compile-time power/uniform selection CDF
(+ `cdf_rescale` — never reuse the selection random, pitfall 4), the two-stage env
wrapper, `light_of` (region → light id; identity lives on REGIONS), `lighting_pdf`
(mis only), and `lighting_query_delta` (equiangular placement — a light's position is
a fact the from-p sampler can't answer). Explicit area lights DESUGAR in the Planner
to synthesized emissive regions (`__light_n`) so every hittable light is real geometry.

## Invariants & witnesses

pt / pt-nee / pt-mis converge on cornell-area, X-GLASS, X-FOG (§11.2); shadow-ray
back-off is 2·EPSILON coupled to `ray_spawn`'s offset (the dark-tops bug — documented
at the call sites). Deferred: spherical-rectangle quads (Ureña), two-sided quads,
inside-sphere fallback, p-independent area arms (equiangular's area exit).
