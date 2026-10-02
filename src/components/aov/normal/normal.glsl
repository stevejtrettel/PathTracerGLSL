// normal.glsl — the normal guide's sample at the first surface a path reaches.
// The shading normal, faced toward the side the ray arrives from (scene_intersect faces the
// frame by the GEOMETRIC normal, so an interpolated mesh normal can still point away near a
// silhouette), times the channel average of the path's weight on arrival: the averaged
// picture is the normal times the mean transmittance along the camera ray. Not renormalized.
// Provides: normal_aov().

vec3 normal_aov(int mat, Hit hit, Direction wo, MaterialProperties props, Spectrum weight) {
    vec3 n = ambient_dot(hit.frame.n, wo, hit.p) < 0.0 ? -hit.frame.n : hit.frame.n;
    return n * spectrum_average(weight);
}
