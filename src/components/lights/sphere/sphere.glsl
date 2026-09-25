// Sphere area light — VISIBLE-CONE sampling, pdf directly in solid angle (§6.1 / reference §6.2).
// Struct-shaped (the house pattern). The §6.1 BYTE-MATCH INVARIANT lives here as two
// ADJACENT functions: sphere_light_pdf mirrors the sampler's cone density exactly.
// Pitfall 3: cone sampling, NOT uniform-surface (the old sphere-light.glsl wasted half its
// samples on the back hemisphere). p inside the light: pdf = 0 punt — OPEN; pbrt falls back to
// uniform-area sampling there (deferred).
// METRIC EXEMPTION (trace-loop contract): raw dot() on world-space physical directions is
// deliberate — light samplers are Euclidean closed forms; curved spaces get new bodies (§5.3).
// Provides (struct GENERATED from descriptor rows — A1): sphere_light_sample(), sphere_light_pdf().
//
// PRECISION (Sep 25 2026): for a small or distant sphere, 1 − cosθmax computed as
// 1 − sqrt(1 − sin²θmax) keeps almost no bits (f32: ±12% at sin²θmax = 1e-6, i.e. r/d = 1e-3
// — an ember in a cloud), and that number IS the pdf, so the light was biased. Everything below
// uses forms without cancellation: 1 − cosθmax = sin²θmax / (1 + cosθmax); the sampled polar
// angle via w = 1 − cosθ = u·(1 − cosθmax) and sin²θ = w·(2 − w) (the old cosθ = 1 − u·(…)
// then sin²θ = 1 − cos²θ quantized small cones onto a few rings); and the distance to the
// sphere as the robust near root (sphere_intersect's form). The pdf mirror uses the same
// expression, so the §6.1 byte match holds.

// 1 − cosθmax for the cone subtending the sphere from a point at squared distance dc2.
float sphere_light_one_minus_cos_max(float r, float dc2) {
    float sin2_max = r * r / dc2;
    return sin2_max / (1.0 + sqrt(max(0.0, 1.0 - sin2_max)));
}

LightSample sphere_light_sample(SphereLight l, Point p, vec2 xi) {
    vec3 to_c = l.center - p;
    float dc2 = dot(to_c, to_c);

    LightSample ls;
    ls.radiance = l.radiance;               // NO distance falloff (§6.1)
    ls.flags    = 0u;
    ls.light_id = -1;                       // dispatcher sets the real id

    if (dc2 <= l.radius * l.radius) {       // p inside the light: degenerate, punt (OPEN)
        ls.wi = Direction(0.0, 1.0, 0.0);
        ls.distance = 1.0;
        ls.pdf = 0.0;
        return ls;
    }

    // Sample the cone of directions subtending the sphere — pdf is DIRECTLY solid-angle.
    float omc_max  = sphere_light_one_minus_cos_max(l.radius, dc2);
    float w_t      = xi.x * omc_max;                    // 1 − cosθ, uniform in the cone
    float cos_t    = 1.0 - w_t;
    float sin_t    = sqrt(max(0.0, w_t * (2.0 - w_t)));
    float phi      = TWO_PI * xi.y;

    vec3 w = to_c * inversesqrt(dc2);
    vec3 t, b;
    build_basis(w, t, b);
    ls.wi  = normalize(t * (sin_t * cos(phi)) + b * (sin_t * sin(phi)) + w * cos_t);
    ls.pdf = 1.0 / (TWO_PI * omc_max);                  // uniform-cone solid-angle pdf

    // Distance to the sphere along wi: the near root, real by the cone construction (up to
    // rounding — hence the max), in the robust form (c/q with the perpendicular discriminant).
    float proj = dot(to_c, ls.wi);
    vec3 perp  = to_c - proj * ls.wi;
    float disc = max(0.0, l.radius * l.radius - dot(perp, perp));
    ls.distance = (dc2 - l.radius * l.radius) / (proj + sqrt(disc));
    return ls;
}

// The MIS cone density — depends only on p (mirrors the sampler above, §6.1); inside the
// sphere returns 0, matching the sampler's punt. light_p/wi unused (uniform pdf signature).
float sphere_light_pdf(SphereLight l, Point p, Point light_p, Direction wi) {
    vec3 to_c = l.center - p;
    float dc2 = dot(to_c, to_c);
    if (dc2 <= l.radius * l.radius) return 0.0;   // inside: sampler punts too
    return 1.0 / (TWO_PI * sphere_light_one_minus_cos_max(l.radius, dc2));
}
