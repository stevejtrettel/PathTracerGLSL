// Cylinder in S³ — the tube of geodesic radius r about the y-axis great circle {(0, sin s, 0, cos s)}
// of its own frame, capped by the two great spheres perpendicular to the axis at axial distance
// ±h (h = halfHeight). x lies at distance atan(|x_xz|, |x_yw|) from the axis, so the tube is
// |x_xz|² ≤ sin² r (a Clifford-type solid torus); the caps are |x_y| ≤ tan h·x_w, with outward
// normals (0, ±cos h, 0, −sin h). With r, h in (0, π/2) (the Validator's domain) the capped tube
// lies in the open hemisphere x_w > 0 with smallest x_w = cos r·cos h at its rims, but it is NOT
// convex: in the gnomonic chart the tube is the inside of a one-sheet hyperboloid, so a geodesic
// can cross it in two arcs. Points and rays are in the object's frame; the struct holds radius and
// halfHeight (the center row is folded into the placement). Derivations:
// docs/claude-2026-11-review/curved/next-shapes-plan.md §2–§3.
// Provides (struct GENERATED from descriptor rows): cylinder_sdf(), cylinder_intersect(),
//             cylinder_normal().
// Depends on: spherical_cos_sin(), spherical_asin(), spherical_halfspace(), spherical_crossing(),
//             SPHERICAL_T_INF (the S³ occupant).

// The signed distances to the tube and to the nearer cap's great sphere; the larger names the
// face p is on.
vec2 cylinder_terms(Point p, Cylinder c) {
    vec2 csh = spherical_cos_sin(c.halfHeight);
    float cap = abs(p.y) * csh.x - p.w * csh.y;
    return vec2(atan(length(p.xz), length(p.yw)) - c.radius, spherical_asin(clamp(cap, -1.0, 1.0)));
}

// The larger of the two: exact inside, never above the distance outside.
float cylinder_sdf(Point p, Cylinder c) {
    vec2 d = cylinder_terms(p, c);
    return max(d.x, d.y);
}

// Nearest intersection strictly ahead of the ray (t > 0), on the ray's arc in x_w > 0 in
// T = tan(t − φ) (spherical_halfspace): the caps give one interval; the tube, with P, V the xz
// parts of the origin and direction, P̃ = aP + bV, Ṽ = aV − bP (a = p_w, b = v_w, A² = a² + b²) and
// S = sin r, is where (|Ṽ|² − A²S²)T² + 2(P̃·Ṽ)T + (|P̃|² − A²S²) ≤ 0 — one interval or, when the
// leading coefficient is negative, the outside of one. Its discriminant is A⁴·D with
// D = S²(|P|² + |V|² − S²) − (P × V)² (cancellation-free; an invariant of the geodesic). The capped
// tube is the caps' interval cut by that set: at most two intervals, and the hit is the earliest
// crossing ahead among their ends (spherical_crossing). A ray whose largest x_w, √(a² + b²), does
// not exceed cos r·cos h misses.
bool cylinder_intersect(Ray ray, Cylinder c, out float t) {
    float a = ray.origin.w, b = ray.direction.w;
    vec2 csr = spherical_cos_sin(c.radius), csh = spherical_cos_sin(c.halfHeight);
    float A2 = a * a + b * b;
    if (A2 <= csr.x * csr.x * csh.x * csh.x) return false;
    float lo = -SPHERICAL_T_INF, hi = SPHERICAL_T_INF;
    if (!spherical_halfspace(ray, Direction(0.0, csh.x, 0.0, -csh.y), lo, hi)) return false;
    if (!spherical_halfspace(ray, Direction(0.0, -csh.x, 0.0, -csh.y), lo, hi)) return false;
    vec2 P = ray.origin.xz, V = ray.direction.xz;
    float S2 = csr.y * csr.y;
    vec2 Pt = a * P + b * V, Vt = a * V - b * P;
    float qa = dot(Vt, Vt) - A2 * S2, qb = dot(Pt, Vt), qc = dot(Pt, Pt) - A2 * S2;
    float cr = P.x * V.y - P.y * V.x;
    float D = S2 * (dot(P, P) + dot(V, V) - S2) - cr * cr;
    float best = MAX_DIST;
    if (qa == 0.0) {
        // linear: 2·qb·T + qc ≤ 0
        if (qb > 0.0) hi = min(hi, -qc / (2.0 * qb));
        else if (qb < 0.0) lo = max(lo, -qc / (2.0 * qb));
        else if (qc > 0.0) return false;
        if (lo > hi) return false;
        spherical_crossing(ray, lo, best);
        spherical_crossing(ray, hi, best);
    } else if (D < 0.0) {
        if (qa > 0.0) return false;   // outside the tube along the whole arc
        spherical_crossing(ray, lo, best);   // inside it along the whole arc: the caps decide
        spherical_crossing(ray, hi, best);
    } else {
        float q = -qb - (qb >= 0.0 ? 1.0 : -1.0) * A2 * sqrt(D);
        if (q == 0.0) return false;
        float r1 = q / qa, r2 = qc / q;
        float t1 = min(r1, r2), t2 = max(r1, r2);
        if (qa > 0.0) {
            float l = max(lo, t1), h = min(hi, t2);
            if (l > h) return false;
            spherical_crossing(ray, l, best);
            spherical_crossing(ray, h, best);
        } else {
            if (lo <= min(hi, t1)) { spherical_crossing(ray, lo, best); spherical_crossing(ray, min(hi, t1), best); }
            if (max(lo, t2) <= hi) { spherical_crossing(ray, max(lo, t2), best); spherical_crossing(ray, hi, best); }
        }
    }
    t = best;
    return best < MAX_DIST;
}

// Outward unit normal at p (on or near the surface): a cap's normal when p is nearer the cap's
// great sphere, else the velocity at p of the geodesic leaving the axis perpendicularly through p:
// (c·p_x/s, −(s/c)·p_y, c·p_z/s, −(s/c)·p_w) with s = |p_xz| = sin(distance), c = |p_yw|.
Direction cylinder_normal(Point p, Cylinder c) {
    vec2 d = cylinder_terms(p, c);
    if (d.y > d.x) {
        vec2 csh = spherical_cos_sin(c.halfHeight);
        return Direction(0.0, (p.y >= 0.0 ? 1.0 : -1.0) * csh.x, 0.0, -csh.y);
    }
    float s = length(p.xz), cw = length(p.yw);
    return Direction(cw * p.x / s, -(s / cw) * p.y, cw * p.z / s, -(s / cw) * p.w);
}
