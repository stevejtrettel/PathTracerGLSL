// Sphere — one primitive, both backends' math (included wholesale when present, §2.12).
// The struct is the shape's record (house convention — MaterialProperties/MediumProperties
// pattern); call sites construct it from compile-time literals (constant placement) or
// s-scaled expressions (driven rigid frame, fable-transforms §6.1).
// Provides (struct GENERATED from descriptor rows — A1): sphere_sdf() (signed distance — also the analytic backend's
// containment query), sphere_intersect() (closed-form intersection), sphere_normal().

float sphere_sdf(vec3 p, Sphere sp) {
    return length(p - sp.center) - sp.radius;
}

// The roots of |oc + t·d|² = r² (d unit) in the robust form of Haines, Günther & Akenine-Möller,
// "Precision Improvements for Ray/Sphere Intersection" (Ray Tracing Gems, ch. 7, 2019): the
// discriminant from the perpendicular offset, r² − |oc − b·d|², instead of b² − c, and the
// near root as c/q instead of −b − √disc. b² − c subtracts two numbers of size |oc|², so for a
// sphere small against its distance it keeps few bits of r²: in f32 emulation at r/|oc| = 1e-3
// (an instance-cloud sphere seen from across the cloud) 1.6% of rays aimed near the sphere got
// the wrong hit/miss answer and hit points moved by up to 27% of r; at 2.5e-4, 36% (Sep 25
// 2026 audit). The perpendicular form loses only relative precision in |oc − b·d| ≈ r.
// q takes the sign that avoids cancellation; q = 0 only for a tangent ray through the origin.

// Nearest intersection strictly ahead of the ray (t > 0). direction is unit → a = 1.
// The FAR bound is the caller's job (t < hit.t for nearest-hit, t < maxDist for occlusion).
// The floor is 0, not an epsilon: self-intersection escape is OWNED by ray_spawn's
// provenance offset (hit.eps — impl-plan-epsilon-discipline), under which a spawned
// origin's re-root is strictly behind the ray, so a floor here would only delete real
// shallow hits (the measured slab-albedo J2 leak).
bool sphere_intersect(Ray ray, Sphere sp, out float t) {
    vec3 oc = ray.origin - sp.center;
    float b = dot(oc, ray.direction);
    vec3 perp = oc - b * ray.direction;
    float disc = sp.radius * sp.radius - dot(perp, perp);
    if (disc < 0.0) return false;
    float c = dot(oc, oc) - sp.radius * sp.radius;
    float q = (b >= 0.0) ? -b - sqrt(disc) : -b + sqrt(disc);
    if (q == 0.0) return false;
    float ta = q, tb = c / q;
    // Root selection by the INSIDE test (c < 0), never by a t-threshold: an outside origin
    // near the surface must NOT fall through to the far root — that skips the entry
    // interface and fakes an exit from a region the ray never entered (review finding).
    // The sign of c is trustworthy for spawned origins: the fp-relative offset (≥256 ulps
    // of |p|) exceeds the discriminant's rounding noise (a few ulps) by ~2 orders — the
    // margin the six-agent audit derived; shrink FP_UNCERTAINTY_REL and re-derive.
    t = (c < 0.0) ? max(ta, tb) : min(ta, tb);
    return (t > 0.0);
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
    vec3 perp = oc - b * ray.direction;
    float disc = sp.radius * sp.radius - dot(perp, perp);   // robust form: see sphere_intersect
    if (disc < 0.0) return false;
    float c = dot(oc, oc) - sp.radius * sp.radius;
    float q = (b >= 0.0) ? -b - sqrt(disc) : -b + sqrt(disc);
    if (q == 0.0) return false;
    float ta = q, tb = c / q;
    t1 = max(ta, tb);
    if (t1 <= 0.0) return false;   // the whole sphere is behind the ray (sliver intervals
                                   // are the marcher's own t_stop guard's job)
    t0 = max(min(ta, tb), 0.0);
    return true;
}

// Marching (`sphere_sdf_intersect`) and the gradient normal (`sphere_sdf_normal`)
// are GENERATED from sphere_sdf when a program marches this shape — fable-sdf-contract
// §4 (emitSdfIntersect/emitSdfNormal in geometry/index.ts carry the rules).

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
