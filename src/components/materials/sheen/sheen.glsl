// Sheen: OpenPBR's fuzz layer over a Lambertian base, the fuzz lobe being Zeltner, Burley and
// Chiang's linearly transformed cosine (transcribed from MaterialX mx_microfacet_sheen.glsl).
// The math, the energy identity and the non-reciprocity are in sheen.md; sheen.test.ts is the
// TS twin (change one, change both).
// Fields read: mp.albedo (ρ, the base), mp.sheen_color (c), mp.sheen_weight (W), mp.sheen_r
// (the fits' roughness: sheen_roughness clamped to [0.01, 1], a derived field).
// The model, with μ_o = cos θ_o and p = W·E(μ_o) the fuzz lobe's share:
//   f = c·p·D/μ_i + (1 − p)·ρ/π,
// D a normalized density on the hemisphere and E the fit to the fuzz's directional albedo.
// Write g = π·D/μ_i (the fuzz density over the cosine density). Then f = (c·p·g + ρ(1 − p))/π;
// the sampler draws the fuzz lobe with probability p and the cosine lobe otherwise, so
// pdf = μ_i·(p·g + 1 − p)/π and the weight is (c·p·g + ρ(1 − p))/(p·g + 1 − p), which is ρ
// when c = ρ.
// All lobe math is in the local frame on wo's side (n = +z); D depends on wi only through its
// azimuth relative to wo's, so the tangent frame's orientation does not matter.
// Provides: sheen_eval(), sheen_sample(), sheen_pdf(), sheen_emission().
// Depends on: microfacet_to_local/microfacet_from_local (core), MaterialProperties, Hit/Frame,
//             InteractionSample, LOBE_REFLECTION, PI, TWO_PI, SPECTRUM_ZERO.

// E(μ_o, r), the fuzz lobe's directional albedo: MaterialX's Gaussian fit, clamped into [0, 1]
// (the fit dips to −2e-5 near r = 0.05; its maximum is 0.745).
float sheen_E(float mu, float r) {
    float s = r * (0.0206607 + 1.58491 * r) / (0.0379424 + r * (1.32227 + r));
    float m = r * (-0.193854 + r * (-1.14885 + r * (1.7932 - 0.95943 * r * r))) / (0.046391 + r);
    float o = r * (0.000654023 + (-0.0207818 + 0.119681 * r) * r) / (1.26264 + r * (-1.92021 + r));
    float d = (mu - m) / s;
    return clamp(exp(-0.5 * d * d) / (s * sqrt(TWO_PI)) + o, 0.0, 1.0);
}

// The inverse LTC matrix M⁻¹ = [[a⁻¹, 0, b⁻¹], [0, a⁻¹, 0], [0, 0, 1]] (rational fits).
float sheen_ainv(float mu, float r) {
    return (2.58126 * mu + 0.813703 * r) * r / (1.0 + 0.310327 * mu * mu + 2.60994 * mu * r);
}
float sheen_binv(float mu, float r) {
    return sqrt(1.0 - mu) * (r - 1.0) * r * r * r / (0.0000254053 + 1.71228 * mu - 1.71506 * mu * r + 1.34174 * r * r);
}

// The fuzz lobe at one wo (local, upper side). az = (cos φ_o, sin φ_o): the LTC frame is the
// local frame turned about n so that wo lies in its +x half of the xz plane; when wo is the
// normal any azimuth will do, since b⁻¹ = 0 there and the lobe is round. μ_o is clamped away
// from 0 as MaterialX does.
struct SheenLobe { vec2 az; float a; float b; float p; };

SheenLobe sheen_lobe(vec3 wol, MaterialProperties mp) {
    float mu_o = clamp(wol.z, 1e-6, 1.0);
    float l2 = wol.x * wol.x + wol.y * wol.y;
    SheenLobe l;
    l.az = l2 > 0.0 ? vec2(wol.x, wol.y) * inversesqrt(l2) : vec2(1.0, 0.0);
    l.a  = sheen_ainv(mu_o, mp.sheen_r);
    l.b  = sheen_binv(mu_o, mp.sheen_r);
    l.p  = mp.sheen_weight * sheen_E(mu_o, mp.sheen_r);
    return l;
}

// g = π·D/μ_i at wil (local, upper side): with w the LTC-frame coordinates of wil and
// w' = M⁻¹·w, D = (w_z/π)·(a⁻¹/|w'|²)², so g = (a⁻¹/|w'|²)².
float sheen_ratio(vec3 wil, SheenLobe l) {
    vec3 w = vec3(l.az.x * wil.x + l.az.y * wil.y, -l.az.y * wil.x + l.az.x * wil.y, wil.z);
    vec3 o = vec3(l.a * w.x + l.b * w.z, l.a * w.y, w.z);
    float k = l.a / dot(o, o);
    return k * k;
}

Spectrum sheen_eval(Direction wi, Direction wo, Hit hit, MaterialProperties mp) {
    // bare f (no cosine); reflection only, on wo's side.
    vec3 wil = microfacet_to_local(hit.frame, hit.p, wi);
    vec3 wol = microfacet_to_local(hit.frame, hit.p, wo);
    if (wil.z * wol.z <= 0.0) return SPECTRUM_ZERO;
    float side = wol.z < 0.0 ? -1.0 : 1.0;
    wil *= side;
    wol *= side;
    SheenLobe l = sheen_lobe(wol, mp);
    float x = l.p * sheen_ratio(wil, l);
    return (mp.sheen_color * x + mp.albedo * (1.0 - l.p)) * (1.0 / PI);
}

InteractionSample sheen_sample(Direction wo, Hit hit, MaterialProperties mp, float uc, vec2 u) {
    // uc picks the lobe; u draws a cosine-distributed direction, which the fuzz lobe maps
    // through M = (M⁻¹)⁻¹ and turns by φ_o.
    vec3 wol = microfacet_to_local(hit.frame, hit.p, wo);
    float side = wol.z < 0.0 ? -1.0 : 1.0;                  // canonical side (undone at exit)
    wol *= side;
    SheenLobe l = sheen_lobe(wol, mp);
    float cos_t = sqrt(u.y);
    float sin_t = sqrt(max(0.0, 1.0 - u.y));
    float phi = TWO_PI * u.x;
    vec3 wil = vec3(sin_t * cos(phi), sin_t * sin(phi), cos_t);
    if (uc < l.p) {
        vec3 w = normalize(vec3((wil.x - wil.z * l.b) / l.a, wil.y / l.a, wil.z));
        wil = vec3(l.az.x * w.x - l.az.y * w.y, l.az.y * w.x + l.az.x * w.y, w.z);
    }
    // The mixture's value at the drawn direction, whichever lobe drew it. x + y ≥ 1 − p > 0.25.
    float x = l.p * sheen_ratio(wil, l);
    float y = 1.0 - l.p;
    InteractionSample s;
    s.wi     = microfacet_from_local(hit.frame, wil * side);
    s.weight = (mp.sheen_color * x + mp.albedo * y) / (x + y);   // f·cos/pdf
    s.pdf    = wil.z * (x + y) * (1.0 / PI);
    s.flags  = LOBE_REFLECTION;
    return s;
}

float sheen_pdf(Direction wi, Direction wo, Hit hit, MaterialProperties mp) {
    vec3 wil = microfacet_to_local(hit.frame, hit.p, wi);
    vec3 wol = microfacet_to_local(hit.frame, hit.p, wo);
    if (wil.z * wol.z <= 0.0) return 0.0;
    float side = wol.z < 0.0 ? -1.0 : 1.0;
    wil *= side;
    wol *= side;
    SheenLobe l = sheen_lobe(wol, mp);
    return wil.z * (l.p * sheen_ratio(wil, l) + 1.0 - l.p) * (1.0 / PI);   // MUST match sheen_sample's pdf
}

Spectrum sheen_emission(Direction wo, Hit hit, MaterialProperties mp) {
    return SPECTRUM_ZERO;
}
