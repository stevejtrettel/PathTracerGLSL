// Closed-form ray–primitive intersection — the analytic geometry backend.
// Straight-ray algebra because the tracer is Euclidean FOR NOW; closed-form geodesic–surface
// intersection in curved spaces is a later job, not precluded (the abstraction doesn't assume
// straight rays). Provides: ray_sphere(), ray_plane(). Depends on: Ray (structs).
// (The dots below are Euclidean ray-geometry algebra — raw dot, not ambient_dot; see the
//  trace-loop contract's metric rule. Moot while the tracer is flat.)

// Nearest intersection ahead of the ray with a sphere (t > EPSILON). direction is unit → a = 1.
// The FAR bound is the caller's job (t < hit.t for nearest-hit, t < maxDist for occlusion).
bool ray_sphere(Ray ray, vec3 center, float radius, out float t) {
    vec3 oc = ray.origin - center;
    float b = dot(oc, ray.direction);
    float c = dot(oc, oc) - radius * radius;
    float disc = b * b - c;
    if (disc < 0.0) return false;
    float s = sqrt(disc);
    float t0 = -b - s;
    t = (t0 > EPSILON) ? t0 : (-b + s);   // nearer root if it's ahead, else the far root
    return (t > EPSILON);
}

// Intersection with the plane dot(p, normal) + offset = 0 (matches the SDF plane convention).
bool ray_plane(Ray ray, vec3 normal, float offset, out float t) {
    float denom = dot(ray.direction, normal);
    if (abs(denom) < 1e-8) return false;   // ray parallel to the plane
    t = -(dot(ray.origin, normal) + offset) / denom;
    return (t > EPSILON);
}
