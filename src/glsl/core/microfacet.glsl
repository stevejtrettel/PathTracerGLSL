// Microfacet distribution machinery — the FIXED stdlib every microfacet model is written
// against (fable-rough-dielectric §4). The MODEL is swappable (ggx conductor, rough
// dielectric, future sheen/layered/anisotropic occupants live behind the materials
// registry); the DISTRIBUTION is not — D, Smith G₁ and VNDF sampling are one truth here,
// so a program containing any one microfacet occupant links them exactly once and a
// rough-glass-only scene needs no conductor.
// Included when some present material model declares `usesMicrofacet` (the math_media
// pattern: conditional core, never wholesale).
// Provides: microfacet_D(), microfacet_G1(), microfacet_sample_vndf(),
//           microfacet_to_local(), microfacet_from_local().
// Depends on: PI, TWO_PI (math), Frame/Point/Direction (structs), ambient_dot.
//
// Convention (shared by every occupant): the local shading frame has n = +z, `a` is the
// GGX roughness parameter α = roughness² clamped ≥ 1e-3 host-side (the descriptors' D4
// derived row — the shader never recomputes it, and letting α → 0 produces fireflies,
// not a mirror: author true specular as a delta model).
// The TS twin in components/materials/ggx/ggx.test.ts is the tested ground truth for
// D/G1/sample — line-for-line transcription, change one change both (§11.3).

// Local shading frame, n = +z. Frame vectors are orthonormal in the ambient metric, so
// projection goes through ambient_dot (Euclidean unpacks to dot).
vec3 microfacet_to_local(Frame f, Point p, Direction v) {
    return vec3(ambient_dot(v, f.t, p), ambient_dot(v, f.b, p), ambient_dot(v, f.n, p));
}
Direction microfacet_from_local(Frame f, vec3 v) {
    return normalize(f.t * v.x + f.b * v.y + f.n * v.z);
}

float microfacet_D(vec3 h_local, float a) {          // Trowbridge–Reitz / GGX
    float t = h_local.z * h_local.z * (a * a - 1.0) + 1.0;
    return a * a / (PI * t * t);
}
float microfacet_G1(vec3 v_local, float a) {         // Smith, separable
    float c = abs(v_local.z);
    return 2.0 * c / (c + sqrt(a * a + (1.0 - a * a) * c * c));
}

// VNDF sampling (Heitz 2018) — sample the microfacet normal visible from wol, which must
// be in the UPPER hemisphere (callers canonicalize their side first). Returns the local
// half-vector m; the caller owns what to do with it (reflect, refract, or both).
vec3 microfacet_sample_vndf(vec3 wol, float a, vec2 u) {
    vec3 vh = normalize(vec3(a * wol.x, a * wol.y, wol.z));
    float lensq = vh.x * vh.x + vh.y * vh.y;
    vec3 T1 = lensq > 0.0 ? vec3(-vh.y, vh.x, 0.0) * inversesqrt(lensq) : vec3(1.0, 0.0, 0.0);
    vec3 T2 = cross(vh, T1);
    float rr = sqrt(u.x);
    float phi = TWO_PI * u.y;
    float t1 = rr * cos(phi);
    float t2 = rr * sin(phi);
    float s_ = 0.5 * (1.0 + vh.z);
    t2 = (1.0 - s_) * sqrt(max(0.0, 1.0 - t1 * t1)) + s_ * t2;
    vec3 nh = t1 * T1 + t2 * T2 + sqrt(max(0.0, 1.0 - t1 * t1 - t2 * t2)) * vh;
    return normalize(vec3(a * nh.x, a * nh.y, max(1e-6, nh.z)));
}
