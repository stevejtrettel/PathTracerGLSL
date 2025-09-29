// optics/accumulator/averaging-accumulator.ts
import type { ModuleDescriptor } from '../../engine/types.js';

const averagingAccumulator: ModuleDescriptor = {
    id: {
        kind: 'accumulator',
        name: 'averaging',
        version: '1.0.0'
    },

    fragment: {
        uniforms: `
            uniform sampler2D u_accumulator_radiance_previous;
            uniform bool u_accumulator_reset;
            // Note: u_sample_count comes from engine
        `,

        functions: `
            Radiance accumulator_accumulate(Spectrum new_sample, vec2 pixel) {
                // Reset or first frame
                if (u_sample_count == 0 || u_accumulator_reset) {
                    return Radiance(new_sample);
                }
                
                // Read previous accumulated value
                ivec2 coord = ivec2(gl_FragCoord.xy);
                vec3 previous = texelFetch(u_accumulator_radiance_previous, coord, 0).rgb;
                
                // Simple running average: new_avg = (old_avg * n + new_sample) / (n + 1)
                // Which simplifies to: mix(old, new, 1/(n+1))
                float n = float(u_sample_count);
                float new_weight = 1.0 / (n + 1.0);
                
                return Radiance(mix(previous, new_sample, new_weight));
            }
        `
    },

    uniformBindings: [
        {
            uniform: 'u_accumulator_reset',
            parameters: ['accumulator.reset'],
            type: 'bool',
            compute: (params) => params['accumulator.reset'] || false
        }
        // u_accumulator_radiance_previous is bound by ResourceManager
        // u_sample_count comes from Engine
    ],

    exports: ['accumulator_accumulate']
};

export { averagingAccumulator };
