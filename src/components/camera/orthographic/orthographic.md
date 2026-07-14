# Orthographic camera — what it computes and why

Parallel projection: the measurement functional where every pixel's ray points the same
direction (`forward`) and the rays' **origins** tile the film plane. There is no eye point
and no perspective foreshortening — parallel lines in the scene stay parallel in the image,
and object size is independent of depth. Distinct from perspective as an INTEGRAL (an
orthographic render does not converge to a pinhole one), so it's a measurement occupant.

From the continuous `film` point (the `pixel/` family placed the sub-pixel sample):

- `ndc = 2·film/u_imageSize − 1`, aspect-corrected in x (same as pinhole).
- look-at frame `forward/right/up` with the same degenerate up-reference guard.
- **origin** `= position + ndc.x·u_orthoScale·right + ndc.y·u_orthoScale·up` — the ray
  enters the scene from a point on the film plane. `u_orthoScale` is the world-space
  half-height of the view (half-width = aspect·scale).
- **direction** `= forward`, constant for every pixel.

No `TAN_FOV` (there is no field of view — the view size is `u_orthoScale`, not an angle) and
no aperture (`xiLens` unused; depth of field would need a per-ray aperture, a separate
occupant). `scale` is a live slider that triggers accumulation reset. Good for technical /
isometric looks and for inspecting geometry without perspective distortion.
