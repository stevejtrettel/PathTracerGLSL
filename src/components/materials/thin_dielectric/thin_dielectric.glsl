// Thin dielectric sheet (pbrt-v4 ThinDielectricBxDF): an infinitely thin slab of relative index
// η = mp.sheet_eta, the sheet's index over the index of the medium around it (Mitsuba's and
// pbrt's convention; not read from the region table). Light passing through is refracted twice
// in opposite senses, so it leaves along −wo with no lateral shift; the internal reflections sum
// in closed form (thin_dielectric.md):
//   R_tot = R + T²R/(1 − R²) = 2R/(1 + R),   T_tot = 1 − R_tot,   R = F(cos_i; 1/η), T = 1 − R.
// The inner face reflects as much as the outer one (Stokes), so one R serves both faces.
// Pure delta: eval/pdf return zero; transport skips NEE via material_has_nondelta_lobes.
// Fields read: mp.sheet_eta.
// Provides: thin_dielectric_eval/sample/pdf/emission/albedo/reflectance().
// Depends on: dielectric_fresnel() (core math, eta = n_i/n_t), MaterialProperties, Hit/Frame,
//             InteractionSample, LOBE_*, SPECTRUM_ZERO/ONE, ambient_dot.

Spectrum thin_dielectric_eval(Direction wi, Direction wo, Hit hit, MaterialProperties mp) { return SPECTRUM_ZERO; } // pure delta
float    thin_dielectric_pdf (Direction wi, Direction wo, Hit hit, MaterialProperties mp) { return 0.0; }
Spectrum thin_dielectric_emission(Direction wo, Hit hit, MaterialProperties mp) { return SPECTRUM_ZERO; }

// The albedo guide's value: a clear sheet, like clear glass, reports 1.
Spectrum thin_dielectric_albedo(Hit hit, MaterialProperties mp) { return SPECTRUM_ONE; }

// R_tot = 2R/(1 + R) at cosine cos_i for a sheet of relative index sheet_eta. Entering the sheet
// from outside, n_i/n_t = 1/η; total internal reflection (η < 1) gives R = 1, so R_tot = 1.
float thin_dielectric_reflectance(float cos_i, float sheet_eta) {
    float R = dielectric_fresnel(cos_i, 1.0 / sheet_eta);
    return 2.0 * R / (1.0 + R);
}

InteractionSample thin_dielectric_sample(Direction wo, Hit hit, MaterialProperties mp, float uc, vec2 u) {
    // n faces region_from (§4.1), so cos_i > 0 by orientation; clamped at grazing.
    Direction n = hit.frame.n;
    float cos_i = clamp(ambient_dot(wo, n, hit.p), 1e-6, 1.0);

    InteractionSample s;
    if (uc < thin_dielectric_reflectance(cos_i, mp.sheet_eta)) {
        s.wi    = normalize(2.0 * cos_i * n - wo);
        s.flags = LOBE_REFLECTION | LOBE_DELTA;
    } else {
        s.wi    = -wo;
        s.flags = LOBE_TRANSMISSION | LOBE_DELTA;
    }
    // Each lobe is chosen with the probability of its own weight (R_tot or T_tot), so f·|cos|/pdf
    // with the delta cancellation (§2.1) leaves weight 1 on both branches. No η² factor: the
    // light ends up in the medium it started in.
    s.weight = SPECTRUM_ONE;
    s.pdf    = 0.0;
    return s;
}
