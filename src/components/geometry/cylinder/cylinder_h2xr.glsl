// Cylinder in H²×R — the capped vertical cylinder D_R × [−h, h] about o of its own frame: the H² disk
// of radius R times an interval of heights (canonical y axis, as in E³; the placement carries it
// to its center). Both factors are convex, so the product is, and its distance is the product
// distance. Derivations: components/ambient/h2xr/h2xr.md.
// Provides (struct GENERATED from descriptor rows): cylinder_sdf(), cylinder_intersect(),
//           cylinder_normal().
// Depends on: h2xr_speed(), h2xr_h2() (the H²×R occupant).

// Exact signed distance: with a = dist_H²(p, o) − R = asinh(|p.xz|) − R and b = |y| − h,
// length(max((a, b), 0)) + min(max(a, b), 0).
float cylinder_sdf(Point p, Cylinder c) {
    vec2 ab = vec2(asinh(length(p.xz)) - c.radius, abs(p.y) - c.halfHeight);
    return length(max(ab, 0.0)) + min(max(ab.x, ab.y), 0.0);
}

// Nearest intersection strictly ahead of the ray (floor 0). The slab |y| ≤ h is an interval of t
// (the height is linear). The tube: along the H² part, w(t) = a·cosh τ + b·sinh τ with τ = st,
// a = p.w, b = û.w (û = u/s the unit H² direction); w = cosh R at X = e^τ solving
// (a+b)X² − 2 cosh R·X + (a−b) = 0 — H³'s ball quadratic, with its cancellation-free identities in
// R^{2,1}: disc = sinh²R − k with k = (p.x·û.z − p.z·û.x)², and (a+b)(a−b) = 1 + k. A vertical ray
// (s = 0) stays at its H² point: inside the tube for all t or never. The hit is the first end of the
// intersected interval, chosen by the inside test (inside → its far end).
bool cylinder_intersect(Ray ray, Cylinder c, out float t) {
    float lo = -1.0e30, hi = 1.0e30;
    Point p = ray.origin;
    Direction v = ray.direction;
    if (v.y == 0.0) {
        if (abs(p.y) > c.halfHeight) return false;
    } else {
        float t1 = (-c.halfHeight - p.y) / v.y, t2 = (c.halfHeight - p.y) / v.y;
        lo = min(t1, t2);
        hi = max(t1, t2);
    }
    float s = h2xr_speed(v);
    float sr = sinh(c.radius);
    if (s == 0.0) {
        if (dot(p.xz, p.xz) > sr * sr) return false;
    } else {
        vec4 u = h2xr_h2(v) / s;
        float cr = p.x * u.z - p.z * u.x;
        float k = cr * cr;
        float disc = sr * sr - k;
        if (disc < 0.0) return false;
        float big = p.w + abs(u.w);
        float small = (1.0 + k) / big;
        float apb = u.w >= 0.0 ? big : small;   // a + b
        float amb = u.w >= 0.0 ? small : big;   // a − b
        float q = cosh(c.radius) + sqrt(disc);
        lo = max(lo, log(amb / q) / s);
        hi = min(hi, log(q / apb) / s);
    }
    if (!(lo < hi)) return false;
    bool inside = dot(p.xz, p.xz) < sr * sr && abs(p.y) < c.halfHeight;
    t = inside ? hi : lo;
    return t > 0.0;
}

// Outward unit normal at p (on or near the cylinder): the wall's, the velocity at p of the H²
// geodesic from o, (p.w·p.x/r, 0, p.w·p.z/r, r) with r = |p.xz|, where the wall is the nearer
// boundary; else the cap's, (0, ±1, 0, 0).
Direction cylinder_normal(Point p, Cylinder c) {
    float r = length(p.xz);
    if (asinh(r) - c.radius > abs(p.y) - c.halfHeight) return Direction(p.w * p.x / r, 0.0, p.w * p.z / r, r);
    return Direction(0.0, sign(p.y), 0.0, 0.0);
}
