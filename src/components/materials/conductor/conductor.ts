// Smooth-conductor descriptor — co-located with conductor.glsl (module-anatomy §2).

import type { MaterialModelDescriptor } from '../../descriptors.js';
import conductorGLSL from './conductor.glsl?raw';

export const conductorDescriptor: MaterialModelDescriptor = {
    id: 'conductor',
    glsl: { euclidean: { origin: 'components/materials/conductor/conductor.glsl', source: conductorGLSL } },
    // Fields read (matches conductor.glsl's header): the complex index η + iκ relative to the
    // outside medium, one value per wavelength lane (role 'optical'). The defaults (η = 0,
    // κ = 1, Mitsuba's) make a perfect mirror. κ > 0 keeps conductor_fresnel defined (η = κ = 0
    // is 0/0 at normal incidence).
    properties: [
        { name: 'eta', glslType: 'Spectrum', role: 'optical', source: 'eta', default: 0, storage: 'field' },
        { name: 'k', glslType: 'Spectrum', role: 'optical', source: 'k', default: 1, storage: 'field', constraint: { kind: 'positive' } },
    ],
    albedo: { fn: 'conductor_albedo' },   // reflectance at normal incidence
    capabilities: {
        nonDeltaLobes: false,   // pure delta: eval ≡ 0, NEE skips (the generated guard)
        transmission: false,    // conductor — no ior table entry, no etaScale
        support: 'hemisphere',  // reflection only
        emissive: false,        // conductor_emission ≡ 0
    },
};
