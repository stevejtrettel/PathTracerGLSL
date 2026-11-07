// Sphere in H³ — the geodesic ball of radius R about the origin o of its own frame (the object's
// placement carries it to its center). Points and rays are in the object's frame; the struct
// holds only the radius (the center row is folded into the placement). Arc length t is the same
// in every frame, so the generated arm compares it with world hits unchanged. Derivations and
// float32 measurements: components/ambient/hyperbolic/hyperbolic.md.
// Provides (struct GENERATED from descriptor rows): sphere_sdf(), sphere_intersect(), sphere_normal().

// Exact distance to the sphere: dist(o, p) = asinh(|p.xyz|) (the asinh form keeps precision
// near the surface, where acosh(p.w) does not).
float sphere_sdf(Point p, Sphere sp) {
    return asinh(length(p.xyz)) - sp.radius;
}

// Nearest intersection strictly ahead of the ray (t > 0), floor 0 (escape is ray_spawn's
// offset). Along γ(t) = cosh t·p + sinh t·v the 4th coordinate is a·cosh t + b·sinh t with
// a = p.w, b = v.w; setting it to cosh R and x = eᵗ gives (a+b)x² − 2 cosh R·x + (a−b) = 0.
// Two identities make it cancellation-free: the discriminant cosh²R − (a² − b²) equals
// sinh²R − k with k = |p.xyz × v.xyz|² = sinh²(dist(o, the geodesic)) (Haines' perpendicular
// form, hyperbolic), and (a+b)(a−b) = 1 + k, so the smaller of a ± b is (1 + k)/(a + |b|).
// Root selection by the inside test, never by a t-threshold: inside → the exit root.
bool sphere_intersect(Ray ray, Sphere sp, out float t) {
    vec3 c = cross(ray.origin.xyz, ray.direction.xyz);
    float k = dot(c, c);
    float sr = sinh(sp.radius);
    float disc = sr * sr - k;
    if (disc < 0.0) return false;
    float big = ray.origin.w + abs(ray.direction.w);
    float small = (1.0 + k) / big;
    float apb = ray.direction.w >= 0.0 ? big : small;   // a + b
    float amb = ray.direction.w >= 0.0 ? small : big;   // a − b
    float q = cosh(sp.radius) + sqrt(disc);
    bool inside = dot(ray.origin.xyz, ray.origin.xyz) < sr * sr;
    t = log(inside ? q / apb : amb / q);
    return t > 0.0;
}

// Outward unit normal at p (on or near the sphere): the velocity at p of the geodesic from o,
// (p.w·p.xyz/|p.xyz|, |p.xyz|).
Direction sphere_normal(Point p, Sphere sp) {
    float r = length(p.xyz);
    return Direction(p.w * p.xyz / r, r);
}
