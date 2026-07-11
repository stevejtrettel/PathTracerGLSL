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
    // Root selection by the INSIDE test (c < 0), never by a t-threshold: an outside origin
    // within EPSILON of the surface must NOT fall through to the far root — that skips the
    // entry interface and fakes an exit from a region the ray never entered (review finding).
    // Outside origins whose near root is ≤ EPSILON now miss (hairline, energy-bounded).
    t = (c < 0.0) ? (-b + s) : (-b - s);
    return (t > EPSILON);
}

// Intersection with the plane dot(p, normal) + offset = 0 (matches the SDF plane convention).
bool ray_plane(Ray ray, vec3 normal, float offset, out float t) {
    float denom = dot(ray.direction, normal);
    if (abs(denom) < 1e-8) return false;   // ray parallel to the plane
    t = -(dot(ray.origin, normal) + offset) / denom;
    return (t > EPSILON);
}

// Intersection with the parallelogram corner + u·edge1 + v·edge2, u,v ∈ [0,1] (a "quad").
// Zero-thickness: it never claims containment in scene_region_at, so it is naturally
// ONE-SIDED under the region_to emission convention (impl-plan-area-lights pinned deviation).
// `normal` is the precompiled unit cross(edge1, edge2) — the emitting side.
bool ray_quad(Ray ray, vec3 corner, vec3 edge1, vec3 edge2, vec3 normal, out float t) {
    float denom = dot(ray.direction, normal);
    if (abs(denom) < 1e-8) return false;                   // parallel to the quad's plane
    t = dot(corner - ray.origin, normal) / denom;
    if (t <= EPSILON) return false;
    vec3 local = ray.origin + ray.direction * t - corner;  // Euclidean backend (see header note)
    // Inside test via the plane's 2x2 Gram system (edges need not be orthogonal).
    float e11 = dot(edge1, edge1), e22 = dot(edge2, edge2), e12 = dot(edge1, edge2);
    float d1 = dot(local, edge1), d2 = dot(local, edge2);
    float det = e11 * e22 - e12 * e12;                     // > 0 (Validator rejects degenerate)
    float u = (d1 * e22 - d2 * e12) / det;
    float v = (d2 * e11 - d1 * e12) / det;
    return (u >= 0.0 && u <= 1.0 && v >= 0.0 && v <= 1.0);
}
