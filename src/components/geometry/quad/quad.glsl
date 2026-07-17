// Quad (parallelogram, analytic backend only) — corner + u·edge1 + v·edge2, u,v ∈ [0,1].
// Zero-thickness: it never claims containment in scene_region_at, so it is naturally
// ONE-SIDED under the region_to emission convention (impl-plan-area-lights pinned
// deviation). The `normal` FIELD is the precompiled unit cross(edge1, edge2) — the
// emitting side, the SAME compile-time literal the quad light's sampler bakes (hit side
// and sample side agree bit-exactly by construction; never recompute it per-fragment).
// Provides (struct GENERATED from descriptor rows — A1): quad_intersect(), quad_normal().

bool quad_intersect(Ray ray, Quad q, out float t) {
    float denom = dot(ray.direction, q.normal);
    if (abs(denom) < 1e-8) return false;                   // parallel to the quad's plane
    t = dot(q.corner - ray.origin, q.normal) / denom;
    if (t <= EPSILON) return false;
    vec3 local = ray.origin + ray.direction * t - q.corner;  // Euclidean backend
    // Inside test via the plane's 2x2 Gram system (edges need not be orthogonal).
    float e11 = dot(q.edge1, q.edge1), e22 = dot(q.edge2, q.edge2), e12 = dot(q.edge1, q.edge2);
    float d1 = dot(local, q.edge1), d2 = dot(local, q.edge2);
    float det = e11 * e22 - e12 * e12;                     // > 0 (Validator rejects degenerate)
    float u = (d1 * e22 - d2 * e12) / det;
    float v = (d2 * e11 - d1 * e12) / det;
    return (u >= 0.0 && u <= 1.0 && v >= 0.0 && v <= 1.0);
}

// The emitting-side normal — stored, never recomputed (see the struct comment).
vec3 quad_normal(vec3 p, Quad q) {
    return q.normal;
}
