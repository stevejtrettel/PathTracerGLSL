// Plane in S³ — a great sphere {x : x·N = 0} for a unit 4-vector N (compact: every geodesic meets it
// twice per period). In the object's frame the plane is perpendicular to `normal` (a tangent vector
// at o) at signed distance −offset from o, as in E³'s dot(p, normal) + offset = 0:
// N = (cos(offset)·normal.xyz, sin(offset)). Then exp_o(λ·normal)·N = sin(λ + offset), so the
// signed distance is asin(p·N), positive on the side `normal` points to; the solid is the
// hemisphere on the other side. Derivations: components/ambient/spherical/spherical.md.
// Provides (struct GENERATED from descriptor rows): plane_sdf(), plane_intersect(), plane_normal().
// Depends on: spherical_cos_sin(), spherical_asin(), spherical_plane_root() (the S³ occupant).

Direction plane_N(Plane pl) {
    vec2 cs = spherical_cos_sin(pl.offset);
    return Direction(cs.x * pl.normal.xyz, cs.y);
}

// Exact signed distance to the great sphere.
float plane_sdf(Point p, Plane pl) {
    return spherical_asin(clamp(dot(p, plane_N(pl)), -1.0, 1.0));
}

// The first crossing of the great sphere (spherical_plane_root in the occupant).
bool plane_intersect(Ray ray, Plane pl, out float t) {
    return spherical_plane_root(ray, plane_N(pl), t);
}

// Outward unit normal: N projected onto T_p, which is N itself on the plane.
Direction plane_normal(Point p, Plane pl) {
    return plane_N(pl);
}
