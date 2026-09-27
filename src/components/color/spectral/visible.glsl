// Truncated sech-squared density on [360,830] nm, sampled by its exact inverse CDF.
// The endpoint tanh values normalize the density on the same finite interval.
float wavelength_from_cdf(float u) {
    float a = tanh(0.0072 * (360.0 - 538.0));
    float b = tanh(0.0072 * (830.0 - 538.0));
    return 538.0 + atanh(mix(a, b, u)) / 0.0072;
}
float wavelength_pdf(float lambda) {
    float a = tanh(0.0072 * (360.0 - 538.0));
    float b = tanh(0.0072 * (830.0 - 538.0));
    float c = cosh(0.0072 * (lambda - 538.0));
    return 0.0072 / ((b - a) * c * c);
}
