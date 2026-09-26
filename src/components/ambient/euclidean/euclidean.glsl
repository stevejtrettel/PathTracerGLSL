// Euclidean Ambient Geometry
// Flat-space geometric operations
// Provides: ambient_geodesic(), ambient_frame(), ambient_dot(), ambient_parallel_transport(),
//           ambient_direction_to()

Point ambient_geodesic(Point origin, Direction dir, float t) {
    return origin + dir * t;
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

float ambient_dot(Direction v1, Direction v2, Point p) {
    return dot(v1, v2);
}

Direction ambient_parallel_transport(Direction v, Point from_p, Point to_p) {
    return v;
}

// The unit direction at `from` of the geodesic to `to` (the normalized log map). Shadow rays
// are aimed with it at their light point.
Direction ambient_direction_to(Point from, Point to) {
    return normalize(to - from);
}
