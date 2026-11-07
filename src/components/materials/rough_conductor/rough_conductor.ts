// Rough-conductor descriptor — co-located with rough_conductor.glsl (module-anatomy §2).

import type { MaterialModelDescriptor } from '../../descriptors.js';
import { microfacetAlpha } from '../microfacet.js';
import roughConductorGLSL from './rough_conductor.glsl?raw';

export const roughConductorDescriptor: MaterialModelDescriptor = {
    id: 'rough_conductor',
    glsl: { euclidean: { origin: 'components/materials/rough_conductor/rough_conductor.glsl', source: roughConductorGLSL } },
    // Fields read (matches rough_conductor.glsl's header): eta and k exactly as conductor
    // declares them (one struct field each when both are present), and roughness as ggx
    // declares it.
    properties: [
        { name: 'eta', glslType: 'Spectrum', role: 'optical', source: 'eta', default: 0, storage: 'field' },
        { name: 'k', glslType: 'Spectrum', role: 'optical', source: 'k', default: 1, storage: 'field', constraint: { kind: 'positive' } },
        { name: 'roughness', glslType: 'float', source: 'roughness', default: 0.5, storage: 'field', constraint: { kind: 'closed-interval', min: 0, max: 1 } },
    ],
    // alpha = max(1e-3, roughness²), the microfacet models' shared derived field.
    derived: [microfacetAlpha],
    // The F-free reflection lobe of glsl/core/microfacet.glsl. Its energy gain needs the
    // hemispherical average of conductor_fresnel per lane, which is not built.
    microfacet: { energy: 'not-built' },
    albedo: { fn: 'rough_conductor_albedo' },   // reflectance at normal incidence
    capabilities: {
        nonDeltaLobes: true,    // glossy: NEE samples it, MIS weights against rough_conductor_pdf
        transmission: false,    // conductor — no ior table entry, no etaScale
        support: 'hemisphere',  // reflection-only lobe
        emissive: false,        // rough_conductor_emission ≡ 0
    },
};
