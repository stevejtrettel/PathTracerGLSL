import type {ModuleDescriptor} from "../../engine/types";

export const simpleInteraction: ModuleDescriptor = {
    id: { kind: 'interaction', name: 'simple', version: '1.0.0' },
    fragment: {
        functions: `
            vec3 interaction_surface_shade(vec3 wi, vec3 wo, Hit hit) {
                MaterialProperties props = scene_material_properties(hit.material_to, hit.p);
                return props.albedo;  // Just return albedo for now
            }
        `
    },
    exports: ['interaction_surface_shade']
};
