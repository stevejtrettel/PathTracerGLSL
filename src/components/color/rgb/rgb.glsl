// RGB camera samples consume no random dimension.
WavelengthSample wavelengths_sample() {
    return WavelengthSample(Wavelengths(0.0), 1.0);
}

// Transport is already expressed in the film's linear-sRGB coordinates.
vec3 color_to_pixel(vec2 film, Direction ray_dir, Radiance L, WavelengthSample camera_sample) {
    return sensor_response(film, ray_dir) * L;
}
