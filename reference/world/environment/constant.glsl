// Constant Environment
// Returns uniform radiance in all directions
// Uniforms: u_environment_color (vec3), u_environment_intensity (float)

uniform vec3 u_environment_color;
uniform float u_environment_intensity;

vec3 environment_radiance(vec3 direction) {
    return u_environment_color * u_environment_intensity;
}
