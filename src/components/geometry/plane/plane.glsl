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

// Marching (`plane_sdf_intersect`) and the gradient normal (`plane_sdf_normal`) are
// GENERATED from plane_sdf when a program marches this shape — fable-sdf-contract §4.
// The plane is the UNBOUNDED shape (impl-plan-sdf-as-shape §2.3): it declares no
// bound, so it is always visited and the caller passes the open interval
// [near, running nearest] — the generated loop is unchanged by that, it simply
// never leaves early.
