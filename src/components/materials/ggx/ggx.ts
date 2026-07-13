// GGX rough-conductor descriptor — co-located with ggx.glsl (module-anatomy §2). The
// occupant earns a folder (§4 rule: ≥3 artifacts — GLSL + descriptor + the twin test).

import type { MaterialModelDescriptor } from '../../descriptors.js';
import ggxGLSL from './ggx.glsl?raw';

export const ggxDescriptor: MaterialModelDescriptor = {
    id: 'ggx',
    glsl: ggxGLSL,
    // Fields read (matches ggx.glsl's header): f0, roughness. NO albedo — a conductor's
    // color IS its Fresnel f0; declaring both would invite double-tinting.
    properties: [
        { name: 'f0', glslType: 'Spectrum', semantic: 'radiometric', source: 'f0', default: 'Spectrum(0.9)', storage: 'field' },
        { name: 'roughness', glslType: 'float', semantic: 'geometric', source: 'roughness', default: '0.5', storage: 'field' },
    ],
    capabilities: {
        nonDeltaLobes: true,    // glossy: NEE samples it, MIS weights against ggx_pdf
        transmission: false,    // conductor — no ior table entry, no etaScale
        emissive: false,        // ggx_emission ≡ 0; authored emission warns (capability ∧ value)
    },
};
