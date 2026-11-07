// Smooth conductor — a delta reflection weighted by the exact conductor Fresnel term
// (conductor.md): F(cos θᵢ; η, κ) from conductor_fresnel (core math), per wavelength lane.
// Fields read: mp.eta, mp.k (the complex index η + iκ relative to the outside medium; optical
// rows, SHARED with rough_conductor by name and type). Pure delta: eval/pdf return zero (§3.1);
// transport skips NEE via material_has_nondelta_lobes.
// pbrt-v4's ConductorBxDF smooth branch returns f = F/|cos θᵢ| with pdf 1 (delta convention);
// our InteractionSample carries weight = f·|cos|/pdf directly, so the delta cancellation (§2.1)
// leaves weight = F exactly.
// Provides: conductor_eval(), conductor_sample(), conductor_pdf(), conductor_emission(),
//           conductor_albedo().
// Depends on: MaterialProperties, Hit/Frame, InteractionSample, LOBE_REFLECTION, LOBE_DELTA,
//             SPECTRUM_ZERO, ambient_dot, conductor_fresnel (core math).

Spectrum conductor_eval(Direction wi, Direction wo, Hit hit, MaterialProperties mp) { return SPECTRUM_ZERO; } // pure delta
float    conductor_pdf (Direction wi, Direction wo, Hit hit, MaterialProperties mp) { return 0.0; }
Spectrum conductor_emission(Direction wo, Hit hit, MaterialProperties mp) { return SPECTRUM_ZERO; }

InteractionSample conductor_sample(Direction wo, Hit hit, MaterialProperties mp, float uc, vec2 u) {
    // Single delta lobe: uc and u unused. n faces region_from (§4.1) → cos_i > 0 by
    // orientation; clamped at grazing (the dielectric's discipline).
    Direction n = hit.frame.n;
    float cos_i = clamp(ambient_dot(wo, n, hit.p), 1e-6, 1.0);

    InteractionSample s;
    s.wi     = normalize(2.0 * cos_i * n - wo);
    s.weight = conductor_fresnel(cos_i, mp.eta, mp.k);   // F·|cos|/pdf with the delta cancellation (§2.1)
    s.pdf    = 0.0;
    s.flags  = LOBE_REFLECTION | LOBE_DELTA;
    return s;
}

// The albedo guide: the reflectance at normal incidence.
Spectrum conductor_albedo(Hit hit, MaterialProperties mp) {
    return conductor_fresnel(1.0, mp.eta, mp.k);
}
