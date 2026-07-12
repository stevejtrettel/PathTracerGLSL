// Equirect environment CHART (env-as-light D11: a sampler = a chart × a weight policy).
// Provides: env_chart_uv(), env_chart_dir(), env_rotate_y(). This file is the chart seam —
// T5's octahedral chart is a drop-in replacement behind the same names.
//
// ROTATION SIGN: env_chart_uv ADDS the rotation, env_chart_dir SUBTRACTS it — the pair must
// be exact inverses or sample↔pdf and sample↔radiance silently disagree whenever rotation ≠ 0.
// (The reference hdri-importance.glsl had them BOTH adding — env-plan pitfall 1. Do not "fix"
// the asymmetry back.)
// Convention: v = 0 at the +Y pole (θ = acos(y)); the u seam at φ = ±π wraps via the env
// map's REPEAT wrap mode. Chart Jacobian dΩ ∝ sinθ — the CDF builder weights by it and the
// sampler's pdf divides by it; this file owns only the mapping.
// METRIC EXEMPTION (trace-loop contract): raw math on world-space directions is deliberate —
// the environment lives on direction-space S², not in scene space (§5.3).

vec2 env_chart_uv(vec3 dir) {
    vec3 n = normalize(dir);
    float phi = atan(n.z, n.x) + u_envRotation;
    float theta = acos(clamp(n.y, -1.0, 1.0));
    return vec2(phi * (1.0 / TWO_PI) + 0.5, theta * (1.0 / PI));
}

vec3 env_chart_dir(vec2 uv) {
    float phi = (uv.x - 0.5) * TWO_PI - u_envRotation;
    float theta = uv.y * PI;
    float s = sin(theta);
    return vec3(cos(phi) * s, cos(theta), sin(phi) * s);
}

// Azimuth rotation by +a (adds a to atan(z, x)) — the direction-space form of the chart's
// rotation term, for radiance bodies that evaluate a formula rather than fetch a texture.
vec3 env_rotate_y(vec3 d, float a) {
    float c = cos(a), s = sin(a);
    return vec3(c * d.x - s * d.z, d.y, s * d.x + c * d.z);
}
