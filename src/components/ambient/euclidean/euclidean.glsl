// Euclidean ambient geometry: flat R³, geodesics are straight lines, the metric is the dot
// product everywhere. The contract each occupant meets is components/ambient/README.md.
// Provides: fp_uncertainty(), ambient_geodesic(), ambient_flow(), ambient_dot(),
//           ambient_normalize(), ambient_frame(), ambient_parallel_transport(),
//           ambient_distance(), ambient_direction_to(), ambient_aim(), ambient_sky_key()
// Depends on: Point/Direction (types.glsl), Ray/Frame (structs), FP_UNCERTAINTY_REL/ABS (math).
// The far clip MAX_DIST is emitted just before this block (the descriptor's farClip, or the
// measurement's).

// Positional error bound of a floating-point-accurate point: 256 ulps of its largest
// coordinate, floored near the origin (the constants and their source are in core math).
float fp_uncertainty(Point p) {
    return max(FP_UNCERTAINTY_ABS, FP_UNCERTAINTY_REL * max(abs(p.x), max(abs(p.y), abs(p.z))));
}

// The point at arc length t along the geodesic leaving `origin` with unit velocity `dir`.
Point ambient_geodesic(Point origin, Direction dir, float t) {
    return origin + dir * t;
}

// The geodesic flow: the ray moved arc length t along itself — the point reached and the
// velocity there (the ARRIVAL direction). A line keeps its direction.
Ray ambient_flow(Ray r, float t) {
    return Ray(ambient_geodesic(r.origin, r.direction, t), r.direction, r.wl);
}

float ambient_dot(Direction v1, Direction v2, Point p) {
    return dot(v1, v2);
}

// v rescaled to unit length in the metric at p.
Direction ambient_normalize(Direction v, Point p) {
    return normalize(v);
}

// The METRIC-SEAM frame builder: curved-space occupants replace this wholesale, so its
// construction is free to differ from core math's build_basis (the declared-Euclidean
// sampler helper) — the two serve different contracts and need not agree.
Frame ambient_frame(Point p, Direction n) {
    Direction nn = normalize(n);
    Direction t = abs(nn.x) < 0.9 ? Direction(1.0, 0.0, 0.0) : Direction(0.0, 1.0, 0.0);
    t = normalize(t - dot(t, nn) * nn);
    Direction b = cross(nn, t);
    return Frame(p, t, b, nn);
}

Direction ambient_parallel_transport(Direction v, Point from_p, Point to_p) {
    return v;
}

// The geodesic distance between two points: the length of the segment.
float ambient_distance(Point a, Point b) {
    return length(b - a);
}

// The unit direction at `from` of the geodesic to `to` (the normalized log map).
Direction ambient_direction_to(Point from, Point to) {
    return normalize(to - from);
}

// Aims a shadow ray at the point `to`: the unit direction at `from` of the geodesic to `to`
// that continues the arc the ray travels on (`along`, its current direction), and in
// `remaining` the arc length left to `to`. One segment joins two points of R³, so `along`
// selects nothing here; in S³ two arcs do, and it picks one.
Direction ambient_aim(Point from, Direction along, Point to, out float remaining) {
    remaining = ambient_distance(from, to);
    return normalize(to - from);
}

// The key the sky is looked up by for a ray leaving p in direction v: the direction itself
// (the sky is at infinite distance, so every parallel ray sees the same sky point).
vec3 ambient_sky_key(Point p, Direction v) {
    return v;
}
