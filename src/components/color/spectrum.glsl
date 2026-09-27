// Component-wise transport operations; no RGB luminance weights.
const Spectrum SPECTRUM_ZERO = Spectrum(0.0);
const Spectrum SPECTRUM_ONE = Spectrum(1.0);

float spectrum_average(Spectrum s) {
    float sum = s[0];
    for (int i = 1; i < SPECTRUM_N; ++i) sum += s[i];
    return sum * (1.0 / float(SPECTRUM_N));
}

float spectrum_max(Spectrum s) {
    float m = s[SPECTRUM_N - 1];
    for (int i = SPECTRUM_N - 2; i >= 0; --i) m = max(s[i], m);
    return m;
}

bool spectrum_is_black(Spectrum s) {
    return all(lessThanEqual(s, SPECTRUM_ZERO));
}

// Uniform selection among the transport channels; u is in [0,1).
int spectrum_sample_channel(float u) {
    return min(int(u * float(SPECTRUM_N)), SPECTRUM_N - 1);
}
