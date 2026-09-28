// Coefficients use micrometres; wavelength carriers use nanometres.
float cauchy_index(vec3 coefficients, float lambdaNM) {
    float inv2 = 1e6 / (lambdaNM * lambdaNM);
    return coefficients.x + inv2 * (coefficients.y + inv2 * coefficients.z);
}
