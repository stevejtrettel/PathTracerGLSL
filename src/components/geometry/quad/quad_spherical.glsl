// Quad in S³ (zero-thickness) — the rectangle centered at the origin o of its own frame, in the
// great sphere through o spanned by edge1 and edge2 (orthogonal tangent vectors at o; the
// Validator checks it), bounded by the two pairs of geodesics perpendicular to ê1 and ê2 at
// distances a = |edge1|/2 and b = |edge2|/2 from o (each below π/2, the Validator's domain): in the
// plane's gnomonic chart the Euclidean rectangle |k·ê1| ≤ tan a, |k·ê2| ≤ tan b, inside the
// hemisphere x_w > 0. Its corner angles are obtuse (cos α = −sin a·sin b). The placement carries o
// to exp_o(corner + (edge1 + edge2)/2), the authored quad's center (the descriptor's
// curvedAnchor). One-sided like the Euclidean quad: it emits toward ê1×ê2.
// Derivations: docs/claude-2026-11-review/curved/next-shapes-plan.md §2–§3.
// Provides (struct GENERATED from descriptor rows): quad_intersect(), quad_normal().
// Depends on: spherical_plane_root(), spherical_cos_sin(), ambient_geodesic() (the S³ occupant),
//             PI (math).

// The great sphere's normal N = (ê1×ê2, 0): x·N = 0 on it, and N is the normal at each of its
// points.
Direction quad_N(Quad q) {
    return Direction(normalize(cross(q.edge1.xyz, q.edge2.xyz)), 0.0);
}

// The chart test |h·ê1| ≤ tan a·h_w, |h·ê2| ≤ tan b·h_w (which implies h_w ≥ 0), written as
// |h·edge|·cos(|edge|/2) ≤ sin(|edge|/2)·|edge|·h_w.
bool quad_contains(Point h, Quad q) {
    float l1 = length(q.edge1.xyz), l2 = length(q.edge2.xyz);
    vec2 cs1 = spherical_cos_sin(0.5 * l1), cs2 = spherical_cos_sin(0.5 * l2);
    return abs(dot(h.xyz, q.edge1.xyz)) * cs1.x <= cs1.y * l1 * h.w
        && abs(dot(h.xyz, q.edge2.xyz)) * cs2.x <= cs2.y * l2 * h.w;
}

// A geodesic meets the great sphere at t₀ and t₀ + π, at antipodal points h and −h; the hit is the
// first of them that lies in the rectangle.
bool quad_intersect(Ray ray, Quad q, out float t) {
    float t0;
    if (!spherical_plane_root(ray, quad_N(q), t0)) return false;
    Point h = ambient_geodesic(ray.origin, ray.direction, t0);
    if (quad_contains(h, q)) { t = t0; return true; }
    if (quad_contains(-h, q)) { t = t0 + PI; return true; }
    return false;
}

// The emitting-side normal: N at every point of the great sphere.
Direction quad_normal(Point p, Quad q) {
    return quad_N(q);
}
