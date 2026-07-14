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
