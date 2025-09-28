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
            Spectrum interaction_surface_shade(Direction wi, Direction wo, Hit hit) {
                MaterialProperties props = scene_material_properties(hit.material_to, hit.p);
                
                // Cosine of angle between surface normal and light direction
                float cos_theta = max(0.0, ambient_dot(wi, hit.n,hit.p));
                
                // Lambert BRDF with energy conservation
                Spectrum brdf = props.albedo / PI;
                
                return brdf * cos_theta;
            }
        `
    },

    exports: ['interaction_surface_shade']
};
