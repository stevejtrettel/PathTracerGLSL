// GGX rough conductor — conforms to §3.2 (transcribed from reference-implementations §7,
// adapted to the (uc, u) sampler split and the ambient_dot metric discipline).
// Smith separable masking, Schlick Fresnel, VNDF sampling (Heitz 2018).
// Fields read: mp.f0 (normal-incidence reflectance), mp.alpha (DERIVED host-side, D4:
// max(1e-3, roughness²) — the descriptor's `derived` declaration; the shader never
// recomputes it). Convention: alpha clamped ≥ 1e-3 — author true mirrors as a delta
// model instead (§3.1); letting alpha→0 here produces fireflies, not a mirror.
// Provides: ggx_to_local(), ggx_from_local(), ggx_D(), ggx_G1(),
//           ggx_eval(), ggx_sample(), ggx_pdf(), ggx_emission().
// Depends on: MaterialProperties, Hit/Frame, InteractionSample, LOBE_REFLECTION,
//             PI, TWO_PI, SPECTRUM_ZERO/ONE, ambient_dot, schlick_fresnel (core math).
// The TS twin in ggx.test.ts is the tested ground truth for D/G1/sample/pdf/eval —
// line-for-line transcription, change one change both (§11.3 runs against the twin).

// Local shading frame, n = +z. Frame vectors are orthonormal in the ambient metric, so
// projection goes through ambient_dot (Euclidean unpacks to dot).
vec3 ggx_to_local(Frame f, Point p, Direction v) {
    return vec3(ambient_dot(v, f.t, p), ambient_dot(v, f.b, p), ambient_dot(v, f.n, p));
}
Direction ggx_from_local(Frame f, vec3 v) {
    return normalize(f.t * v.x + f.b * v.y + f.n * v.z);
}

float ggx_D(vec3 h_local, float a) {
    float t = h_local.z * h_local.z * (a * a - 1.0) + 1.0;
    return a * a / (PI * t * t);
}
float ggx_G1(vec3 v_local, float a) {          // Smith, separable
    float c = abs(v_local.z);
    return 2.0 * c / (c + sqrt(a * a + (1.0 - a * a) * c * c));
}

Spectrum ggx_eval(Direction wi, Direction wo, Hit hit, MaterialProperties mp) {
    vec3 wil = ggx_to_local(hit.frame, hit.p, wi);
    vec3 wol = ggx_to_local(hit.frame, hit.p, wo);
    if (wil.z * wol.z <= 0.0) return SPECTRUM_ZERO;         // reflection-only model
    float a = mp.alpha;                                     // derived host-side (D4): max(1e-3, roughness²)
    vec3 h = normalize(wil + wol);
    Spectrum F = schlick_fresnel(mp.f0, abs(dot(wol, h)));
    // bare f (§2.2): D·F·G / (4 cos_i cos_o), NO extra cos_i here
    return F * (ggx_D(h, a) * ggx_G1(wil, a) * ggx_G1(wol, a) / (4.0 * abs(wil.z) * abs(wol.z)));
}

InteractionSample ggx_sample(Direction wo, Hit hit, MaterialProperties mp, float uc, vec2 u) {
    // Single lobe: uc unused (the reflection lobe is certain).
    vec3 wol = ggx_to_local(hit.frame, hit.p, wo);
    float side = wol.z < 0.0 ? -1.0 : 1.0;                  // canonical side (undone at exit)
    wol *= side;
    float a = mp.alpha;                                     // derived host-side (D4)
    // VNDF sampling (Heitz 2018) — sample the visible microfacet distribution:
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
    vec3 h  = normalize(vec3(a * nh.x, a * nh.y, max(1e-6, nh.z)));

    vec3 wil = reflect(-wol, h);
    InteractionSample s;
    if (wil.z <= 0.0) {                                     // reflected below horizon: dead sample
        s.wi = wo; s.weight = SPECTRUM_ZERO; s.pdf = 0.0; s.flags = LOBE_REFLECTION;
        return s;
    }
    Spectrum F = schlick_fresnel(mp.f0, abs(dot(wol, h)));
    // The VNDF elegance: weight = F · G1(wi) exactly (separable Smith) — D, cosines,
    // and the half-vector jacobian all cancel.
    s.weight = F * ggx_G1(wil, a);
    // pdf for MIS: VNDF pdf = G1(wo)·D·|wo·h| / cos_o through the jacobian 1/(4|wo·h|):
    s.pdf    = ggx_G1(wol, a) * ggx_D(h, a) / (4.0 * abs(wol.z));
    s.flags  = LOBE_REFLECTION;
    s.wi     = ggx_from_local(hit.frame, wil * side);       // back to arrival side
    return s;
}

float ggx_pdf(Direction wi, Direction wo, Hit hit, MaterialProperties mp) {
    vec3 wil = ggx_to_local(hit.frame, hit.p, wi);
    vec3 wol = ggx_to_local(hit.frame, hit.p, wo);
    if (wil.z * wol.z <= 0.0) return 0.0;
    float a = mp.alpha;                                     // derived host-side (D4)
    vec3 h = normalize(wil + wol);
    // Side-symmetric by construction (G1 uses |z|, D uses z²) — no canonicalization needed.
    return ggx_G1(wol, a) * ggx_D(h, a) / (4.0 * abs(wol.z));   // MUST match ggx_sample's pdf — §11.3 checks this
}

Spectrum ggx_emission(Direction wo, Hit hit, MaterialProperties mp) {
    return SPECTRUM_ZERO;                                    // conductor: never emits (capability false)
}
