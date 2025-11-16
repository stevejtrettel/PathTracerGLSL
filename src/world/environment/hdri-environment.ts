// objects/environment/hdri-environment.ts
import type { ModuleDescriptor } from '../../engine/types';

export const hdriEnvironment: ModuleDescriptor = {
    id: {
        kind: 'environment',
        name: 'hdri',
        version: '1.0.0'
    },

    fragment: {
        uniforms: `
            uniform sampler2D u_env_map;
            uniform float u_env_intensity;
            uniform float u_env_rotation;  // Rotation angle in radians
        `,

        constants: `
            #define PI 3.14159265359
            #define TWO_PI 6.28318530718
        `,

        functions: `
            // Convert 3D direction to equirectangular UV
            vec2 direction_to_equirect(vec3 dir) {
                vec3 n = normalize(dir);
                float phi = atan(n.z, n.x) + u_env_rotation;
                float theta = acos(clamp(n.y, -1.0, 1.0));
                
                float u = phi / TWO_PI + 0.5;
                float v = theta / PI;
                
                return vec2(u, v);
            }
            
            //Sample environment radiance in a direction
            vec3 environment_radiance(vec3 direction) {
                vec2 uv = direction_to_equirect(direction);
                vec3 color = texture(u_env_map, uv).rgb;

                return color * u_env_intensity;
            }
           
        `
    },

    uniformBindings: [
        {
            uniform: 'u_env_intensity',
            parameters: ['environment.intensity'],
            type: 'float',
            compute: (params) => params['environment.intensity'] || 1.0
        },
        {
            uniform: 'u_env_rotation',
            parameters: ['environment.rotation'],
            type: 'float',
            compute: (params) => (params['environment.rotation'] || 0.0) * Math.PI / 180.0
        }
    ],

    // exports: ['environment_radiance']  // Disabled: using GLSL compiler validation instead
};
