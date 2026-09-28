// Per-lane integral of exp(-sigma*s) over [0,len]. The zero-extinction limit is len.
// For small optical depth, a Taylor polynomial avoids subtracting exp(-tau) from 1.
// On [0,0.1], the omitted term in (1-exp(-tau))/tau is at most 0.1^5/720 < 1.4e-8.
Spectrum medium_absorption_integral(Spectrum sigma, float len) {
    Spectrum integral;
    for (int c = 0; c < SPECTRUM_N; ++c) {
        float tau = sigma[c] * len;
        integral[c] = tau < 0.1
            ? len * (1.0 + tau * (-0.5 + tau * (1.0/6.0 + tau * (-1.0/24.0 + tau/120.0))))
            : (1.0 - exp(-tau)) / sigma[c];
    }
    return integral;
}
