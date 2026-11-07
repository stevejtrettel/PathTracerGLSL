// phase_hg.glsl — Henyey–Greenstein phase function (§3.5). Fields read: mp.phase_g.
// TRANSCRIBED from fable-reference-implementations §3 — the FORWARD convention:
// c is measured from the propagation direction (-wo), so the denominator is 1 + g² − 2gc
// (forward peak at c = 1 for g > 0). PBRT uses the OPPOSITE form (+2gc with dot(wo, wi));
// its own book footnotes the divergence from the scattering literature — do NOT "fix" this
// file against PBRT: mixing the conventions swaps forward/backward scattering AND desyncs
// eval from sample (the second-pass audit caught exactly this).
// p is the scattering event's point: the cosine, the sampling frame around the propagation
// direction and the sampled direction's normalization all use the metric there (ambient_dot,
// ambient_frame, ambient_normalize), so the one file serves every space.

Spectrum hg_eval(Direction wi, Direction wo, Point p, MediumProperties mp) {
    float g = mp.phase_g;
    float c = ambient_dot(wi, -wo, p);                // cos from the FORWARD (propagation) direction
    float d = 1.0 + g * g - 2.0 * g * c;
    return Spectrum((1.0 - g * g) / (4.0 * PI * d * sqrt(max(d, 1e-8))));
}

InteractionSample hg_sample(Direction wo, Point p, MediumProperties mp, vec2 xi) {
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
    Frame f = ambient_frame(p, -wo);                  // tangent frame at p around the propagation direction

    InteractionSample s;
    s.wi     = ambient_normalize(f.t * (sin_theta * cos(phi)) + f.b * (sin_theta * sin(phi)) + f.n * cos_theta, p);
    s.weight = SPECTRUM_ONE;                          // phase/pdf = 1 exactly: HG sampling is exact (§2.1)
    s.pdf    = spectrum_average(hg_eval(s.wi, wo, p, mp)); // scalar; HG is grayscale
    s.flags  = LOBE_MEDIUM;
    return s;
}

float hg_pdf(Direction wi, Direction wo, Point p, MediumProperties mp) {
    return spectrum_average(hg_eval(wi, wo, p, mp));
}
