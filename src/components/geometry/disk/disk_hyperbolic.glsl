// Disk in H³ (zero-thickness) — the geodesic disk of radius ρ about o in the totally geodesic
// plane through o perpendicular to `normal` (a tangent vector at o): {x : ⟨x, N⟩ = 0} with
// N = (normal.xyz, 0). The object's placement carries it to its center (the center row is folded
// into the placement). Derivations: components/ambient/hyperbolic/hyperbolic.md.
// Provides (struct GENERATED from descriptor rows): disk_intersect(), disk_normal().

// The plane root (plane_hyperbolic.glsl with offset 0: ⟨γ(t), N⟩ = P·cosh t + W·sinh t), then the
// radial test dist(o, h) ≤ ρ ⟺ |h.xyz|² ≤ sinh²ρ. Floor 0 (escape is ray_spawn's offset).
bool disk_intersect(Ray ray, Disk d, out float t) {
    float P = ambient_dot(ray.origin, d.normal, ray.origin);
    float W = ambient_dot(ray.direction, d.normal, ray.origin);
    if (P * W >= 0.0 || abs(W) <= abs(P)) return false;
    t = 0.5 * log((W - P) / (W + P));
    Point h = ambient_geodesic(ray.origin, ray.direction, t);
    float sr = sinh(d.radius);
    return dot(h.xyz, h.xyz) <= sr * sr;
}

// The emitting-side normal: N at every point of the plane.
Direction disk_normal(Point p, Disk d) {
    return d.normal;
}
