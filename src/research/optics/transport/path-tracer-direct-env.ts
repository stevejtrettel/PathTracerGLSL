import type { ModuleDescriptor } from '../../../infrastructure/engine/types.js';

/**
 * Path tracing transport module with direct ENV sampling (NEE to sky)
 * Mirrors your light-based version but calls environment_sample(...)
 */
const pathTracerDirectEnv: ModuleDescriptor = {
    id: {
        kind: 'transport',
        name: 'pathtracer-direct-env',
        version: '1.0.0'
    },

    fragment: {
        constants: `
      #define EPSILON 0.001
      #define MAX_BOUNCES 10
      #define RR_START_DEPTH 3
    `,

        functions: `
      // Helper to compute luminance for Russian roulette
      float luminance(vec3 c) { return 0.299*c.r + 0.587*c.g + 0.114*c.b; }

      Radiance transport_trace(Ray ray) {
        vec3 throughput = vec3(1.0);
        vec3 radiance = vec3(0.0);

        Ray current_ray = ray;

        for (int bounce = 0; bounce < MAX_BOUNCES; bounce++) {
          Hit hit;
          if (!scene_intersect(current_ray, hit)) {
            // Ray escaped — evaluate environment in ray direction
            //DO NOTHING: WE ARE EXPLICIT LIGHT SAMPLING
            //THIS WILL MAKE THE SKY DARK IF YOU SEE IT, BUT WILL LIGHT OBJECTS WELL
           // vec3 env_radiance = environment_radiance(current_ray.direction);
           // radiance += throughput * env_radiance;

            break;
          }

          hit.frame = ambient_frame(hit.p, hit.n);

          // === Direct environment sampling (NEE to sky) ===
          LightSample ls = environment_sample(hit.p);  // <— swap from lighting_sample

          if (ls.pdf > 0.0) {
            Ray shadow_ray;
            shadow_ray.origin = hit.p + hit.n * EPSILON;
            shadow_ray.direction = ls.wi;
            shadow_ray.tmin = EPSILON;
            shadow_ray.tmax = ls.distance - EPSILON; // env module can set a big distance (e.g., 1e6)

            if (!scene_intersect_any(shadow_ray, ls.distance - EPSILON)) {
              vec3 f = interaction_surface_shade(ls.wi, -current_ray.direction, hit);
              // Keep your original weighting style: contribution / pdf
              radiance += throughput * ls.radiance * f / ls.pdf;
            }
          }

          // Russian roulette termination after a few bounces
          if (bounce >= RR_START_DEPTH) {
            float p_survive = min(0.95, luminance(throughput));
            if (random() > p_survive) break;
            throughput /= p_survive;
          }

          // === Next-event: sample BSDF for next bounce ===
          float pdf;
          vec2 xi = random2(); // your RNG
          Direction wi = interaction_surface_scatter(
            -current_ray.direction,
            hit,
            pdf
          );

          if (pdf <= 0.0001) break;

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

          // Setup ray for next bounce
          current_ray.origin = ambient_geodesic(hit.p, hit.n, EPSILON);
          current_ray.direction = wi;
          current_ray.tmin = EPSILON;
          current_ray.tmax = 1000.0;
        }

        return Radiance(radiance);
      }
    `
    },

    // exports: ['transport_trace']  // Disabled: using GLSL compiler validation instead
};

export { pathTracerDirectEnv };
