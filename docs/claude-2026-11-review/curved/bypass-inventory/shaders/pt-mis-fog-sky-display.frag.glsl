
// ╔══ BLOCK: generated:display-header  [lines 1–8]
#version 300 es
precision highp float;
precision highp int;

out vec4 fragColor;
uniform vec2 u_resolution;
uniform sampler2D u_radiance;
#define DISPLAY_EXPOSURE 1.0000000

// ╔══ BLOCK: glsl/shared/display.glsl  [lines 9–28]
// display.glsl — shared display-pass math (compiler-owned, non-swappable).
// safe_color (NaN/Inf + negative sanitize) and the sRGB OETF are FIXED math shared by
// every tonemap occupant, so they live here, not re-pasted per occupant. A tonemap
// occupant supplies ONLY its `vec3 <id>_curve(vec3)`; exposure, this math, and the
// display main() are shared/generated glue (impl-plan-display Stage 2).

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


// ╔══ BLOCK: components/tonemap/none/none.glsl  [lines 29–38]
// tonemap 'none' — identity curve (raw linear passthrough).
// The display main() applies NO sRGB encode for this occupant (encodesToDisplay=false)
// and exposure is forced to 1.0, so what §11 on-screen radiance probes read is exactly
// what the accumulator holds (clamped to [0,1] only by the 8-bit target). NaN/Inf and
// negatives are sanitized by the shared safe_color() in the display glue.

vec3 none_curve(vec3 x) {
    return x;
}


// ╔══ BLOCK: generated:display-main  [lines 39–44]
void main() {
    vec2 uv = gl_FragCoord.xy / u_resolution;
    vec3 color = safe_color(texture(u_radiance, uv).rgb) * DISPLAY_EXPOSURE;
    color = none_curve(color);
    fragColor = vec4(color, 1.0);
}