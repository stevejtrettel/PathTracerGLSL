// Lambert descriptor — co-located with lambert.glsl (module-anatomy §2: a model is one
// GLSL file + one descriptor; the pair moves together).

import type { MaterialModelDescriptor } from '../../descriptors.js';
import lambertGLSL from './lambert.glsl?raw';

export const lambertDescriptor: MaterialModelDescriptor = {
    id: 'lambert',
    glsl: lambertGLSL,
    // Fields read (matches lambert.glsl's header): albedo, emission.
    properties: [
        { name: 'albedo', glslType: 'Spectrum', semantic: 'radiometric', source: 'albedo', default: 0.8, storage: 'field' },
        { name: 'emission', glslType: 'Spectrum', semantic: 'radiometric', source: 'emission', default: 0, storage: 'field' },
    ],
    capabilities: {
        nonDeltaLobes: true,
        transmission: false,
        support: 'hemisphere',   // opaque diffuse: nothing arrives from below the normal
        emissive: true,
    },
};
