// Media struct family — included by core iff the program has media (commit D of the
// item-9 split: conditional INCLUSION replaced the HAS_MEDIA preprocessor gate).

// MediumProperties is GENERATED per scene (§3.4/§3.5): RTE extinction fields + the
// phase-model schemas (see generate/schema.ts) — emitted as the preceding block.

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
