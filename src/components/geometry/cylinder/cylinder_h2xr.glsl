// Cylinder in H²×R — the capped vertical cylinder D_R × [−h, h] about o of its own frame: the H² disk
// of radius R times an interval of heights (canonical y axis, as in E³; the placement carries it
// to its center). Both factors are convex, so the product is, and its distance is the product
// distance. Derivations: components/ambient/h2xr/h2xr.md.
// Provides (struct GENERATED from descriptor rows): cylinder_sdf(), cylinder_intersect(),
//           cylinder_normal().
// Depends on: h2xr_speed() (the H²×R occupant).

// Exact signed distance: with a = dist_H²(p, o) − R = asinh(|p.xz|) − R and b = |y| − h,
// length(max((a, b), 0)) + min(max(a, b), 0).
float cylinder_sdf(Point p, Cylinder c) {
    vec2 ab = vec2(asinh(length(p.xz)) - c.radius, abs(p.y) - c.halfHeight);
    return length(max(ab, 0.0)) + min(max(ab.x, ab.y), 0.0);
}

// Nearest intersection strictly ahead of the ray (floor 0). The slab |y| ≤ h is an interval of t
// (the height is linear). The tube: the flow keeps the point's x and z as
// x(τ) = cosh τ·P + sinh τ·V with τ = st, P = p.xz, V = u.xz/s (u the H² part of the direction; w is
// recomputed from them), so |x(τ)|² = sinh²R is, in Y = e^{2τ}, the quadratic
// |P + V|²·Y² + 2(|P|² − |V|² − 2 sinh²R)·Y + |P − V|² = 0, whose reduced discriminant is 4·D with
// D = sinh²R·(sinh²R − |P|² + |V|²) − (P × V)². It holds for any direction, tangent or not: a spawned
// ray's direction is tangent at its hit point and off the offset origin's tangent space by about the
// spawn offset, and H³'s ball identities, which assume tangency, put the root up to 4e-5 inside the
// surface (measured on SwiftShader; the next ray then met the cylinder from inside). A vertical ray
// (s = 0) stays at its H² point: inside the tube for all t or never. The hit is the first end of
// the intersected interval, chosen by the inside test (inside → its far end).
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
    float S = sr * sr;
    vec2 P = p.xz;
    if (s == 0.0) {
        if (dot(P, P) > S) return false;
    } else {
        vec2 V = v.xz / s;
        float cr = P.x * V.y - P.y * V.x;
        float D = S * (S - dot(P, P) + dot(V, V)) - cr * cr;   // the reduced discriminant is 4·D
        if (D < 0.0) return false;
        float A = dot(P + V, P + V), C = dot(P - V, P - V);
        float Bh = dot(P, P) - dot(V, V) - 2.0 * S;            // B / 2
        float q = -(Bh + sign(Bh) * 2.0 * sqrt(D));             // cancellation-free pair: Y = q/A, C/q
        float y1 = q / A, y2 = C / q;
        lo = max(lo, 0.5 * log(min(y1, y2)) / s);
        hi = min(hi, 0.5 * log(max(y1, y2)) / s);
    }
    if (!(lo < hi)) return false;
    bool inside = dot(P, P) < S && abs(p.y) < c.halfHeight;
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
