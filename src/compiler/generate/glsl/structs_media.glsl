// Media struct family — included by core iff the program has media (commit D of the
// item-9 split: conditional INCLUSION replaced the HAS_MEDIA preprocessor gate).

// Medium of a region's interior (§3.5) — read via scene_medium_properties(mat, p); p is
// unused-but-present under V1-C1 (homogeneous). Schema-generated struct is the reorg pass.
struct MediumProperties {
    Spectrum sigma_a;   // absorption
    Spectrum sigma_s;   // scattering
    float    phase_g;   // Henyey–Greenstein anisotropy
};

// The volumetric component's segment decision (fable-volumetric-component.md §2/§3) — the
// return of medium_sample. Mirrors the RTE's three segment terms: weight (attenuation of what
// lies beyond), scattered (inscattering event → transport recurses), radiance (source term —
// governed by the partition rule; the accumulate line is capability-gated and NO v1 strategy
// declares it, but every body MUST still assign the field).
struct MediumSample {
    bool     scattered;  // true: real scattering event at t
    float    t;          // event arc length (valid when scattered)
    Spectrum weight;     // throughput factor for WHICHEVER outcome (§2.1)
    Radiance radiance;   // inline source term (SPECTRUM_ZERO for v1 strategies)
};
