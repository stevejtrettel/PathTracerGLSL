// Plane — one primitive, both backends' math (included wholesale when present, §2.12).
// Convention: the surface dot(p, normal) + offset = 0, normal unit (canonicalPlane
// normalizes at plan time — the SDF expression is a true distance bound only then).
// Provides: struct Plane, plane_sdf() (signed distance / containment), plane_intersect(),
// plane_normal().

struct Plane {
    vec3 normal;
    float offset;
};

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
