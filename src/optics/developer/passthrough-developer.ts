// optics/developer/gamma-developer.ts
import type { ModuleDescriptor } from '../../engine/types';

/**
 * Gamma developer - converts from linear to sRGB color space
 * Applies gamma 2.2 correction for display on standard monitors
 */
const passthroughDeveloper: ModuleDescriptor = {
    id: {
        kind: 'developer',
        name: 'passthrough',
        version: '1.0.0'
    },

    fragment: {
        constants: ``,

        functions: `
            RGB developer_develop(Radiance radiance) {
                // do nothing: passthrough
                return RGB(radiance);
            }
        `
    },

    // exports: ['developer_develop']  // Disabled: using GLSL compiler validation instead
};

export { passthroughDeveloper };
