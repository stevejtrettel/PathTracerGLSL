// HDRI Environment
// Equirectangular HDR environment map sampling
// Uniforms: u_env_map (sampler2D), u_env_intensity (float), u_env_rotation (float, radians)

#define PI 3.14159265359
#define TWO_PI 6.28318530718

uniform sampler2D u_env_map;
uniform float u_env_intensity;
uniform float u_env_rotation;

vec2 direction_to_equirect(vec3 dir) {
    vec3 n = normalize(dir);
    float phi = atan(n.z, n.x) + u_env_rotation;
    float theta = acos(clamp(n.y, -1.0, 1.0));
    float u = phi / TWO_PI + 0.5;
    float v = theta / PI;
    return vec2(u, v);
}

vec3 environment_radiance(vec3 direction) {
    vec2 uv = direction_to_equirect(direction);
    vec3 color = texture(u_env_map, uv).rgb;
    return color * u_env_intensity;
}
