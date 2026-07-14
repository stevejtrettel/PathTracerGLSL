# Thin-lens camera — what it computes and why

The measurement functional with a finite aperture: instead of every ray passing through
a single point, rays for a pixel pass through a *disk* (the lens) and converge on the
**focus plane** at `u_focusDistance`. Objects on that plane image sharply; objects off it
spread into a circle of confusion — depth of field. This is a **measurement** change (a
different integral), not an estimator one: pinhole and thin-lens do not converge to the
same image, by design.

The construction reuses the pinhole look-at frame and `TAN_FOV`:

- Build the pinhole primary direction `dir` through the `film` point (identical to
  `pinhole.glsl`; the `pixel/` family already placed the sub-pixel sample).
- **Focus point:** the primary ray crosses the focus plane at
  `t = u_focusDistance / dot(dir, forward)` (the plane is perpendicular to `forward` at
  `u_focusDistance`), so `focus_point = position + dir·t`.
- **Lens sample:** `concentric_disk(xiLens)·u_aperture` — the equal-area Shirley map of
  the second sub-sample onto the lens disk (`xiLens` comes from the film sample stream, so
  QMC stratifies the aperture just like the pixel). `u_aperture` is the lens radius.
- **Final ray:** origin moves to the sampled lens point
  `position + lens.x·right + lens.y·up`, re-aimed at `focus_point`.

`u_aperture → 0` collapses `lens → 0`: the origin is unchanged and the direction becomes
`normalize(focus_point − position) = dir`, i.e. the exact pinhole ray. That exact limit
is the correctness witness (a thin-lens render at aperture 0 must match pinhole).

`concentric_disk` is inlined rather than shared: thin-lens is its only user today: it
graduates to a shared sampler helper when a second occupant (e.g. a disk area light) needs
it. `aperture` and `focusDistance` are live sliders that trigger accumulation reset — they
change what the render converges to.

Randomness note (the camera A/B split, see `../README.md`): thin-lens consumes exactly the
Category-A dimensions — the `film` footprint (pixel/) + `xiLens`. Motion blur (shutter time) and spectral
sensor response (wavelength) are Category-B seed fields, not `generateRay` arguments.
