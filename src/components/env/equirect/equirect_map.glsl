// The equirect mapping of direction space: direction → (u, v) = (φ/2π + ½, θ/π), θ = acos(y)
// (v = 0 at the +Y pole), with the azimuth rotation u_envRotation ADDED and u WRAPPED into
// [0, 1). Its inverse, which SUBTRACTS the rotation, is env_chart_dir (equirect.glsl).
// Two readers: the equirect chart (env_chart_uv — the sampler's table coordinates) and the image
// environment's radiance lookup, which reads its equirect map through this mapping whichever
// chart the sampler uses.
// The wrap is required, not cosmetic: the rotation shifts u by up to ±½, and environment_pdf
// turns u into a CDF-table column index, so an unwrapped u would be clamped to the edge column
// and the pdf read from the wrong column over a band of longitudes as wide as the rotation. (The
// radiance lookup would survive an unwrapped u: the map texture repeats horizontally.)
// METRIC EXEMPTION (trace-loop contract): raw math on world-space directions is deliberate —
// the environment lives on direction-space S², not in scene space (§5.3).
// Provides: equirect_uv().

vec2 equirect_uv(vec3 dir) {
    vec3 n = normalize(dir);
    float phi = atan(n.z, n.x) + u_envRotation;
    float theta = acos(clamp(n.y, -1.0, 1.0));
    return vec2(fract(phi * (1.0 / TWO_PI) + 0.5), theta * (1.0 / PI));
}
