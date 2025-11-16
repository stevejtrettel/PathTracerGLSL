// objects/environment/constant-environment.ts
import type { ModuleDescriptor } from '../../engine/types';

/**
 * Constant color environment module
 * Provides uniform background color in all directions
 */
export const constEnvironment: ModuleDescriptor = {
    id: {
        kind: 'environment',
        name: 'constant',
        version: '1.0.0'
    },

    fragment: {
        uniforms: `
            uniform vec3 u_environment_color;
            uniform float u_environment_intensity;
        `,

        functions: `
            // Return constant radiance for any direction
            vec3 environment_radiance(vec3 direction) {
                return u_environment_color * u_environment_intensity;
            }
        `
    },

    uniformBindings: [
        {
            uniform: 'u_environment_color',
            parameters: ['environment.color'],
            type: 'vec3',
            compute: (params) => params['environment.color'] || [0.1, 0.1, 0.2]
        },
        {
            uniform: 'u_environment_intensity',
            parameters: ['environment.intensity'],
            type: 'float',
            compute: (params) => params['environment.intensity'] || 1.0
        }
    ],

    // exports: ['environment_radiance']  // Disabled: using GLSL compiler validation instead
};
