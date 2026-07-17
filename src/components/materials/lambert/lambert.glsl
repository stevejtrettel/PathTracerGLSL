// Lambert diffuse BRDF — conforms to §3.2 (transcribed from reference-implementations §1).
// Fields read: mp.albedo, mp.emission. Reflection-only, non-delta.
// Provides: lambert_eval(), lambert_sample(), lambert_pdf(), lambert_emission().
// Depends on: MaterialProperties, Hit/Frame, InteractionSample, LOBE_REFLECTION,
//             PI, TWO_PI, SPECTRUM_ZERO.

Spectrum lambert_eval(Direction wi, Direction wo, Hit hit, MaterialProperties mp) {
    // bare f (§2.2): NO cosine here. Reflection side only (transmission is illegal for Lambert).
    // World-space direction·normal → metric (ambient_dot); Euclidean unpacks to dot.
    if (ambient_dot(wi, hit.frame.n, hit.p) * ambient_dot(wo, hit.frame.n, hit.p) <= 0.0) return SPECTRUM_ZERO;
    return mp.albedo * (1.0 / PI);
}

InteractionSample lambert_sample(Direction wo, Hit hit, MaterialProperties mp, float uc, vec2 u) {
    // Cosine-weighted hemisphere on the side we arrived from. Lambert has one lobe: uc unused.
    Frame f = hit.frame;
    Direction n = ambient_dot(wo, f.n, hit.p) < 0.0 ? -f.n : f.n;
    float cos_theta = sqrt(u.y);
    float sin_theta = sqrt(max(0.0, 1.0 - u.y));
    float phi = TWO_PI * u.x;

    InteractionSample s;
    s.wi     = normalize(f.t * (sin_theta * cos(phi)) + f.b * (sin_theta * sin(phi)) + n * cos_theta);
    s.weight = mp.albedo;                       // (albedo/π)·cos / (cos/π) — exact cancellation (§2.1)
    s.pdf    = cos_theta * (1.0 / PI);
    s.flags  = LOBE_REFLECTION;
    return s;
}

float lambert_pdf(Direction wi, Direction wo, Hit hit, MaterialProperties mp) {
    float c = ambient_dot(wi, hit.frame.n, hit.p) * sign(ambient_dot(wo, hit.frame.n, hit.p));
    return max(0.0, c) * (1.0 / PI);
}

Spectrum lambert_emission(Direction wo, Hit hit, MaterialProperties mp) {
    return mp.emission;
}
