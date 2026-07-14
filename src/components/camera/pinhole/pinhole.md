# Pinhole camera — what it computes and why

The measurement functional: which ray each pixel integrates over. `camera_generateRay`
receives a continuous `film` point (the `pixel/` family owns the sub-pixel footprint now —
the camera is a pure film-point → ray map), maps it to NDC with aspect correction, and
assembles the direction in a look-at frame:

- `forward = normalize(target − position)`; `right/up` by cross products with an
  up-reference that falls back from +Y to +Z when `|forward.y| > 0.999999` — a camera
  looking straight up/down otherwise produces `normalize(0)` = NaN and poisons every
  ray of the frame (the camera-NaN fix).
- `dir = normalize(forward + ndc.x·TAN_FOV·right + ndc.y·TAN_FOV·up)` — `TAN_FOV` is
  tan(fov/2): a constant fov bakes to a literal define; a `{param}` fov becomes the
  live `u_tanFov` uniform aliased through the SAME define, so this file is unchanged
  either way (the §2.8 Value<T> pattern).
- Returns `make_ray(position, dir)` — a pure geodesic seed (trace-loop contract: no
  interval on the ray; far bounds are the query's business).

Changing camera type changes the INTEGRAL (measurement section) — pinhole and a
future thin-lens do not converge to each other, by design. Thin-lens is the known
next occupant: aperture + focus distance as two more schema fields, a lens-disk
sample from a second `xi`, no transport changes — defocus is measurement, not
estimation.
