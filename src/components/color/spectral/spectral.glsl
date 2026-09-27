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

// Each lane uses its original camera wavelength and its own marginal density.
vec3 color_to_pixel(vec2 film, Direction ray_dir, Radiance L, WavelengthSample camera_sample) {
    vec3 pixel = vec3(0.0);
    for (int i = 0; i < 4; ++i) {
        pixel += sensor_response(camera_sample.wl.lambda[i], film, ray_dir) * (L[i] / camera_sample.pdf[i]);
    }
    return 0.25 * pixel;
}
