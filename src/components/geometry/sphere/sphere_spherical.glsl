// Sphere in S³ — the geodesic ball of radius R (0 < R < π) about the origin o of its own frame (the
// object's placement carries it to its center). Points and rays are in the object's frame; the
// struct holds only the radius (the center row is folded into the placement). Arc length t is the
// same in every frame, so the generated arm compares it with world hits unchanged. Derivations and
// float32 measurements: components/ambient/spherical/spherical.md.
// Provides (struct GENERATED from descriptor rows): sphere_sdf(), sphere_root(), sphere_intersect(),
//           sphere_normal().
// Depends on: TWO_PI (math), spherical_cos_sin() (the S³ occupant).

// Exact distance to the sphere: dist(o, p) = atan(|p.xyz|, p.w) (the atan form keeps precision
// near the surface, where acos(p.w) does not).
float sphere_sdf(Point p, Sphere sp) {
    return atan(length(p.xyz), p.w) - sp.radius;
}

// The root on the ball's boundary of a geodesic γ along which cos dist(γ(t), o) = a·cos t + b·sin t
// = A·cos(t − φ), A = √(a² + b²), φ = atan(b, a), with k = 1 − A² = sin²(dist(o, the geodesic)): the
// ball is where A·cos(t − φ) exceeds cos R, so the crossings are φ ∓ α with α = atan(√(sin²R − k), cos R)
// (the root of sin²R − k clamped at 0: a caller that knows the geodesic meets the ball takes it as a
// tangency). The exit root φ + α when the geodesic starts inside the ball, else the entry root φ − α,
// each taken mod 2π (the geodesic is periodic). The sphere body and the sphere light's sampler both
// call it, so the light's distance is the root rays find.
float sphere_root(float a, float b, float k, float radius, bool inside) {
    vec2 csr = spherical_cos_sin(radius);
    float phi = atan(b, a);
    float alpha = atan(sqrt(max(csr.y * csr.y - k, 0.0)), csr.x);
    return mod(inside ? phi + alpha : phi - alpha, TWO_PI);
}

// Nearest intersection strictly ahead of the ray (t > 0), floor 0 (escape is ray_spawn's
// offset). Along γ(t) = cos t·p + sin t·v the 4th coordinate, cos dist(γ(t), o), is a·cos t + b·sin t
// with a = p.w, b = v.w, and for orthonormal p, v, k = |p.xyz × v.xyz|² (sphere_root); no crossing
// when sin²R < k (the geodesic stays on one side). Root selection by the inside test, never by a
// t-threshold.
bool sphere_intersect(Ray ray, Sphere sp, out float t) {
    vec3 c = cross(ray.origin.xyz, ray.direction.xyz);
    float k = dot(c, c);
    float sr = spherical_cos_sin(sp.radius).y;
    if (sr * sr - k < 0.0) return false;
    bool inside = atan(length(ray.origin.xyz), ray.origin.w) < sp.radius;
    t = sphere_root(ray.origin.w, ray.direction.w, k, sp.radius, inside);
    return t > 0.0;
}

// Outward unit normal at p (on or near the sphere): the velocity at p of the geodesic from o,
// (p.w·p.xyz/|p.xyz|, −|p.xyz|).
Direction sphere_normal(Point p, Sphere sp) {
    float r = length(p.xyz);
    return Direction(p.w * p.xyz / r, -r);
}
