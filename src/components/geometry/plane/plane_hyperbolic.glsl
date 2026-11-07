// Plane in H³ — a totally geodesic plane: {x : ⟨x, N⟩ = 0} for a unit spacelike 4-vector N. In
// the object's frame the plane is perpendicular to `normal` (a tangent vector at o) at signed
// distance −offset from o, as in E³'s dot(p, normal) + offset = 0: N = (cosh(offset)·normal.xyz,
// −sinh(offset)). Then ⟨exp_o(λ·normal), N⟩ = sinh(λ + offset), so the signed distance is
// asinh(⟨p, N⟩), positive on the side `normal` points to. Derivations:
// components/ambient/hyperbolic/hyperbolic.md.
// Provides (struct GENERATED from descriptor rows): plane_sdf(), plane_intersect(), plane_normal().

Direction plane_N(Plane pl) {
    return Direction(cosh(pl.offset) * pl.normal.xyz, -sinh(pl.offset));
}

// Exact signed distance; asinh of |x| with the sign restored (GLSL's asinh loses precision for
// large negative arguments).
float plane_sdf(Point p, Plane pl) {
    float s = ambient_dot(p, plane_N(pl), p);
    return sign(s) * asinh(abs(s));
}

// Along γ(t): ⟨γ(t), N⟩ = P·cosh t + W·sinh t with P = ⟨p, N⟩, W = ⟨v, N⟩, zero where
// tanh t = −P/W, i.e. e^{2t} = (W − P)/(W + P). A root at t > 0 exists iff P and W have opposite
// signs and |W| > |P|. Floor 0 (escape is ray_spawn's offset).
bool plane_intersect(Ray ray, Plane pl, out float t) {
    Direction N = plane_N(pl);
    float P = ambient_dot(ray.origin, N, ray.origin);
    float W = ambient_dot(ray.direction, N, ray.origin);
    if (P * W >= 0.0 || abs(W) <= abs(P)) return false;
    t = 0.5 * log((W - P) / (W + P));
    return true;
}

// Outward unit normal: N projected onto T_p, which is N itself on the plane.
Direction plane_normal(Point p, Plane pl) {
    return plane_N(pl);
}
