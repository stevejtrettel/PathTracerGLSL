// optics/developer/gamma-developer.ts
import type { ModuleDescriptor } from '../../../infrastructure/engine/types';

/**
 * Gamma developer - converts from linear to sRGB color space
 * Applies gamma 2.2 correction for display on standard monitors
 */
const gammaDeveloper: ModuleDescriptor = {
    id: {
        kind: 'developer',
        name: 'gamma',
        version: '1.0.0'
    },

    fragment: {
        constants: `
            #define GAMMA 2.2
            #define INV_GAMMA (1.0 / 2.2)
        `,

        functions: `
            // Convert from linear radiance to display RGB
            RGB developer_develop(Radiance radiance) {
                // Clamp to [0,1] range for LDR display
                vec3 clamped = clamp(radiance, 0.0, 1.0);
                
                // Apply gamma correction: linear -> sRGB
                // We raise to 1/2.2 to go from linear (physics) to sRGB (perceptual)
                vec3 gamma_corrected = pow(clamped, vec3(INV_GAMMA));
                
                return RGB(gamma_corrected);
            }
        `
    },

    // exports: ['developer_develop']  // Disabled: using GLSL compiler validation instead
};

export { gammaDeveloper };
