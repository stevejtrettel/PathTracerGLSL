// Mirror descriptor — co-located with mirror.glsl (module-anatomy §2).

import type { MaterialModelDescriptor } from '../../descriptors.js';
import mirrorGLSL from './mirror.glsl?raw';

export const mirrorDescriptor: MaterialModelDescriptor = {
    id: 'mirror',
    glsl: mirrorGLSL,
    // Fields read (matches mirror.glsl's header): f0 — the SAME row ggx declares
    // (name+type), so the generated MaterialProperties shares ONE f0 field between
    // them (§3.4 unionFields dedupe — this occupant is its first real exercise).
    properties: [
        { name: 'f0', glslType: 'Spectrum', semantic: 'radiometric', source: 'f0', default: 0.9, storage: 'field' },
    ],
    capabilities: {
        nonDeltaLobes: false,   // pure delta: eval ≡ 0, NEE skips (the generated guard)
        transmission: false,    // conductor — no ior table entry, no etaScale
        emissive: false,        // mirror_emission ≡ 0; authored emission warns (capability ∧ value)
    },
};
