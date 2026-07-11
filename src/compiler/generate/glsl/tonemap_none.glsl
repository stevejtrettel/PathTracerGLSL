// Raw Display Pass (tonemap: 'none')
// Linear radiance straight to the canvas — no tonemap, no sRGB. This is the display mode
// the §11 on-screen radiance checks need: what you probe is what the accumulator holds
// (clamped to [0,1] only by the 8-bit target itself). NaN/Inf sanitized like the tonemapped path.

uniform vec2 u_resolution;
uniform sampler2D u_radiance;

vec3 safe_color(vec3 c) {
    c = max(c, vec3(0.0));
    bvec3 ok = lessThanEqual(abs(c), vec3(1e19));
    if (!(ok.x && ok.y && ok.z)) return vec3(0.0);
    return c;
}

void main() {
    vec2 uv = gl_FragCoord.xy / u_resolution;
    vec3 radiance = texture(u_radiance, uv).rgb;
    fragColor = vec4(safe_color(radiance) * DISPLAY_EXPOSURE, 1.0);
}
