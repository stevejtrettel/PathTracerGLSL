// Spherical space S³ (curvature +1) in the unit-sphere model. A point is p ∈ R⁴ with |p| = 1; a
// tangent vector at p is v with p·v = 0, and the metric on it is the dot product of R⁴. The world
// origin is o = (0,0,0,1). Two geodesics join any two points that are not antipodal: the short arc
// of length d and the long arc of length 2π − d, which leave in opposite directions. The math and
// its measurements are in spherical.md; the contract is components/ambient/README.md.
// Provides: fp_uncertainty(), ambient_geodesic(), ambient_flow(), ambient_dot(),
//           ambient_normalize(), ambient_frame(), ambient_parallel_transport(),
//           ambient_distance(), ambient_direction_to(), ambient_aim(), ambient_sky_key(),
//           isometry_direction(); for the S³ bodies, spherical_cos_sin(), spherical_asin(),
//           spherical_plane_root(), spherical_light_arc() and spherical_light_arc_probability().
// Depends on: Point/Direction (types.glsl), Ray/Frame/LightQuery (structs), PI/TWO_PI and
//             FP_UNCERTAINTY_REL/ABS (math), random() (the sampler, emitted before this block).

// cos t and sin t to float32 precision (|error| ≤ 7e-8 for t in [−4, 12], measured on SwiftShader),
// for every S³ position and every S³ body. GLSL ES 3.00 leaves the precision of sin and cos
// unspecified, and SwiftShader's are off by up to 1.9e-4 (measured on [−0.1, 6.4]): a geodesic point
// that far from where its root says it is lies on the wrong side of the hit.eps spawn offset.
// Range reduction t = k·π/2 + r (π/2 split in three parts, the first exact in 9 bits, so k·C1 is
// exact for |k| < 2¹⁵), then the Taylor polynomials of sin and cos on |r| ≤ π/4 (truncation error
// below 2e-9), and the quadrant k mod 4 picks the pair.
vec2 spherical_cos_sin(float t) {
    float k = floor(t * 0.636619772 + 0.5);
    float r = ((t - k * 1.5703125) - k * 4.837512969970703125e-4) - k * 7.549789948768648e-8;
    float r2 = r * r;
    float s = r * (1.0 + r2 * (-1.6666667e-1 + r2 * (8.3333333e-3 + r2 * (-1.98412698e-4 + r2 * 2.75573192e-6))));
    float c = 1.0 + r2 * (-0.5 + r2 * (4.16666667e-2 + r2 * (-1.38888889e-3 + r2 * (2.48015873e-5 + r2 * -2.75573192e-7))));
    int q = int(k - 4.0 * floor(k * 0.25));
    return q == 0 ? vec2(c, s) : q == 1 ? vec2(-s, c) : q == 2 ? vec2(-c, -s) : vec2(s, -c);
}

// asin x as atan(x, √(1 − x²)): SwiftShader's asin is off by up to 7e-5 (measured), its atan by
// 2e-7.
float spherical_asin(float x) {
    return atan(x, sqrt(max(1.0 - x * x, 0.0)));
}

// The far clip MAX_DIST is emitted just before this block: the descriptor's farClip 2π, or the
// measurement's. 2π is exact rather than a clip: every geodesic closes after 2π, so the first hit
// within one period is the first hit, and a ray that meets nothing in it meets nothing at all.

// Positional error bound of a floating-point-accurate point: 256 ulps of its largest
// coordinate, floored near zero. Every coordinate is at most 1 in magnitude.
float fp_uncertainty(Point p) {
    vec4 a = abs(p);
    return max(FP_UNCERTAINTY_ABS, FP_UNCERTAINTY_REL * max(max(a.x, a.y), max(a.z, a.w)));
}

// The point at arc length t along the geodesic leaving `origin` with unit velocity `dir`:
// cos t·origin + sin t·dir, put back on the sphere by rescaling (in S³ rescaling keeps the
// float32 error at about 1e-7 at every distance).
Point ambient_geodesic(Point origin, Direction dir, float t) {
    vec2 cs = spherical_cos_sin(t);
    return normalize(cs.x * origin + cs.y * dir);
}

// The geodesic flow: the point at arc length t and the velocity there, −sin t·origin + cos t·dir
// (the ARRIVAL direction).
Ray ambient_flow(Ray r, float t) {
    vec2 cs = spherical_cos_sin(t);
    return Ray(ambient_geodesic(r.origin, r.direction, t), -cs.y * r.origin + cs.x * r.direction, r.wl);
}

// The metric on tangent vectors at p: the dot product of R⁴.
float ambient_dot(Direction v1, Direction v2, Point p) {
    return dot(v1, v2);
}

// v rescaled to unit length in the metric at p.
Direction ambient_normalize(Direction v, Point p) {
    return normalize(v);
}

// The coordinate axis e_i whose component orthogonal to p, a and b is longest, normalized (a
// component of length ≥ 1/2 always exists, so no threshold is needed).
Direction spherical_tangent_seed(Point p, Direction a, Direction b) {
    Direction best = Direction(0.0);
    float best_l2 = -1.0;
    for (int i = 0; i < 4; i++) {
        Direction e = Direction(0.0);
        e[i] = 1.0;
        Direction w = e - dot(e, p) * p;   // onto T_p (|p| = 1)
        w -= dot(w, a) * a;
        w -= dot(w, b) * b;
        float l2 = dot(w, w);
        if (l2 > best_l2) { best_l2 = l2; best = w; }
    }
    return best * inversesqrt(best_l2);
}

// Orthonormal tangent frame at p around n. n is first projected onto T_p (a normal mapped from
// an object's frame is tangent only to rounding); t and b are Gram–Schmidt seeds from the axes.
Frame ambient_frame(Point p, Direction n) {
    Direction nn = normalize(n - dot(n, p) * p);
    Direction t = spherical_tangent_seed(p, nn, Direction(0.0));
    Direction b = spherical_tangent_seed(p, nn, t);
    return Frame(p, t, b, nn);
}

// Parallel transport of v ∈ T_from along the short geodesic to `to`:
// v − (to·v)/(1 + from·to)·(from + to) (singular at the antipode, where the short arc is not unique).
Direction ambient_parallel_transport(Direction v, Point from_p, Point to_p) {
    return v - dot(to_p, v) / (1.0 + dot(from_p, to_p)) * (from_p + to_p);
}

// Geodesic distance (the short arc) by the chord form 2·atan(|a − b|, |a + b|): |a − b| = 2 sin(d/2)
// and |a + b| = 2 cos(d/2), so it keeps full relative precision near 0 and near π, where acos(a·b)
// does not.
float ambient_distance(Point a, Point b) {
    return 2.0 * atan(length(a - b), length(a + b));
}

// The unit direction at `from` of the short geodesic to `to` (the normalized log map):
// (to − from) − (from·(to − from))·from, the chord projected onto T_from. The long arc leaves
// along its negation.
Direction ambient_direction_to(Point from, Point to) {
    Direction c = to - from;
    return normalize(c - dot(from, c) * from);
}

// Aims a shadow ray at `to` along the arc the ray travels: the short arc when `along` (the ray's
// current direction) leaves into the short arc's side, with `remaining` = d; otherwise the long
// arc, leaving along −u with remaining = 2π − d. Occluders on the far part of a long arc are then
// inside the walker's search interval.
Direction ambient_aim(Point from, Direction along, Point to, out float remaining) {
    float d = ambient_distance(from, to);
    Direction u = ambient_direction_to(from, to);
    if (dot(along, u) > 0.0) {
        remaining = d;
        return u;
    }
    remaining = TWO_PI - d;
    return -u;
}

// S³ has no sky: an environment is an error in this space, so a missed ray is scored against the
// empty environment, which reads no key. A ray that meets nothing within one period meets nothing
// at all, and its radiance is exactly 0.
vec3 ambient_sky_key(Point p, Direction v) {
    return vec3(0.0);
}

// The first t > 0 at which the ray meets the great sphere {x : x·N = 0}, N a unit 4-vector (the
// plane and disk bodies). Along γ(t), γ(t)·N = P·cos t + W·sin t with P = p·N, W = v·N; its zeros
// are spaced by π, the first at t ∈ (0, π]. Every geodesic meets every great sphere; one lying in it
// (P = W = 0) has no crossing. Floor 0 (escape is ray_spawn's offset).
bool spherical_plane_root(Ray ray, vec4 N, out float t) {
    float P = dot(ray.origin, N);
    float W = dot(ray.direction, N);
    if (P == 0.0 && W == 0.0) return false;
    t = mod(atan(-P, W), PI);
    if (t <= 0.0) t += PI;
    return true;
}

// Whether the receiver of query q is a one-sided surface: !q.two_sided with n ≠ 0 (n is the hit's
// frame.n, which faces the side the ray arrived from). Such a receiver scatters only into its upper
// hemisphere; a two-sided receiver scatters into both, and a medium event (n = 0) has no
// orientation.
bool spherical_query_one_sided(LightQuery q) {
    return !q.two_sided && dot(q.n, q.n) > 0.0;
}

// The probability with which spherical_light_arc takes either arc for the query q (the MIS pdf's
// factor): 1 for a one-sided receiver, ½ otherwise.
float spherical_light_arc_probability(LightQuery q) {
    return spherical_query_one_sided(q) ? 1.0 : 0.5;
}

// The arc a light sample travels from q.p to a light point whose short arc leaves along u, chosen
// before the emitter's back-face test; returns true for the long arc (leaving along −u). Both arcs
// carry light, with the same area density sin² d. Exactly one arc leaves into a one-sided
// receiver's upper hemisphere, so that arc is taken with probability 1 — per sample the same as
// summing both arcs. Otherwise each arc is taken with probability ½, drawing one random number.
bool spherical_light_arc(LightQuery q, Direction u, out float probability) {
    probability = spherical_light_arc_probability(q);
    if (spherical_query_one_sided(q)) return dot(u, q.n) < 0.0;
    return random() < 0.5;
}

// The world image G·v of a tangent vector v given in an object's frame, where `inverse` is the
// object's placement G⁻¹ (world → local). An isometry of S³ is orthogonal, G = (G⁻¹)ᵀ, so G·v is
// the row-vector product v·G⁻¹.
Direction isometry_direction(mat4 inverse, Direction v) {
    return v * inverse;
}
