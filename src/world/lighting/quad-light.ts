import type { ModuleDescriptor } from "../../engine/types";

const quadLight: ModuleDescriptor = {
    id: {
        kind: 'lighting',
        name: 'quad-light',
        version: '1.0.0'
    },

    fragment: {
        uniforms: `
            uniform vec3 u_quad_center;     // Center of the quad
            uniform vec3 u_quad_edge1;      // Edge vector 1 (full width)
            uniform vec3 u_quad_edge2;      // Edge vector 2 (full height)
            uniform vec3 u_quad_radiance;
        `,

        functions: `
            LightSample lighting_sample(Point p) {
                LightSample ls;
                
                vec2 xi = random2();
                
                // Sample point on quad centered at origin, then translate
                // xi is [0,1], shift to [-0.5, 0.5] to center the sampling
                vec3 light_point = u_quad_center + 
                                  (xi.x - 0.5) * u_quad_edge1 + 
                                  (xi.y - 0.5) * u_quad_edge2;
                
                // Quad normal
                vec3 quad_normal = normalize(cross(u_quad_edge1, u_quad_edge2));
                
                // Direction from shading point to light
                vec3 to_light = light_point - p;
                float distance = length(to_light);
                ls.wi = to_light / distance;
                ls.distance = distance;
                ls.position = light_point;
                
                // Check orientation
                float cos_light = dot(-ls.wi, quad_normal);
                if (cos_light <= 0.0) {
                    ls.radiance = vec3(0.0);
                    ls.pdf = 1.0;
                    return ls;
                }
                
                // Quad area = |edge1 × edge2|
                float area = length(cross(u_quad_edge1, u_quad_edge2));
                
                // PDF conversion from area to solid angle
                ls.pdf = (distance * distance) / (area * cos_light);
                
                ls.radiance = u_quad_radiance;
                
                return ls;
            }
        `
    },

    uniformBindings: [
        {
            uniform: 'u_quad_center',
            parameters: ['quad.center'],
            type: 'vec3',
            compute: (params) => params['quad.center'] || [0, 3.9, 0]
        },
        {
            uniform: 'u_quad_edge1',
            parameters: ['quad.width', 'quad.direction1'],
            type: 'vec3',
            compute: (params) => {
                const width = params['quad.width'] || 2.0;
                const dir = params['quad.direction1'] || [1, 0, 0];
                return dir.map(d => d * width);
            }
        },
        {
            uniform: 'u_quad_edge2',
            parameters: ['quad.height', 'quad.direction2'],
            type: 'vec3',
            compute: (params) => {
                const height = params['quad.height'] || 2.0;
                const dir = params['quad.direction2'] || [0, 0, 1];
                return dir.map(d => d * height);
            }
        },
        {
            uniform: 'u_quad_radiance',
            parameters: ['quad.color', 'quad.intensity'],
            type: 'vec3',
            compute: (params) => {
                const color = params['quad.color'] || [1.0, 1.0, 1.0];
                const intensity = params['quad.intensity'] || 25.0;
                return color.map(c => c * intensity);
            }
        }
    ],

    exports: ['lighting_sample']
};

export { quadLight };
