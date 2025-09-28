import type { ModuleDescriptor } from '../../engine/types.js';

/**
 * Direct lighting transport module
 * Implements one-bounce lighting: surface -> light with shadow testing
 */
const directLightingTransport: ModuleDescriptor = {
    id: {
        kind: 'transport',
        name: 'direct-lighting',
        version: '1.0.0'
    },

    fragment: {
        constants: `
            #define EPSILON 0.001
        `,

        functions: `
            RGB transport_trace(Ray ray) {
                // Find surface intersection
                Hit hit;
                if (!scene_intersect(ray, hit)) {
                    // No intersection - return background color
                    return RGB(0.1, 0.1, 0.2);  // Dark blue background
                }
                
                // Sample light from hit point
                LightSample ls = lighting_sample(hit.p);
                
                // Create shadow ray to test visibility
                Ray shadow_ray;
                shadow_ray.origin = ambient_geodesic(hit.p, hit.n, EPSILON);  // Offset along normal
                shadow_ray.direction = ls.wi;
                shadow_ray.tmin = EPSILON;
                shadow_ray.tmax = ls.distance - EPSILON;  // Stop just before light
                
                // Test for shadows
                if (scene_intersect_any(shadow_ray, ls.distance - EPSILON)) {
                    // In shadow - return ambient lighting only
                    MaterialProperties props = scene_material_properties(hit.material_to, hit.p);
                    return RGB(props.albedo * 0.1);  // 10% ambient
                }
                
                // Not in shadow - compute direct lighting
                Direction wo = ambient_parallel_transport(ray.origin, hit.p, -ray.direction);  // Toward viewer
                Spectrum shading = interaction_surface_shade(ls.wi, wo, hit);
                
                // Combine BRDF result with incident light
                Radiance outgoing = shading * ls.radiance;
                
                return RGB(outgoing);
            }
        `
    },

    exports: ['transport_trace']
};

export { directLightingTransport };
