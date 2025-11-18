// path-tracer-transport.ts

import type {ModuleDescriptor} from "../../../infrastructure/engine/types";


export const pathTracingTransport: ModuleDescriptor = {
    id: {
        kind: 'transport',
        name: 'pathtracer',
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
            float luminance(vec3 color) {
                return 0.299 * color.r + 0.587 * color.g + 0.114 * color.b;
            }
            
            Radiance transport_trace(Ray ray) {
                vec3 throughput = vec3(1.0);  // Path contribution weight
                vec3 radiance = vec3(0.0);     // Accumulated light
                
                Ray current_ray = ray;
                
                for (int bounce = 0; bounce < MAX_BOUNCES; bounce++) {
                    Hit hit;
                    
                    // Find intersection
                    if (!scene_intersect(current_ray, hit)) {
                        // Ray escaped - use environment
                        vec3 env_radiance = environment_radiance(current_ray.direction);
                        radiance += throughput * env_radiance;
                        break;
                    }
                    
                    // Build local frame for shading
                    hit.frame = ambient_frame(hit.p, hit.n);
                    
                    // Add emission from surface we hit
                    vec3 emission = interaction_surface_emit(hit);
                    if (length(emission) > 0.0) {
                        radiance += throughput * emission;
                    }
                    
                    // Russian roulette termination after a few bounces
                    if (bounce >= RR_START_DEPTH) {
                        float p_survive = min(0.95, luminance(throughput));
                        if (random() > p_survive) {
                            break;  // Terminate path
                        }
                        throughput /= p_survive;  // Boost surviving paths
                    }
                    
                    // Sample next direction using BRDF importance sampling
                    float pdf;
                    Direction wi = interaction_surface_scatter(
                        -current_ray.direction,  // wo (toward viewer/previous point)
                        hit,
                        pdf
                    );
                    
                    // Check for valid scatter
                    if (pdf <= 0.0001) {
                        break;  // No valid scatter direction
                    }
                    
                    // Evaluate BRDF for the sampled direction
                    Spectrum f = interaction_surface_shade(
                        wi,                      // New direction (toward next point)
                        -current_ray.direction,  // Where we came from
                        hit
                    );
                    
                    // Update throughput
                    float cos_theta = max(0.0, ambient_dot(wi, hit.n, hit.p));
                    
                    if (cos_theta > 0.0001) {
                        throughput *= f / pdf;
                    } else {
                        break;  // Terminate if we're going below surface
                    }
                    
                    // Set up next ray
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
