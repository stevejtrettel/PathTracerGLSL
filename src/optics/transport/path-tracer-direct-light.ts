import type { ModuleDescriptor } from '../../engine/types.js';

/**
 * Path tracing transport module
 * Implements recursive light bouncing with Russian roulette termination
 */
const pathTracerDirectLight: ModuleDescriptor = {
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
                
                // Get RNG state from main - this is a bit hacky but works for now
                vec2 pixel = gl_FragCoord.xy;
                uint rng_state = hash3(uint(pixel.x), uint(pixel.y), uint(u_frame_index));
                
                Ray current_ray = ray;
                
                for (int bounce = 0; bounce < MAX_BOUNCES; bounce++) {
                
                    // decorrelate
                    uint rng_state = hash3(
                        uint(pixel.x), 
                        uint(pixel.y), 
                        uint(u_frame_index) * 73u + uint(bounce) * 1931u
                    );
    
                
                    Hit hit;
                    
                    // Find intersection
                    if (!scene_intersect(current_ray, hit)) {
                        // Ray escaped - add background
                        vec3 background = vec3(0.01, 0.01, 0.02);  // Dark blue-ish
                        radiance += throughput * background;
                        break;
                    }
                    
                    // Build local frame for shading
                    hit.frame = ambient_frame(hit.p, hit.n);
                    
                   // // Add emission from surface we hit
                   //  vec3 emission = interaction_surface_emit(hit);
                   //  if (length(emission) > 0.0) {
                   //      radiance += throughput * emission;
                   //  }

                    
                    // NEW: Sample the point light at this vertex
                    // THIS FILE WORKS WITH JUST SINGLE POINT LIGHT SOURCE
                    LightSample ls = lighting_sample(hit.p);
                   // if (ls.pdf > 0.0) {
                        Ray shadow_ray;
                        shadow_ray.origin = hit.p + hit.n * EPSILON;
                        shadow_ray.direction = ls.wi;
                        shadow_ray.tmin = EPSILON;
                        shadow_ray.tmax = ls.distance - EPSILON;
                        
                        if (!scene_intersect_any(shadow_ray, ls.distance - EPSILON)) {
                            vec3 f = interaction_surface_shade(ls.wi, -ray.direction, hit);
                            radiance += throughput * ls.radiance * f *0.01;
                        }
                       //}
                    
                    // Russian roulette termination after a few bounces
                    if (bounce >= RR_START_DEPTH) {
                        float p_survive = min(0.95, luminance(throughput));
                        if (random(rng_state) > p_survive) {
                            break;  // Terminate path
                        }
                        throughput /= p_survive;  // Boost surviving paths
                    }
                    
                    // Sample next direction using BRDF importance sampling
                    float pdf;
                    vec2 xi = random2(rng_state);
                    Direction wi = interaction_surface_scatter(
                        -current_ray.direction,  // wo (toward viewer/previous point)
                        hit,
                        xi,
                        pdf
                    );
                    
                    // Check for valid scatter
                    if (pdf <= 0.0001) {
                        break;  // No valid scatter direction
                    }
                    
                    // Evaluate BRDF for the sampled direction
                    // Note: interaction_surface_shade expects (wi toward light, wo toward viewer)
                    Spectrum f = interaction_surface_shade(
                        wi,                      // New direction (toward next point)
                        -current_ray.direction,  // Where we came from
                        hit
                    );
                    
                    // Update throughput with BRDF * cos(theta) / pdf
                    // The cosine is already in interaction_surface_shade for Lambert
                    // But we need to remove it since we importance sampled it
                    float cos_theta = max(0.0, ambient_dot(wi, hit.n, hit.p));
                    
                    // For Lambert: f already includes cos_theta, so we have:
                    // throughput *= (albedo/PI * cos_theta) / (cos_theta/PI) = albedo
                    // But let's be explicit:
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

    exports: ['transport_trace']
};

export { pathTracerDirectLight };
