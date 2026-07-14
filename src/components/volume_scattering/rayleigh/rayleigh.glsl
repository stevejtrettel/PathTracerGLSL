// rayleigh.glsl — Rayleigh scattering model (particles ≪ wavelength; molecular air/sky).
// p(θ) = (3/16π)(1 + cos²θ), with cos measured from the FORWARD (propagation) direction —
// the same convention as hg (do NOT consult pbrt's opposite dot). Symmetric fore/aft, so
// the convention doesn't flip a peak here, but keep it consistent for eval↔sample sync.
// GRAYSCALE: Rayleigh's λ⁻⁴ color lives in the medium's σ_s, not the phase — the phase is
// angular shape only, so it reads no fields (rayleigh has no parameters). Exact sampler
// (weight = 1): the marginal p(μ) = (3/8)(1+μ²) is inverted in closed form (a depressed
// cubic, Cardano). Provides: rayleigh_eval / rayleigh_sample / rayleigh_pdf.

Spectrum rayleigh_eval(Direction wi, Direction wo, MediumProperties mp) {
    float c = dot(wi, -wo);                              // cos from the forward direction
    return Spectrum((3.0 / (16.0 * PI)) * (1.0 + c * c));
}

InteractionSample rayleigh_sample(Direction wo, MediumProperties mp, vec2 xi) {
    // Invert F(μ)=ξ for p(μ)=(3/8)(1+μ²): μ³ + 3μ + (4 − 8ξ) = 0 → depressed cubic with a
    // single real root (discriminant > 0). u = 4ξ−2, D = √(u²+1); root = ∛(u+D) + ∛(u−D).
    float u = 4.0 * xi.x - 2.0;
    float D = sqrt(u * u + 1.0);
    float cos_theta = pow(u + D, 1.0 / 3.0) - pow(D - u, 1.0 / 3.0);   // u−D<0 ⇒ −∛(D−u)
    cos_theta = clamp(cos_theta, -1.0, 1.0);
    float sin_theta = sqrt(max(0.0, 1.0 - cos_theta * cos_theta));
    float phi = TWO_PI * xi.y;
    vec3 t, b;
    build_basis(-wo, t, b);                              // frame around the propagation direction

    InteractionSample s;
    s.wi     = normalize(t * (sin_theta * cos(phi)) + b * (sin_theta * sin(phi)) + (-wo) * cos_theta);
    s.weight = SPECTRUM_ONE;                             // exact: sampled the marginal exactly (§2.1)
    s.pdf    = spectrum_average(rayleigh_eval(s.wi, wo, mp));   // = phase value; grayscale
    s.flags  = LOBE_MEDIUM;
    return s;
}

float rayleigh_pdf(Direction wi, Direction wo, MediumProperties mp) {
    return spectrum_average(rayleigh_eval(wi, wo, mp));
}
