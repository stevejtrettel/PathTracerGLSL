// Mirror descriptor — co-located with mirror.glsl (module-anatomy §2).

import type { MaterialModelDescriptor } from '../../descriptors.js';
import mirrorGLSL from './mirror.glsl?raw';

const body = { origin: 'components/materials/mirror/mirror.glsl', source: mirrorGLSL };

export const mirrorDescriptor: MaterialModelDescriptor = {
    id: 'mirror',
    // One file, checked in every space: it is written against the ambient seam alone.
    glsl: { euclidean: body, hyperbolic: body, spherical: body },
    // Fields read (matches mirror.glsl's header): f0 — the SAME row ggx declares
    // (name+type), so the generated MaterialProperties shares ONE f0 field between
    // them (§3.4 unionFields dedupe — this occupant is its first real exercise).
    properties: [
        { name: 'f0', glslType: 'Spectrum', role: 'reflectance', source: 'f0', default: 0.9, storage: 'field' },
    ],
    albedo: { row: 'f0' },   // reflectance at normal incidence
    capabilities: {
        nonDeltaLobes: false,   // pure delta: eval ≡ 0, NEE skips (the generated guard)
        transmission: false,    // conductor — no ior table entry, no etaScale
        support: 'hemisphere',  // reflection only (delta, but the fact is about SUPPORT)
        emissive: false,        // mirror_emission ≡ 0; authored emission warns (capability ∧ value)
    },
};
