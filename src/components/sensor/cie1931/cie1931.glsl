// CIE 1931 observer projected to signed linear sRGB. Matrix and normalization are
// derived from the same tabulated D65 and CMFs used by the spectral lift.
vec3 sensor_response(float lambda, vec2 film, Direction ray_dir) {
    return CIE_XYZ_TO_RGB * spectral_curves(lambda).xyz / CIE_Y_INTEGRAL;
}
