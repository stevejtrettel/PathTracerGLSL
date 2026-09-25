// Shadow transmittance — media form (§6.3; emitted INSTEAD of shadow_opaque when the scene
// has media + NEE; the NEE call sites never change). Segment-walk by RE-SPAWN
// (impl-plan-media deviation 1: the reference's t-windowed scene_intersect_from predates the
// trace-loop contract — same segments, pinned signatures only).
// Per segment: closed-form Beer–Lambert over full σ_t via medium_transmittance (generated,
// seam 2). Null interfaces pass; EVERYTHING else — opaque and dielectric alike — blocks
// (§6.3 v1 policy; transparent shadows are §10.2). Depends on: scene_intersect/scene_region_at
// (intersection), material_of, material_has_medium/is_null_interface/medium_transmittance
// (materials), ray_spawn (core).
//
// CROSSING BUDGET (measurement.maxNullCrossings): the shadow ray is the last segment of a path,
// and the measurement keeps paths with at most MAX_NULL_CROSSINGS null crossings in total.
// `crossings_left` is what the path has not spent (shadow_crossings_left in the walk); a shadow
// ray that would need more returns ZERO, exactly as the walk ends a BSDF path at the same total.
// That makes the loop bound the measurement, not a safety limit: every estimator drops the
// same paths.
//
// The stop bound is the LIGHT POINT, not a scalar distance (trace-loop-contract: a shadow ray
// is defined by its destination). Each segment re-derives the SHADOW_BACKOFF against the
// FIXED light_p — pbrt's SpawnRayTo discipline — so the back-off can never be eroded by the
// ray_spawn offsets that accumulate across null-interface crossings (a decremented distance
// would drift by one spawn offset per crossing until the area light's own surface blocked the
// shadow ray). (length() is Euclidean; a geodesic-distance ambient helper is the curved-space
// follow-up, like the straight-ray march itself.)

Spectrum shadow_transmittance(Ray shadow_ray, Point light_p, int crossings_left) {
    Spectrum T = SPECTRUM_ONE;
    // Starting medium recovered from the §4.4 containment oracle — self-contained
    // (works from surface points and medium event points alike).
    int medium = scene_region_at(shadow_ray.origin);
    Ray seg_ray = shadow_ray;

    // One iteration per segment; `crossed` = null interfaces behind this segment's origin.
    for (int crossed = 0; crossed <= crossings_left; crossed++) {
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
    return SPECTRUM_ZERO;   // one more crossing than the path's budget: outside the measured set
}
