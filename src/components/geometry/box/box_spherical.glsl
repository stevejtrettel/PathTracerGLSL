// Box in S³ — the region bounded by three pairs of great spheres, the pair i perpendicular to the
// axis eᵢ at geodesic distance hᵢ = halfSize[i] < π/2 from the origin o of its own frame on either
// side: ∩ᵢ {|xᵢ| ≤ tan hᵢ·x_w}. It lies in the open hemisphere x_w > 0 (at x_w ≤ 0 every xᵢ would
// vanish), where it is a Euclidean box in the gnomonic chart; its smallest x_w, at the corners, is
// 1/√(1 + Σ tan² hᵢ). The face (i, ±) has the outward unit normal N = (±cos hᵢ·eᵢ, −sin hᵢ), and
// x·N = sin of x's signed distance to its great sphere. The Validator keeps every hᵢ in (0, π/2).
// Points and rays are in the object's frame; the struct holds only halfSize (the center row is
// folded into the placement). Derivations: docs/claude-2026-11-review/curved/next-shapes-plan.md.
// Provides (struct GENERATED from descriptor rows): box_sdf(), box_intersect(), box_normal().
// Depends on: spherical_cos_sin(), spherical_asin(), spherical_halfspace(), spherical_crossing(),
//             SPHERICAL_T_INF (the S³ occupant).

// cos hᵢ and sin hᵢ per axis.
void box_cos_sin(Box b, out vec3 c, out vec3 s) {
    vec2 x = spherical_cos_sin(b.halfSize.x), y = spherical_cos_sin(b.halfSize.y), z = spherical_cos_sin(b.halfSize.z);
    c = vec3(x.x, y.x, z.x);
    s = vec3(x.y, y.y, z.y);
}

// The largest signed distance to a face's great sphere: exact inside, never above the distance
// outside. Per axis the larger of p·N_{i±} is |pᵢ|·cos hᵢ − p_w·sin hᵢ.
float box_sdf(Point p, Box b) {
    vec3 c, s;
    box_cos_sin(b, c, s);
    vec3 f = abs(p.xyz) * c - p.w * s;
    return spherical_asin(clamp(max(f.x, max(f.y, f.z)), -1.0, 1.0));
}

// Nearest intersection strictly ahead of the ray (t > 0): the T = tan(t − φ) interval of the six
// half-spaces (each linear in T) on the ray's arc in x_w > 0, then the earlier of its two
// crossings ahead (spherical_crossing). A ray whose largest x_w, √(p_w² + v_w²), does not exceed
// the corners' misses.
bool box_intersect(Ray ray, Box b, out float t) {
    vec3 c, s;
    box_cos_sin(b, c, s);
    vec3 tn = s / c;
    if (length(vec2(ray.origin.w, ray.direction.w)) <= inversesqrt(1.0 + dot(tn, tn))) return false;
    float lo = -SPHERICAL_T_INF, hi = SPHERICAL_T_INF;
    for (int i = 0; i < 3; i++) {
        Direction N = Direction(0.0, 0.0, 0.0, -s[i]);
        N[i] = c[i];
        if (!spherical_halfspace(ray, N, lo, hi)) return false;
        N[i] = -c[i];
        if (!spherical_halfspace(ray, N, lo, hi)) return false;
    }
    float best = MAX_DIST;
    spherical_crossing(ray, lo, best);
    spherical_crossing(ray, hi, best);
    t = best;
    return best < MAX_DIST;
}

// Outward unit normal at p (on or near the surface): the normal of the face p lies on, the one
// with the largest p·N (at an edge, either face's).
Direction box_normal(Point p, Box b) {
    vec3 c, s;
    box_cos_sin(b, c, s);
    vec3 f = abs(p.xyz) * c - p.w * s;
    int i = f.x >= f.y && f.x >= f.z ? 0 : (f.y >= f.z ? 1 : 2);
    Direction N = Direction(0.0, 0.0, 0.0, -s[i]);
    N[i] = (p[i] >= 0.0 ? 1.0 : -1.0) * c[i];
    return N;
}
