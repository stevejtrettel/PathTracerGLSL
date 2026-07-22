// Disk (flat circular, ZERO-THICKNESS, analytic backend only) — center + unit normal +
// radius. Included wholesale when present (§2.12). Second tenant of the thin machinery
// (quad's sibling): never claims containment, one-sided under region_to emission,
// back-face hits probe the entering side (audit H2).
// The `normal` is a canonical UNIT parameter (descriptor canonicalize — framework-applied
// once; the disk light's sampler shares the SAME normalized value, the one-sided pin).
// Transcribed from pbrt-v4 Disks: plane intersection + squared-radial test, no quadratic.
// Provides (struct GENERATED from descriptor rows — A1): disk_intersect(), disk_normal().

bool disk_intersect(Ray ray, Disk d, out float t) {
    float denom = dot(ray.direction, d.normal);
    if (abs(denom) < 1e-8) return false;                   // parallel to the disk's plane
    t = dot(d.center - ray.origin, d.normal) / denom;
    if (t <= EPSILON) return false;
    vec3 local = ray.origin + ray.direction * t - d.center;  // ~in-plane (O(t·ulp) residual,
    return dot(local, local) <= d.radius * d.radius;         //  same class as quad's Gram solve)
}

// The emitting-side normal — stored, unit by canonicalization (never recompute).
vec3 disk_normal(vec3 p, Disk d) {
    return d.normal;
}

// Surface parameterization — polar (r/R, θ/2π) in the disk's plane. The RADIAL coordinate is
// orientation-free; the ANGULAR reference comes from build_basis(normal) (fable-imagery P1
// §7.2 v1): the fold dissolves the disk's in-plane rotation, so θ=0 is a derived direction,
// not an authored one — the chart-frame carry is the deferred fix.
vec2 disk_uv(vec3 p, Disk d) {
    vec3 local = p - d.center;
    vec3 t, b;
    build_basis(d.normal, t, b);
    float r = length(local) / d.radius;
    float theta = atan(dot(local, b), dot(local, t)) / TWO_PI + 0.5;
    return vec2(r, theta);
}
