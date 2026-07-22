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
    bool     deflected;  // true: GRIN — the ray bent out of the region (fable-variable-ior);
                         // exit_p/exit_dir are the bent continuation. Every arm assigns it.
    float    t;          // event arc length (valid when scattered)
    Spectrum weight;     // throughput factor for WHICHEVER outcome (§2.1)
    Radiance radiance;   // inline source term (§3 partition rule) — the emission arms
                         // fill it (impl-plan-medium-emission); ZERO in non-emissive arms
    Point     exit_p;    // THE EVENT RAY's position: scatter event (valid iff scattered — every
                         // scattering arm fills it; a bent event is not recomputable from
                         // (origin, dir, t)) or the GRIN bent-exit handoff (valid iff deflected)
    Direction exit_dir;  // THE EVENT RAY's direction: incident unit direction at the scatter
                         // event, or the bent-exit unit direction (same validity as exit_p)
    float    eta_scale;  // RR-metric compensation for whatever η² compression the arm folded
                         // into `weight` (impl-plan-grin-interface: the GRIN arm's interior
                         // L/n² factor, mirroring the surface transmission site's bookkeeping).
                         // 1.0 in every non-deflecting arm. Every arm assigns it.
};
