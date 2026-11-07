// Rough conductor — GGX microfacet reflection with the exact conductor Fresnel term
// (conductor/conductor.md): f = F(|ωₒ·h|; η, κ)·D·G₁(ωᵢ)G₁(ωₒ)/(4|cos θᵢ||cos θₒ|), per wavelength
// lane. The F-free reflection lobe (D·G₁·G₁/(4|cos θᵢ||cos θₒ|), the VNDF weight G₁(ωᵢ), the pdf
// and the horizon test) is SHARED stdlib in glsl/core/microfacet.glsl; this file is the model:
// conductor_fresnel at the lobe's half-vector cosine, and nothing else. ggx is the same lobe
// with Schlick's F.
// Fields read: mp.eta, mp.k (optical rows, shared with conductor), mp.alpha (the derived field
// max(1e-3, roughness²), assigned by the material lookup).
// Single scattering: no energy gain (the model declares microfacet energy 'not-built', and
// measurement.microfacet 'energy-compensated' rejects it).
// Provides: rough_conductor_eval(), rough_conductor_sample(), rough_conductor_pdf(),
//           rough_conductor_emission(), rough_conductor_albedo().
// Depends on: microfacet_reflect_* (core), conductor_fresnel (core math), MaterialProperties,
//             Hit, InteractionSample, LOBE_REFLECTION, SPECTRUM_ZERO.
// TS twin: rough_conductor.test.ts (the lobe's twin is components/materials/microfacetTwin.ts).

Spectrum rough_conductor_eval(Direction wi, Direction wo, Hit hit, MaterialProperties mp) {
    float cos_h, cos_o;
    float lobe = microfacet_reflect_eval(wi, wo, hit, mp.alpha, cos_h, cos_o);
    if (lobe == 0.0) return SPECTRUM_ZERO;                  // reflection only: wi, wo on opposite sides
    return conductor_fresnel(cos_h, mp.eta, mp.k) * lobe;  // bare f (§2.2), no cos_i
}

InteractionSample rough_conductor_sample(Direction wo, Hit hit, MaterialProperties mp, float uc, vec2 u) {
    // Single lobe: uc unused. The VNDF weight is F·G₁(ωᵢ) exactly (r.weight = G₁(ωᵢ); 0 for a
    // dead sample, whose cos_h is still finite).
    MicrofacetReflectSample r = microfacet_reflect_sample(wo, hit, mp.alpha, u);
    InteractionSample s;
    s.weight = conductor_fresnel(r.cos_h, mp.eta, mp.k) * r.weight;
    s.pdf    = r.pdf;
    s.flags  = LOBE_REFLECTION;
    s.wi     = r.wi;
    return s;
}

float rough_conductor_pdf(Direction wi, Direction wo, Hit hit, MaterialProperties mp) {
    return microfacet_reflect_pdf(wi, wo, hit, mp.alpha);   // equals rough_conductor_sample's pdf (§11.3)
}

Spectrum rough_conductor_emission(Direction wo, Hit hit, MaterialProperties mp) {
    return SPECTRUM_ZERO;                                    // conductor: never emits
}

// The albedo guide: the reflectance at normal incidence.
Spectrum rough_conductor_albedo(Hit hit, MaterialProperties mp) {
    return conductor_fresnel(1.0, mp.eta, mp.k);
}
