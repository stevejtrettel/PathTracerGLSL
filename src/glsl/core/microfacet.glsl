// Microfacet distribution machinery — the FIXED stdlib every microfacet model is written
// against (fable-rough-dielectric §4). The MODEL is swappable (ggx conductor, rough
// dielectric, and sheen, which reads only the frame maps, live behind the materials
// registry); the DISTRIBUTION is not — D, Smith G₁ and VNDF sampling are one truth here,
// so a program containing any one microfacet occupant links them exactly once and a
// rough-glass-only scene needs no conductor.
// Included when some present material model declares `microfacet` (the math_media
// pattern: conditional core, never wholesale).
// Provides: microfacet_D(), microfacet_G1(), microfacet_sample_vndf(),
//           microfacet_to_local(), microfacet_from_local(), and the F-free reflection lobe
//           microfacet_reflect_eval(), microfacet_reflect_pdf(), microfacet_reflect_sample().
// Depends on: PI, TWO_PI (math), Frame/Point/Direction/Hit (structs), ambient_dot/ambient_normalize.
//
// Convention (shared by every occupant): the local shading frame has n = +z, `a` is the
// GGX roughness parameter α = roughness² clamped ≥ 1e-3 (the derived field mp.alpha,
// assigned by the material lookup; letting α → 0 produces fireflies,
// not a mirror: author true specular as a delta model).
// The TS twin in components/materials/microfacetTwin.ts is the tested ground truth for D/G1/sample
// and the reflection lobe — line-for-line transcription, change one change both (§11.3 runs
// against it from each model's twin test).

// Local shading frame, n = +z. Frame vectors are orthonormal in the ambient metric, so
// projection goes through ambient_dot and the recombined world vector is normalized in the
// metric at the frame's point (Euclidean unpacks to dot and normalize).
vec3 microfacet_to_local(Frame f, Point p, Direction v) {
    return vec3(ambient_dot(v, f.t, p), ambient_dot(v, f.b, p), ambient_dot(v, f.n, p));
}
Direction microfacet_from_local(Frame f, vec3 v) {
    return ambient_normalize(f.t * v.x + f.b * v.y + f.n * v.z, f.p);
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

// The F-free GGX reflection lobe. A reflection-only microfacet model (the conductor) is this
// lobe times its Fresnel term F(cos_h), times an energy gain read at cos_o; the lobe carries
// everything else: D·G₁·G₁/(4|cos θᵢ||cos θₒ|), the VNDF weight G₁(ωᵢ), the pdf and the
// horizon test. cos_h = |ωₒ·h| and cos_o = |cos θₒ|. World directions in, world direction out.

// f/F, the bare BRDF without its Fresnel term (no cos θᵢ). Returns 0 when wi and wo lie on
// opposite sides (reflection only) and then leaves cos_h and cos_o unset: the caller returns
// zero before reading them.
float microfacet_reflect_eval(Direction wi, Direction wo, Hit hit, float a, out float cos_h, out float cos_o) {
    vec3 wil = microfacet_to_local(hit.frame, hit.p, wi);
    vec3 wol = microfacet_to_local(hit.frame, hit.p, wo);
    if (wil.z * wol.z <= 0.0) return 0.0;
    vec3 h = normalize(wil + wol);
    cos_h = abs(dot(wol, h));
    cos_o = abs(wol.z);
    return microfacet_D(h, a) * microfacet_G1(wil, a) * microfacet_G1(wol, a) / (4.0 * abs(wil.z) * abs(wol.z));
}

// Solid-angle pdf of microfacet_reflect_sample: the VNDF pdf G₁(ωₒ)·D·|ωₒ·h|/|cos θₒ| through
// the reflection jacobian 1/(4|ωₒ·h|). Side-symmetric (G₁ reads |z|, D reads z²).
float microfacet_reflect_pdf(Direction wi, Direction wo, Hit hit, float a) {
    vec3 wil = microfacet_to_local(hit.frame, hit.p, wi);
    vec3 wol = microfacet_to_local(hit.frame, hit.p, wo);
    if (wil.z * wol.z <= 0.0) return 0.0;
    vec3 h = normalize(wil + wol);
    return microfacet_G1(wol, a) * microfacet_D(h, a) / (4.0 * abs(wol.z));
}

// One VNDF sample of the lobe. weight = G₁(ωᵢ) is f·|cos θᵢ|/pdf without F: D, both cosines and
// the jacobian cancel. A direction reflected below the horizon is a dead sample: wi = wo,
// weight 0, pdf 0, with cos_h and cos_o still finite, so the caller's F·weight·gain is 0.
struct MicrofacetReflectSample {
    Direction wi;       // on wo's side
    float weight;       // G₁(ωᵢ)
    float pdf;          // solid angle, equal to microfacet_reflect_pdf(wi, wo)
    float cos_h;        // |ωₒ·h|, the Fresnel argument
    float cos_o;        // |cos θₒ|, the energy-gain argument
};

MicrofacetReflectSample microfacet_reflect_sample(Direction wo, Hit hit, float a, vec2 u) {
    vec3 wol = microfacet_to_local(hit.frame, hit.p, wo);
    float side = wol.z < 0.0 ? -1.0 : 1.0;                  // canonical side, undone at exit
    wol *= side;
    vec3 h = microfacet_sample_vndf(wol, a, u);
    vec3 wil = reflect(-wol, h);
    MicrofacetReflectSample s;
    s.cos_h = abs(dot(wol, h));
    s.cos_o = wol.z;
    if (wil.z <= 0.0) {
        s.wi = wo; s.weight = 0.0; s.pdf = 0.0;
        return s;
    }
    s.weight = microfacet_G1(wil, a);
    s.pdf    = microfacet_G1(wol, a) * microfacet_D(h, a) / (4.0 * abs(wol.z));
    s.wi     = microfacet_from_local(hit.frame, wil * side);
    return s;
}
