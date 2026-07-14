# sensor/ — the measurement importance (We)

**Taxonomy:** measurement (the `We` factor of the pixel measurement — the adjoint of a
light's `Le`). **Kind:** pick-one.

The pixel integral is `I_j = ∫ h_j(p) · We(film, ω) · L(x→ω) dp dω`. `camera/` supplies the
ray map and `pixel/` the reconstruction kernel `h_j`; this family supplies **`We`**, the
sensor's importance. Together they are the measurement functional `sensor ∘ camera ∘ pixel`.

## What an occupant supplies

**GLSL** (`<id>.glsl`):
```glsl
Spectrum sensor_response(vec2 film, Direction ray_dir);
```
- `film` = the normalized film-plane point (the same one `camera_generateRay` consumed) —
  a sensor can vignette/window by film position.
- `ray_dir` = the generated primary direction — a sensor can weight by angle (cosⁿ falloff).
- Returns the importance `We`. The identity sensor returns `SPECTRUM_ONE`.
- **Wavelength deferred** (same discipline as the camera's time/λ seed fields): when the
  spectral axis lands, this signature gains `float lambda` and the CIE XYZ response lives
  here. Do NOT add the arg until the seed field exists.

## How the compiler consumes it

Included by `core.ts` (sole occupant today, like the sampler). The accumulator `main()`
applies it as `color = sensor_response(film, ray.direction) * transport_trace(ray)` —
`We · L`, the measurement. When a second occupant lands it gains a `measurement.sensor`
strategy knob (a MEASUREMENT axis — it shapes the integrand's importance, not the estimator).

## Invariants & witnesses

The `ideal` occupant is INERT: `We ≡ 1` ⇒ `We·L == L` bit-for-bit, so every witness number
is unchanged — that byte-identity is the proof the seam was carved without perturbing the
measurement. Occupant: `ideal/`.

## Deferred occupants (named so they don't leak into `ideal`)

- `exposure` / physical camera (ISO · aperture · shutter → an exposure scalar; `DISPLAY_EXPOSURE`
  arguably migrates here — it is a MEASUREMENT property, not a view one).
- `vignette` (cosⁿ natural falloff + optical vignetting).
- `spectral` (CIE XYZ response — waits on the wavelength seed field).
