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
        { name: 'f0', glslType: 'Spectrum', semantic: 'radiometric', source: 'f0', default: 0.9, storage: 'field' },
        { name: 'roughness', glslType: 'float', semantic: 'geometric', source: 'roughness', default: 0.5, storage: 'field' },
    ],
    // D4 derived: alpha = max(1e-3, roughness²) — declared ONCE, host-computed (baked
    // literal / driven closure); the three in-shader recomputations became mp.alpha.
    // The 1e-3 clamp is the descriptor's convention (author true mirrors as delta).
    derived: [{
        name: 'alpha', glslType: 'float', inputs: ['roughness'],
        fn: (v) => Math.max(1e-3, (v.roughness as number) * (v.roughness as number)),
    }],
    capabilities: {
        nonDeltaLobes: true,    // glossy: NEE samples it, MIS weights against ggx_pdf
        transmission: false,    // conductor — no ior table entry, no etaScale
        emissive: false,        // ggx_emission ≡ 0; authored emission warns (capability ∧ value)
    },
};
