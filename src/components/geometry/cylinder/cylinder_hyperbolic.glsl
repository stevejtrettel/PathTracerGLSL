// Cylinder in H³ — the tube of geodesic radius r about the y-axis geodesic {(0, sinh s, 0, cosh s)}
// of its own frame, capped by the two planes perpendicular to the axis at axial distance ±h
// (h = halfHeight). x lies at distance asinh|x_xz| from the axis, so the tube is |x_xz|² ≤ sinh² r;
// the caps are |x_y| ≤ tanh h·x_w, with outward normals (0, ±cosh h, 0, sinh h). Convex and
// bounded for every r, h. Points and rays are in the object's frame; the struct holds radius and
// halfHeight (the center row is folded into the placement). Derivations and the float32
// measurement of the tube discriminant: docs/claude-2026-11-review/curved/next-shapes-plan.md §3,
// curved/primitive-bodies/f32_tube.ts.
// Provides (struct GENERATED from descriptor rows): cylinder_sdf(), cylinder_intersect(),
//             cylinder_normal().
// Depends on: hyperbolic_halfspace(), hyperbolic_interval_hit(), HYPERBOLIC_X_INF (the H³ occupant).

// The signed distances to the tube and to the nearer cap's plane; the larger names the face p is on.
vec2 cylinder_terms(Point p, Cylinder c) {
    float cap = abs(p.y) * cosh(c.halfHeight) - p.w * sinh(c.halfHeight);
    return vec2(asinh(length(p.xz)) - c.radius, sign(cap) * asinh(abs(cap)));
}

// The larger of the two: exact inside, never above the distance outside.
float cylinder_sdf(Point p, Cylinder c) {
    vec2 d = cylinder_terms(p, c);
    return max(d.x, d.y);
}

// Nearest intersection strictly ahead of the ray (t > 0): the interval of X = e^{2t} inside both
// caps (linear in X) and inside the tube, then its first boundary crossing ahead. With P, V the xz
// parts of the ray's origin and direction and S = sinh r, 4X·(|γ_xz|² − S²) = αX² + 2βX + γ with
// α = |P + V|², β = |P|² − |V|² − 2S², γ = |P − V|² (α, γ ≥ 0: the tube's X-set is one interval).
// Its discriminant β² − αγ = 4D, D = S²(S² − (|P|² − |V|²)) − (P × V)², is free of the
// cancellation in β² − αγ (both |P|² − |V|² and P × V are unchanged along the geodesic); the roots
// are q/α and γ/q with q = −β − sign(β)·2√D.
bool cylinder_intersect(Ray ray, Cylinder c, out float t) {
    float lo = 0.0, hi = HYPERBOLIC_X_INF;
    float ch = cosh(c.halfHeight), sh = sinh(c.halfHeight);
    if (!hyperbolic_halfspace(ray, Direction(0.0, ch, 0.0, sh), lo, hi)) return false;
    if (!hyperbolic_halfspace(ray, Direction(0.0, -ch, 0.0, sh), lo, hi)) return false;
    vec2 P = ray.origin.xz, V = ray.direction.xz;
    float sr = sinh(c.radius);
    float S2 = sr * sr;
    float k = dot(P, P) - dot(V, V);
    float cr = P.x * V.y - P.y * V.x;
    float D = S2 * (S2 - k) - cr * cr;
    if (D < 0.0) return false;
    float alpha = dot(P + V, P + V), gamma = dot(P - V, P - V);
    float beta = k - 2.0 * S2;
    if (alpha > 0.0) {
        float q = -beta - (beta >= 0.0 ? 2.0 : -2.0) * sqrt(D);
        if (q == 0.0) return false;   // a tangent ray through the axis' ideal point
        float r1 = q / alpha, r2 = gamma / q;
        lo = max(lo, min(r1, r2));
        hi = min(hi, max(r1, r2));
    } else if (beta < 0.0) {
        lo = max(lo, -gamma / (2.0 * beta));   // 2βX + γ ≤ 0
    } else {
        return false;
    }
    if (lo > hi) return false;
    return hyperbolic_interval_hit(lo, hi, t);
}

// Outward unit normal at p (on or near the surface): a cap's normal when p is nearer the cap's
// plane, else the velocity at p of the geodesic leaving the axis perpendicularly through p:
// (C·p_x/s, (s/C)·p_y, C·p_z/s, (s/C)·p_w) with s = |p_xz| = sinh(distance), C = √(1 + s²).
Direction cylinder_normal(Point p, Cylinder c) {
    vec2 d = cylinder_terms(p, c);
    if (d.y > d.x) return Direction(0.0, (p.y >= 0.0 ? 1.0 : -1.0) * cosh(c.halfHeight), 0.0, sinh(c.halfHeight));
    float s = length(p.xz);
    float C = sqrt(1.0 + s * s);
    return Direction(C * p.x / s, (s / C) * p.y, C * p.z / s, (s / C) * p.w);
}
