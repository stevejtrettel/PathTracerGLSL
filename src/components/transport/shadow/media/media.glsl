// Shadow transmittance — media form (§6.3; emitted INSTEAD of shadow_opaque when the scene
// has media + NEE; the NEE call sites never change). Segment-walk by RE-SPAWN
// (impl-plan-media deviation 1: the reference's t-windowed scene_intersect_from predates the
// trace-loop contract — same segments, pinned signatures only).
// Per segment: closed-form Beer–Lambert over full σ_t via medium_transmittance (generated,
// seam 2). Null interfaces pass; EVERYTHING else — opaque and dielectric alike — blocks
// (§6.3 v1 policy; transparent shadows are §10.2). Segment budget exhaustion is conservative
// (ZERO). Depends on: scene_intersect/scene_region_at (intersection), material_of,
// material_has_medium/is_null_interface/medium_transmittance (materials), ray_spawn (core),
// MAX_SHADOW_SEGMENTS (define, pin: 8).
//
// The stop bound is the LIGHT POINT, not a scalar distance (trace-loop-contract: a shadow ray
// is defined by its destination). Each segment re-derives the SHADOW_BACKOFF against the
// FIXED light_p — pbrt's SpawnRayTo discipline — so the back-off can never be eroded by the
// ray_spawn offsets that accumulate across null-interface crossings. A decremented `remaining`
// (the earlier form) drifted by one spawn offset per crossing, and after ≥2 crossings the drift
// exceeded the back-off, letting the AREA LIGHT'S OWN surface block the shadow ray → NEE went
// dark through any bounded medium. (length() is Euclidean; a geodesic-distance ambient helper
// is the curved-space follow-up, like the straight-ray march itself.)

Spectrum shadow_transmittance(Ray shadow_ray, Point light_p) {
    Spectrum T = SPECTRUM_ONE;
    // Starting medium recovered from the §4.4 containment oracle — self-contained
    // (works from surface points and medium event points alike).
    int medium = scene_region_at(shadow_ray.origin);
    Ray seg_ray = shadow_ray;

    for (int seg = 0; seg < MAX_SHADOW_SEGMENTS; seg++) {
        // Distance to the light re-derived from the fixed target — drift-free by construction.
        float remaining = length(light_p - seg_ray.origin) - SHADOW_BACKOFF;
        // ARRIVED, never a negative segment (rider, impl-plan-epsilon-discipline): a medium
        // EVENT origin is unfloored and can sit within the back-off of the light; a negative
        // remaining fed medium_transmittance an exp(+σ·|len|) — energy amplified, a firefly.
        if (remaining <= 0.0) return T;
        Hit h;
        bool hit_boundary = scene_intersect(seg_ray, h) && h.t < remaining;
        float seg_len = hit_boundary ? h.t : remaining;

        int med_mat = material_of(medium);
        if (material_has_medium(med_mat)) {
            T *= medium_transmittance(med_mat, seg_ray, seg_len);
        }

        if (!hit_boundary) return T;                              // reached the light
        if (!is_null_interface(material_of(h.region_owner))) {
            return SPECTRUM_ZERO;                                 // opaque or dielectric: blocked (§6.3 v1)
        }
        medium = h.region_to;                                     // pass through the null interface
        seg_ray = ray_spawn(h, seg_ray.direction);                // far side by sign(dir·n)
    }
    return SPECTRUM_ZERO;                                         // budget exhausted: conservative
}
