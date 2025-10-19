import type {ModuleDescriptor} from "../../engine/types";

export const albedoInteraction: ModuleDescriptor = {
    id: { kind: 'interaction', name: 'albedo', version: '1.0.0' },
    fragment: {
        functions: `
            vec3 interaction_surface_shade(vec3 wi, vec3 wo, Hit hit) {
                MaterialProperties props = scene_material_properties(hit.material_to, hit.p);
                Spectrum result = props.albedo;  // Just return albedo for now
                return result; 
            }
        `
    },
    exports: ['interaction_surface_shade']
};
