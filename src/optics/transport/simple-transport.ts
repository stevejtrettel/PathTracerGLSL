import type {ModuleDescriptor} from "../../engine/types";


export const simpleTransport: ModuleDescriptor = {
    id: { kind: 'transport', name: 'direct', version: '1.0.0' },
    fragment: {
        functions: `
            vec3 transport_trace(Ray ray) {
                Hit hit;
                if (!scene_intersect(ray, hit)) {
                    return vec3(0.0);  // Black background
                }
                
                vec3 wo = -ray.direction;  // Toward camera
                vec3 wi = vec3(0.0);       // Placeholder
                
                return interaction_surface_shade(wi, wo, hit);
            }
        `
    },
    exports: ['transport_trace']
};
