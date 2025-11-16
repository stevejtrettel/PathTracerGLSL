import type { ModuleDescriptor } from '../../engine/types.js';

/**
 * Sphere area light module
 * The sphere exists only as a light source, not as geometry
 */
const sphereLight: ModuleDescriptor = {
    id: {
        kind: 'lighting',
        name: 'sphere-light',
        version: '1.0.0'
    },

    fragment: {
        uniforms: `
            uniform vec3 u_sphere_light_position;
            uniform float u_sphere_light_radius;
            uniform vec3 u_sphere_light_radiance;
        `,

        constants: `
            #define PI 3.14159265359
            #define TWO_PI 6.28318530718
        `,

        functions: `
            // Sample a point uniformly on sphere surface
            vec3 sample_uniform_sphere(vec3 center, float radius, vec2 xi) {
                // Map [0,1]^2 to sphere surface
                float z = 1.0 - 2.0 * xi.x;  // cos(theta)
                float r = sqrt(max(0.0, 1.0 - z * z));  // sin(theta)
                float phi = TWO_PI * xi.y;
                
                vec3 direction = vec3(
                    r * cos(phi),
                    r * sin(phi),
                    z
                );
                
                return center + radius * direction;
            }
            
            LightSample lighting_sample(Point p) {
                LightSample ls;
                
                // Just generate random numbers directly!
                vec2 xi = random2();
                
                // Sample point on sphere surface
                vec3 light_point = sample_uniform_sphere(
                    u_sphere_light_position,
                    u_sphere_light_radius,
                    xi
                );
                
                // Direction and distance from shading point to light sample
                vec3 to_light = light_point - p;
                float distance = length(to_light);
                ls.wi = to_light / distance;
                ls.distance = distance;
                ls.position = light_point;
                
                // Normal at the sampled point on sphere (pointing outward)
                vec3 light_normal = (light_point - u_sphere_light_position) / u_sphere_light_radius;
                
                // Check if light sample faces the shading point
                float cos_light = dot(-ls.wi, light_normal);
                
                
                if (cos_light <= 0.0) {
                 // Back side of sphere - no contribution
                    ls.radiance = vec3(0.0);
                    ls.pdf = 1.0;
                    return ls;
                }
                
                // Area of sphere
                float sphere_area = 4.0 * PI * u_sphere_light_radius * u_sphere_light_radius;
                
                // PDF in area measure (uniform sampling)
                float pdf_area = 1.0 / sphere_area;
                
                // Convert to solid angle measure
                // pdf_omega = pdf_area * distance^2 / cos(theta_light)
                ls.pdf = pdf_area * distance * distance / cos_light;
                
                // Emission (constant across sphere surface)
                ls.radiance = u_sphere_light_radiance;
                
                return ls;
            }
            
            // For MIS later - can this light be sampled?
            bool lighting_can_sample(int light_id) {
                return true;  // Yes, we can sample the sphere
            }
            
            // For MIS later - probability of generating direction wi
            float lighting_pdf(vec3 p, vec3 wi, int light_id) {
                // Would need to compute if wi hits the sphere
                // and what the sampling PDF would be
                // For now, return 0 (won't be used without MIS)
                return 0.0;
            }
        `
    },

    uniformBindings: [
        {
            uniform: 'u_sphere_light_position',
            parameters: ['sphere_light.position'],
            type: 'vec3',
            compute: (params) => params['sphere_light.position'] || [2.0, 1.0, 0.0]
        },
        {
            uniform: 'u_sphere_light_radius',
            parameters: ['sphere_light.radius'],
            type: 'float',
            compute: (params) => params['sphere_light.radius'] || 0.5
        },
        {
            uniform: 'u_sphere_light_radiance',
            parameters: ['sphere_light.color', 'sphere_light.intensity'],
            type: 'vec3',
            compute: (params) => {
                const color = params['sphere_light.color'] || [1.0, 1.0, 1.0];
                const intensity = params['sphere_light.intensity'] || 20.0;
                return [
                    color[0] * intensity,
                    color[1] * intensity,
                    color[2] * intensity
                ];
            }
        }
    ],

    // exports: ['lighting_sample', 'lighting_can_sample', 'lighting_pdf']  // Disabled: using GLSL compiler validation instead
};

export { sphereLight };
