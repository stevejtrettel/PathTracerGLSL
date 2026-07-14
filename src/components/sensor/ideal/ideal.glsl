// sensor 'ideal' — the measurement functional's importance We ≡ 1.
// We is the ADJOINT of a light's Le: it weights the measured radiance by the sensor's
// response, so a pixel integrates ∫ h_j · We · L. v1 is the identity sensor (unit
// response — no exposure, no vignetting, no spectral weighting), which is exactly what
// makes this carve INERT: `We·L == L` bit-for-bit (×1.0 is exact), so witness numbers are
// unchanged. Real sensors (physical exposure, cosⁿ / optical vignetting, CIE spectral
// response once wavelengths are a seed field) are future occupants — and `film`/`ray_dir`
// are already the arguments they need.
// Provides: sensor_response(vec2 film, Direction ray_dir).

Spectrum sensor_response(vec2 film, Direction ray_dir) {
    return SPECTRUM_ONE;
}
