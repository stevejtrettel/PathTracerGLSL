// Box in H³ — the region bounded by three pairs of totally geodesic planes, the pair i
// perpendicular to the axis eᵢ at geodesic distance hᵢ = halfSize[i] from the origin o of its own
// frame on either side: ∩ᵢ {|xᵢ| ≤ tanh hᵢ·x_w}, a Euclidean box in the Klein chart. Its dihedral
// angles are not right angles (cos = sinh hᵢ·sinh hⱼ). The face (i, ±) has the outward unit normal
// N = (±cosh hᵢ·eᵢ, sinh hᵢ), and ⟨x, N⟩ = sinh of x's signed distance to its plane. The Validator
// keeps Σ tanh² hᵢ < 1, where the corners exist and the box is bounded. Points and rays are in the
// object's frame; the struct holds only halfSize (the center row is folded into the placement).
// Derivations: docs/claude-2026-11-review/curved/next-shapes-plan.md §2–§3.
// Provides (struct GENERATED from descriptor rows): box_sdf(), box_intersect(), box_normal().
// Depends on: hyperbolic_halfspace(), hyperbolic_interval_hit(), HYPERBOLIC_X_INF (the H³ occupant).

// The largest ⟨p, N⟩ over the six faces, per axis: |pᵢ|·cosh hᵢ − p_w·sinh hᵢ.
vec3 box_face_values(Point p, Box b) {
    return abs(p.xyz) * cosh(b.halfSize) - p.w * sinh(b.halfSize);
}

// The largest signed distance to a face plane: exact inside, never above the distance outside.
// asinh of |x| with the sign restored (GLSL's asinh loses precision for large negative arguments).
float box_sdf(Point p, Box b) {
    vec3 f = box_face_values(p, b);
    float m = max(f.x, max(f.y, f.z));
    return sign(m) * asinh(abs(m));
}

// Nearest intersection strictly ahead of the ray (t > 0): the X = e^{2t} interval of the six
// half-spaces (each linear in X), then its first boundary crossing ahead.
bool box_intersect(Ray ray, Box b, out float t) {
    float lo = 0.0, hi = HYPERBOLIC_X_INF;
    for (int i = 0; i < 3; i++) {
        Direction N = Direction(0.0, 0.0, 0.0, sinh(b.halfSize[i]));
        N[i] = cosh(b.halfSize[i]);
        if (!hyperbolic_halfspace(ray, N, lo, hi)) return false;
        N[i] = -N[i];
        if (!hyperbolic_halfspace(ray, N, lo, hi)) return false;
    }
    return hyperbolic_interval_hit(lo, hi, t);
}

// Outward unit normal at p (on or near the surface): the normal of the face p lies on, the one
// with the largest ⟨p, N⟩ (at an edge, either face's).
Direction box_normal(Point p, Box b) {
    vec3 f = box_face_values(p, b);
    int i = f.x >= f.y && f.x >= f.z ? 0 : (f.y >= f.z ? 1 : 2);
    Direction N = Direction(0.0, 0.0, 0.0, sinh(b.halfSize[i]));
    N[i] = (p[i] >= 0.0 ? 1.0 : -1.0) * cosh(b.halfSize[i]);
    return N;
}
