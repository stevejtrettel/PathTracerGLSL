// Reinhard Tonemapping Display Pass
// Reads HDR radiance, applies exposure + Reinhard + sRGB, outputs LDR.
// u_resolution / u_radiance / DISPLAY_EXPOSURE are declared by the generated
// display header (ShaderBuilder) — this template is tonemap math only.

vec3 safe_color(vec3 c) {
    c = max(c, vec3(0.0));
    bvec3 ok = lessThanEqual(abs(c), vec3(1e19));
    if (!(ok.x && ok.y && ok.z)) return vec3(0.0);
    return c;
}

vec3 linear_to_srgb(vec3 c) {
    vec3 lo = 12.92 * c;
    vec3 hi = 1.055 * pow(max(c, 0.0), vec3(1.0 / 2.4)) - 0.055;
    bvec3 cutoff = lessThanEqual(c, vec3(0.0031308));
    return mix(hi, lo, vec3(cutoff));
}

vec3 tonemap_reinhard(vec3 x) {
    return x / (1.0 + x);
}

void main() {
    vec2 uv = gl_FragCoord.xy / u_resolution;
    vec3 radiance = texture(u_radiance, uv).rgb;
    vec3 color = safe_color(radiance) * DISPLAY_EXPOSURE;
    color = tonemap_reinhard(color);
    color = clamp(linear_to_srgb(color), 0.0, 1.0);
    fragColor = vec4(color, 1.0);
}
