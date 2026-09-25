// Rough dielectric — the two-lobe microfacet BSDF (Walter 2007 / pbrt-v4 §9.7),
// transcribed in reference-implementations §7b. Design authority:
// docs/fable-rough-dielectric.md.
//
// The FIRST model that is transmissive AND non-delta: it runs NEE, so its support fact
// (`support: 'sphere'`) disarms the light tree's below-horizon cull through the
// generated two-sided light query (§3.1/§3.3). Everything else downstream keys on
// LOBE_TRANSMISSION alone — the walk's current_medium switch, the eta_scale
// accumulation, ray_spawn's far-side escape — so transport needs no arm for this model.
//
// Two house conventions simplify the transcription and must not be "fixed" back toward
// pbrt: (1) hit.frame.n is oriented toward region_from (§4.1), so wo is ALWAYS in the
// upper hemisphere — pbrt's cosTheta_o < 0 side flip has no analogue; (2) IORs come
// from the HIT's regions via ior_of (§4.1), and our eta = n_i/n_t is pbrt's 1/etap, so
// pbrt's `ft /= Sqr(etap)` IS our × eta² — the same η² radiance-compression factor the
// smooth dielectric carries (F-ETA is the witness that catches a divergence).
//
// Smith masking is SEPARABLE (G = G1(wo)·G1(wi)), which collapses both sampling weights:
// the reflection lobe's F cancels against the lobe probability F, the transmission
// lobe's (1−F) against (1−F), leaving G1(wi) [× eta² × tint]. If a future edit needs the
// full f·|cos|/pdf quotient at the sampling site, something has drifted.
//
// Fields read: mp.alpha (D4 derived host-side: max(1e-3, roughness²) — the α floor is
// the house convention; author true smooth glass as `dielectric`, since a runtime
// delta flip would break the compile-time NEE guard), mp.transmittance (interface tint;
// interior absorption is the medium's job, §4.4). ior is region-indexed.
// Provides: rough_dielectric_eval/sample/pdf/emission().
// Depends on: ior_of() (generated), microfacet_* (core), dielectric_fresnel() (core
//             math), MaterialProperties, Hit/Frame, InteractionSample, LOBE_*,
//             SPECTRUM_ZERO/ONE, ambient_dot.
// The TS twin in rough_dielectric.test.ts is the tested ground truth (§11.3): χ² over
// both lobes, the weight·pdf ≈ eval·|cos| triple on both sides, η²-aware reciprocity.

// Generalized half-direction (pbrt-v4 §9.7): m ∝ wi·etap + wo, faced into the upper
// hemisphere. Returns false when the pair is degenerate or the microfacet is backfacing
// — the shared prologue of eval and pdf, so the two can never disagree about geometry.
bool rough_dielectric_half(vec3 wil, vec3 wol, float eta, out vec3 m) {
    float etap = wil.z > 0.0 ? 1.0 : 1.0 / eta;   // reflection: 1; transmission: n_t/n_i
    m = wil * etap + wol;
    if (dot(m, m) <= 0.0) return false;
    m = normalize(m);
    if (m.z < 0.0) m = -m;
    return dot(m, wil) * wil.z >= 0.0 && dot(m, wol) * wol.z >= 0.0;
}

Spectrum rough_dielectric_eval(Direction wi, Direction wo, Hit hit, MaterialProperties mp) {
    vec3 wil = microfacet_to_local(hit.frame, hit.p, wi);
    vec3 wol = microfacet_to_local(hit.frame, hit.p, wo);
    if (wol.z <= 0.0 || wil.z == 0.0) return SPECTRUM_ZERO;   // grazing/degenerate
    float eta = ior_of(hit.region_from, hit.p) / ior_of(hit.region_to, hit.p);
    if (eta == 1.0) return SPECTRUM_ZERO;   // index-matched: pure delta pass-through (see sample)
    vec3 m;
    if (!rough_dielectric_half(wil, wol, eta, m)) return SPECTRUM_ZERO;

    float a = mp.alpha;
    float cos_om = clamp(abs(dot(wol, m)), 1e-6, 1.0);
    float F = dielectric_fresnel(cos_om, eta);
    float DG = microfacet_D(m, a) * microfacet_G1(wol, a) * microfacet_G1(wil, a);

    if (wil.z > 0.0) {   // reflection lobe — bare f (§2.2), no cosine here
        return SPECTRUM_ONE * (DG * F / (4.0 * wil.z * wol.z));
    }
    // Transmission lobe (Walter Eq. 21): the change-of-variables denominator, then the
    // η² radiance compression. eta = 1/etap, so (wo·m)/etap = (wo·m)·eta.
    float denom = dot(wil, m) + dot(wol, m) * eta;
    denom *= denom;
    float ft = DG * (1.0 - F) * abs(dot(wil, m) * dot(wol, m) / (wil.z * wol.z * denom));
    return mp.transmittance * (ft * eta * eta);
}

InteractionSample rough_dielectric_sample(Direction wo, Hit hit, MaterialProperties mp, float uc, vec2 u) {
    vec3 wol = microfacet_to_local(hit.frame, hit.p, wo);
    InteractionSample s;
    s.wi = wo; s.weight = SPECTRUM_ZERO; s.pdf = 0.0; s.flags = LOBE_REFLECTION;
    if (wol.z <= 0.0) return s;                       // grazing: the contract's boundary case

    float a = mp.alpha;
    // Media on both sides come from the HIT (§4.1). The point argument is the
    // GRIN-interface unification: a deflecting region answers with its n(x) AT THE WALL.
    float n_i = ior_of(hit.region_from, hit.p);
    float n_t = ior_of(hit.region_to, hit.p);
    float eta = n_i / n_t;

    // Index-matched interface (η = 1, e.g. both sides of a thin sheet, or glass inside
    // glass of the same index): F = 0 and every microfacet refracts wo straight through,
    // so the BSDF collapses to the DELTA pass-through wi = −wo. The microfacet branch below
    // would produce that direction with an infinite pdf — the Jacobian's denominator
    // (wi·m + η wo·m)² is exactly 0 — which becomes NaN in the MIS weight. eval and pdf
    // return 0 at η = 1 (mathematically they are 0 anyway: F = 0 kills reflection and the
    // half-vector test rejects every transmitted pair; the explicit early return removes
    // the fp residue of F), so the delta sample is the whole BSDF. pbrt-v4 does the same.
    if (eta == 1.0) {
        s.wi = -wo;
        s.weight = mp.transmittance;                  // T = 1 − F = 1, and η² = 1
        s.pdf = 0.0;                                  // delta convention (interaction.glsl)
        s.flags = LOBE_TRANSMISSION | LOBE_DELTA;
        return s;
    }

    vec3 m = microfacet_sample_vndf(wol, a, u);       // visible microfacet normal (Heitz 2018)
    float cos_om = clamp(dot(wol, m), 1e-6, 1.0);
    float F = dielectric_fresnel(cos_om, eta);        // TIR is not a special case: it is F = 1

    vec3 wil;
    if (uc < F) {
        wil = reflect(-wol, m);
        if (wil.z <= 0.0) return s;                   // reflected below the horizon: dead sample
        s.weight = SPECTRUM_ONE * microfacet_G1(wil, a);   // F cancels against P(reflect) = F
        s.pdf    = F * microfacet_G1(wol, a) * microfacet_D(m, a) / (4.0 * wol.z);
        s.flags  = LOBE_REFLECTION;
    } else {
        float sin2_t = eta * eta * (1.0 - cos_om * cos_om);
        float cos_t  = sqrt(max(0.0, 1.0 - sin2_t));  // sin2_t < 1 guaranteed (else F was 1)
        wil = normalize(-eta * wol + (eta * cos_om - cos_t) * m);
        if (wil.z >= 0.0) return s;                   // failed to cross: dead sample
        float denom = dot(wil, m) + dot(wol, m) * eta;
        denom *= denom;
        // THE η² FACTOR (eta² = 1/etap²) — do not omit. Radiance compresses by (n_t/n_i)²
        // crossing into a denser medium; camera paths transport backwards, so throughput
        // carries (n_i/n_t)². It cancels on enter+exit round trips, which is why omitting
        // it "looks fine" until a path terminates inside the medium. F-ETA: 0.554 vs 0.980.
        s.weight = mp.transmittance * (microfacet_G1(wil, a) * eta * eta);
        s.pdf    = (1.0 - F) * microfacet_G1(wol, a) * microfacet_D(m, a) * cos_om / wol.z
                 * abs(dot(wil, m)) / denom;          // VNDF density × dwm_dwi
        s.flags  = LOBE_TRANSMISSION;                 // NO LOBE_DELTA — the first such sample
    }
    s.wi = microfacet_from_local(hit.frame, wil);
    return s;
}

float rough_dielectric_pdf(Direction wi, Direction wo, Hit hit, MaterialProperties mp) {
    vec3 wil = microfacet_to_local(hit.frame, hit.p, wi);
    vec3 wol = microfacet_to_local(hit.frame, hit.p, wo);
    if (wol.z <= 0.0 || wil.z == 0.0) return 0.0;
    float eta = ior_of(hit.region_from, hit.p) / ior_of(hit.region_to, hit.p);
    if (eta == 1.0) return 0.0;             // index-matched: pure delta pass-through (see sample)
    vec3 m;
    if (!rough_dielectric_half(wil, wol, eta, m)) return 0.0;

    float a = mp.alpha;
    float cos_om = clamp(abs(dot(wol, m)), 1e-6, 1.0);
    float F = dielectric_fresnel(cos_om, eta);
    // wi's SIDE decides which lobe could have produced it — the two densities never sum
    // at a single wi. MUST match rough_dielectric_sample's pdf (§11.3 checks this).
    if (wil.z > 0.0) return F * microfacet_G1(wol, a) * microfacet_D(m, a) / (4.0 * wol.z);
    float denom = dot(wil, m) + dot(wol, m) * eta;
    denom *= denom;
    return (1.0 - F) * microfacet_G1(wol, a) * microfacet_D(m, a) * cos_om / wol.z
         * abs(dot(wil, m)) / denom;
}

Spectrum rough_dielectric_emission(Direction wo, Hit hit, MaterialProperties mp) {
    return SPECTRUM_ZERO;                             // never emits (capability false)
}
