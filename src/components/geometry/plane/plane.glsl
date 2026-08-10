// Plane — one primitive, both backends' math (included wholesale when present, §2.12).
// Convention: the surface dot(p, normal) + offset = 0, normal unit (canonicalPlane
// normalizes at plan time — the SDF expression is a true distance bound only then).
// Provides (struct GENERATED from descriptor rows — A1): plane_sdf() (signed distance / containment), plane_intersect(),
// plane_normal().

float plane_sdf(vec3 p, Plane pl) {
    return dot(p, pl.normal) + pl.offset;
}

// Intersection with the plane dot(p, normal) + offset = 0 (matches the SDF convention).
bool plane_intersect(Ray ray, Plane pl, out float t) {
    float denom = dot(ray.direction, pl.normal);
    if (abs(denom) < 1e-8) return false;   // ray parallel to the plane
    t = -(dot(ray.origin, pl.normal) + pl.offset) / denom;
    return (t > EPSILON);
}

// Outward surface normal — a plane's normal IS its parameter (trivial body, uniform signature).
vec3 plane_normal(vec3 p, Plane pl) {
    return pl.normal;
}

// ---- the marching intersect (impl-plan-sdf-as-shape T1) ---------------------
// The iterating twin of plane_intersect; rules and derivations in sphere.glsl. The
// plane is the UNBOUNDED shape (impl-plan-sdf-as-shape §2.3): it declares no bound, so
// it is always visited and the caller passes the open interval [near, running nearest]
// — the loop below is unchanged by that, it simply never leaves early.
bool plane_sdf_intersect(Ray ray, Plane pl, float t0, float t1, out float t) {
    t = max(t0, EPSILON);
    float t_stop = t1 + march_epsilon(t1);
    float bound = 1e20;
    for (int i = 0; i < MAX_MARCH_STEPS; i++) {
        if (t > t_stop) return false;
        bound = abs(plane_sdf(ray.origin + t * ray.direction, pl));
        if (bound < march_epsilon(t)) return true;
        t += bound;
    }
    return bound < 16.0 * march_epsilon(t) && t <= t_stop;
}

// Gradient normal of THIS field (six taps), in the shape's own frame. Constant for a
// plane — kept for signature uniformity, and free after constant folding.
vec3 plane_sdf_normal(vec3 p, Plane pl) {
    vec2 e = vec2(NORMAL_EPSILON, 0.0);
    return normalize(vec3(
        plane_sdf(p + e.xyy, pl) - plane_sdf(p - e.xyy, pl),
        plane_sdf(p + e.yxy, pl) - plane_sdf(p - e.yxy, pl),
        plane_sdf(p + e.yyx, pl) - plane_sdf(p - e.yyx, pl)));
}
