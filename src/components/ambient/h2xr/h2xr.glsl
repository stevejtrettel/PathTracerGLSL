// H²×R — the product of the hyperbolic plane (curvature −1) and the line. A point is
// p = (x, y, z, w): the height is y, and (x, z, w) lies on the hyperboloid x² + z² − w² = −1, w > 0,
// of R^{2,1}. Write p_H = (x, 0, z, w) for its H² part. A tangent vector at p is v with
// ⟨p_H, v⟩_H = 0, where ⟨a,b⟩_H = a.x·b.x + a.z·b.z − a.w·b.w; v.y is free. The metric on tangent
// vectors is ⟨a,b⟩_H + a.y·b.y, which is the Minkowski form of R^{3,1}, as in H³. The world origin is
// o = (0,0,0,1). The space is homogeneous but not isotropic: the vertical is distinguished. The math
// and its measurements are in h2xr.md; the contract is components/ambient/README.md.
// Provides: fp_uncertainty(), ambient_geodesic(), ambient_flow(), ambient_dot(),
//           ambient_normalize(), ambient_frame(), ambient_parallel_transport(),
//           ambient_distance(), ambient_direction_to(), ambient_aim(), ambient_sky_key(),
//           isometry_point(), isometry_tangent(), isometry_direction(); for the H²×R bodies,
//           h2xr_form(), h2xr_h2(), h2xr_speed(), h2xr_sinhc(), h2xr_asinhc(), h2xr_basis(),
//           h2xr_local(), h2xr_world(),
//           h2xr_vertical_plane_root() and h2xr_area_density().
// Depends on: Point/Direction (types.glsl), Ray/Frame (structs), FP_UNCERTAINTY_REL/ABS (math).

// The far clip MAX_DIST (an arc length, as in H³) is emitted just before this block: the
// descriptor's farClip 10, or the measurement's. The hyperboloid coordinates of a point 10 from the
// scene are about e¹⁰/2, still finite in float32. The sky does not depend on it: a missed ray looks
// it up by its endpoint class (ambient_sky_key), exact for any t.

// The form of R^{2,1} on the H² parts; the height (y) does not enter.
float h2xr_form(vec4 a, vec4 b) {
    return a.x * b.x + a.z * b.z - a.w * b.w;
}

// The H² part of a point or a vector: its height component removed.
vec4 h2xr_h2(vec4 v) {
    return vec4(v.x, 0.0, v.z, v.w);
}

// sinh(x)/x, asinh(x)/x, atanh(x)/x. SwiftShader evaluates sinh, asinh and atanh through exp and
// log, with an ABSOLUTE error near 0 (measured: 8e-8, 2e-7, 9e-8), so the plain quotient loses up to
// 2% at tiny x. Below 0.05 the Taylor polynomials (truncation below 3e-9); above, the quotient's
// relative error is at most about 4e-6.
float h2xr_sinhc(float x) {
    float x2 = x * x;
    return abs(x) < 0.05 ? 1.0 + x2 * (1.0 / 6.0 + x2 * (1.0 / 120.0)) : sinh(x) / x;
}
float h2xr_asinhc(float x) {
    float x2 = x * x;
    return abs(x) < 0.05 ? 1.0 + x2 * (-1.0 / 6.0 + x2 * (3.0 / 40.0)) : asinh(x) / x;
}
float h2xr_atanhc(float x) {
    float x2 = x * x;
    return abs(x) < 0.05 ? 1.0 + x2 * (1.0 / 3.0 + x2 * (1.0 / 5.0)) : atanh(x) / x;
}

// A point put back on the model by recomputing w from x and z (H³'s rule); the height needs nothing.
Point h2xr_on_model(vec4 p) {
    return vec4(p.x, p.y, p.z, sqrt(1.0 + p.x * p.x + p.z * p.z));
}

// Positional error bound of a floating-point-accurate point: 256 ulps of its largest coordinate,
// floored near the origin. On the hyperboloid w ≥ |x|, |z|; the height is Euclidean.
float fp_uncertainty(Point p) {
    return max(FP_UNCERTAINTY_ABS, FP_UNCERTAINTY_REL * max(p.w, abs(p.y)));
}

// The horizontal speed s of a unit tangent vector: the length of its H² part u = (v.x, 0, v.z, v.w).
// (s and the H² step t·sinhc(st)·u below are computed from the same u, so an error in s changes
// only the speed along u.)
float h2xr_speed(Direction v) {
    return sqrt(max(h2xr_form(v, v), 0.0));
}

// The point at arc length t along the geodesic leaving `origin` with unit velocity `dir`: the H²
// part runs along an H² geodesic at speed s, the height at speed dir.y:
// cosh(st)·origin_H + t·sinhc(st)·dir_H + (origin.y + dir.y·t)·e_y. No division by s, so a vertical
// geodesic (s = 0) is exact.
Point ambient_geodesic(Point origin, Direction dir, float t) {
    float st = h2xr_speed(dir) * t;
    vec4 h = cosh(st) * h2xr_h2(origin) + (t * h2xr_sinhc(st)) * h2xr_h2(dir);
    h.y = origin.y + dir.y * t;
    return h2xr_on_model(h);
}

// The geodesic flow: the point at arc length t and the velocity there,
// s·sinh(st)·origin_H + cosh(st)·dir_H + dir.y·e_y (the ARRIVAL direction).
Ray ambient_flow(Ray r, float t) {
    float s = h2xr_speed(r.direction);
    float st = s * t;
    Direction v = (s * sinh(st)) * h2xr_h2(r.origin) + cosh(st) * h2xr_h2(r.direction);
    v.y = r.direction.y;
    return Ray(ambient_geodesic(r.origin, r.direction, t), v, r.wl);
}

// The orthonormal basis (E1, e_y, E2) of T_p: the x and z axes at o carried to p along the H²
// geodesic (H²'s boost from o to p_H applied to them), and the vertical. With k = 1/(1 + w):
// E1 = (1 + k·x², 0, k·x·z, x), E2 = (k·x·z, 0, 1 + k·z², z). Every term is a product of
// coordinates, with no cancellation.
void h2xr_basis(Point p, out Direction e1, out Direction e2) {
    float k = 1.0 / (1.0 + p.w);
    e1 = Direction(1.0 + k * p.x * p.x, 0.0, k * p.x * p.z, p.x);
    e2 = Direction(k * p.x * p.z, 0.0, 1.0 + k * p.z * p.z, p.z);
}

// The components of v in that basis, and the vector with given components.
vec3 h2xr_local(Point p, Direction v) {
    Direction e1, e2;
    h2xr_basis(p, e1, e2);
    return vec3(h2xr_form(v, e1), v.y, h2xr_form(v, e2));
}
Direction h2xr_world(Point p, vec3 l) {
    Direction e1, e2;
    h2xr_basis(p, e1, e2);
    return l.x * e1 + l.z * e2 + Direction(0.0, l.y, 0.0, 0.0);
}

// The metric on tangent vectors at p — the Minkowski form of R^{3,1} — evaluated as the dot product
// of the components in the orthonormal basis. Far from o the form cancels (a tangent vector's
// coordinates grow like w while its length stays 1) and on SwiftShader can come out negative at
// hit points beyond about 4 from o, which a floor seen near its horizon reaches; the sum of squares
// cannot be negative. This keeps such directions finite, not accurate: either way their relative
// error grows like ε·w² (about 1e-4 at 4 from o, 1e-2 at 6, order 1 at 8).
float ambient_dot(Direction v1, Direction v2, Point p) {
    return dot(h2xr_local(p, v1), h2xr_local(p, v2));
}

// v rescaled to unit length in the metric at p.
Direction ambient_normalize(Direction v, Point p) {
    return v * inversesqrt(ambient_dot(v, v, p));
}

// Orthonormal tangent frame at p around n: n's components in the basis (the part of n normal to the
// model drops out), completed to an orthonormal triple in those components and mapped back.
Frame ambient_frame(Point p, Direction n) {
    vec3 nl = normalize(h2xr_local(p, n));
    vec3 tl = normalize(cross(nl, abs(nl.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
    vec3 bl = cross(nl, tl);
    return Frame(p, h2xr_world(p, tl), h2xr_world(p, bl), h2xr_world(p, nl));
}

// Parallel transport of v ∈ T_from along the geodesic to `to`: the height component is parallel,
// and the H² part follows H³'s formula v + ⟨to,v⟩/(1 − ⟨from,to⟩)·(from + to) in R^{2,1}.
Direction ambient_parallel_transport(Direction v, Point from_p, Point to_p) {
    return v + h2xr_form(to_p, v) / (1.0 - h2xr_form(from_p, to_p)) * (h2xr_h2(from_p) + h2xr_h2(to_p));
}

// The H² distance of two points by the chord form 2·asinh(√⟨c,c⟩_H / 2), c = a_H − b_H.
float h2xr_hdistance(Point a, Point b) {
    vec4 c = h2xr_h2(a) - h2xr_h2(b);
    return 2.0 * asinh(0.5 * sqrt(max(h2xr_form(c, c), 0.0)));
}

// Geodesic distance √(D_H² + Δy²) (the product metric).
float ambient_distance(Point a, Point b) {
    return length(vec2(h2xr_hdistance(a, b), b.y - a.y));
}

// The unit direction at `from` of the geodesic to `to`: (D_H·ŵ + Δy·e_y)/d, with w the H² log
// direction (to_H − from_H) + ⟨from_H, to_H − from_H⟩·from_H, of length sinh D_H, so that
// D_H·ŵ = asinhc(|w|)·w — no division by |w|, exact for a point straight above.
Direction ambient_direction_to(Point from, Point to) {
    vec4 c = h2xr_h2(to) - h2xr_h2(from);
    vec4 w = c + h2xr_form(from, c) * h2xr_h2(from);
    Direction v = h2xr_asinhc(sqrt(max(h2xr_form(w, w), 0.0))) * w;
    v.y = to.y - from.y;
    return ambient_normalize(v, from);
}

// Aims a shadow ray at `to`. One geodesic joins two points of H²×R, so `along` selects nothing.
Direction ambient_aim(Point from, Direction along, Point to, out float remaining) {
    remaining = ambient_distance(from, to);
    return ambient_direction_to(from, to);
}

// The sky at infinity: a ray's endpoint class is the ideal point ξ of its H² part with its angle
// β from the vertical; the key is (sin β·ξ.x, cos β, sin β·ξ.z), ξ in Klein coordinates
// (p_H + û).xz/(p_H + û).w, a unit 2-vector (p_H + û is null). With m = s·p_H + u = s·(p_H + û),
// sin β·ξ = s·m.xz/m.w. At o it is the view direction; a vertical ray reads (0, ±1, 0).
vec3 ambient_sky_key(Point p, Direction v) {
    float s = h2xr_speed(v);
    if (s == 0.0) return vec3(0.0, sign(v.y), 0.0);
    vec4 m = s * h2xr_h2(p) + h2xr_h2(v);
    return normalize(vec3(s * m.x / m.w, v.y, s * m.z / m.w));
}

// The first t > 0 at which the ray meets the vertical plane {x : ⟨x_H, N⟩_H = 0}, N a unit
// spacelike vector of R^{2,1} (N.y = 0). Along the geodesic ⟨γ(t), N⟩ = cosh(st)·P + t·sinhc(st)·W
// with P = ⟨p, N⟩, W = ⟨v, N⟩, zero where tanh(st) = −s·P/W: t = (−P/W)·atanhc(−s·P/W), a root at
// t > 0 iff P·W < 0 and s·|P| < |W|. No 1/s: a near-vertical ray loses nothing.
bool h2xr_vertical_plane_root(Ray ray, vec4 N, out float t) {
    float P = h2xr_form(ray.origin, N);
    float W = h2xr_form(ray.direction, N);
    float s = h2xr_speed(ray.direction);
    if (P * W >= 0.0 || s * abs(P) >= abs(W)) return false;
    t = (-P / W) * h2xr_atanhc(-s * P / W);
    return true;
}

// The area density J(a, b) = d²·sinh(D_H)/D_H: the area of the geodesic sphere about a per unit
// solid angle at the point b (the Jacobi fields along a geodesic at angle β from the vertical grow
// as sinh(t·sin β)/sin β and as t, and t·sin β = D_H). It replaces E³'s d² in the area ↔ solid
// angle conversion, dω = cos·dA/J, and is symmetric in a and b. It depends on the direction, not
// only on d: a light straight above falls off as 1/d², one at the same height as 1/(d·sinh d).
float h2xr_area_density(Point a, Point b) {
    float dh = h2xr_hdistance(a, b);
    float dy = b.y - a.y;
    return (dh * dh + dy * dy) * h2xr_sinhc(dh);
}

// An object's placement (B, c) — B ∈ SO⁺(2,1) on (x, z, w), c a height shift — is held as a mat4 m:
// m[3][1] (column 3, row 1) is c, and the rest of m is B on (x, z, w) and the identity on y. It is
// an encoding, not a linear map of the 4-vector (a translation of R is affine). These apply it.
Point isometry_point(mat4 m, Point p) {
    vec4 q = m * vec4(p.x, 0.0, p.z, p.w);
    q.y = p.y + m[3][1];
    return q;
}
Direction isometry_tangent(mat4 m, Direction v) {
    vec4 q = m * vec4(v.x, 0.0, v.z, v.w);
    q.y = v.y;
    return q;
}

// The world image G·v of a tangent vector v given in an object's frame, from the object's
// placement G⁻¹ (world → local). The linear part L of G⁻¹ (its shift entry zeroed) preserves the
// form, so G's linear part is J·Lᵀ·J (J = diag(1,1,1,−1)) and G·v = J·((J·v)·L), GLSL's v·M being
// the row-vector product.
Direction isometry_direction(mat4 inverse, Direction v) {
    const vec4 J = vec4(1.0, 1.0, 1.0, -1.0);
    mat4 L = inverse;
    L[3][1] = 0.0;
    return J * ((J * v) * L);
}
