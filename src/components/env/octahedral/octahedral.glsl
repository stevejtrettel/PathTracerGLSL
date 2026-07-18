// Equal-area octahedral environment CHART (env-as-light T5, plan D11) — pbrt-v4's
// ImageInfiniteLight mapping (Clarberg 2008), Y-up. Drop-in replacement for the equirect
// chart behind the same names: env_chart_uv / env_chart_dir / env_texel_dOmega / env_rotate_y.
//
// EQUAL-AREA is the point: every texel of the N×N table subtends exactly 4π/N² sr — the
// Jacobian is constant, the CDF table needs no sinθ weighting, poles cost nothing.
// LINE-FOR-LINE TWIN of src/engine/loaders/octahedral.ts (the CPU resampler + the vitest
// ground truth) — change one, change both.
// METRIC EXEMPTION (trace-loop contract): raw math on world-space directions is deliberate —
// the environment lives on direction-space S², not in scene space (§5.3).

float env_copysign(float m, float s) {
    return s < 0.0 ? -abs(m) : abs(m);
}

// env_rotate_y comes from the shared generated block (emitted before any chart).

// Constant Jacobian: 4π / (W·H). (j unused — signature shared with the equirect chart.)
float env_texel_dOmega(int j, ivec2 sz) {
    return (4.0 * PI) / (float(sz.x) * float(sz.y));
}

vec3 env_chart_dir(vec2 uv) {
    float up = 2.0 * uv.x - 1.0;
    float vp = 2.0 * uv.y - 1.0;
    float upAbs = abs(up), vpAbs = abs(vp);

    float signedDistance = 1.0 - (upAbs + vpAbs);   // to the equator fold |u'|+|v'| = 1
    float d = abs(signedDistance);
    float r = 1.0 - d;

    float phi = ((r == 0.0 ? 1.0 : (vpAbs - upAbs) / r) + 1.0) * PI * 0.25;
    float y = env_copysign(1.0 - r * r, signedDistance);
    float cosPhi = env_copysign(cos(phi), up);
    float sinPhi = env_copysign(sin(phi), vp);
    float s = r * sqrt(max(0.0, 2.0 - r * r));
    // rotation: the table is unrotated; a world direction at azimuth φ reads the table at
    // φ + ρ, so decoding table uv must SUBTRACT ρ (the inverse — same discipline as equirect).
    return env_rotate_cs(vec3(cosPhi * s, y, sinPhi * s), vec2(u_envRotCS.x, -u_envRotCS.y));   // −ρ: negate sin
}

vec2 env_chart_uv(vec3 dir) {
    vec3 n = env_rotate_cs(normalize(dir), u_envRotCS);
    float x = abs(n.x), y = abs(n.y), z = abs(n.z);

    float r = sqrt(max(0.0, 1.0 - y));

    float a = max(x, z);
    float b = (a == 0.0) ? 0.0 : min(x, z) / a;
    float phi = atan(b) * (2.0 / PI);
    if (x < z) phi = 1.0 - phi;

    float vv = phi * r;
    float uu = r - vv;
    if (n.y < 0.0) {
        float t = uu; uu = vv; vv = t;
        uu = 1.0 - uu;
        vv = 1.0 - vv;
    }
    uu = env_copysign(uu, n.x);
    vv = env_copysign(vv, n.z);
    return vec2((uu + 1.0) * 0.5, (vv + 1.0) * 0.5);
}
