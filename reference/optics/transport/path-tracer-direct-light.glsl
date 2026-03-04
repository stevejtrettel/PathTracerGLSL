// Path Tracer with Direct Light Sampling (NEE)
// Multi-bounce path tracing with next event estimation for area lights
// Depends on: scene_intersect, scene_intersect_any, ambient_frame, ambient_geodesic, ambient_dot,
//             lighting_sample, interaction_surface_shade, interaction_surface_scatter,
//             environment_radiance, random(), random2()

#define EPSILON 0.001
#define MAX_BOUNCES 10
#define RR_START_DEPTH 3

float luminance(vec3 color) {
    return 0.299 * color.r + 0.587 * color.g + 0.114 * color.b;
}

Radiance transport_trace(Ray ray) {
    vec3 throughput = vec3(1.0);
    vec3 radiance = vec3(0.0);

    Ray current_ray = ray;

    for (int bounce = 0; bounce < MAX_BOUNCES; bounce++) {
        Hit hit;
        if (!scene_intersect(current_ray, hit)) {
            vec3 env_radiance = environment_radiance(current_ray.direction);
            radiance += throughput * env_radiance;
            break;
        }

        hit.frame = ambient_frame(hit.p, hit.n);

        LightSample ls = lighting_sample(hit.p);

        if (ls.pdf > 0.0) {
            Ray shadow_ray;
            shadow_ray.origin = hit.p + hit.n * EPSILON;
            shadow_ray.direction = ls.wi;
            shadow_ray.tmin = EPSILON;
            shadow_ray.tmax = ls.distance - EPSILON;

            if (!scene_intersect_any(shadow_ray, ls.distance - EPSILON)) {
                vec3 f = interaction_surface_shade(ls.wi, -current_ray.direction, hit);
                radiance += throughput * ls.radiance * f / ls.pdf;
            }
        }

        if (bounce >= RR_START_DEPTH) {
            float p_survive = min(0.95, luminance(throughput));
            if (random() > p_survive) {
                break;
            }
            throughput /= p_survive;
        }

        float pdf;
        vec2 xi = random2();
        Direction wi = interaction_surface_scatter(
            -current_ray.direction,
            hit,
            pdf
        );

        if (pdf <= 0.0001) {
            break;
        }

        Spectrum f = interaction_surface_shade(
            wi,
            -current_ray.direction,
            hit
        );

        float cos_theta = max(0.0, ambient_dot(wi, hit.n, hit.p));

        if (cos_theta > 0.0001) {
            throughput *= f / pdf;
        } else {
            break;
        }

        current_ray.origin = ambient_geodesic(hit.p, hit.n, EPSILON);
        current_ray.direction = wi;
        current_ray.tmin = EPSILON;
        current_ray.tmax = 1000.0;
    }

    return Radiance(radiance);
}
