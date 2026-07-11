// Equirect environment chart + tabulated radiance lookup (env-as-light T2; chart D11).
// Provides: env_chart_uv(), env_chart_dir(), environment_radiance().
// Uniforms (declared by the generator): u_envMap (extern:env_map), u_envIntensity, u_envRotation.
//
// ROTATION SIGN: env_chart_uv ADDS the rotation, env_chart_dir SUBTRACTS it — the pair must
// be exact inverses or sample↔pdf and sample↔radiance silently disagree whenever rotation ≠ 0.
// (The reference hdri-importance.glsl had them BOTH adding — env-plan pitfall 1. Do not "fix"
// the asymmetry back.)
// Convention: v = 0 at the +Y pole (θ = acos(y)); the u seam at φ = ±π wraps via the env
// map's REPEAT wrap mode. Chart Jacobian dΩ ∝ sinθ — the CDF builder weights by it and the
// pdf (T3) divides by it; this file owns only the mapping.
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

vec3 environment_radiance(vec3 dir) {
    return texture(u_envMap, env_chart_uv(dir)).rgb * u_envIntensity;
}
