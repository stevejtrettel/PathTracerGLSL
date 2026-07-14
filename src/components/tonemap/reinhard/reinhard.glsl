// tonemap 'reinhard' — the Reinhard operator x/(1+x), per channel.
// HDR-linear → display-linear [0,1]. safe_color, the sRGB OETF (linear_to_srgb),
// exposure, and the display main() are shared/generated glue — this occupant is the
// tone curve only (impl-plan-display Stage 2).

vec3 reinhard_curve(vec3 x) {
    return x / (1.0 + x);
}
