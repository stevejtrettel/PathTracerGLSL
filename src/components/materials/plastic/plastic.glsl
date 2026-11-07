// Plastic: a smooth, non-absorbing dielectric coat over a Lambertian base (Mitsuba 3
// `plastic` with `nonlinear = true`). The math, the closed-form albedo and the two
// deliberate deviations from Mitsuba are in plastic.md; plastic.test.ts is the TS twin
// (change one, change both).
// Fields read: mp.albedo (base reflectance R, in [0, 1]), mp.coat_eta (η, the coat's index
// relative to the medium outside), mp.coat_fdr (K, derived on the host: the fraction of
// cosine-distributed light inside the coat that the interface reflects back down,
// total internal reflection included).
// Every Fresnel call takes eta = n_i/n_t; light arriving from outside sees 1/η.
// Two lobes: the coat's mirror reflection (delta: pdf 0, LOBE_DELTA, absent from eval/pdf)
// and the base seen through the coat (non-delta, cosine-sampled).
// Provides: plastic_eval(), plastic_sample(), plastic_pdf(), plastic_emission().
// Depends on: MaterialProperties, Hit/Frame, InteractionSample, LOBE_REFLECTION, LOBE_DELTA,
//             PI, TWO_PI, SPECTRUM_ZERO/ONE, spectrum_average, ambient_dot,
//             dielectric_fresnel (core math).

// The base seen through the coat, bare f (no cosine), for cosines on the arrival side:
//   f_d = R/(1 − R·K) · (1 − F(μ_i))(1 − F(μ_o)) / (π η²).
// R/(1 − R·K) sums the bounces between the base and the underside of the coat; 1/η² is the
// radiance compression into the coat. Symmetric in i and o.
Spectrum plastic_diffuse(float cos_i, float cos_o, MaterialProperties mp) {
    float inv_eta = 1.0 / mp.coat_eta;
    float through = (1.0 - dielectric_fresnel(cos_i, inv_eta)) * (1.0 - dielectric_fresnel(cos_o, inv_eta));
    return mp.albedo / (SPECTRUM_ONE - mp.albedo * mp.coat_fdr) * (through * inv_eta * inv_eta / PI);
}

// The probability of choosing the mirror lobe, F(μ_o)/(F(μ_o) + (1 − F(μ_o))·avg R): the
// one selection rule, read by sample and pdf. The total is 0 only when nothing scatters
// (η = 1, so F = 0, over a black base); the diffuse branch then carries weight 0.
float plastic_specular_prob(float cos_o, MaterialProperties mp) {
    float F = dielectric_fresnel(cos_o, 1.0 / mp.coat_eta);
    float total = F + (1.0 - F) * spectrum_average(mp.albedo);
    return total > 0.0 ? F / total : 0.0;
}

Spectrum plastic_eval(Direction wi, Direction wo, Hit hit, MaterialProperties mp) {
    // Reflection only. The mirror lobe is delta, so only the diffuse lobe is evaluated.
    float cos_i = ambient_dot(wi, hit.frame.n, hit.p);
    float cos_o = ambient_dot(wo, hit.frame.n, hit.p);
    if (cos_i * cos_o <= 0.0) return SPECTRUM_ZERO;
    return plastic_diffuse(abs(cos_i), abs(cos_o), mp);
}

InteractionSample plastic_sample(Direction wo, Hit hit, MaterialProperties mp, float uc, vec2 u) {
    // uc picks the lobe; u draws the cosine-weighted direction of the diffuse lobe.
    Frame f = hit.frame;
    float cos_o_signed = ambient_dot(wo, f.n, hit.p);
    Direction n = cos_o_signed < 0.0 ? -f.n : f.n;           // the arrival side
    float cos_o = abs(cos_o_signed);
    float p_spec = plastic_specular_prob(cos_o, mp);

    InteractionSample s;
    if (uc < p_spec) {
        // Mirror lobe: weight = F·|cos|/pdf with the delta cancellation, divided by the
        // lobe's selection probability.
        s.wi     = normalize(2.0 * cos_o * n - wo);
        s.weight = SPECTRUM_ONE * (dielectric_fresnel(cos_o, 1.0 / mp.coat_eta) / p_spec);
        s.pdf    = 0.0;
        s.flags  = LOBE_REFLECTION | LOBE_DELTA;
        return s;
    }
    float cos_i = sqrt(u.y);
    float sin_i = sqrt(max(0.0, 1.0 - u.y));
    float phi = TWO_PI * u.x;
    float p_diff = 1.0 - p_spec;
    s.wi     = normalize(f.t * (sin_i * cos(phi)) + f.b * (sin_i * sin(phi)) + n * cos_i);
    s.weight = plastic_diffuse(cos_i, cos_o, mp) * (PI / p_diff);   // f_d·cos/pdf, pdf = p_diff·cos/π
    s.pdf    = p_diff * cos_i * (1.0 / PI);
    s.flags  = LOBE_REFLECTION;
    return s;
}

float plastic_pdf(Direction wi, Direction wo, Hit hit, MaterialProperties mp) {
    // The density of the diffuse lobe, the mixture's only non-delta part.
    float cos_i = ambient_dot(wi, hit.frame.n, hit.p);
    float cos_o = ambient_dot(wo, hit.frame.n, hit.p);
    if (cos_i * cos_o <= 0.0) return 0.0;
    return (1.0 - plastic_specular_prob(abs(cos_o), mp)) * abs(cos_i) * (1.0 / PI);
}

Spectrum plastic_emission(Direction wo, Hit hit, MaterialProperties mp) {
    return SPECTRUM_ZERO;
}
