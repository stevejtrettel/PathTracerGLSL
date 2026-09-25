# Pinhole camera — what it computes and why

The measurement functional: which ray each pixel integrates over. `camera_generateRay`
receives a continuous `film` point (the `pixel/` family owns the sub-pixel footprint —
the camera is a pure film-point → ray map), maps it to NDC with aspect correction
(`ndc = 2·film/u_imageSize − 1`, then `ndc.x *= u_aspect`), and assembles the direction in
a look-at frame:

- The frame (`u_cameraForward/Right/Up`) is computed on the CPU (`camera/basis.ts`) from the
  pose and shipped as uniforms, so no ray pays for normalize/cross. The degenerate
  up-reference guard lives there: the up-reference falls back from +Y to +Z when the camera
  looks straight up or down, which would otherwise give `normalize(0)` = NaN on every ray.
- `dir = normalize(forward + ndc.x·u_tanFov·right + ndc.y·u_tanFov·up)`, with
  `u_tanFov = tan(fov/2)` computed on the CPU (constant or `{param}` fov alike). `fov` is
  the full VERTICAL angle in radians, validated in (0, π).
- Returns `make_ray(position, dir)` — a pure geodesic seed (trace-loop contract: no
  interval on the ray; far bounds are the query's business).

Changing camera type changes the INTEGRAL (measurement section) — pinhole and thin-lens
do not converge to each other, by design (thin-lens at aperture 0 does: the
`thinlens-zero` witness).
