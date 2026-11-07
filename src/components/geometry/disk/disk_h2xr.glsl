// Disk in H²×R (zero-thickness) — the geodesic disk of radius ρ about o in the horizontal plane
// y = 0 of its own frame: the H² disk {x² + z² ≤ sinh²ρ} at height 0 (a horizontal plane is a copy of
// H², totally geodesic). Disks are horizontal: the normal row is (0, ±1, 0) (the Validator's h2xr
// row constraint). The object's placement carries it to its center (the center row is folded into
// the placement). Derivations: components/ambient/h2xr/h2xr.md.
// Provides (struct GENERATED from descriptor rows): disk_intersect(), disk_normal().
// Depends on: ambient_geodesic() (the H²×R occupant).

// The height is linear along every geodesic: t = −y/v.y, then the radial test dist(o, h) ≤ ρ ⟺
// x² + z² ≤ sinh²ρ at the root.
bool disk_intersect(Ray ray, Disk d, out float t) {
    if (ray.direction.y == 0.0) return false;
    t = -ray.origin.y / ray.direction.y;
    if (!(t > 0.0)) return false;
    Point h = ambient_geodesic(ray.origin, ray.direction, t);
    float sr = sinh(d.radius);
    return h.x * h.x + h.z * h.z <= sr * sr;
}

// The emitting-side normal: the normal row at every point of the plane.
Direction disk_normal(Point p, Disk d) {
    return d.normal;
}
