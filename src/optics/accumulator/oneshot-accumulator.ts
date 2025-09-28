
import type { ModuleDescriptor } from "../../engine/types";


export const oneshotAccumulator: ModuleDescriptor = {
    id: {
        kind: 'accumulator',
        name: 'oneshot',
        version: '1.0.0'
    },

    fragment: {
        functions: `
            // Pass through current sample - no accumulation
            Radiance accumulator_accumulate(Spectrum spectrum, vec2 pixel) {
                return Radiance(spectrum);
            }
        `
    },

    exports: ['accumulator_accumulate']
};
