// GGX rough conductor — conforms to §3.2 (transcribed from reference-implementations §7,
// adapted to the (uc, u) sampler split and the ambient_dot metric discipline).
// The F-free reflection lobe (D·G₁·G₁/(4|cos θᵢ||cos θₒ|), the VNDF weight G₁(ωᵢ), the pdf
// and the horizon test) is SHARED stdlib in glsl/core/microfacet.glsl — this file is the
// conductor MODEL: Schlick Fresnel at the lobe's half-vector cosine, and nothing else.
// Fields read: mp.f0 (normal-incidence reflectance), mp.alpha (the derived field
// max(1e-3, roughness²), assigned by the material lookup; this file never recomputes it).
// Convention: alpha clamped ≥ 1e-3 — author true mirrors as a delta
// model instead (§3.1); letting alpha→0 here produces fireflies, not a mirror.
// Energy: eval and the sample weight carry microfacet_conductor_gain (materials/
// microfacet_energy), the constant 1 under measurement.microfacet 'single-scattering'.
// Provides: ggx_eval(), ggx_sample(), ggx_pdf(), ggx_emission(), ggx_fresnel_average().
// Depends on: microfacet_reflect_* (core), microfacet_conductor_gain, MaterialProperties,
//             Hit, InteractionSample, LOBE_REFLECTION, SPECTRUM_ZERO/ONE, schlick_fresnel
//             (core math).
// The TS twin in ggx.test.ts is the tested ground truth for this model (the lobe's twin is
// components/materials/microfacetTwin.ts) — line-for-line transcription, change one change both
// (§11.3 runs against the twin).

// Schlick's hemispherical average 2∫₀¹ F(μ) μ dμ = f0 + (1 − f0)/21: the F_avg of the
// conductor energy gain (microfacet_energy.glsl).
Spectrum ggx_fresnel_average(Spectrum f0) {
    return f0 + (SPECTRUM_ONE - f0) * (1.0 / 21.0);
}

Spectrum ggx_eval(Direction wi, Direction wo, Hit hit, MaterialProperties mp) {
    float cos_h, cos_o;
    float lobe = microfacet_reflect_eval(wi, wo, hit, mp.alpha, cos_h, cos_o);
    if (lobe == 0.0) return SPECTRUM_ZERO;                  // reflection only: wi, wo on opposite sides
    Spectrum F = schlick_fresnel(mp.f0, cos_h);
    // bare f (§2.2): F · D·G / (4 cos_i cos_o) × the energy gain on wo, NO extra cos_i here
    return F * lobe * microfacet_conductor_gain(cos_o, mp.alpha, ggx_fresnel_average(mp.f0));
}

InteractionSample ggx_sample(Direction wo, Hit hit, MaterialProperties mp, float uc, vec2 u) {
    // Single lobe: uc unused (the reflection lobe is certain).
    MicrofacetReflectSample r = microfacet_reflect_sample(wo, hit, mp.alpha, u);
    Spectrum F = schlick_fresnel(mp.f0, r.cos_h);
    InteractionSample s;
    // The VNDF weight is F · G₁(wi) exactly (r.weight = G₁(wi); 0 for a dead sample). The
    // energy gain on wo multiplies eval and weight alike and leaves the pdf alone.
    s.weight = F * r.weight * microfacet_conductor_gain(r.cos_o, mp.alpha, ggx_fresnel_average(mp.f0));
    s.pdf    = r.pdf;
    s.flags  = LOBE_REFLECTION;
    s.wi     = r.wi;
    return s;
}

float ggx_pdf(Direction wi, Direction wo, Hit hit, MaterialProperties mp) {
    return microfacet_reflect_pdf(wi, wo, hit, mp.alpha);   // equals ggx_sample's pdf (§11.3)
}

Spectrum ggx_emission(Direction wo, Hit hit, MaterialProperties mp) {
    return SPECTRUM_ZERO;                                    // conductor: never emits (capability false)
}
