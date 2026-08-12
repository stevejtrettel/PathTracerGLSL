// Smooth-dielectric descriptor — co-located with dielectric.glsl (module-anatomy §2).

import type { MaterialModelDescriptor } from '../../descriptors.js';
import dielectricGLSL from './dielectric.glsl?raw';

export const dielectricDescriptor: MaterialModelDescriptor = {
    id: 'dielectric',
    glsl: dielectricGLSL,
    // Fields read (matches dielectric.glsl's header): transmittance at the shading point;
    // ior is region-indexed (read for the FAR side of the boundary via ior_of — the
    // reason the region-table storage kind exists).
    properties: [
        { name: 'transmittance', glslType: 'Spectrum', semantic: 'radiometric', source: 'transmittance', default: 1, storage: 'field' },
        { name: 'ior', glslType: 'float', semantic: 'geometric', source: 'ior', default: 1.5, storage: 'region-table', constraint: { kind: 'positive' } },
    ],
    capabilities: {
        nonDeltaLobes: false,   // pure delta: eval ≡ 0, NEE skips (the generated guard)
        transmission: true,
        // Support is the SPHERE (the transmission branch scatters to the far side), but
        // the lobes are DELTA, so NEE never runs here and the two-sided query never
        // fires — the two facts are independent, which is the point of the split
        // (fable-rough-dielectric §3.1). rough_dielectric is the pair that sets both.
        support: 'sphere',
        emissive: false,        // dielectric_emission ≡ 0 — an emissive-valued dielectric material emits nothing
    },
};
