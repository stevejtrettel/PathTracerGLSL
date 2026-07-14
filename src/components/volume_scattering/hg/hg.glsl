// phase_hg.glsl — Henyey–Greenstein phase function (§3.5). Fields read: mp.phase_g.
// TRANSCRIBED from fable-reference-implementations §3 — the FORWARD convention:
// c is measured from the propagation direction (-wo), so the denominator is 1 + g² − 2gc
// (forward peak at c = 1 for g > 0). PBRT uses the OPPOSITE form (+2gc with dot(wo, wi));
// its own book footnotes the divergence from the scattering literature — do NOT "fix" this
// file against PBRT: mixing the conventions swaps forward/backward scattering AND desyncs
// eval from sample (the second-pass audit caught exactly this).
// Raw dot() is forced here: the pinned §3.5 signature carries no Point, so the metric seam
// (ambient_dot) waits for the phase interface to gain a position argument with curved spaces.

Spectrum hg_eval(Direction wi, Direction wo, MediumProperties mp) {
    float g = mp.phase_g;
    float c = dot(wi, -wo);                           // cos from the FORWARD (propagation) direction
    float d = 1.0 + g * g - 2.0 * g * c;
    return Spectrum((1.0 - g * g) / (4.0 * PI * d * sqrt(max(d, 1e-8))));
}

InteractionSample hg_sample(Direction wo, MediumProperties mp, vec2 xi) {
    float g = mp.phase_g;
    float cos_theta;
    if (abs(g) < 1e-3) {
        cos_theta = 1.0 - 2.0 * xi.x;                 // isotropic limit (the exact-inverse blows up at g→0)
    } else {
        float sq = (1.0 - g * g) / (1.0 - g + 2.0 * g * xi.x);
        cos_theta = (1.0 + g * g - sq * sq) / (2.0 * g);
    }
    float sin_theta = sqrt(max(0.0, 1.0 - cos_theta * cos_theta));
    float phi = TWO_PI * xi.y;
    vec3 t, b;
    build_basis(-wo, t, b);                           // frame around the propagation direction

    InteractionSample s;
    s.wi     = normalize(t * (sin_theta * cos(phi)) + b * (sin_theta * sin(phi)) + (-wo) * cos_theta);
    s.weight = SPECTRUM_ONE;                          // phase/pdf = 1 exactly: HG sampling is exact (§2.1)
    s.pdf    = spectrum_average(hg_eval(s.wi, wo, mp)); // scalar; HG is grayscale
    s.flags  = LOBE_MEDIUM;
    return s;
}

float hg_pdf(Direction wi, Direction wo, MediumProperties mp) {
    return spectrum_average(hg_eval(wi, wo, mp));
}
