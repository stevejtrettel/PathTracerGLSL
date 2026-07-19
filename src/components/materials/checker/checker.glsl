// Checker diffuse BRDF — THE FIRST Hit.uv READER (impl-plan-blackbody-uv): Lambert
// transport (transcribed — same cosine sampling, same exact weight cancellation) with
// the albedo PROCEDURAL in the surface parameterization:
//   albedo(uv) = mix(albedo_a, albedo_b, checker(uv · scale)).
// Fields read: mp.albedo_a, mp.albedo_b, mp.uv_scale.
// NOTE the chart it makes visible: Hit.uv is today the PLACEHOLDER planar xz chart
// (structs.glsl UV_PLANAR_SCALE) — every writer uses it; a real per-primitive uv chart
// is the ledgered follow-up this occupant exists to force (audit F3 disposition).
// Provides: checker_eval(), checker_sample(), checker_pdf(), checker_emission().
// Depends on: MaterialProperties, Hit/Frame, InteractionSample, LOBE_REFLECTION,
//             PI, TWO_PI, SPECTRUM_ZERO, ambient_dot.

Spectrum checker_albedo(Hit hit, MaterialProperties mp) {
    vec2 c = floor(hit.uv * mp.uv_scale);
    float k = mod(c.x + c.y, 2.0);   // 0/1 alternating cells
    return mix(mp.albedo_a, mp.albedo_b, k);
}

Spectrum checker_eval(Direction wi, Direction wo, Hit hit, MaterialProperties mp) {
    // bare f (§2.2): NO cosine here. Reflection side only (the Lambert discipline).
    if (ambient_dot(wi, hit.frame.n, hit.p) * ambient_dot(wo, hit.frame.n, hit.p) <= 0.0) return SPECTRUM_ZERO;
    return checker_albedo(hit, mp) * (1.0 / PI);
}

InteractionSample checker_sample(Direction wo, Hit hit, MaterialProperties mp, float uc, vec2 u) {
    // Cosine-weighted hemisphere on the side we arrived from; one lobe, uc unused.
    Frame f = hit.frame;
    Direction n = ambient_dot(wo, f.n, hit.p) < 0.0 ? -f.n : f.n;
    float cos_theta = sqrt(u.y);
    float sin_theta = sqrt(max(0.0, 1.0 - u.y));
    float phi = TWO_PI * u.x;

    InteractionSample s;
    s.wi     = normalize(f.t * (sin_theta * cos(phi)) + f.b * (sin_theta * sin(phi)) + n * cos_theta);
    s.weight = checker_albedo(hit, mp);         // (albedo/π)·cos / (cos/π) — exact cancellation (§2.1)
    s.pdf    = cos_theta * (1.0 / PI);
    s.flags  = LOBE_REFLECTION;
    return s;
}

float checker_pdf(Direction wi, Direction wo, Hit hit, MaterialProperties mp) {
    float c = ambient_dot(wi, hit.frame.n, hit.p) * sign(ambient_dot(wo, hit.frame.n, hit.p));
    return max(0.0, c) * (1.0 / PI);
}

Spectrum checker_emission(Direction wo, Hit hit, MaterialProperties mp) {
    return SPECTRUM_ZERO;   // never emits (capability false)
}
