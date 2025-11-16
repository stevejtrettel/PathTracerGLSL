import type { ModuleDescriptor } from '../../engine/types.js';

/**
 * Point light module - single omnidirectional light source
 * Provides lighting_sample() function for direct illumination
 */
const pointLight: ModuleDescriptor = {
    id: {
        kind: 'lighting',
        name: 'point-light',
        version: '1.0.0'
    },

    fragment: {
        uniforms: `
            uniform vec3 u_light_position;    // World space position of light
            uniform vec3 u_light_radiance;    // RGB color * intensity
        `,

        functions: `
            LightSample lighting_sample(Point p) {
                LightSample ls;
                
                // Direction from surface point to light
                vec3 light_vector = u_light_position - p;
                ls.distance = length(light_vector);
                ls.wi = normalize(light_vector);
                
                // Light position in world space
                ls.position = u_light_position;
                
                // Inverse square falloff: I / r²
                ls.radiance = u_light_radiance / (ls.distance * ls.distance);
                
                return ls;
            }
        `
    },

    uniformBindings: [
        {
            uniform: 'u_light_position',
            parameters: ['light.position'],
            type: 'vec3',
            compute: (params) => params['light.position']
        },
        {
            uniform: 'u_light_radiance',
            parameters: ['light.color', 'light.intensity'],
            type: 'vec3',
            compute: (params) => {
                const color = params['light.color'] || [1.0, 1.0, 1.0];
                const intensity = params['light.intensity'] || 10.0;
                return [
                    color[0] * intensity,
                    color[1] * intensity,
                    color[2] * intensity
                ];
            }
        }
    ],

    // exports: ['lighting_sample']  // Disabled: using GLSL compiler validation instead
};

export { pointLight };
