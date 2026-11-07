// Sphere in H²×R — the metric ball of radius R about the origin o of its own frame (the object's
// placement carries it to its center): {D_H² + y² ≤ R²}, D_H = asinh(|p.xz|) the H² distance from o.
// Not a quadric: H²×R is not isotropic, and the ball has no closed-form intersection. Derivations:
// components/ambient/h2xr/h2xr.md.
// Provides (struct GENERATED from descriptor rows): sphere_sdf(), sphere_intersect(), sphere_normal().
// Depends on: ambient_flow(), h2xr_asinhc() (the H²×R occupant).

// Exact signed distance √(D_H² + y²) − R.
float sphere_sdf(Point p, Sphere sp) {
    return length(vec2(asinh(length(p.xz)), p.y)) - sp.radius;
}

// f(t) = D_H(t)² + y(t)² − R² along the ray, and f′(t) = 2·asinhc(r)·γ′.w + 2·y·v.y, with
// r = |γ(t).xz| = sinh D_H (from d(D_H²)/dt = 2·D_H·γ′.w/sinh D_H; stable through the axis D_H = 0).
vec2 sphere_f(Ray ray, Sphere sp, float t) {
    Ray g = ambient_flow(ray, t);
    float r = length(g.origin.xz);
    float D = asinh(r);
    return vec2(D * D + g.origin.y * g.origin.y - sp.radius * sp.radius,
                2.0 * h2xr_asinhc(r) * g.direction.w + 2.0 * g.origin.y * ray.direction.y);
}

// Nearest intersection strictly ahead of the ray (t > 0, floor 0: escape is ray_spawn's offset).
// No closed form: along the geodesic f mixes exponentials of st with a polynomial in t. But f is
// CONVEX in t (H²×R is CAT(0), where the squared distance to a point is convex along geodesics),
// so Newton's method started where f > 0 moves monotonically toward the nearest root on that side
// and never passes it:
//   - outside (f(0) ≥ 0): from t = 0; an iterate with f′ ≥ 0 means the minimum is at or behind it
//     with f > 0 there — the ray misses;
//   - inside (f(0) < 0): from t = 2R, where f > 0 (dist(γ(2R), c) ≥ 2R − dist(p, c) > R), down to
//     the exit root.
// The iterates approach the root from the side where f > 0, so f ≤ 0 at an iterate means it has
// reached the root within float32 rounding of f: a hit there. Otherwise a hit when the step is at
// most 1e-5·(1 + t) — near a transversal root Newton's error after a step δ is of order δ², far
// below δ; near a tangent (double) root it converges linearly and the error is about δ, still on
// the f > 0 side, just outside the ball. The rounding of f in float32 keeps the steps from falling
// much below 1e-5 (measured on SwiftShader: h2xr.md). 24 iterations without either (a ray grazing the silhouette within rounding) is a miss.
bool sphere_intersect(Ray ray, Sphere sp, out float t) {
    bool inside = sphere_f(ray, sp, 0.0).x < 0.0;
    t = inside ? 2.0 * sp.radius : 0.0;
    for (int i = 0; i < 24; i++) {
        vec2 f = sphere_f(ray, sp, t);
        if (i > 0 && f.x <= 0.0) return t > 0.0;
        if (inside ? f.y <= 0.0 : f.y >= 0.0) return false;
        float step = f.x / f.y;
        t -= step;
        if (abs(step) <= 1.0e-5 * (1.0 + t)) return t > 0.0;
    }
    return false;
}

// Outward unit normal at p (on or near the sphere): the unit velocity at p of the geodesic from o,
// (D_H·(the H² radial direction (p.w·p̂.xz, |p.xz|)), y)/d, written with asinhc(r) = D_H/r.
Direction sphere_normal(Point p, Sphere sp) {
    float r = length(p.xz);
    float k = h2xr_asinhc(r);
    return ambient_normalize(Direction(k * p.w * p.x, p.y, k * p.w * p.z, k * r * r), p);
}
