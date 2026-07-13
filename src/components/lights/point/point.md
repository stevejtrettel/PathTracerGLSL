# Point light — what it computes and why

An idealized emitter with all its power at one position — the source term is a spatial
delta, so sampling is deterministic: one direction matters, and the shadow ray either
reaches it or doesn't.

`point_light_sample(Point pos, Spectrum Le, Point p)` fills the `LightSample`:

- `wi = normalize(pos − p)`, `distance = |pos − p|` — the only possible sample.
- `radiance = Le / d²` — **the 1/d² folds into radiance here**, not into the pdf:
  a delta light has no solid angle to integrate over (§6.1). `Le` arrives precompiled
  as color·intensity by the descriptor's `emitSampleCall`.
- `pdf = 1.0` (per-light; the dispatcher multiplies selection in), `flags = LIGHT_DELTA`.

Consequences of `LIGHT_DELTA` elsewhere:
- the combiner's delta guard `(ls.flags & LIGHT_DELTA) != 0u → w = 1` — kernel
  sampling can never hit a measure-zero target, so light sampling owns this term (§6.4);
- not hittable: no region, no `light_of` entry — pure-kernel `pt` never sees it, which
  is why the haze card's key 3 is darker than keys 1/2 by exactly this light's term
  (a witness, not a bug).

Descriptor facts (`point.ts`): `delta: true`; `power(l) = 4π · mean(color·intensity)`
(pbrt's PowerLightSampler — so the compile-time selection CDF weighs it fairly against
area lights, whose power scales with area). Position and Le are compile-time constants
baked into the generated `lighting_sample` dispatcher — and into `lighting_query_delta`
under equiangular placement, which needs `pos` before it can choose its t.
