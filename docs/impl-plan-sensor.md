# impl-plan-sensor.md — the sensor (`W_e`) seam

**Status:** PLANNED (Jul 14 2026).
**Depends on:** nothing. Additive, behavior-preserving.

## Why

The pixel measurement is `I_j = ∫∫ h_j(p) · W_e(ray) · L(x→ω) dp dω`. Today `W_e ≡ 1`
is hardcoded: the measurement functional `sensor ∘ camera ∘ pixel` is missing its
`sensor` factor. `L_e` (emission) is a first-class family (`lights/`); its adjoint
`W_e` (the sensor importance) has no home. This carves the seam — empty-but-present —
so exposure, vignetting, and (later) spectral response have somewhere to live, and any
future adjoint method (a light tracer / BDPT walk) has the `We` object it needs.

This is a SEAM, not a feature. v1 changes zero pixels.

## The math

`W_e(film, ω)` is the sensor's importance emitted backward along the primary ray —
the dual of a light's `L_e`. For an ideal pinhole sensor it is a constant (the value
that makes the measurement equal average radiance); we take that constant = 1, matching
today's implicit behavior exactly.

## Family shape

New leaf family `src/components/sensor/`. **Kind: select-one** per program (like
`camera/`, `pixel/`, `accumulator/`, `tonemap/` — NOT mix-many).

**GLSL** (`<id>.glsl`):
```glsl
Spectrum sensor_response(vec2 film, Direction ray_dir);   // the We carried into throughput
```
- `film` = the normalized film coordinate (same one the camera consumed) — lets a
  sensor vignette or window by film position.
- `ray_dir` = the generated primary direction — lets a sensor weight by angle
  (cosⁿ falloff, natural vignetting).
- Returns `Spectrum` (the importance). v1 `ideal` returns `SPECTRUM_ONE`.
- **Wavelength deferred, consciously** (same discipline as the camera's time/λ seed
  fields): when the spectral axis lands, `sensor_response` gains a `float lambda` arg
  and this is where the CIE XYZ response curves live (`W_e(λ)`), resolved XYZ→RGB at
  the film. Do NOT add the arg until the seed field exists.

**Descriptor** (`<id>.ts`): `id`, `glsl`, optional `properties` (§3.4 schema — e.g. a
future `exposure`/`vignette` occupant's fields). **Registry line** in `sensor/index.ts`.

## Call site (transport)

The primary ray is spawned in the walk's init (integrators/pt walk). `W_e` multiplies
the initial path **throughput/importance** there — exactly where a light tracer would
seed `L_e`. With `ideal` → `SPECTRUM_ONE`, throughput init is unchanged, so:

- **v1 emits `throughput *= sensor_response(film, ray.d)`** at primary-ray spawn.
  Optimizer note: an identity-`W_e` occupant folds to nothing (a deferred Generate-stage
  elision, same as identity-weight elision in the combiner) — but emit it for now; the
  witness numbers must be byte-for-byte unchanged, which proves the seam is inert.

## Strategy axis

**No `RenderStrategy` field yet.** Single occupant compiled in (the "no field until a
reader needs it" rule — same as why `roughness` didn't exist until GGX declared it).
When the second sensor occupant lands, add `measurement.sensor: '<id>'` (it is a
MEASUREMENT-section axis — it shapes the integrand's importance, not the estimator).

## Deferred occupants (name them so they don't leak into `ideal`)

- `exposure` / physical camera (ISO · aperture · shutter → an exposure scalar; this is
  where `DISPLAY_EXPOSURE` arguably belongs — it is a MEASUREMENT property, not a view
  one — but do NOT move it now, just note the future migration).
- `vignette` (cosⁿ natural falloff + optical vignetting).
- `spectral` (CIE XYZ response — waits on the wavelength seed field).

## Gate

Carve family + `ideal` occupant + the transport call site. `npx vitest run` green
(new snapshot for the sensor block; existing pixel/camera snapshots unchanged except
the throughput-init provenance line). `npm run witness` — **every number identical**
(the proof the seam is inert).
