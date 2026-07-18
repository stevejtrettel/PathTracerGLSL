// delta_tracking.glsl — the heterogeneous-media null-collision bodies
// (fable-heterogeneous-media.md §3, as amended Jul 17 2026: transcribe-with-lottery).
//
// NORMATIVE SOURCE (transcribed, NOT re-derived): Kutz, Habel, Li, Novák 2017,
// "Spectral and Decomposition Tracking for Rendering Heterogeneous Volumes",
// TOG 36(4) — Algorithm 4 (spectral tracking) with the history-aware AVERAGE-based
// collision probabilities (Eq. 30–33; the paper's recommended variant, Fig. 10b:
// bounds path throughput, firefly-immune) and the local-weight identity
// w_star = mu_star / (mu_bar · P_star) (Eq. 15–16). Cross-checked against pbrt-v4
// (SampleT_maj, the VolPathIntegrator collision branches, SampleLd's ratio tracking).
//
// Deviations — declared-and-inert facts ONLY (full table: impl-plan-heterogeneous-media.md):
//   1. The absorption branch is a pure TERMINATOR (weight 0). Emission is NOT collected
//      there — it accumulates per tentative collision, pre-lottery, via the generated
//      medium_emission() accessor (impl-plan-medium-emission P3: with a scalar majorant
//      pbrt's per-collision emission term collapses to w ⊙ ε/σ̄; the two track-length
//      derivations live in that plan and are gated by the EMIT witnesses).
//   2. The papers' |·| guards negative sigma_n under non-bounding majorants; by D1
//      (the medium IS the ceiling-clamped field, applied inside scene_medium_properties)
//      sigma_t <= sigma_bar so sigma_n >= 0 — the max(…, 0.0) below is fp-safety only.
//   3. Scalar sigma_bar (v1) makes the majorant transmittance achromatic: pbrt's
//      per-channel T_maj normalizations collapse to 1 exactly (transmitted weight = the
//      accumulated w-hat; ratio update = sigma_n / sigma_bar).
//   Kutz §5.1.3 (P_a = 0 for non-emissive media) is the paper's own variance option
//   inside this same structure — noted, NOT enabled (owner decision: full lottery).
//
// EUCLIDEAN: p(t) = origin + t·dir is extrinsic, like the analytic bodies.
// RNG: xi carries the leading stratified draws (first jump, first lottery); the loop
// tail draws from the stream (random()) — the equiangular precedent (volumetric §2).
// Budget: MAX_NULL_COLLISIONS (numeric knob, pin 64) — exhaustion is a conservative
// pass-through with the accumulated weight, a declared truncation like MAX_SHADOW_SEGMENTS.
// Depends on: scene_medium_properties (generated, returns the EFFECTIVE clamped field),
// medium_emission (generated: ε or the folded ZERO), random (sampler), structs_media
// (MediumSample), spectrum_* (core math).

// Seam-1 delta-tracking arm (heterogeneous scattering media): Kutz Algorithm 4 on the
// segment [0, t_max]. Scattered-at-t or transmitted, per-channel weight — the walk
// cannot tell this arm from the analytic one.
MediumSample medium_sample_delta(int med, float sigma_bar, Ray ray, float t_max, vec2 xi) {
    MediumSample ms;
    ms.scattered = false;
    ms.t = t_max;
    ms.weight = SPECTRUM_ONE;
    ms.radiance = SPECTRUM_ZERO;

    Spectrum w = SPECTRUM_ONE;
    float t = 0.0;
    float xi_dist = xi.x;
    float xi_evt = xi.y;
    for (int i = 0; i < MAX_NULL_COLLISIONS; i++) {
        t += -log(1.0 - xi_dist) / sigma_bar;
        if (t >= t_max) {                      // transmitted (deviation 3: residual = 1)
            ms.weight = w;
            return ms;
        }
        Point p = ray.origin + t * ray.direction;
        MediumProperties m = scene_medium_properties(med, p);
        Spectrum sigma_n = max(Spectrum(sigma_bar) - (m.sigma_a + m.sigma_s), 0.0);

        // Emission (impl-plan-medium-emission P3): per-tentative-collision track-length
        // collection, PRE-lottery (the final real collision collects too):
        //   E[Σ_i w_i · ε(x_i)/σ̄] = ∫ T·ε ds.  medium_emission() is generated — ε when
        // emissive media exist, the folded constant ZERO otherwise.
        ms.radiance += w * medium_emission(m) / sigma_bar;

        // History-aware average-based probabilities (Eq. 30–33; the history is this
        // tracker's own accumulated w-hat, per Algorithm 4's subpath definition).
        float pa = spectrum_average(m.sigma_a * w);
        float ps = spectrum_average(m.sigma_s * w);
        float pn = spectrum_average(sigma_n * w);
        float c = pa + ps + pn;
        if (c <= 0.0) {                        // w reached exact zero: dead path
            ms.weight = SPECTRUM_ZERO;
            return ms;
        }
        pa /= c; ps /= c; pn /= c;

        if (xi_evt < pa) {
            // Absorption/emission (Alg. 4 line 6). Deviation 1: v1 media don't emit —
            // the path dies; when fire arrives, Le lands in ms.radiance RIGHT HERE with
            // weight w * m.sigma_a / (sigma_bar * pa).
            ms.weight = SPECTRUM_ZERO;
            return ms;
        } else if (xi_evt < pa + ps) {
            // Real scatter (Alg. 4 line 8): w ⊙ sigma_s / (sigma_bar · P_s).
            ms.scattered = true;
            ms.t = t;
            ms.weight = w * m.sigma_s / (sigma_bar * max(ps, 1e-20));
            return ms;
        }
        // Null collision (Alg. 4 line 11): w ⊙ sigma_n / (sigma_bar · P_n); keep flying.
        w *= sigma_n / (sigma_bar * max(pn, 1e-20));
        xi_dist = random();
        xi_evt = random();
    }
    ms.weight = w;                             // budget exhausted: conservative pass-through
    return ms;
}

// Seam-1 ratio-tracked pass-through arm (heterogeneous ABSORBING-ONLY media — amended
// D2, the fourth dispatch quadrant): ratio tracking (Novák et al. 2014) of
// exp(-∫ sigma_a), the heterogeneous analog of the deterministic Beer–Lambert arm.
// Always reaches the boundary; the weight is the transmittance estimate. sigma_a here
// is already the EFFECTIVE (D1-clamped) field, so sigma_bar bounds it.
MediumSample medium_sample_ratio_absorb(int med, float sigma_bar, Ray ray, float t_max) {
    MediumSample ms;
    ms.scattered = false;
    ms.t = t_max;
    ms.radiance = SPECTRUM_ZERO;

    Spectrum T = SPECTRUM_ONE;
    float t = 0.0;
    for (int i = 0; i < MAX_NULL_COLLISIONS; i++) {
        t += -log(1.0 - random()) / sigma_bar;
        if (t >= t_max) break;
        Point p = ray.origin + t * ray.direction;
        MediumProperties m = scene_medium_properties(med, p);
        // Emission (P3, ratio-arm sibling): collected with the PRE-update T — the
        // weight of collisions prior. E[Σ_i T_i · ε(x_i)/σ̄] = ∫ T·ε ds.
        ms.radiance += T * medium_emission(m) / sigma_bar;
        T *= max(Spectrum(sigma_bar) - m.sigma_a, 0.0) / sigma_bar;
    }
    ms.weight = T;                             // exhaustion falls through: conservative
    return ms;
}

// Seam-2 ratio-tracking arm: transmittance over FULL sigma_t (absorption + out-scatter,
// the same shadow convention as the analytic form). NO emission here — shadow rays
// carry transmittance only (the emission integral belongs to the camera path). pbrt-v4 SampleLd verbatim under a
// scalar majorant: T_ray *= T_maj·sigma_n/pdf with pdf = T_maj[0]·sigma_maj[0]
// collapses to T ⊙= sigma_n/sigma_bar (deviation 3). pbrt's Russian-roulette
// termination is transcribed with it: the trigger (max channel < 0.05) is a heuristic,
// the compensation (q = 0.75, survive ⇒ /(1−q)) is exact — unbiased either way.
Spectrum medium_transmittance_ratio(int med, float sigma_bar, Ray ray, float len) {
    Spectrum T = SPECTRUM_ONE;
    float t = 0.0;
    for (int i = 0; i < MAX_NULL_COLLISIONS; i++) {
        t += -log(1.0 - random()) / sigma_bar;
        if (t >= len) return T;
        Point p = ray.origin + t * ray.direction;
        MediumProperties m = scene_medium_properties(med, p);
        T *= max(Spectrum(sigma_bar) - (m.sigma_a + m.sigma_s), 0.0) / sigma_bar;
        if (spectrum_max(T) < 0.05) {
            if (random() < 0.75) return SPECTRUM_ZERO;
            T /= 0.25;
        }
    }
    return T;                                  // budget exhausted: conservative
}
