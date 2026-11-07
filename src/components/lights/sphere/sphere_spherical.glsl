// Sphere area light in S³ — cone sampling of the geodesic ball of radius R (0 < R < π) about
// `center` (the backing region's placement applied to o, by the CPU function that places the region,
// so the sampled ball is the ball rays hit). Every geodesic from p also passes −p, so with d the
// short distance from p to the center:
//   - R < d < π − R: the ball is seen in two disjoint cones, the forward one about
//     u = ambient_direction_to(p, center) with sin α = sin R / sin d (< 1, so α < π/2), and its
//     negation — geodesics that leave away from the center, pass −p and reach the ball's far side;
//   - d ≥ π − R: −p lies in the ball and every geodesic from p meets it; the forward "cone" is the
//     hemisphere about u (sin²α clamped to 1) and the two together are every direction;
//   - d ≤ R: p is inside the ball (never a surface point: the backing region is opaque), pdf 0 in
//     sampler and pdf alike, as in E³.
// One direction ω is drawn uniformly in the forward cone (w = 1 − cos θ = ξ·(1 − cos α), sin²θ =
// w(2 − w), 1 − cos α = sin²α/(1 + cos α)); then the route is chosen as for every S³ light
// (spherical_light_arc, before anything else depends on it): a one-sided receiver takes −ω exactly
// when ω lies below its normal, so each direction of its upper hemisphere comes from exactly one ω;
// anything else takes −ω with probability ½. Each cone thus carries the density
// p_arc/(2π(1 − cos α)), the same at every one of its directions. The distance is the ball's entry
// root along the chosen direction, sphere_root (the sphere body's root): along −ω that is the point
// where ω's geodesic leaves the ball, reached the other way round, at 2π minus ω's exit root. The §6.1
// byte-match invariant: sphere_light_pdf mirrors the sampler with the same expressions.
// Provides (struct GENERATED from descriptor rows): sphere_light_sample(), sphere_light_pdf().
// Depends on: ambient_frame/ambient_distance/ambient_direction_to/ambient_normalize,
//             spherical_cos_sin/spherical_light_arc/spherical_light_arc_probability (the S³
//             occupant), sphere_root() (the S³ sphere body, present as the light's backing region).

// 1 − cos α for the forward cone of a ball of radius `radius` seen from distance d (sin_d = sin d),
// with sin²α clamped to 1 (the hemisphere) when −p lies in the ball.
float sphere_light_one_minus_cos_max(float radius, float sin_d) {
    float sr = spherical_cos_sin(radius).y;
    float sin2_max = min(1.0, sr * sr / (sin_d * sin_d));
    return sin2_max / (1.0 + sqrt(1.0 - sin2_max));
}

LightSample sphere_light_sample(SphereLight l, LightQuery q, vec2 xi) {
    float d = ambient_distance(q.p, l.center);

    LightSample ls;
    ls.radiance = l.radiance;               // NO distance falloff (§6.1)
    ls.flags    = 0u;                       // non-delta: hittable, MIS-eligible
    ls.light_id = -1;                       // dispatcher sets the real id

    if (d <= l.radius) {                    // inside the ball: punt
        ls.wi = ambient_direction_to(q.p, l.center);
        ls.distance = 1.0;
        ls.pdf = 0.0;
        return ls;
    }

    vec2 csd       = spherical_cos_sin(d);
    float omc_max  = sphere_light_one_minus_cos_max(l.radius, csd.y);
    float w_t      = xi.x * omc_max;                    // 1 − cos θ, uniform in the forward cone
    float cos_t    = 1.0 - w_t;
    float sin_t    = sqrt(max(0.0, w_t * (2.0 - w_t)));
    vec2 csp       = spherical_cos_sin(TWO_PI * xi.y);

    Frame f = ambient_frame(q.p, ambient_direction_to(q.p, l.center));
    Direction w = ambient_normalize(f.t * (sin_t * csp.x) + f.b * (sin_t * csp.y) + f.n * cos_t, q.p);
    float arc_pdf;
    bool flip = spherical_light_arc(q, w, arc_pdf);
    ls.wi  = flip ? -w : w;
    ls.pdf = arc_pdf / (TWO_PI * omc_max);

    // Along the geodesic leaving along ±ω, cos dist(γ(t), center) = cos d·cos t ± sin d·cos θ·sin t,
    // and its distance from the center is sin d·sin θ on both routes: the ball's entry root.
    float k = csd.y * sin_t;
    ls.distance = sphere_root(csd.x, flip ? -csd.y * cos_t : csd.y * cos_t, k * k, l.radius, false);
    return ls;
}

// The MIS density with which sphere_light_sample(l, q, ·) produces a direction that meets the ball —
// the same on both cones (mirrors the sampler above, §6.1); inside the ball it returns 0, matching the
// sampler's punt. light_p and wo are unused: neither the density nor the arc probability depends on
// where the ray met the ball.
float sphere_light_pdf(SphereLight l, LightQuery q, Point light_p, Direction wo) {
    float d = ambient_distance(q.p, l.center);
    if (d <= l.radius) return 0.0;
    float omc_max = sphere_light_one_minus_cos_max(l.radius, spherical_cos_sin(d).y);
    return spherical_light_arc_probability(q) / (TWO_PI * omc_max);
}
