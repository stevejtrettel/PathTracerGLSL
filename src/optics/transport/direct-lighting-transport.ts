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
            Radiance transport_trace(Ray ray) {

                // Find surface intersection
                Hit hit;
                if (!scene_intersect(ray, hit)) {
                    // Use environment instead of black
                    return environment_radiance(ray.direction);
                }

                //otherwise we hit the scene! so we can pick up some ambient light
                MaterialProperties props = scene_material_properties(hit.material_to, hit.p);
                Radiance objColor = Radiance(props.albedo*0.05);  // 5% ambient


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
                    return objColor;
                }

                // Not in shadow - compute direct lighting
                Direction wo = ambient_parallel_transport(ray.origin, hit.p, -ray.direction);  // Toward viewer
                Spectrum shading = interaction_surface_shade(ls.wi, wo, hit);

                // Combine BRDF result with incident light
                Radiance diffuseLighting = shading * ls.radiance;

                return objColor + diffuseLighting;
            }
        `
    },

    // exports: ['transport_trace']  // Disabled: using GLSL compiler validation instead
};

export { directLightingTransport };
