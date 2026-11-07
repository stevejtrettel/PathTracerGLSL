# Euclidean space — what it computes and why

The flat-space occupant of the metric seam. Its functions are trivial here precisely so
they can be non-trivial in a curved space:

- `types.glsl`: `Point` and `Direction` are `vec3` — R³ coordinates.
- `farClip: 1000` (descriptor field, emitted as `MAX_DIST`) — the far clip, an absolute
  length where missed rays and environment NEE both find the sky.
- `fp_uncertainty(p)` — 256 ulps of the largest coordinate, floored near the origin (the
  constants and their source are in core math).
- `ambient_geodesic(o, d, t) = o + d·t` — straight lines are the geodesics.
- `ambient_flow(r, t)` — the point `ambient_geodesic(r.origin, r.direction, t)` with the
  direction unchanged: a line's velocity is constant, so the arrival direction is the
  departure direction.
- `ambient_dot(v1, v2, p) = dot(v1, v2)` and `ambient_normalize(v, p) = normalize(v)` — the
  metric is position-independent.
- `ambient_frame(p, n)` — an orthonormal shading frame around n (branch on |n.x| to
  avoid a degenerate tangent seed).
- `ambient_parallel_transport(v, from, to) = v` — flat connection: vectors compare
  across points with no correction.
- `ambient_direction_to(from, to) = normalize(to − from)` — the unit start direction of the
  geodesic to a point (the normalized log map).
- `ambient_aim(from, along, to, remaining)` — `normalize(to − from)` with
  `remaining = length(to − from)`: one segment joins two points, so `along` selects nothing.
- `ambient_sky_key(p, v) = v` — the sky is at infinite distance, so parallel rays see the
  same sky point and the lookup key is the direction alone.

Every component writes THESE names instead of the raw operations, so a curved occupant
replaces these two files (and `Point` widens to `vec4`) and every metric product,
normalization, arrival direction, shadow aim and sky lookup in the library follows. Each
body is the same IEEE arithmetic as the raw operation it names, so the respelling leaves
every Euclidean picture bit-identical.

Places the seam does NOT cover are listed in the family README: light samplers (they
carry a METRIC EXEMPTION note — Euclidean solid-angle constructions that get new bodies
per space), the phase functions' sampling basis, the march and the placement arms, camera
frames, environment samplers and equiangular placement.
