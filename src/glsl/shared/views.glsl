// views.glsl — the data views of the display pass: fixed mappings of non-radiometric pictures
// (components/aov) to display values in [0, 1]. No exposure and no tone curve: these pictures
// are not light. Included only when some picture uses one (ShaderBuilder). Reads linear_to_srgb
// from display.glsl.

// NaN/Inf → 0, signs kept (safe_color's clamp to ≥ 0 would erase half of a normal).
vec3 view_finite(vec3 c) {
    bvec3 ok = lessThanEqual(abs(c), vec3(1e19));
    return (ok.x && ok.y && ok.z) ? c : vec3(0.0);
}

// 'unit': a value in [0, 1] (an albedo), clamped, then sRGB-encoded like any displayed color.
vec3 view_unit(vec3 x) {
    return clamp(linear_to_srgb(clamp(view_finite(x), 0.0, 1.0)), 0.0, 1.0);
}

// 'signed': a value in [−1, 1] (a normal) as 0.5·x + 0.5, clamped; not sRGB-encoded, the usual
// look of a normal map.
vec3 view_signed(vec3 x) {
    return clamp(0.5 * view_finite(x) + 0.5, 0.0, 1.0);
}
