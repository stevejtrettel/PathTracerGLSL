import type {ModuleDescriptor} from "../../engine/types";

export const lambertInteraction: ModuleDescriptor = {
    id: {
        kind: 'interaction',
        name: 'lambert',
        version: '1.0.0'
    },

    fragment: {
        constants: `
            #define PI 3.14159265359
        `,

        functions: `
            // Existing BRDF evaluation
            Spectrum interaction_surface_shade(Direction wi, Direction wo, Hit hit) {
                MaterialProperties props = scene_material_properties(hit.material_to, hit.p);
                
                // Cosine of angle between surface normal and light direction
                float cos_theta = max(0.0, ambient_dot(wi, hit.n, hit.p));
                
                // Lambert BRDF with energy conservation
                Spectrum brdf = props.albedo / PI;
                
                return brdf * cos_theta;
            }
            
            // NEW: Sample a scattered direction for Lambert diffuse
            Direction interaction_surface_scatter(Direction wo, Hit hit, vec2 xi, out float pdf) {
                // Cosine-weighted hemisphere sampling
                // This importance samples according to the cosine term
                
                // Generate direction in local space (z-up hemisphere)
                float cos_theta = sqrt(xi.y);  // Square root for cosine distribution
                float sin_theta = sqrt(1.0 - xi.y);
                float phi = 2.0 * PI * xi.x;
                
                vec3 local_wi = vec3(
                    sin_theta * cos(phi),
                    sin_theta * sin(phi),
                    cos_theta
                );
                
                // We need to build or use the hit.frame to transform to world space
                // Assuming hit.frame has been set up properly with t, b, n vectors
                Direction wi = hit.frame.t * local_wi.x + 
                              hit.frame.b * local_wi.y + 
                              hit.frame.n * local_wi.z;
                
                // PDF for cosine-weighted hemisphere sampling is cos(theta) / PI
                pdf = cos_theta / PI;
                
                return wi;
            }
            
            // NEW: Compute PDF for a given direction (for MIS later)
            float interaction_surface_pdf(Direction wi, Direction wo, Hit hit) {
                // For Lambert diffuse with cosine-weighted sampling
                float cos_theta = max(0.0, ambient_dot(wi, hit.n, hit.p));
                return cos_theta / PI;
            }
            
            // NEW: Get emission from this surface
            Spectrum interaction_surface_emit(Hit hit) {
                MaterialProperties props = scene_material_properties(hit.material_to, hit.p);
                return props.emission * props.emission_strength;
            }
        `
    },

    exports: [
        'interaction_surface_shade',
        'interaction_surface_scatter',
        'interaction_surface_pdf',
        'interaction_surface_emit'
    ]
};
