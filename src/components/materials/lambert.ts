// Lambert descriptor — co-located with lambert.glsl (module-anatomy §2: a model is one
// GLSL file + one descriptor; the pair moves together).

import type { MaterialModelDescriptor } from '../descriptors.js';
import lambertGLSL from './lambert.glsl?raw';

export const lambertDescriptor: MaterialModelDescriptor = {
    id: 'lambert',
    glsl: lambertGLSL,
    // Fields read (matches lambert.glsl's header): albedo, emission (+ the paired
    // emission_strength — the resolver's strength coupling rides the emission row; the
    // §3.4 field merge is deferred, see the note in lambert.glsl).
    properties: [
        { name: 'albedo', glslType: 'Spectrum', semantic: 'radiometric', source: 'albedo', default: 'Spectrum(0.8)', storage: 'field' },
        { name: 'emission', glslType: 'Spectrum', semantic: 'radiometric', source: 'emission', default: 'SPECTRUM_ZERO', storage: 'field' },
    ],
    capabilities: {
        nonDeltaLobes: true,
        transmission: false,
        emissive: true,
    },
};
