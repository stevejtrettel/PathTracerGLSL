// Equirect environment CHART (env-as-light D11: a sampler = a chart × a weight policy).
// Provides: env_chart_uv(), env_chart_dir(), env_texel_dOmega(). This file is the chart seam —
// T5's octahedral chart is a drop-in replacement behind the same names. (Unlike octahedral,
// this chart applies u_envRotation inline — it does not call the shared env_rotate_y block.)
// Depends on: equirect_uv (equirect_map.glsl, which the chart descriptor's `needs` includes).
//
// ROTATION SIGN: env_chart_uv ADDS the rotation, env_chart_dir SUBTRACTS it — the pair must
// be exact inverses or sample↔pdf and sample↔radiance silently disagree whenever rotation ≠ 0.
// (An earlier reference implementation had them BOTH adding — env-plan pitfall 1. Do not "fix"
// the asymmetry back.)
// Convention: v = 0 at the +Y pole (θ = acos(y)); u is periodic in φ and WRAPPED into [0, 1).
// The mapping itself, with the wrap and the reason for it, is equirect_uv (equirect_map.glsl),
// which the image environment's radiance lookup also reads; env_chart_uv is that mapping.
// Cell sampling is uniform in solid angle; the CDF's luminance/sine weights are
// only an importance heuristic. The exact cell area determines the density.
// METRIC EXEMPTION (trace-loop contract): raw math on world-space directions is deliberate —
// the environment lives on direction-space S², not in scene space (§5.3).

vec2 env_chart_uv(vec3 dir) {
    return equirect_uv(dir);
}

vec3 env_chart_dir(vec2 uv) {
    float phi = (uv.x - 0.5) * TWO_PI - u_envRotation;
    float theta = uv.y * PI;
    float s = sin(theta);
    return vec3(cos(phi) * s, cos(theta), sin(phi) * s);
}

// Exact cell area: (2π/W)(cos θ0 − cos θ1), using the stable difference identity.
float env_texel_dOmega(int j, ivec2 sz) {
    float theta = PI * (float(j) + 0.5) / float(sz.y);
    return (TWO_PI / float(sz.x)) * 2.0 * sin(theta) * sin(0.5 * PI / float(sz.y));
}

// Uniform azimuth and uniform cos(theta) within a cell. Half-angle coordinates
// retain the transverse direction even when the axial component rounds to ±1.
vec3 env_chart_sample(ivec2 cell, vec2 u, ivec2 sz) {
    float phi = ((float(cell.x) + u.x) / float(sz.x) - 0.5) * TWO_PI - u_envRotation;
    bool north = 2 * cell.y < sz.y;
    float row = north ? float(cell.y) : float(sz.y - cell.y - 1);
    float a = sin(0.5 * PI * row / float(sz.y));
    float b = sin(0.5 * PI * (row + 1.0) / float(sz.y));
    float h = mix(a * a, b * b, north ? u.y : 1.0 - u.y);
    float y = (north ? 1.0 : -1.0) * (1.0 - 2.0 * h);
    float r = 2.0 * sqrt(h * (1.0 - h));
    return vec3(r * cos(phi), y, r * sin(phi));
}
