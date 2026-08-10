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

// The INTERVAL form (impl-plan-sdf-as-shape T2) — entry and exit, not the nearest
// root: this is what a shape declaring `marchBound` hands its marched intersect, and
// what a shape bounded BY a sphere gets. Entry is clamped to 0 (an origin inside the
// sphere enters at once); false = the ray misses entirely. Deliberately a sibling of
// sphere_intersect rather than a rewrite of it — the closed-form arm's root-selection
// discipline must not move.
bool sphere_interval(Ray ray, Sphere sp, out float t0, out float t1) {
    vec3 oc = ray.origin - sp.center;
    float b = dot(oc, ray.direction);
    float c = dot(oc, oc) - sp.radius * sp.radius;
    float disc = b * b - c;
    if (disc < 0.0) return false;
    float s = sqrt(disc);
    t1 = -b + s;
    if (t1 <= EPSILON) return false;   // the whole sphere is behind the ray
    t0 = max(-b - s, 0.0);
    return true;
}

// ---- the marching intersect (impl-plan-sdf-as-shape T1) ---------------------
// An SDF object is a shape whose intersect ITERATES: same signature shape as
// sphere_intersect above, plus the [t0, t1] interval its bound handed us. Nothing
// here knows about the scene — no minimum over other objects, no region ids.
//
// The rules, transcribed from the verified leaf marcher (fable-sdf-accel §3):
//   · step by |sdf| (unsigned) so a ray INSIDE the shape marches to its exit;
//   · accept when the field falls under march_epsilon(t);
//   · the far end is dilated by march_epsilon(t1) — a surface may sit exactly ON the
//     bound's wall, and a tight bound would otherwise clip silhouettes;
//   · exhaustion still inside the interval commits the graze (the stall rule: a ray
//     pinned at a silhouette must report the surface, not paint the background
//     through it); exhaustion past it is a miss and the caller resumes.
// The caller applies its own nearest-hit test (t < hit.t), exactly as it does for the
// closed-form intersects — this returns the nearest hit WITHIN the interval.
bool sphere_sdf_intersect(Ray ray, Sphere sp, float t0, float t1, out float t) {
    t = max(t0, EPSILON);
    float t_stop = t1 + march_epsilon(t1);
    float bound = 1e20;
    for (int i = 0; i < MAX_MARCH_STEPS; i++) {
        if (t > t_stop) return false;
        bound = abs(sphere_sdf(ray.origin + t * ray.direction, sp));
        if (bound < march_epsilon(t)) return true;
        t += bound;
    }
    return bound < 16.0 * march_epsilon(t) && t <= t_stop;
}

// Gradient normal of THIS field — six taps, the general form a marched hit uses (a
// custom distance field has nothing else). In the shape's own frame; the caller
// rotates it to world. Distinct from sphere_normal(), which the closed-form arm uses.
vec3 sphere_sdf_normal(vec3 p, Sphere sp) {
    vec2 e = vec2(NORMAL_EPSILON, 0.0);
    return normalize(vec3(
        sphere_sdf(p + e.xyy, sp) - sphere_sdf(p - e.xyy, sp),
        sphere_sdf(p + e.yxy, sp) - sphere_sdf(p - e.yxy, sp),
        sphere_sdf(p + e.yyx, sp) - sphere_sdf(p - e.yyx, sp)));
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
