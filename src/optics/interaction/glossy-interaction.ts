// glossy-interaction.ts
import type { ModuleDescriptor } from "../../engine/types";

export const glossyInteraction: ModuleDescriptor = {
    id: {
        kind: 'interaction',
        name: 'glossy',
        version: '1.0.0'
    },

    fragment: {
        constants: `
            #ifndef PI
            #define PI 3.14159265359
            #endif
        `,

        functions: `
            // Evaluate the mixture BRDF
            Spectrum interaction_surface_shade(Direction wi, Direction wo, Hit hit) {
                MaterialProperties props = scene_material_properties(hit.material_to, hit.p);
                
                float cos_theta = max(0.0, ambient_dot(wi, hit.n, hit.p));
                if (cos_theta <= 0.0) return vec3(0.0);
                
                vec3 result = vec3(0.0);
                
                // Check if wi matches the specular reflection direction
                vec3 reflected = reflect(-wo, hit.n);
                float alignment = dot(wi, reflected);
                
                // Specular lobe (weighted by 1-roughness)
                if (alignment > 0.99 && props.roughness < 0.999) {
                    float specular_weight = 1.0 - props.roughness;
                    result += props.albedo * specular_weight * cos_theta;
                }
                
                // Diffuse lobe (weighted by roughness)
                float diffuse_weight = props.roughness;
                result += (props.albedo / PI) * diffuse_weight * cos_theta;
                
                return result;
            }
            
            // Sample from the mixture distribution
            Direction interaction_surface_scatter(Direction wo, Hit hit, out float pdf) {
                MaterialProperties props = scene_material_properties(hit.material_to, hit.p);
                
                float specular_prob = 1.0 - props.roughness;
                
                if (random() < specular_prob) {
                    // Sample specular component
                    Direction wi = reflect(-wo, hit.n);
                    
                    float cos_theta = ambient_dot(wi, hit.n, hit.p);
                    if (cos_theta <= 0.0) {
                        pdf = 0.0001;
                        return hit.n;  // Shouldn't happen, but handle gracefully
                    }
                    
                    // PDF is just the selection probability (the delta integrates to 1)
                    pdf = specular_prob;
                    return wi;
                    
                } else {
                    // Sample diffuse component
                    vec2 xi = random2();
                    
                    // Cosine-weighted hemisphere sampling
                    float cos_theta = sqrt(xi.y);
                    float sin_theta = sqrt(1.0 - xi.y);
                    float phi = 2.0 * PI * xi.x;
                    
                    vec3 local_wi = vec3(
                        sin_theta * cos(phi),
                        sin_theta * sin(phi),
                        cos_theta
                    );
                    
                    Direction wi = hit.frame.t * local_wi.x + 
                                  hit.frame.b * local_wi.y + 
                                  hit.frame.n * local_wi.z;
                    
                    // Mixture PDF: P(choose diffuse) * P(direction | diffuse)
                    pdf = props.roughness * (cos_theta / PI);
                    return wi;
                }
            }
            
            // Evaluate mixture PDF for arbitrary direction
            float interaction_surface_pdf(Direction wi, Direction wo, Hit hit) {
                MaterialProperties props = scene_material_properties(hit.material_to, hit.p);
                
                float cos_theta = max(0.0, ambient_dot(wi, hit.n, hit.p));
                if (cos_theta <= 0.0) return 0.0001;
                
                float pdf = 0.0;
                
                // Specular component: delta function at reflection
                vec3 reflected = reflect(-wo, hit.n);
                if (dot(wi, reflected) > 0.99) {
                    pdf += (1.0 - props.roughness);
                }
                
                // Diffuse component: cosine-weighted hemisphere
                pdf += props.roughness * (cos_theta / PI);
                
                return max(pdf, 0.0001);
            }
            
            // Get emission from this surface
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
