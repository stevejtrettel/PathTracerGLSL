// tonemap 'agx' — AgX (Troy Sobotka), the Blender-default neutral tone mapping.
// A log-encoded sigmoid with inset/outset matrices: excellent highlight desaturation and
// hue stability, the modern production default. Transcribed from the widely-used "minimal
// AgX" (Benjamin Wrensch) — sRGB working space, 6th-order contrast approximation. The
// outset stage linearizes (pow 2.2), so output is display-referred LINEAR and the shared
// sRGB OETF encodes it (encodesToDisplay).

vec3 agx_contrast_approx(vec3 x) {
    // 6th-order polynomial fit of the AgX sigmoid.
    vec3 x2 = x * x;
    vec3 x4 = x2 * x2;
    return + 15.5    * x4 * x2
           - 40.14   * x4 * x
           + 31.96   * x4
           - 6.868   * x2 * x
           + 0.4298  * x2
           + 0.1191  * x
           - 0.00232;
}

vec3 agx_curve(vec3 color) {
    const mat3 agx_inset = mat3(
        0.842479062253094,  0.0423282422610123, 0.0423756549057051,
        0.0784335999999992, 0.878468636469772,  0.0784336,
        0.0792237451477643, 0.0791661274605434, 0.879142973793104);
    const mat3 agx_outset = mat3(
         1.19687900512017,   -0.0528968517574562, -0.0529716355144438,
        -0.0980208811401368,  1.15190312990417,   -0.0980434501171241,
        -0.0990297440797205, -0.0989611768448433,  1.15107367264116);
    const float min_ev = -12.47393;
    const float max_ev = 4.026069;

    color = agx_inset * color;
    color = clamp(log2(color), min_ev, max_ev);      // log-encode; guards color==0 (→ min_ev)
    color = (color - min_ev) / (max_ev - min_ev);
    color = agx_contrast_approx(color);
    color = agx_outset * color;
    color = pow(max(color, 0.0), vec3(2.2));         // → linear; shared sRGB OETF re-encodes
    return color;
}
