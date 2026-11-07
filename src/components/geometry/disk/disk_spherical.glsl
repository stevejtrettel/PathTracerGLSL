// Disk in S³ (zero-thickness) — the geodesic disk of radius ρ (0 < ρ < π) about o in the great
// sphere through o perpendicular to `normal` (a tangent vector at o): {x : x·N = 0} with
// N = (normal.xyz, 0). The object's placement carries it to its center (the center row is folded
// into the placement). Derivations: components/ambient/spherical/spherical.md.
// Provides (struct GENERATED from descriptor rows): disk_intersect(), disk_normal().
// Depends on: spherical_plane_root(), ambient_geodesic(), spherical_cos_sin() (the S³ occupant),
//             PI (math).

// A geodesic meets the disk's great sphere at t₀ and t₀ + π, at antipodal points h and −h; the hit
// is the first of them that lies in the disk: dist(o, h) ≤ ρ ⟺ h.w ≥ cos ρ, and for −h, −h.w ≥ cos ρ.
bool disk_intersect(Ray ray, Disk d, out float t) {
    float t0;
    if (!spherical_plane_root(ray, d.normal, t0)) return false;
    float w = ambient_geodesic(ray.origin, ray.direction, t0).w;
    float cr = spherical_cos_sin(d.radius).x;
    if (w >= cr) { t = t0; return true; }
    if (-w >= cr) { t = t0 + PI; return true; }
    return false;
}

// The emitting-side normal: N at every point of the great sphere.
Direction disk_normal(Point p, Disk d) {
    return d.normal;
}
