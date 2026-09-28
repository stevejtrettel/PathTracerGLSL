// Planck radiance relative to 550 nm, in the authored 1000–40000 K domain.
// q = hc/(k*T) in nm. CPU normalization uses the fixed CIE reference observer;
// the active sensor measures this positive spectrum only when accumulating film.
Spectrum blackbody_emission(float kelvin, float normalization, Wavelengths wl) {
    float q = 14387768.775039338 / kelvin;
    vec4 ratio = vec4(550.0) / wl.lambda;
    vec4 ratio2 = ratio * ratio;
    return normalization * (exp(q / 550.0) - 1.0)
        * ratio2 * ratio2 * ratio / (exp(vec4(q) / wl.lambda) - 1.0);
}
