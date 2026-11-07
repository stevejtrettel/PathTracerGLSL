// Sphere area light in H³ — VISIBLE-CONE sampling of the geodesic ball of radius R about `center`
// (the backing region's placement applied to o, by the CPU function that places the region, so the
// sampled ball is the ball rays hit). From a point at distance d > R the ball subtends the cone about
// u = ambient_direction_to(p, center) with sin α = sinh R / sinh d (the hyperbolic right triangle
// with legs R and the tangent segment); sampling it uniformly gives a pdf directly in solid angle,
// 1/(2π(1 − cos α)), the same at every direction of the cone. The cone's size enters only through
// 1 − cos α = sin²α/(1 + cos α) (no cancellation for a small or distant ball), the polar angle is
// sampled as w = 1 − cos θ = ξ·(1 − cos α) with sin²θ = w(2 − w), and the distance to the near side
// is sphere_root (the sphere body's root), so it is the root rays find. The §6.1 byte-match
// invariant: sphere_light_pdf mirrors the sampler with the same expressions. A point inside the
// ball (never a surface point: the backing region is opaque) gets pdf 0 in both, as in E³.
// Provides (struct GENERATED from descriptor rows): sphere_light_sample(), sphere_light_pdf().
// Depends on: ambient_frame/ambient_distance/ambient_direction_to/ambient_normalize,
//             sphere_root() (the H³ sphere body, present as the light's backing region).

// 1 − cos α for the cone subtending a ball of radius `radius` from distance d (sinh_d = sinh d).
float sphere_light_one_minus_cos_max(float radius, float sinh_d) {
    float sr = sinh(radius);
    float sin2_max = sr * sr / (sinh_d * sinh_d);
    return sin2_max / (1.0 + sqrt(max(0.0, 1.0 - sin2_max)));
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

    float sinh_d   = sinh(d);
    float omc_max  = sphere_light_one_minus_cos_max(l.radius, sinh_d);
    float w_t      = xi.x * omc_max;                    // 1 − cos θ, uniform in the cone
    float cos_t    = 1.0 - w_t;
    float sin_t    = sqrt(max(0.0, w_t * (2.0 - w_t)));
    float phi      = TWO_PI * xi.y;

    Frame f = ambient_frame(q.p, ambient_direction_to(q.p, l.center));
    ls.wi  = ambient_normalize(f.t * (sin_t * cos(phi)) + f.b * (sin_t * sin(phi)) + f.n * cos_t, q.p);
    ls.pdf = 1.0 / (TWO_PI * omc_max);                  // uniform-cone solid-angle pdf

    // Along the sampled geodesic γ, cosh dist(γ(t), center) = cosh d·cosh t − sinh d·cos θ·sinh t,
    // and its distance from the center is sinh d·sin θ: the ball's entry root.
    float k = sinh_d * sin_t;
    ls.distance = sphere_root(cosh(d), -sinh_d * cos_t, k * k, l.radius, false);
    return ls;
}

// The MIS cone density — depends only on q.p (mirrors the sampler above, §6.1); inside the ball it
// returns 0, matching the sampler's punt. light_p and wo are unused (the curved pdf signature).
float sphere_light_pdf(SphereLight l, LightQuery q, Point light_p, Direction wo) {
    float d = ambient_distance(q.p, l.center);
    if (d <= l.radius) return 0.0;
    return 1.0 / (TWO_PI * sphere_light_one_minus_cos_max(l.radius, sinh(d)));
}
