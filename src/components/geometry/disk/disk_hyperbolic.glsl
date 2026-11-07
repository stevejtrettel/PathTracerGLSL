// Disk in H³ (zero-thickness) — the geodesic disk of radius ρ about o in the totally geodesic
// plane through o perpendicular to `normal` (a tangent vector at o): {x : ⟨x, N⟩ = 0} with
// N = (normal.xyz, 0). The object's placement carries it to its center (the center row is folded
// into the placement). Derivations: components/ambient/hyperbolic/hyperbolic.md.
// Provides (struct GENERATED from descriptor rows): disk_intersect(), disk_normal().
// Depends on: hyperbolic_plane_root(), ambient_geodesic() (the H³ occupant).

// The root on the disk's plane (hyperbolic_plane_root in the occupant), then the radial test
// dist(o, h) ≤ ρ ⟺ |h.xyz|² ≤ sinh²ρ.
bool disk_intersect(Ray ray, Disk d, out float t) {
    if (!hyperbolic_plane_root(ray, d.normal, t)) return false;
    Point h = ambient_geodesic(ray.origin, ray.direction, t);
    float sr = sinh(d.radius);
    return dot(h.xyz, h.xyz) <= sr * sr;
}

// The emitting-side normal: N at every point of the plane.
Direction disk_normal(Point p, Disk d) {
    return d.normal;
}
