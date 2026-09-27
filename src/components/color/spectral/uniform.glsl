float wavelength_from_cdf(float u) { return 360.0 + 470.0 * u; }
float wavelength_pdf(float lambda) { return 1.0 / 470.0; }
