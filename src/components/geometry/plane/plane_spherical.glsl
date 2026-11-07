// Plane in S³ — a great sphere {x : x·N = 0} for a unit 4-vector N (compact: every geodesic meets it
// twice per period). In the object's frame the plane is perpendicular to `normal` (a tangent vector
// at o) at signed distance −offset from o, as in E³'s dot(p, normal) + offset = 0:
// N = (cos(offset)·normal.xyz, sin(offset)). Then exp_o(λ·normal)·N = sin(λ + offset), so the
// signed distance is asin(p·N), positive on the side `normal` points to; the solid is the
// hemisphere on the other side. Derivations: components/ambient/spherical/spherical.md.
// Provides (struct GENERATED from descriptor rows): plane_sdf(), plane_intersect(), plane_normal().
// Depends on: spherical_plane_vector(), spherical_plane_distance(), spherical_plane_root() (the S³
//             occupant).

Direction plane_N(Plane pl) {
    return spherical_plane_vector(pl.normal, pl.offset);
}

// Exact signed distance to the great sphere.
float plane_sdf(Point p, Plane pl) {
    return spherical_plane_distance(p, plane_N(pl));
}

// The first crossing of the great sphere (spherical_plane_root in the occupant).
bool plane_intersect(Ray ray, Plane pl, out float t) {
    return spherical_plane_root(ray, plane_N(pl), t);
}

// Outward unit normal: N projected onto T_p, which is N itself on the plane.
Direction plane_normal(Point p, Plane pl) {
    return plane_N(pl);
}
