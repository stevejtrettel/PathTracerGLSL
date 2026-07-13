# ambient/ — the space the light lives in

**Taxonomy:** scene (the manifold + metric — part of WHAT integral). **Kind:**
pick-one — one space per program.

## What an occupant supplies

**GLSL** (`<space>.glsl`) implementing the metric seam (trace-loop-contract):

```glsl
float ambient_dot(Direction a, Direction b, Point p);   // metric at p
Point ambient_geodesic(Point o, Direction d, float t);  // exp map along the geodesic
```

plus whatever `ray_spawn`/`make_ray` need from the space. Euclidean unpacks to
`dot(a, b)` and `o + t*d` — which is why every component writes `ambient_dot` and
`ambient_geodesic` instead of the raw operations: the discipline is the whole
preparation for curved spaces. `Point` is a typedef (currently `vec3`; becomes `vec4`
for H³/Schwarzschild models — write against the typedef).

## Status & the honest caveat

Sole occupant: `euclidean/`. H³ and Schwarzschild are the known next occupants (the
reference doc §10 sketches the H³ form — shape-normative, unbuilt). Two places are
DECLARED Euclidean-only beyond the seam and will need real work, not just a new
occupant: the analytic medium bodies (distances along segments) and equiangular
placement (extrinsic closest-approach geometry) — both say so in their headers.

## Invariants & witnesses

None space-specific yet (one occupant). The arrival witness for H³ is pinned by the
swappability claim itself: every Euclidean scene must be byte-unchanged, and the first
H³ scene exercises the seam end to end.
