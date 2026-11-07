// Plane in H³ — a totally geodesic plane: {x : ⟨x, N⟩ = 0} for a unit spacelike 4-vector N. In
// the object's frame the plane is perpendicular to `normal` (a tangent vector at o) at signed
// distance −offset from o, as in E³'s dot(p, normal) + offset = 0: N = (cosh(offset)·normal.xyz,
// −sinh(offset)). Then ⟨exp_o(λ·normal), N⟩ = sinh(λ + offset), so the signed distance is
// asinh(⟨p, N⟩), positive on the side `normal` points to. Derivations:
// components/ambient/hyperbolic/hyperbolic.md.
// Provides (struct GENERATED from descriptor rows): plane_sdf(), plane_intersect(), plane_normal().
// Depends on: hyperbolic_plane_vector(), hyperbolic_plane_distance(), hyperbolic_plane_root() (the H³
//             occupant).

Direction plane_N(Plane pl) {
    return hyperbolic_plane_vector(pl.normal, pl.offset);
}

// Exact signed distance.
float plane_sdf(Point p, Plane pl) {
    return hyperbolic_plane_distance(p, plane_N(pl));
}

// The geodesic's root on ⟨x, N⟩ = 0 (hyperbolic_plane_root in the occupant).
bool plane_intersect(Ray ray, Plane pl, out float t) {
    return hyperbolic_plane_root(ray, plane_N(pl), t);
}

// Outward unit normal: N projected onto T_p, which is N itself on the plane.
Direction plane_normal(Point p, Plane pl) {
    return plane_N(pl);
}
