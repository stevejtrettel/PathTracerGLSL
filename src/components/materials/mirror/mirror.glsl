// Perfect specular conductor (mirror) — delta reflection, Schlick Fresnel.
// Fields read: mp.f0 (normal-incidence reflectance — the conductor's color, SHARED with
// ggx by row name+type). Pure delta: eval/pdf return zero (§3.1); transport skips NEE
// via material_has_nondelta_lobes.
// pbrt-v4's smooth-conductor case returns f = F/|cos| with pdf 1 (Conductor BRDF, delta
// convention); our InteractionSample carries weight = f·|cos|/pdf directly, so the delta
// cancellation (§2.1) leaves weight = F exactly. DELIBERATE deviation from pbrt: Schlick
// from f0, not complex-IOR FrComplex — f0 is the house conductor vocabulary (ggx), and
// exact conductor Fresnel in RGB needs spectral η/k data to pay off (later occupant or
// f0-from-(η,k) authoring sugar).
// Provides: mirror_eval(), mirror_sample(), mirror_pdf(), mirror_emission().
// Depends on: MaterialProperties, Hit/Frame, InteractionSample, LOBE_REFLECTION,
//             LOBE_DELTA, SPECTRUM_ZERO/ONE, ambient_dot, schlick_fresnel (core math).

Spectrum mirror_eval(Direction wi, Direction wo, Hit hit, MaterialProperties mp) { return SPECTRUM_ZERO; } // pure delta
float    mirror_pdf (Direction wi, Direction wo, Hit hit, MaterialProperties mp) { return 0.0; }
Spectrum mirror_emission(Direction wo, Hit hit, MaterialProperties mp) { return SPECTRUM_ZERO; }

InteractionSample mirror_sample(Direction wo, Hit hit, MaterialProperties mp, float uc, vec2 u) {
    // Single delta lobe: uc and u unused. n faces region_from (§4.1) → cos_i > 0 by
    // orientation; clamped at grazing (the dielectric's discipline).
    Direction n = hit.frame.n;
    float cos_i = clamp(ambient_dot(wo, n, hit.p), 1e-6, 1.0);
    Spectrum F = schlick_fresnel(mp.f0, cos_i);

    InteractionSample s;
    s.wi     = normalize(2.0 * cos_i * n - wo);
    s.weight = F;                        // F·|cos|/pdf with the delta cancellation (§2.1)
    s.pdf    = 0.0;
    s.flags  = LOBE_REFLECTION | LOBE_DELTA;
    return s;
}
