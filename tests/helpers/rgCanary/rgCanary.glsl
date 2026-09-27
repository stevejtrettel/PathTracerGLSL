// Test representation: retain red and green; the film's blue component is zero.
WavelengthSample wavelengths_sample() {
    return WavelengthSample(Wavelengths(0.0), 1.0);
}
vec3 color_to_pixel(vec2 film, Direction ray_dir, Radiance L, WavelengthSample camera_sample) {
    return vec3(sensor_response(film, ray_dir) * L, 0.0);
}
Spectrum color_lift_reflectance(vec3 rgb, Wavelengths wl) { return rgb.rg; }
Spectrum color_lift_coefficient(vec3 rgb, Wavelengths wl) { return rgb.rg; }
Spectrum color_lift_emission(vec3 rgb, Wavelengths wl) { return rgb.rg; }
