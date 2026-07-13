// medium_analytic.glsl — the v1 'analytic' volume strategy bodies (V1-C1: homogeneous,
// closed-form). NORMATIVE SOURCE: fable-volumetric-component.md §4 — transcribe, don't
// re-derive. Chromatic sampling is pbrt-v3's uniform CHANNEL SELECTION with the
// balance-heuristic weight over per-channel exponential pdfs (owner decision; bounded
// weights — NOT the σ̄ ratio-weight scheme of reference-implementations §5, superseded).
// Grayscale degeneracy check: scatter weight → σ_s/σ_t (single-scatter albedo), survival
// weight → 1 — the §7.2 "no weight on survival" pin is the special case of these formulas.

MediumSample medium_sample_analytic(MediumProperties m, float t_max, vec2 xi) {
    Spectrum sigma_t = m.sigma_a + m.sigma_s;

    int   c  = min(int(xi.x * 3.0), 2);               // uniform channel selection
    float sc = max(sigma_t[c], 1e-9);                 // zero channel → huge t → survive branch
    float t  = -log(1.0 - xi.y) / sc;

    MediumSample ms;
    ms.radiance = SPECTRUM_ZERO;                      // mandatory (§3 partition rule)
    if (t < t_max) {
        // Scatter event at t. pdf = (1/3) Σ_c σ_c e^{−σ_c t} (one-sample MIS over channels).
        Spectrum tr  = spectrum_exp(-sigma_t * t);
        float    pdf = spectrum_average(sigma_t * tr);
        ms.scattered = true;
        ms.t         = t;
        ms.weight    = m.sigma_s * tr / max(pdf, 1e-20);
    } else {
        // Survived to the boundary. pdf = P(t ≥ t_max) = (1/3) Σ_c e^{−σ_c t_max}.
        Spectrum tr  = spectrum_exp(-sigma_t * t_max);
        float    pdf = spectrum_average(tr);
        ms.scattered = false;
        ms.t         = t_max;
        ms.weight    = tr / max(pdf, 1e-20);
    }
    return ms;
}

// Seam 2 (per-segment shadow transmittance): exact Beer–Lambert over FULL σ_t — absorption
// plus out-scatter, the standard single-scattering shadow approximation. Residual ratio
// tracking degenerates to exactly this for homogeneous media (the heterogeneous upgrade is
// a strict superset). Caller clamps len finite (MAX_DIST) — inf × 0 = NaN guard (pbrt note).
Spectrum medium_transmittance_analytic(MediumProperties m, float len) {
    return spectrum_exp(-(m.sigma_a + m.sigma_s) * len);
}
