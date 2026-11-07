// Sphere in S³ — the geodesic ball of radius R (0 < R < π) about the origin o of its own frame (the
// object's placement carries it to its center). Points and rays are in the object's frame; the
// struct holds only the radius (the center row is folded into the placement). Arc length t is the
// same in every frame, so the generated arm compares it with world hits unchanged. Derivations and
// float32 measurements: components/ambient/spherical/spherical.md.
// Provides (struct GENERATED from descriptor rows): sphere_sdf(), sphere_intersect(), sphere_normal().
// Depends on: TWO_PI (math), spherical_cos_sin() (the S³ occupant).

// Exact distance to the sphere: dist(o, p) = atan(|p.xyz|, p.w) (the atan form keeps precision
// near the surface, where acos(p.w) does not).
float sphere_sdf(Point p, Sphere sp) {
    return atan(length(p.xyz), p.w) - sp.radius;
}

// Nearest intersection strictly ahead of the ray (t > 0), floor 0 (escape is ray_spawn's
// offset). Along γ(t) = cos t·p + sin t·v the 4th coordinate is a·cos t + b·sin t = A·cos(t − φ)
// with a = p.w, b = v.w, A = √(a² + b²), φ = atan(b, a), and the ball is where it exceeds cos R.
// For orthonormal p, v, A² = 1 − k with k = |p.xyz × v.xyz|², so the crossings are φ ∓ α with
// α = atan(√(sin²R − k), cos R) (no crossing when sin²R < k: the geodesic stays on one side).
// Root selection by the inside test, never by a t-threshold: inside → the exit root φ + α, outside
// → the entry root φ − α, each taken mod 2π (the geodesic is periodic).
bool sphere_intersect(Ray ray, Sphere sp, out float t) {
    vec3 c = cross(ray.origin.xyz, ray.direction.xyz);
    float k = dot(c, c);
    vec2 csr = spherical_cos_sin(sp.radius);
    float disc = csr.y * csr.y - k;
    if (disc < 0.0) return false;
    float phi = atan(ray.direction.w, ray.origin.w);
    float alpha = atan(sqrt(disc), csr.x);
    bool inside = atan(length(ray.origin.xyz), ray.origin.w) < sp.radius;
    t = mod(inside ? phi + alpha : phi - alpha, TWO_PI);
    return t > 0.0;
}

// Outward unit normal at p (on or near the sphere): the velocity at p of the geodesic from o,
// (p.w·p.xyz/|p.xyz|, −|p.xyz|).
Direction sphere_normal(Point p, Sphere sp) {
    float r = length(p.xyz);
    return Direction(p.w * p.xyz / r, -r);
}
