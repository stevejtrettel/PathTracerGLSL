// Sphere in H³ — the geodesic ball of radius R about the origin o of its own frame (the object's
// placement carries it to its center). Points and rays are in the object's frame; the struct
// holds only the radius (the center row is folded into the placement). Arc length t is the same
// in every frame, so the generated arm compares it with world hits unchanged. Derivations and
// float32 measurements: components/ambient/hyperbolic/hyperbolic.md.
// Provides (struct GENERATED from descriptor rows): sphere_sdf(), sphere_root(), sphere_intersect(),
//           sphere_normal(), sphere_interval().

// Exact distance to the sphere: dist(o, p) = asinh(|p.xyz|) (the asinh form keeps precision
// near the surface, where acosh(p.w) does not).
float sphere_sdf(Point p, Sphere sp) {
    return asinh(length(p.xyz)) - sp.radius;
}

// The root on the ball's boundary of a geodesic γ along which cosh dist(γ(t), o) = a·cosh t + b·sinh t,
// k = a² − b² − 1 = sinh²(dist(o, the geodesic)) (Haines' perpendicular form, hyperbolic): the exit root
// when the geodesic starts inside the ball, else the entry root. With x = eᵗ, setting the distance to
// R gives (a+b)x² − 2 cosh R·x + (a−b) = 0, whose discriminant cosh²R − (a² − b²) is sinh²R − k
// (clamped at 0: a caller that knows the geodesic meets the ball takes it as a tangency), and since
// (a+b)(a−b) = 1 + k the smaller of a ± b is (1 + k)/(a + |b|) — no cancellation anywhere. The sphere
// body and the sphere light's sampler both call it, so the light's distance is the root rays find.
float sphere_root(float a, float b, float k, float radius, bool inside) {
    float sr = sinh(radius);
    float big = a + abs(b);
    float small = (1.0 + k) / big;
    float apb = b >= 0.0 ? big : small;   // a + b
    float amb = b >= 0.0 ? small : big;   // a − b
    float q = cosh(radius) + sqrt(max(sr * sr - k, 0.0));
    return log(inside ? q / apb : amb / q);
}

// Nearest intersection strictly ahead of the ray (t > 0), floor 0 (escape is ray_spawn's
// offset). Along γ(t) = cosh t·p + sinh t·v the 4th coordinate, cosh dist(γ(t), o), is
// a·cosh t + b·sinh t with a = p.w, b = v.w, and k = |p.xyz × v.xyz|² (sphere_root).
// Root selection by the inside test, never by a t-threshold: inside → the exit root.
bool sphere_intersect(Ray ray, Sphere sp, out float t) {
    vec3 c = cross(ray.origin.xyz, ray.direction.xyz);
    float k = dot(c, c);
    float sr = sinh(sp.radius);
    if (sr * sr - k < 0.0) return false;
    bool inside = dot(ray.origin.xyz, ray.origin.xyz) < sr * sr;
    t = sphere_root(ray.origin.w, ray.direction.w, k, sp.radius, inside);
    return t > 0.0;
}

// Outward unit normal at p (on or near the sphere): the velocity at p of the geodesic from o,
// (p.w·p.xyz/|p.xyz|, |p.xyz|).
Direction sphere_normal(Point p, Sphere sp) {
    float r = length(p.xyz);
    return Direction(p.w * p.xyz / r, r);
}

// The ray's interval inside the ball, [entry, exit] with the entry clamped to 0 (an origin inside
// enters at once) — what a marched shape bounded by this ball searches. The roots of
// sphere_intersect: x = eᵗ solves (a+b)x² − 2 cosh R·x + (a−b) = 0, entry (a−b)/q and exit q/(a+b) with
// q = cosh R + √disc. False when the geodesic misses the ball or leaves it behind the origin; a
// geodesic of H³ meets a ball in one segment, so nothing lies beyond the exit.
bool sphere_interval(Ray ray, Sphere sp, out float t0, out float t1) {
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
    t1 = log(q / apb);
    if (t1 <= 0.0) return false;
    t0 = max(log(amb / q), 0.0);
    return true;
}
