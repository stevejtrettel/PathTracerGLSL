# Euclidean space — what it computes and why

The flat-space occupant of the metric seam — four functions that are trivial here
precisely so they can be non-trivial later:

- `ambient_geodesic(o, d, t) = o + d·t` — straight lines are the geodesics.
- `ambient_dot(v1, v2, p) = dot(v1, v2)` — the metric is position-independent.
- `ambient_frame(p, n)` — an orthonormal shading frame around n (branch on |n.x| to
  avoid a degenerate tangent seed).
- `ambient_parallel_transport(v, from, to) = v` — flat connection: vectors compare
  across points with no correction.

Every component writes THESE names instead of the raw operations — that discipline is
the entire preparation for H³/Nil/Schwarzschild: a curved occupant replaces this file
(and `Point` may widen to `vec4`), and every metric product and point-along-ray in the
library follows without edits. The swappability witness at arrival: all Euclidean
scenes byte-unchanged.

Two declared holes the seam does NOT cover (their headers say so): the analytic
medium bodies (distances along segments) and equiangular placement (extrinsic
closest-approach geometry) — both are Euclidean closed forms that need new *bodies*,
not just a new metric, in curved space. Light samplers carry the same METRIC
EXEMPTION note (§5.3): they are Euclidean solid-angle constructions and get new
occupants per space.
