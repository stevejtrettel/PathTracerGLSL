// Path trace loop
// Requires: MAX_BOUNCES (define), environment_radiance()
// Optional: ENABLE_NEE, ENABLE_RUSSIAN_ROULETTE, RR_START_DEPTH (defines)

Radiance transport_trace(Ray ray) {
    vec3 throughput = vec3(1.0);
    vec3 radiance = vec3(0.0);
    Ray current_ray = ray;

    for (int bounce = 0; bounce < MAX_BOUNCES; bounce++) {
        Hit hit;
        if (!scene_intersect(current_ray, hit)) {
            radiance += throughput * environment_radiance(current_ray.direction);
            break;
        }

        MaterialProperties props = scene_material_properties(hit.material_to, hit.p);

        Spectrum emitted = interaction_surface_emit(props);
        radiance += throughput * emitted;

#ifdef ENABLE_NEE
        // Next Event Estimation
        LightSample ls = lighting_sample(hit.p);
        if (ls.pdf > 0.0) {
            Ray shadow_ray;
            shadow_ray.origin = hit.p + hit.frame.n * EPSILON;
            shadow_ray.direction = ls.wi;
            shadow_ray.tmin = EPSILON;
            shadow_ray.tmax = ls.distance - EPSILON;
            if (!scene_intersect_any(shadow_ray, ls.distance - EPSILON)) {
                vec3 f = interaction_surface_shade(ls.wi, -current_ray.direction, hit, props);
                radiance += throughput * ls.radiance * f / ls.pdf;
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

        // BRDF sampling
        float pdf;
        Direction wi = interaction_surface_scatter(-current_ray.direction, hit, props, pdf);
        if (pdf <= 0.0001) break;

        Spectrum f = interaction_surface_shade(wi, -current_ray.direction, hit, props);
        throughput *= f / pdf;

        current_ray.origin = ambient_geodesic(hit.p, hit.frame.n, EPSILON);
        current_ray.direction = wi;
        current_ray.tmin = EPSILON;
        current_ray.tmax = 1000.0;
    }

    return radiance;
}
