// Quad in H³ (zero-thickness) — the rectangle centered at the origin o of its own frame, in the
// totally geodesic plane through o spanned by edge1 and edge2 (orthogonal tangent vectors at o;
// the Validator checks it), bounded by the two pairs of geodesics perpendicular to ê1 and ê2 at
// distances a = |edge1|/2 and b = |edge2|/2 from o: in the plane's Klein chart the Euclidean
// rectangle |k·ê1| ≤ tanh a, |k·ê2| ≤ tanh b. Its corner angles are not right angles
// (cos α = sinh a·sinh b; the Validator keeps sinh a·sinh b < 1, where the corners exist). The
// placement carries o to exp_o(corner + (edge1 + edge2)/2), the authored quad's center (the
// descriptor's curvedAnchor), so with orthogonal edges it is the Euclidean quad's curved
// counterpart. One-sided like the Euclidean quad: it emits toward ê1×ê2.
// Derivations: docs/claude-2026-11-review/curved/next-shapes-plan.md §2–§3.
// Provides (struct GENERATED from descriptor rows): quad_intersect(), quad_normal().
// Depends on: hyperbolic_plane_root(), ambient_geodesic() (the H³ occupant).

// The plane's normal N = (ê1×ê2, 0): ⟨x, N⟩ = 0 on the plane, and N is the normal at each of its
// points.
Direction quad_N(Quad q) {
    return Direction(normalize(cross(q.edge1.xyz, q.edge2.xyz)), 0.0);
}

// The plane root (hyperbolic_plane_root), then the chart test |h·ê1| ≤ tanh a·h_w,
// |h·ê2| ≤ tanh b·h_w, written as |h·edge| ≤ tanh(|edge|/2)·|edge|·h_w.
bool quad_intersect(Ray ray, Quad q, out float t) {
    if (!hyperbolic_plane_root(ray, quad_N(q), t)) return false;
    Point h = ambient_geodesic(ray.origin, ray.direction, t);
    float l1 = length(q.edge1.xyz), l2 = length(q.edge2.xyz);
    return abs(dot(h.xyz, q.edge1.xyz)) <= tanh(0.5 * l1) * l1 * h.w
        && abs(dot(h.xyz, q.edge2.xyz)) <= tanh(0.5 * l2) * l2 * h.w;
}

// The emitting-side normal: N at every point of the plane.
Direction quad_normal(Point p, Quad q) {
    return quad_N(q);
}
