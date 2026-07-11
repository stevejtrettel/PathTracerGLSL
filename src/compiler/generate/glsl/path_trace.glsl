// Path trace loop
// Requires: MAX_BOUNCES (define), environment_radiance(), interaction_surface_* dispatch (§3.3)
// Optional: ENABLE_NEE, ENABLE_RUSSIAN_ROULETTE, RR_START_DEPTH (defines)

Radiance transport_trace(Ray ray) {
    Spectrum throughput = SPECTRUM_ONE;
    Radiance radiance   = SPECTRUM_ZERO;
    Ray current_ray = ray;

#ifdef HAS_TRANSMISSION
    // §7.2 etaScale: transmission compresses radiance by η² (restored on exit), so RR keyed on
    // raw throughput over-kills inside dense media — this factor divides the compression back
    // out of the survival metric only. Efficiency, not bias.
    float eta_scale = 1.0;
#endif

    // §6.2 bookkeeping hook: tracked now, consumed when MIS / samplable environment land.
    // The camera "bounce" counts as delta so bounce-0 emission would be full-weight. Inert for
    // Lambert (never delta) until those readers exist — see docs/impl-plan-interaction-reshape.
    bool prev_was_delta = true;

    for (int bounce = 0; bounce < MAX_BOUNCES; bounce++) {
        Hit hit;
        if (!scene_intersect(current_ray, hit)) {
            radiance += throughput * environment_radiance(current_ray.direction);
            break;
        }

        int mat = material_of(hit.region_owner);        // §4.1: the boundary OWNER's BSDF shades (≠ region_to at exits)
        MaterialProperties props = scene_material_properties(mat, hit.p);
        Direction wo = -current_ray.direction;

        // Emission keys on region_to (§6.2 side convention: you receive emission from the region
        // ahead) — NOT on the owner. They differ at exits: leaving an emissive region contributes
        // nothing from behind. material_of(-1) = -1 resolves to non-emissive defaults.
        int mat_emit = material_of(hit.region_to);
        MaterialProperties eprops = props;
        if (mat_emit != mat) eprops = scene_material_properties(mat_emit, hit.p);
        radiance += throughput * interaction_surface_emission(mat_emit, wo, hit, eprops);

#ifdef ENABLE_NEE
        // Next Event Estimation (explicit xi — §2.9; delta lights ignore it). Pure-delta
        // materials skip it entirely (generated guard): their eval is zero, the shadow march
        // would be wasted.
        if (material_has_nondelta_lobes(mat)) {
            LightSample ls = lighting_sample(hit.p, random2());
            if (ls.pdf > 0.0) {
                // §6.3: the shadow query returns per-channel transmittance (opaque form: 0 or 1).
                // The shadow ray is a pure seed; its far bound (the light distance) is an argument.
                Ray shadow_ray = ray_spawn(hit, ls.wi);
                Spectrum vis = shadow_transmittance(shadow_ray, ls.distance - EPSILON);
                if (!spectrum_is_black(vis)) {
                    Spectrum f = interaction_surface_eval(mat, ls.wi, wo, hit, props);  // bare f (§2.2)
                    float cos_i = abs(ambient_dot(ls.wi, hit.frame.n, hit.p));          // transport applies the cosine (metric)
                    radiance += throughput * ls.radiance * f * cos_i * vis / ls.pdf;
                }
            }
        }
#endif

        // BSDF sampling: sample-returns-weight collapses scatter+shade+pdf into one line (§2.1).
        InteractionSample bs = interaction_surface_sample(mat, wo, hit, props, random(), random2());
        if (spectrum_is_black(bs.weight)) break;
        throughput *= bs.weight;
        prev_was_delta = (bs.flags & LOBE_DELTA) != 0u;

#ifdef HAS_TRANSMISSION
        // Accumulate the η² compression this crossing added (derivable from the hit's regions —
        // no eta field on the sample struct needed).
        if ((bs.flags & LOBE_TRANSMISSION) != 0u) {
            float r = ior_of(hit.region_to) / ior_of(hit.region_from);
            eta_scale *= r * r;
        }
#endif

#ifdef ENABLE_RUSSIAN_ROULETTE
        // Russian roulette — §7.2 pin: once per iteration, AFTER throughput *= weight, so survival
        // is keyed on post-weight throughput (kills worthless paths before the next trace).
#ifdef HAS_TRANSMISSION
        float rr_metric = spectrum_max(throughput) * eta_scale;   // η²-corrected (§7.2 note)
#else
        float rr_metric = spectrum_max(throughput);   // §2.5: basis-agnostic, no Rec.709 weights
#endif
        if (bounce >= RR_START_DEPTH) {
            float p_survive = min(0.95, rr_metric);
            if (random() > p_survive) break;
            throughput /= p_survive;
        }
#endif

        // Continuation ray: ray_spawn escapes the origin to wi's side of the surface along the
        // geodesic (self-intersection; transmission gets the far side). See docs/trace-loop-contract.md.
        current_ray = ray_spawn(hit, bs.wi);
    }

    return radiance;
}
