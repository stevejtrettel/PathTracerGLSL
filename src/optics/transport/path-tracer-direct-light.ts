import type { ModuleDescriptor } from '../../engine/types.js';

/**
 * Path tracing transport module with direct light sampling
 * Implements recursive light bouncing with NEE
 */
const pathTracerDirectLight: ModuleDescriptor = {
    id: {
        kind: 'transport',
        name: 'pathtracer-direct',
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
                vec3 throughput = vec3(1.0);
                vec3 radiance = vec3(0.0);
                
                Ray current_ray = ray;
                
                for (int bounce = 0; bounce < MAX_BOUNCES; bounce++) {
                    Hit hit;
                    if (!scene_intersect(current_ray, hit)) {
                        vec3 background = vec3(0.01, 0.01, 0.02);
                        radiance += throughput * background;
                        break;
                    }
                    
                    hit.frame = ambient_frame(hit.p, hit.n);
                    
                    // Sample the area light - NOW WITH RANDOM NUMBERS!
                    LightSample ls = lighting_sample(hit.p); 
                    
                    // Only add contribution if we got a valid sample
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
                    
                    // Russian roulette termination after a few bounces
                    if (bounce >= RR_START_DEPTH) {
                        float p_survive = min(0.95, luminance(throughput));
                        if (random() > p_survive) {  // Just call random()
                            break;
                        }
                        throughput /= p_survive;
                    }
                    
                    // Sample next direction using BRDF importance sampling
                    float pdf;
                    vec2 xi = random2();  // Just call random2()
                    Direction wi = interaction_surface_scatter(
                        -current_ray.direction,
                        hit,
                        pdf
                    );
                    
                    // Check for valid scatter
                    if (pdf <= 0.0001) {
                        break;
                    }
                    
                    // Evaluate BRDF for the sampled direction
                    Spectrum f = interaction_surface_shade(
                        wi,
                        -current_ray.direction,
                        hit
                    );
                    
                    // Update throughput
                    float cos_theta = max(0.0, ambient_dot(wi, hit.n, hit.p));
                    
                    if (cos_theta > 0.0001) {
                        throughput *= f / pdf;
                    } else {
                        break;
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

    exports: ['transport_trace']
};

export { pathTracerDirectLight };
