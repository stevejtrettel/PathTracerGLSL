// draine.glsl — the HG–Draine approximate-Mie scattering model (Jendersie & d'Eon 2023,
// "An Approximate Mie Scattering Function for Fog and Cloud Rendering", SIGGRAPH Talks;
// DOI 10.1145/3587421.3595409). For water-droplet media (fog/cloud/mist): a two-lobe
// mixture (1−w)·HG(g_HG) + w·Draine(α, g_D) that matches ~95% of tabulated Lorenz–Mie
// across droplet sizes. Reads mp.draine_d (droplet diameter, µm; the four lobe parameters
// are fitted functions of d, Eqs. 7–10, valid ~5–50µm).
//
// evalDraine + sampleDraineCos are TRANSCRIBED VERBATIM from the authors' reference
// draine.hlsl (MIT, © NVIDIA 2023): the exact Draine eval and its exact analytic sampler
// (a Cardano/quartic CDF inversion — weight = 1). NaN-guards added for g→0 (isotropic) and
// α→0 (Draine→HG) per the paper; neither triggers in the fitted fog range. cos measured
// from the FORWARD (propagation) direction, u = dot(wi, −wo) — same convention as hg/rayleigh.
// KNOWN LIMIT (paper): matches the forward half of Mie but NOT the weak backscatter fogbow/
// glory peaks; those still need tabulated Mie.
//
// Provides: draine_eval / draine_sample / draine_pdf.

float evalHG(float u, float g) {
    return (1.0 - g * g) / (4.0 * PI * pow(1.0 + g * g - 2.0 * g * u, 1.5));
}

// VERBATIM (draine.hlsl): the Draine phase value, u = cosθ.
float evalDraine(float u, float g, float a) {
    return ((1.0 - g * g) * (1.0 + a * u * u))
        / (4.0 * (1.0 + (a * (1.0 + 2.0 * g * g)) / 3.0) * PI * pow(1.0 + g * g - 2.0 * g * u, 1.5));
}

float sampleHGCos(float xi, float g) {
    if (abs(g) < 1e-3) return 1.0 - 2.0 * xi;                 // isotropic limit (exact-inverse blows up)
    float sq = (1.0 - g * g) / (1.0 - g + 2.0 * g * xi);
    return (1.0 + g * g - sq * sq) / (2.0 * g);
}

// VERBATIM (draine.hlsl): exact analytic sampler for cosθ of the Draine lobe (weight = 1),
// the closed-form quartic CDF inversion. Guards keep it out of its two singular regimes.
float sampleDraineCos(float xi, float g, float a) {
    if (abs(g) < 1e-3) return 1.0 - 2.0 * xi;                 // Draine sampler has 1/(2g); fall back isotropic
    if (a < 1e-3)      return sampleHGCos(xi, g);             // α→0: Draine ≡ HG

    float g2 = g * g;
    float g3 = g * g2;
    float g4 = g2 * g2;
    float g6 = g2 * g4;
    float pgp1_2 = (1.0 + g2) * (1.0 + g2);
    float T1a = -a + a * g4;
    float T1a3 = T1a * T1a * T1a;
    float T2 = -1296.0 * (-1.0 + g2) * (a - a * g2) * (T1a) * (4.0 * g2 + a * pgp1_2);
    float T3 = 3.0 * g2 * (1.0 + g * (-1.0 + 2.0 * xi)) + a * (2.0 + g2 + g3 * (1.0 + 2.0 * g2) * (-1.0 + 2.0 * xi));
    float T4a = 432.0 * T1a3 + T2 + 432.0 * (a - a * g2) * T3 * T3;
    float T4b = -144.0 * a * g2 + 288.0 * a * g4 - 144.0 * a * g6;
    float T4b3 = T4b * T4b * T4b;
    float T4 = T4a + sqrt(-4.0 * T4b3 + T4a * T4a);
    float T4p3 = pow(T4, 1.0 / 3.0);
    float T6 = (2.0 * T1a + (48.0 * pow(2.0, 1.0 / 3.0) * (-(a * g2) + 2.0 * a * g4 - a * g6)) / T4p3
        + T4p3 / (3.0 * pow(2.0, 1.0 / 3.0))) / (a - a * g2);
    float T5 = 6.0 * (1.0 + g2) + T6;
    return (1.0 + g2 - pow(-0.5 * sqrt(T5)
        + sqrt(6.0 * (1.0 + g2) - (8.0 * T3) / (a * (-1.0 + g2) * sqrt(T5)) - T6) / 2.0, 2.0)) / (2.0 * g);
}

// Droplet-diameter → lobe parameters (Jendersie & d'Eon Eqs. 7–10, valid ~5–50µm).
void draine_params(float d, out float gHG, out float gD, out float alpha, out float wD) {
    gHG   = exp(-0.0990567 / (d - 1.67154));
    gD    = exp(-2.20679 / (d + 3.91029) - 0.428934);
    alpha = exp(3.62489 - 8.29288 / (d + 5.52825));
    wD    = exp(-0.599085 / (d - 0.641583) - 0.665888);
}

Spectrum draine_eval(Direction wi, Direction wo, MediumProperties mp) {
    float u = dot(wi, -wo);                                    // forward cosine
    float gHG, gD, alpha, wD;
    draine_params(mp.draine_d, gHG, gD, alpha, wD);
    float p = (1.0 - wD) * evalHG(u, gHG) + wD * evalDraine(u, gD, alpha);   // mixture = pdf = eval
    return Spectrum(p);
}

InteractionSample draine_sample(Direction wo, MediumProperties mp, vec2 xi) {
    float gHG, gD, alpha, wD;
    draine_params(mp.draine_d, gHG, gD, alpha, wD);

    // Select a lobe by weight wD, reusing the same xi.x rescaled to [0,1) inside it.
    float cos_theta;
    if (xi.x < wD) {
        cos_theta = sampleDraineCos(xi.x / wD, gD, alpha);
    } else {
        cos_theta = sampleHGCos((xi.x - wD) / (1.0 - wD), gHG);
    }
    cos_theta = clamp(cos_theta, -1.0, 1.0);

    float sin_theta = sqrt(max(0.0, 1.0 - cos_theta * cos_theta));
    float phi = TWO_PI * xi.y;
    vec3 t, b;
    build_basis(-wo, t, b);                                    // frame around the propagation direction

    InteractionSample s;
    s.wi     = normalize(t * (sin_theta * cos(phi)) + b * (sin_theta * sin(phi)) + (-wo) * cos_theta);
    // Mixture of two EXACT samplers whose combined pdf = the mixture eval ⇒ weight = 1 (§2.1).
    s.weight = SPECTRUM_ONE;
    s.pdf    = spectrum_average(draine_eval(s.wi, wo, mp));    // combined pdf; grayscale
    s.flags  = LOBE_MEDIUM;
    return s;
}

float draine_pdf(Direction wi, Direction wo, MediumProperties mp) {
    return spectrum_average(draine_eval(wi, wo, mp));
}
