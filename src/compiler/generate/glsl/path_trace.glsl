// Path trace loop
// Requires: MAX_BOUNCES (define), environment_radiance(), interaction_surface_* dispatch (§3.3)
// Optional: ENABLE_NEE, ENABLE_RUSSIAN_ROULETTE, RR_START_DEPTH (defines)

Radiance transport_trace(Ray ray) {
    Spectrum throughput = SPECTRUM_ONE;
    Radiance radiance   = SPECTRUM_ZERO;
    Ray current_ray = ray;

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

        int mat = material_of(hit.region_to);           // §2.3: material derived from region (owner == region_to for solids)
        MaterialProperties props = scene_material_properties(mat, hit.p);
        Direction wo = -current_ray.direction;

        // Emission (bare property read; the one-sided/region_to gating is item 2 + §6.2)
        radiance += throughput * interaction_surface_emission(mat, wo, hit, props);

#ifdef ENABLE_NEE
        // Next Event Estimation. Explicit-xi light sampler is item 3.
        LightSample ls = lighting_sample(hit.p);
        if (ls.pdf > 0.0) {
            Ray shadow_ray;
            shadow_ray.origin = hit.p + hit.frame.n * EPSILON;
            shadow_ray.direction = ls.wi;
            shadow_ray.tmin = EPSILON;
            shadow_ray.tmax = ls.distance - EPSILON;
            if (!scene_intersect_any(shadow_ray, ls.distance - EPSILON)) {
                Spectrum f = interaction_surface_eval(mat, ls.wi, wo, hit, props);  // bare f (§2.2)
                float cos_i = abs(dot(ls.wi, hit.frame.n));                         // transport applies the cosine
                radiance += throughput * ls.radiance * f * cos_i / ls.pdf;
            }
        }
#endif

#ifdef ENABLE_RUSSIAN_ROULETTE
        // Russian roulette
        if (bounce >= RR_START_DEPTH) {
            float p_survive = min(0.95, luminance(throughput));
            if (random() > p_survive) break;
            throughput /= p_survive;
        }
#endif

        // BSDF sampling: sample-returns-weight collapses scatter+shade+pdf into one line (§2.1).
        InteractionSample bs = interaction_surface_sample(mat, wo, hit, props, random(), random2());
        if (spectrum_is_black(bs.weight)) break;
        throughput *= bs.weight;
        prev_was_delta = (bs.flags & LOBE_DELTA) != 0u;

        current_ray.origin = ambient_geodesic(hit.p, hit.frame.n, EPSILON);
        current_ray.direction = bs.wi;
        current_ray.tmin = EPSILON;
        current_ray.tmax = 1000.0;
    }

    return radiance;
}
