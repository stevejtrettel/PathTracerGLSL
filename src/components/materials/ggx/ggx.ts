// GGX rough-conductor descriptor — co-located with ggx.glsl (module-anatomy §2). The
// occupant earns a folder (§4 rule: ≥3 artifacts — GLSL + descriptor + the twin test).

import type { MaterialModelDescriptor } from '../../descriptors.js';
import { microfacetAlpha } from '../microfacet.js';
import ggxGLSL from './ggx.glsl?raw';

export const ggxDescriptor: MaterialModelDescriptor = {
    id: 'ggx',
    glsl: ggxGLSL,
    // Fields read (matches ggx.glsl's header): f0, roughness. NO albedo — a conductor's
    // color IS its Fresnel f0; declaring both would invite double-tinting.
    properties: [
        // f0 ≤ 1 keeps the energy gain's bounce series (F_avg (1 − E_avg) < 1) convergent.
        { name: 'f0', glslType: 'Spectrum', role: 'reflectance', source: 'f0', default: 0.9, storage: 'field', constraint: { kind: 'closed-interval', min: 0, max: 1 } },
        // [0, 1]: the energy table's range (α ≤ 1).
        { name: 'roughness', glslType: 'float', source: 'roughness', default: 0.5, storage: 'field', constraint: { kind: 'closed-interval', min: 0, max: 1 } },
    ],
    // alpha = max(1e-3, roughness²), the microfacet models' shared derived field.
    derived: [microfacetAlpha],
    // D / G1 / VNDF / frame maps from glsl/core/microfacet.glsl; the conductor energy gain.
    microfacet: { energy: 'conductor' },
    albedo: { row: 'f0' },   // reflectance at normal incidence
    capabilities: {
        nonDeltaLobes: true,    // glossy: NEE samples it, MIS weights against ggx_pdf
        transmission: false,    // conductor — no ior table entry, no etaScale
        support: 'hemisphere',  // reflection-only lobe (ggx_eval returns 0 across the surface)
        emissive: false,        // ggx_emission ≡ 0; authored emission warns (capability ∧ value)
    },
};
