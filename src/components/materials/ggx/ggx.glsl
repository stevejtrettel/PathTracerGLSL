// GGX rough conductor — conforms to §3.2 (transcribed from reference-implementations §7,
// adapted to the (uc, u) sampler split and the ambient_dot metric discipline).
// The distribution machinery (D, Smith G₁, VNDF sampling, the frame maps) is SHARED
// stdlib in glsl/core/microfacet.glsl (fable-rough-dielectric §4) — this file is the
// conductor MODEL: Schlick Fresnel, the reflection lobe, and nothing else.
// Fields read: mp.f0 (normal-incidence reflectance), mp.alpha (the derived field
// max(1e-3, roughness²), assigned by the material lookup; this file never recomputes it).
// Convention: alpha clamped ≥ 1e-3 — author true mirrors as a delta
// model instead (§3.1); letting alpha→0 here produces fireflies, not a mirror.
// Energy: eval and the sample weight carry microfacet_conductor_gain (materials/
// microfacet_energy), the constant 1 under measurement.microfacet 'single-scattering'.
// Provides: ggx_eval(), ggx_sample(), ggx_pdf(), ggx_emission(), ggx_fresnel_average().
// Depends on: microfacet_* (core), microfacet_conductor_gain, MaterialProperties, Hit/Frame,
//             InteractionSample, LOBE_REFLECTION, SPECTRUM_ZERO/ONE, ambient_dot,
//             schlick_fresnel (core math).
// The TS twin in ggx.test.ts is the tested ground truth for D/G1/sample/pdf/eval —
// line-for-line transcription, change one change both (§11.3 runs against the twin).

// Schlick's hemispherical average 2∫₀¹ F(μ) μ dμ = f0 + (1 − f0)/21: the F_avg of the
// conductor energy gain (microfacet_energy.glsl).
Spectrum ggx_fresnel_average(Spectrum f0) {
    return f0 + (SPECTRUM_ONE - f0) * (1.0 / 21.0);
}

Spectrum ggx_eval(Direction wi, Direction wo, Hit hit, MaterialProperties mp) {
    vec3 wil = microfacet_to_local(hit.frame, hit.p, wi);
    vec3 wol = microfacet_to_local(hit.frame, hit.p, wo);
    if (wil.z * wol.z <= 0.0) return SPECTRUM_ZERO;         // reflection-only model
    float a = mp.alpha;                                     // derived field: max(1e-3, roughness²)
    vec3 h = normalize(wil + wol);
    Spectrum F = schlick_fresnel(mp.f0, abs(dot(wol, h)));
    Spectrum g = microfacet_conductor_gain(abs(wol.z), a, ggx_fresnel_average(mp.f0));
    // bare f (§2.2): D·F·G / (4 cos_i cos_o) × the energy gain on wo, NO extra cos_i here
    return F * (microfacet_D(h, a) * microfacet_G1(wil, a) * microfacet_G1(wol, a) / (4.0 * abs(wil.z) * abs(wol.z))) * g;
}

InteractionSample ggx_sample(Direction wo, Hit hit, MaterialProperties mp, float uc, vec2 u) {
    // Single lobe: uc unused (the reflection lobe is certain).
    vec3 wol = microfacet_to_local(hit.frame, hit.p, wo);
    float side = wol.z < 0.0 ? -1.0 : 1.0;                  // canonical side (undone at exit)
    wol *= side;
    float a = mp.alpha;                                     // derived field
    vec3 h = microfacet_sample_vndf(wol, a, u);             // visible microfacet normal (Heitz 2018)

    vec3 wil = reflect(-wol, h);
    InteractionSample s;
    if (wil.z <= 0.0) {                                     // reflected below horizon: dead sample
        s.wi = wo; s.weight = SPECTRUM_ZERO; s.pdf = 0.0; s.flags = LOBE_REFLECTION;
        return s;
    }
    Spectrum F = schlick_fresnel(mp.f0, abs(dot(wol, h)));
    // The VNDF elegance: weight = F · G1(wi) exactly (separable Smith) — D, cosines,
    // and the half-vector jacobian all cancel. The energy gain on wo multiplies eval and
    // weight alike and leaves the pdf alone.
    s.weight = F * microfacet_G1(wil, a) * microfacet_conductor_gain(wol.z, a, ggx_fresnel_average(mp.f0));
    // pdf for MIS: VNDF pdf = G1(wo)·D·|wo·h| / cos_o through the jacobian 1/(4|wo·h|):
    s.pdf    = microfacet_G1(wol, a) * microfacet_D(h, a) / (4.0 * abs(wol.z));
    s.flags  = LOBE_REFLECTION;
    s.wi     = microfacet_from_local(hit.frame, wil * side);   // back to arrival side
    return s;
}

float ggx_pdf(Direction wi, Direction wo, Hit hit, MaterialProperties mp) {
    vec3 wil = microfacet_to_local(hit.frame, hit.p, wi);
    vec3 wol = microfacet_to_local(hit.frame, hit.p, wo);
    if (wil.z * wol.z <= 0.0) return 0.0;
    float a = mp.alpha;                                     // derived field
    vec3 h = normalize(wil + wol);
    // Side-symmetric by construction (G1 uses |z|, D uses z²) — no canonicalization needed.
    return microfacet_G1(wol, a) * microfacet_D(h, a) / (4.0 * abs(wol.z));   // MUST match ggx_sample's pdf — §11.3 checks this
}

Spectrum ggx_emission(Direction wo, Hit hit, MaterialProperties mp) {
    return SPECTRUM_ZERO;                                    // conductor: never emits (capability false)
}
