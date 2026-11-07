
// ╔══ BLOCK: generated:display-header  [lines 1–9]
#version 300 es
precision highp float;
precision highp int;

out vec4 fragColor;
uniform vec2 u_resolution;
uniform sampler2D u_radiance;
uniform sampler2D u_blueNoise;
#define DISPLAY_EXPOSURE 1.0000000

// ╔══ BLOCK: glsl/shared/display.glsl  [lines 10–29]
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


// ╔══ BLOCK: glsl/shared/noise.glsl  [lines 30–40]
// noise.glsl — shared noise primitive (compiler-owned, non-swappable).
// Accessor for the global blue-noise tile bound as `u_blueNoise` (a 64x64 RGB8, REPEAT-
// wrapped void-and-cluster tile — see tools/gen-bluenoise.mjs). Returns three INDEPENDENT
// blue-noise values (one per color channel), each spectrally blue (energy at high
// frequencies, a hole near DC) and mutually decorrelated, so RGB dither doesn't correlate
// the channels' quantization error. Consumed by the display dither (view).

vec3 blue_noise(vec2 fragCoord) {
    return texture(u_blueNoise, fragCoord * (1.0 / 64.0)).rgb;   // 64 = BLUE_NOISE_SIZE (gen-bluenoise.mjs)
}


// ╔══ BLOCK: components/tonemap/reinhard/reinhard.glsl  [lines 41–49]
// tonemap 'reinhard' — the Reinhard operator x/(1+x), per channel.
// HDR-linear → display-linear [0,1]. safe_color, the sRGB OETF (linear_to_srgb),
// exposure, and the display main() are shared/generated glue — this occupant is the
// tone curve only (impl-plan-display Stage 2).

vec3 reinhard_curve(vec3 x) {
    return x / (1.0 + x);
}


// ╔══ BLOCK: generated:display-main  [lines 50–57]
void main() {
    vec2 uv = gl_FragCoord.xy / u_resolution;
    vec3 color = safe_color(texture(u_radiance, uv).rgb) * DISPLAY_EXPOSURE;
    color = reinhard_curve(color);
    color = clamp(linear_to_srgb(color), 0.0, 1.0);
    color += (blue_noise(gl_FragCoord.xy) - 0.5) * (1.0 / 255.0);
    fragColor = vec4(color, 1.0);
}