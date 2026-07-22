// Sphere — one primitive, both backends' math (included wholesale when present, §2.12).
// The struct is the shape's record (house convention — MaterialProperties/MediumProperties
// pattern); call sites construct it from compile-time literals (constant placement) or
// s-scaled expressions (driven rigid frame, fable-transforms §6.1).
// Provides (struct GENERATED from descriptor rows — A1): sphere_sdf() (signed distance — also the analytic backend's
// containment query), sphere_intersect() (closed-form intersection), sphere_normal().

float sphere_sdf(vec3 p, Sphere sp) {
    return length(p - sp.center) - sp.radius;
}

// Nearest intersection ahead of the ray (t > EPSILON). direction is unit → a = 1.
// The FAR bound is the caller's job (t < hit.t for nearest-hit, t < maxDist for occlusion).
bool sphere_intersect(Ray ray, Sphere sp, out float t) {
    vec3 oc = ray.origin - sp.center;
    float b = dot(oc, ray.direction);
    float c = dot(oc, oc) - sp.radius * sp.radius;
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

// Outward surface normal at p (a point on/near the surface).
vec3 sphere_normal(vec3 p, Sphere sp) {
    return normalize(p - sp.center);
}

// Surface parameterization — the (θ,φ) equirectangular chart from the outward direction.
// u = longitude ∈ [0,1), v = latitude (v=0 at the +y pole). AXIS-ALIGNED (fable-imagery P1
// §7.2 v1): the analytic fold dissolves a sphere's rotation (a sphere IS rotation-invariant),
// so this chart has no authored orientation to inherit — a chart-frame carry is the deferred fix.
vec2 sphere_uv(vec3 p, Sphere sp) {
    vec3 d = normalize(p - sp.center);
    float u = atan(d.z, d.x) / TWO_PI + 0.5;
    float v = acos(clamp(d.y, -1.0, 1.0)) / PI;
    return vec2(u, v);
}
