// albedo.glsl — the albedo guide's sample at the first surface a path reaches.
// The material's albedo fact (generated material_albedo, clamped to [0, 1]) times the path's
// weight on arrival. Every medium arm's arrival weight is an unbiased estimate of the
// transmittance along the camera ray, so the averaged picture is albedo ⊙ transmittance; with
// no medium in front the weight is exactly 1 and this is the plain first-hit albedo.
// Provides: albedo_aov().

vec3 albedo_aov(int mat, Hit hit, Direction wo, MaterialProperties props, Spectrum weight) {
    return material_albedo(mat, hit, props) * weight;
}
