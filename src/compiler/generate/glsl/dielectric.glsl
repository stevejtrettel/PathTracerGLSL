// Smooth dielectric BSDF — conforms to §3.2 (transcribed from reference-implementations §2).
// Fields read: mp.transmittance (interface tint; interior absorption is the medium's job, §4.4).
// IORs come from the HIT's regions via ior_of() (§4.1) — media on both sides, not the material.
// Pure delta: eval/pdf return zero (§3.1); transport skips NEE via material_has_nondelta_lobes.
// Provides: fresnel_dielectric(), dielectric_eval/sample/pdf/emission().
// Depends on: ior_of() (generated), MaterialProperties, Hit/Frame, InteractionSample, LOBE_*,
//             SPECTRUM_ZERO/ONE, ambient_dot.

float fresnel_dielectric(float cos_i, float eta) {    // eta = n_i / n_t
    float sin2_t = eta * eta * (1.0 - cos_i * cos_i);
    if (sin2_t >= 1.0) return 1.0;                    // total internal reflection
    float cos_t = sqrt(1.0 - sin2_t);
    float r_par  = (cos_i - eta * cos_t) / (cos_i + eta * cos_t);
    float r_perp = (eta * cos_i - cos_t) / (eta * cos_i + cos_t);
    return 0.5 * (r_par * r_par + r_perp * r_perp);
}

Spectrum dielectric_eval(Direction wi, Direction wo, Hit hit, MaterialProperties mp) { return SPECTRUM_ZERO; } // pure delta
float    dielectric_pdf (Direction wi, Direction wo, Hit hit, MaterialProperties mp) { return 0.0; }
Spectrum dielectric_emission(Direction wo, Hit hit, MaterialProperties mp) { return SPECTRUM_ZERO; }

InteractionSample dielectric_sample(Direction wo, Hit hit, MaterialProperties mp, float uc, vec2 u) {
    // Media on both sides come from the HIT (§4.1), not from the material:
    float n_i = ior_of(hit.region_from);
    float n_t = ior_of(hit.region_to);
    float eta = n_i / n_t;

    Direction n = hit.frame.n;                        // oriented toward region_from (§4.1)
    float cos_i = clamp(ambient_dot(wo, n, hit.p), 1e-6, 1.0);   // > 0 by orientation; clamped at grazing

    float F = fresnel_dielectric(cos_i, eta);

    InteractionSample s;
    if (uc < F) {
        // Reflection branch — TIR is not a special case: it is this branch with F = 1.
        s.wi     = normalize(2.0 * cos_i * n - wo);
        s.weight = SPECTRUM_ONE;                      // F / P(reflect = F) = 1 — exact (§2.1)
        s.pdf    = 0.0;
        s.flags  = LOBE_REFLECTION | LOBE_DELTA;
    } else {
        // Transmission branch.
        float sin2_t = eta * eta * (1.0 - cos_i * cos_i);
        float cos_t  = sqrt(max(0.0, 1.0 - sin2_t));  // sin2_t < 1 guaranteed (else F was 1)
        s.wi     = normalize(-eta * wo + (eta * cos_i - cos_t) * n);

        // THE η² FACTOR — do not omit. Radiance compresses by (n_t/n_i)² crossing into a denser
        // medium; camera paths transport radiance backwards, so throughput carries (n_i/n_t)².
        // The factor cancels on enter+exit round trips — which is why omitting it "looks fine"
        // until a path terminates inside the medium (emitter in glass, camera underwater) and the
        // brightness is silently wrong. F-ETA is the witness: 0.554 correct vs 0.980 without.
        float radiance_scale = (n_i * n_i) / (n_t * n_t);
        s.weight = mp.transmittance * radiance_scale; // (1−F)/P(transmit = 1−F) = 1, × scale & tint
        s.pdf    = 0.0;
        s.flags  = LOBE_TRANSMISSION | LOBE_DELTA;
    }
    return s;
}
