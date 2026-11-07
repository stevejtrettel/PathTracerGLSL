// Hyperbolic space H³ (curvature −1) in the hyperboloid model. A point is p ∈ R^{3,1} with
// ⟨p,p⟩ = −1 and p.w > 0, where ⟨a,b⟩ = a.x·b.x + a.y·b.y + a.z·b.z − a.w·b.w; a tangent vector
// at p is v with ⟨p,v⟩ = 0, and the metric on it is ⟨·,·⟩. The world origin is o = (0,0,0,1).
// The math and its measurements are in hyperbolic.md; the contract is components/ambient/README.md.
// Provides: fp_uncertainty(), ambient_geodesic(), ambient_flow(), ambient_dot(),
//           ambient_normalize(), ambient_frame(), ambient_parallel_transport(),
//           ambient_distance(), ambient_direction_to(), ambient_aim(), ambient_sky_key(),
//           isometry_point(), isometry_tangent(), isometry_direction(); for the H³ bodies,
//           hyperbolic_form(), hyperbolic_on_model(), hyperbolic_plane_root(), hyperbolic_halfspace(),
//           hyperbolic_interval_hit(), hyperbolic_plane_vector() and hyperbolic_plane_distance(); for
//           marched fields, sdf_plane() and sdf_tube() (the rest of the vocabulary is
//           components/ambient/sdf.glsl).
// Depends on: Point/Direction (types.glsl), Ray/Frame (structs), FP_UNCERTAINTY_REL/ABS (math).

// The far clip MAX_DIST (an arc length; nothing beyond it is geometry) is emitted just before
// this block: the descriptor's farClip 10, or the measurement's. float32 cosh overflows near
// t = 89, and a scene inside the working radius (about 3 from the world origin) loses only
// sub-pixel grazing bands of its planes at 10. The sky does not depend on it: a missed ray looks
// it up at its ideal endpoint (ambient_sky_key), exact for any t.

// The Minkowski form ⟨a,b⟩ of R^{3,1}, for points and tangent vectors alike.
float hyperbolic_form(vec4 a, vec4 b) {
    return dot(a.xyz, b.xyz) - a.w * b.w;
}

// A point put back on the hyperboloid by recomputing w from xyz (w = √(1 + |xyz|²)); measured
// more accurate than rescaling all four coordinates, which fails outright far from o.
Point hyperbolic_on_model(vec4 p) {
    return vec4(p.xyz, sqrt(1.0 + dot(p.xyz, p.xyz)));
}

// Positional error bound of a floating-point-accurate point: 256 ulps of its largest
// coordinate, floored near the origin. On the hyperboloid w ≥ |x|, |y|, |z|, so the largest
// coordinate is w (= cosh of the distance to o).
float fp_uncertainty(Point p) {
    return max(FP_UNCERTAINTY_ABS, FP_UNCERTAINTY_REL * p.w);
}

// The point at arc length t along the geodesic leaving `origin` with unit velocity `dir`:
// cosh t·origin + sinh t·dir.
Point ambient_geodesic(Point origin, Direction dir, float t) {
    return hyperbolic_on_model(cosh(t) * origin + sinh(t) * dir);
}

// The geodesic flow: the point at arc length t and the velocity there, sinh t·origin + cosh t·dir
// (the ARRIVAL direction).
Ray ambient_flow(Ray r, float t) {
    return Ray(ambient_geodesic(r.origin, r.direction, t), sinh(t) * r.origin + cosh(t) * r.direction, r.wl);
}

// The metric on tangent vectors at p: the Minkowski form (positive definite on T_p H³).
float ambient_dot(Direction v1, Direction v2, Point p) {
    return hyperbolic_form(v1, v2);
}

// v rescaled to unit length in the metric at p.
Direction ambient_normalize(Direction v, Point p) {
    return v * inversesqrt(hyperbolic_form(v, v));
}

// The coordinate axis e_i whose component orthogonal to p, a and b is longest, normalized.
// Far from o every axis is nearly parallel to p in R⁴, so a fixed seed with a length threshold
// fails there (measured about 4 from o); the longest candidate does not.
Direction hyperbolic_tangent_seed(Point p, Direction a, Direction b) {
    Direction best = Direction(0.0);
    float best_l2 = -1.0;
    for (int i = 0; i < 4; i++) {
        Direction e = Direction(0.0);
        e[i] = 1.0;
        Direction w = e + hyperbolic_form(e, p) * p;   // onto T_p (⟨p,p⟩ = −1)
        w -= hyperbolic_form(w, a) * a;
        w -= hyperbolic_form(w, b) * b;
        float l2 = hyperbolic_form(w, w);
        if (l2 > best_l2) { best_l2 = l2; best = w; }
    }
    return best * inversesqrt(best_l2);
}

// Orthonormal tangent frame at p around n. n is first projected onto T_p (a normal mapped from
// an object's frame is tangent only to rounding); t and b are Gram–Schmidt seeds from the axes.
Frame ambient_frame(Point p, Direction n) {
    Direction nn = ambient_normalize(n + hyperbolic_form(n, p) * p, p);
    Direction t = hyperbolic_tangent_seed(p, nn, Direction(0.0));
    Direction b = hyperbolic_tangent_seed(p, nn, t);
    return Frame(p, t, b, nn);
}

// Parallel transport of v ∈ T_from along the geodesic to `to`:
// v + ⟨to,v⟩/(1 − ⟨from,to⟩)·(from + to).
Direction ambient_parallel_transport(Direction v, Point from_p, Point to_p) {
    return v + hyperbolic_form(to_p, v) / (1.0 - hyperbolic_form(from_p, to_p)) * (from_p + to_p);
}

// Geodesic distance by the chord form 2·asinh(√⟨a−b,a−b⟩ / 2): ⟨a−b,a−b⟩ = 4 sinh²(d/2), and
// unlike acosh(−⟨a,b⟩) it keeps full relative precision at small separations.
float ambient_distance(Point a, Point b) {
    Point c = a - b;
    return 2.0 * asinh(0.5 * sqrt(max(hyperbolic_form(c, c), 0.0)));
}

// The unit direction at `from` of the geodesic to `to` (the normalized log map):
// (to − from) + ⟨from, to − from⟩·from, the chord projected onto T_from.
Direction ambient_direction_to(Point from, Point to) {
    Direction c = to - from;
    return ambient_normalize(c + hyperbolic_form(from, c) * from, from);
}

// Aims a shadow ray at `to`. One geodesic joins two points of H³, so `along` selects nothing.
Direction ambient_aim(Point from, Direction along, Point to, out float remaining) {
    remaining = ambient_distance(from, to);
    return ambient_direction_to(from, to);
}

// The sky is a picture on the sphere at infinity: the ray (p, v) ends at the ideal point
// normalize((p + v).xyz) (γ(t) = cosh t·p + sinh t·v → (e^t/2)(p + v), a null vector), in world
// coordinates and for any t. At o it is the view direction itself.
vec3 ambient_sky_key(Point p, Direction v) {
    return normalize((p + v).xyz);
}

// The first t > 0 at which the ray meets the totally geodesic plane {x : ⟨x, N⟩ = 0}, N a unit
// spacelike 4-vector (the plane and disk bodies). Along γ(t), ⟨γ(t), N⟩ = P·cosh t + W·sinh t with
// P = ⟨p, N⟩, W = ⟨v, N⟩, zero where tanh t = −P/W, i.e. e^{2t} = (W − P)/(W + P). A root at t > 0
// exists iff P and W have opposite signs and |W| > |P|. Floor 0 (escape is ray_spawn's offset).
bool hyperbolic_plane_root(Ray ray, vec4 N, out float t) {
    float P = hyperbolic_form(ray.origin, N);
    float W = hyperbolic_form(ray.direction, N);
    if (P * W >= 0.0 || abs(W) <= abs(P)) return false;
    t = 0.5 * log((W - P) / (W + P));
    return true;
}

// The intervals of the box and cylinder bodies are intervals of X = e^{2t} ∈ (0, ∞) along the ray;
// HYPERBOLIC_X_INF stands for an interval with no upper end.
#define HYPERBOLIC_X_INF 3.0e38

// Narrows the interval [lo, hi] of X = e^{2t} to where the ray lies in the half-space ⟨x, N⟩ ≤ 0
// (N a unit spacelike 4-vector); false when it becomes empty. Along γ(t),
// ⟨γ(t), N⟩ = P·cosh t + W·sinh t = (e^{−t}/2)·((P + W)·X + (P − W)) with P = ⟨p, N⟩, W = ⟨v, N⟩,
// so the condition is linear in X: an upper end (W − P)/(P + W) when P + W > 0, a lower end when
// P + W < 0, and all or nothing (the sign of P − W) when P + W = 0.
bool hyperbolic_halfspace(Ray ray, vec4 N, inout float lo, inout float hi) {
    float P = hyperbolic_form(ray.origin, N);
    float W = hyperbolic_form(ray.direction, N);
    float c1 = P + W;
    if (c1 > 0.0) hi = min(hi, (W - P) / c1);
    else if (c1 < 0.0) lo = max(lo, (W - P) / c1);
    else if (P - W > 0.0) return false;
    return lo <= hi;
}

// The first boundary crossing ahead of a region whose points along the ray are X ∈ [lo, hi]: the
// entry ½·log lo when lo > 1 (the origin is outside), else the exit ½·log hi when hi > 1 (the
// origin is inside; an interval with no upper end has no exit). Floor 0: escape is ray_spawn's
// offset.
bool hyperbolic_interval_hit(float lo, float hi, out float t) {
    if (lo > 1.0) { t = 0.5 * log(lo); return true; }
    if (hi > 1.0 && hi < HYPERBOLIC_X_INF) { t = 0.5 * log(hi); return true; }
    return false;
}

// The unit spacelike 4-vector N of the totally geodesic plane perpendicular to n (a unit tangent
// vector at o) at signed distance −offset from o, as in E³'s dot(p, n) + offset = 0:
// N = (cosh(offset)·n.xyz, −sinh(offset)), so that ⟨exp_o(λ·n), N⟩ = sinh(λ + offset).
Direction hyperbolic_plane_vector(Direction n, float offset) {
    return Direction(cosh(offset) * n.xyz, -sinh(offset));
}

// Exact signed distance from p to the plane {x : ⟨x, N⟩ = 0}: asinh⟨p, N⟩, positive on the side N
// points to; asinh of |s| with the sign restored (GLSL's asinh loses precision for large negative
// arguments).
float hyperbolic_plane_distance(Point p, Direction N) {
    float s = hyperbolic_form(p, N);
    return sign(s) * asinh(abs(s));
}

// Marched fields: the signed distance to the plane perpendicular to n (a unit tangent vector at o)
// at signed distance −offset from o — the plane rows' meaning.
float sdf_plane(Point p, Direction n, float offset) {
    return hyperbolic_plane_distance(p, hyperbolic_plane_vector(n, offset));
}

// Marched fields: the distance from p to the geodesic through the point a with unit tangent u ∈ T_a,
// minus r (a tube of radius r about it). p⊥ = p + ⟨p,a⟩·a − ⟨p,u⟩·u is the part of p off the plane
// span(a, u) of R^{3,1}, and ⟨p⊥, p⊥⟩ = sinh² of the distance: precise near the axis, where the
// equivalent acosh√(⟨p,a⟩² − ⟨p,u⟩²) is not.
float sdf_tube(Point p, Point a, Direction u, float r) {
    vec4 w = p + hyperbolic_form(p, a) * a - hyperbolic_form(p, u) * u;
    return asinh(sqrt(max(hyperbolic_form(w, w), 0.0))) - r;
}

// An object's placement, an isometry of H³, is a linear map of R⁴ held as a mat4 m; these apply it
// to a point and to a tangent vector (the same product).
Point isometry_point(mat4 m, Point p) {
    return m * p;
}
Direction isometry_tangent(mat4 m, Direction v) {
    return m * v;
}

// The world image G·v of a tangent vector v given in an object's frame, where `inverse` is the
// object's placement G⁻¹ (world → local). An isometry of the form satisfies G = J·(G⁻¹)ᵀ·J with
// J = diag(1,1,1,−1), so G·v = J·((J·v)·G⁻¹), a row-vector product that needs no second matrix.
Direction isometry_direction(mat4 inverse, Direction v) {
    const vec4 J = vec4(1.0, 1.0, 1.0, -1.0);
    return J * ((J * v) * inverse);
}
