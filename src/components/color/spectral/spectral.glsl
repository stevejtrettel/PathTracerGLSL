WavelengthSample wavelengths_sample() {
    float u = random();
    WavelengthSample camera_sample;
    for (int i = 0; i < 4; ++i) {
        float lambda = wavelength_from_cdf(fract(u + 0.25 * float(i)));
        camera_sample.wl.lambda[i] = lambda;
        camera_sample.pdf[i] = wavelength_pdf(lambda);
    }
    return camera_sample;
}

// The hero wavelength: lane 0. A path that must follow one wavelength (through dispersive glass)
// follows this one.
float wavelengths_hero(Wavelengths wl) {
    return wl.lambda.x;
}

// A throughput collapsed to the hero lane. The film averages the lanes,
// (1/N) sum_i S(lambda_i) L_i / p(lambda_i). The lanes' joint distribution is unchanged by a cyclic
// relabelling, so when the path so far treats the lanes alike, the hero lane alone times N has
// the same expectation (spectra/cauchy/README.md, "Why the compensation is valid here").
Spectrum spectrum_collapse_to_hero(Spectrum s) {
    return s * vec4(float(SPECTRUM_N), 0.0, 0.0, 0.0);
}

// Each lane uses its original camera wavelength and its own marginal density.
vec3 color_to_pixel(vec2 film, Direction ray_dir, Radiance L, WavelengthSample camera_sample) {
    vec3 pixel = vec3(0.0);
    for (int i = 0; i < 4; ++i) {
        pixel += sensor_response(camera_sample.wl.lambda[i], film, ray_dir) * (L[i] / camera_sample.pdf[i]);
    }
    return 0.25 * pixel;
}
