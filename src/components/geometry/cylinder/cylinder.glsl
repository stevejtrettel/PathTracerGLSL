// Cylinder (finite, capped, canonical Y-axis; SDF backend only — orientation is
// PLACEMENT, not shape: a tilted cylinder is transform.rotation through the wrapper
// tiers, exactly like box). Included wholesale when present (§2.12).
// Provides (struct GENERATED from descriptor rows — A1): cylinder_sdf().

// Exact signed distance to the capped cylinder (not a bound): correct sign, never
// overestimates, exact near the surface — full quality for marching, containment,
// and gradient normals alike.
float cylinder_sdf(vec3 p, Cylinder c) {
    vec3 q = p - c.center;
    vec2 d = vec2(length(q.xz) - c.radius, abs(q.y) - c.halfHeight);
    return min(max(d.x, d.y), 0.0) + length(max(d, 0.0));
}
